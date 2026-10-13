#!/usr/bin/env node
/**
 * Comissão de RC: Diogo fica de fora, a faturação do RC é a soma do Fatur.
 * dos clientes dele, a comissão é exactamente 4%, e um cliente de outro RC não entra.
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));

function check(title, fn) {
  try {
    fn();
    console.log('OK  ' + title);
  } catch (e) {
    console.error('FAIL ' + title);
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }
}

const ctx = { console, Math, Number, String, Object, Array, parseInt, decodeURIComponent, encodeURIComponent };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'comissao-rc-mapa.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'comissao-rc.js'), 'utf8'), ctx);

const {
  pessoaEhDiogo,
  mapaDeLinhasComissaoRc,
  calcularComissaoRc,
  seedMapaComissaoRc,
  comissaoDeFaturacao,
} = ctx;

check('nome Diogo e NPess 99520004 são ignorados', () => {
  assert.equal(pessoaEhDiogo('DIOGO OLIVEIRA', 0), true);
  assert.equal(pessoaEhDiogo('diogo', 0), true);
  assert.equal(pessoaEhDiogo('Ricardo Miranda', 99520004), true);
  assert.equal(pessoaEhDiogo('JOCINEI NEVES', 99520018), true);
  assert.equal(pessoaEhDiogo('EMANUEL VALLE', 0), false);
});

check('linhas do Diogo não entram no mapa', () => {
  const mapa = mapaDeLinhasComissaoRc([
    { pessoa: 'DIOGO OLIVEIRA', cod: '749068', nome: 'Grupo Fartura' },
    { pessoa: 'Diogo', npess: 99520004, cod: '749002', nome: 'Cencosud' },
    { pessoa: 'JOCINEI NEVES', cod: '433720', nome: 'Coop Vale' },
    { pessoa: 'JOCINEI NEVES', cod: '433720', nome: 'Coop Vale duplicado' },
    { pessoa: 'EMANUEL VALLE', cod: '410730', nome: 'Rubi' },
  ]);
  const nomes = mapa.rcs.map(r => r.nome);
  assert.deepEqual(nomes.sort(), ['EMANUEL VALLE', 'JOCINEI NEVES']);
  const joc = mapa.rcs.find(r => r.nome === 'JOCINEI NEVES');
  assert.equal(joc.clientes.length, 1);
  assert.equal(joc.clientes[0].cod, '433720');
  assert.ok(!mapa.rcs.some(r => /diogo/i.test(r.nome)));
});

check('soma do RC, 4% exactos, cliente alheio fica de fora', () => {
  const mapa = mapaDeLinhasComissaoRc([
    { pessoa: 'JOCINEI NEVES', cod: '10', nome: 'Cliente A' },
    { pessoa: 'JOCINEI NEVES', cod: '20', nome: 'Cliente B' },
    { pessoa: 'JOCINEI NEVES', cod: '30', nome: 'Sem movimento' },
    { pessoa: 'EMANUEL VALLE', cod: '99', nome: 'Outro RC' },
    { pessoa: 'DIOGO OLIVEIRA', cod: '77', nome: 'Não entra' },
  ]);
  const mes = {
    clientes: {
      '10\t99520004': { cod: '10', valor: 1000, nome: 'Cliente A SAP' },
      '10\t1': { cod: '10', valor: 500, nome: 'Cliente A' },
      '20\t2': { cod: '20', valor: -200, nome: 'Cliente B' },
      '99\t3': { cod: '99', valor: 8000, nome: 'Outro RC' },
      '77\t99520004': { cod: '77', valor: 4000, nome: 'Diogo' },
    },
  };
  const res = calcularComissaoRc(mapa, mes);
  assert.equal(res.linhas.length, 2);
  const joc = res.linhas.find(r => r.nome === 'JOCINEI NEVES');
  assert.ok(joc);
  assert.equal(joc.faturacao, 1300);
  assert.equal(joc.comissao, 1300 * 0.04);
  assert.equal(joc.comissao, comissaoDeFaturacao(joc.faturacao));
  assert.equal(joc.comissao, 52);
  const cods = joc.clientes.map(c => c.cod).sort();
  assert.deepEqual(cods, ['10', '20', '30']);
  const zero = joc.clientes.find(c => c.cod === '30');
  assert.equal(zero.faturacao, 0);
  assert.equal(zero.comissao, 0);
  assert.ok(!joc.clientes.some(c => c.cod === '99' || c.cod === '77'));
  const em = res.linhas.find(r => r.nome === 'EMANUEL VALLE');
  assert.equal(em.faturacao, 8000);
  assert.equal(em.comissao, 320);
  assert.equal(res.total.faturacao, 9300);
  assert.equal(res.total.comissao, 9300 * 0.04);
});

check('faturação negativa deixa a comissão negativa', () => {
  const mapa = mapaDeLinhasComissaoRc([
    { pessoa: 'RICARDO MIRANDA', cod: '5', nome: 'Devolução' },
  ]);
  const res = calcularComissaoRc(mapa, {
    clientes: { '5\t1': { cod: '5', valor: -250, nome: 'Devolução' } },
  });
  assert.equal(res.linhas[0].faturacao, -250);
  assert.equal(res.linhas[0].comissao, -10);
  assert.equal(res.total.comissao, -10);
});

check('seed do Excel não tem Diogo e tem os RC', () => {
  const seed = seedMapaComissaoRc();
  assert.ok(seed.rcs.length >= 1);
  assert.ok(!seed.rcs.some(r => /diogo/i.test(r.nome)));
  const nomes = seed.rcs.map(r => r.nome);
  assert.ok(nomes.indexOf('JOCINEI NEVES') >= 0);
  assert.ok(nomes.indexOf('FABRICIO FERNANDES') >= 0);
  assert.ok(nomes.indexOf('RICARDO MIRANDA') >= 0);
  const n = seed.rcs.reduce((s, r) => s + r.clientes.length, 0);
  assert.equal(seed.rcs.length, 7);
  assert.equal(n, 81);
  const joc = seed.rcs.find(r => r.nome === 'JOCINEI NEVES');
  assert.ok(joc.clientes.some(c => c.cod === '433720'));
  assert.ok(!seed.rcs.some(r => r.clientes.some(c => c.cod === '749068')));
});

if (!process.exitCode) console.log('comissão de RC: testes ok');
