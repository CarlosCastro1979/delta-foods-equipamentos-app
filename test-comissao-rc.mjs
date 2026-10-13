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

const queue = [];
function check(title, fn) {
  queue.push([title, fn]);
}

const ctx = {
  console, Math, Number, String, Object, Array, JSON, Date,
  parseInt, decodeURIComponent, encodeURIComponent, isFinite,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'comissao-rc-mapa.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'comissao-rc.js'), 'utf8'), ctx);

const {
  pessoaEhDiogo,
  mapaDeLinhasComissaoRc,
  calcularComissaoRc,
  seedMapaComissaoRc,
  comissaoDeFaturacao,
  linhasDeTabelaComissaoRc,
  substituirMapaComissaoRc,
  lerMapaComissaoRc,
  guardarMapaComissaoRc,
  COMISSAO_RC_SUPA_ID,
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
  assert.equal(n, 82);
  const joc = seed.rcs.find(r => r.nome === 'JOCINEI NEVES');
  assert.ok(joc.clientes.some(c => c.cod === '433720'));
  assert.ok(!seed.rcs.some(r => r.clientes.some(c => c.cod === '749068')));
  const donos749002 = seed.rcs.filter(r => r.clientes.some(c => c.cod === '749002')).map(r => r.nome);
  assert.deepEqual(donos749002, ['RICARDO MIRANDA']);
  const ric = seed.rcs.find(r => r.nome === 'RICARDO MIRANDA');
  const cenco = ric.clientes.find(c => c.cod === '749002');
  assert.equal(cenco.nome, 'Cencosud Brasil Comercial S.a');
  assert.ok(ric.clientes.some(c => c.cod === '749004'));
  assert.ok(ric.clientes.some(c => c.cod === '759725'));
});

check('folha nova substitui o mapa e larga códigos que desapareceram', () => {
  const anterior = mapaDeLinhasComissaoRc([
    { pessoa: 'RICARDO MIRANDA', cod: '749002', nome: 'Cencosud Brasil Comercial S.a' },
    { pessoa: 'RICARDO MIRANDA', cod: '111', nome: 'Cliente que sai' },
    { pessoa: 'JOCINEI NEVES', cod: '222', nome: 'Coop' },
    { pessoa: 'DIOGO OLIVEIRA', cod: '749068', nome: 'Não devia estar' },
  ]);
  assert.ok(anterior.rcs.some(r => r.clientes.some(c => c.cod === '111')));
  const leitura = linhasDeTabelaComissaoRc([
    ['Nr e N', 'e Cliente', 'NOME VENDEDOR', 'Nº Pess'],
    [749002, 'Cencosud Brasil Comercial S.a', 'RICARDO MIRANDA', ''],
    ['222', 'Coop. Prod. E Abastecim. Vale Do It', 'JOCINEI NEVES', ''],
    ['749068', 'Grupo Fartura De Hortifrut S.a.', 'DIOGO OLIVEIRA', 99520004],
    ['333', 'Outro Diogo', 'diogo silva', ''],
    ['425623', 'Caico Distribuid. Laticinios Frios', 'EMANUEL VALLE', ''],
    ['425623', 'Caicó', 'FABRICIO FERNANDES', ''],
    ['10', 'Pelo NPess', 'RICARDO MIRANDA', 99520004],
  ]);
  assert.equal(leitura.ok, true);
  assert.ok(leitura.ignorados >= 2);
  const aplicado = substituirMapaComissaoRc(anterior, leitura);
  assert.equal(aplicado.substituido, true);
  const porCod = {};
  for (const rc of aplicado.mapa.rcs) {
    for (const c of rc.clientes) porCod[c.cod] = { rc: rc.nome, nome: c.nome };
  }
  assert.equal(porCod['749002'].rc, 'RICARDO MIRANDA');
  assert.equal(porCod['749002'].nome, 'Cencosud Brasil Comercial S.a');
  assert.equal(porCod['222'].rc, 'JOCINEI NEVES');
  assert.equal(porCod['425623'].rc, 'EMANUEL VALLE');
  assert.equal(porCod['425623'].nome, 'Caico Distribuid. Laticinios Frios');
  assert.equal(porCod['111'], undefined);
  assert.equal(porCod['749068'], undefined);
  assert.equal(porCod['333'], undefined);
  assert.equal(porCod['10'], undefined);
  assert.ok(!aplicado.mapa.rcs.some(r => /diogo/i.test(r.nome)));
});

check('folha cifrada ou inválida não limpa o mapa', () => {
  const anterior = mapaDeLinhasComissaoRc([
    { pessoa: 'RICARDO MIRANDA', cod: '749002', nome: 'Cencosud Brasil Comercial S.a' },
    { pessoa: 'RICARDO MIRANDA', cod: '111', nome: 'Mantém-se' },
  ]);
  const cifrado = substituirMapaComissaoRc(anterior, {
    ok: false,
    erro: 'ECMA-376 Encrypted file missing /EncryptionInfo',
  });
  assert.equal(cifrado.substituido, false);
  assert.ok(/não foi alterado/i.test(cifrado.erro));
  assert.ok(cifrado.mapa.rcs.some(r => r.clientes.some(c => c.cod === '111')));
  assert.ok(cifrado.mapa.rcs.some(r => r.clientes.some(c => c.cod === '749002')));
  const invalida = substituirMapaComissaoRc(anterior, linhasDeTabelaComissaoRc([
    ['Foo', 'Bar'],
    ['1', '2'],
  ]));
  assert.equal(invalida.substituido, false);
  assert.ok(invalida.mapa.rcs.some(r => r.clientes.some(c => c.cod === '111')));
  const soDiogo = substituirMapaComissaoRc(anterior, linhasDeTabelaComissaoRc([
    ['Cliente', 'Nome', 'NOME VENDEDOR', 'Nº Pess'],
    ['749068', 'Fartura', 'DIOGO OLIVEIRA', 99520004],
    ['77', 'Outro', 'JOCINEI NEVES', 99530001],
  ]));
  assert.equal(soDiogo.substituido, false);
  assert.ok(soDiogo.mapa.rcs.some(r => r.clientes.some(c => c.cod === '749002')));
});

check('a nuvem com RC ganha ao mapa empacotado', async () => {
  ctx.SUPA_KEY = 'chave-teste';
  ctx.LISTA_CLIENTES_SUPA_URL = 'https://example.test/lista_clientes';
  ctx.fetch = async (url) => {
    assert.ok(String(url).includes('id=eq.comissao_rc'));
    return {
      ok: true,
      async json() {
        return [{
          data: {
            rcs: [{ nome: 'RICARDO MIRANDA', clientes: [{ cod: '749002', nome: 'Cencosud Brasil Comercial S.a' }] }],
          },
        }];
      },
    };
  };
  const mapa = await lerMapaComissaoRc();
  assert.equal(mapa.rcs.length, 1);
  assert.equal(mapa.rcs[0].nome, 'RICARDO MIRANDA');
  assert.equal(mapa.rcs[0].clientes[0].cod, '749002');
  assert.ok(mapa.rcs[0].clientes.length < 10, 'não devolve o seed completo');
});

check('gravar a lista só escreve comissao_rc', async () => {
  const posts = [];
  ctx.SUPA_KEY = 'chave-teste';
  ctx.LISTA_CLIENTES_SUPA_URL = 'https://example.test/lista_clientes';
  ctx.Date = Date;
  ctx.JSON = JSON;
  const mem = {};
  ctx.localStorage = {
    getItem(k) { return mem[k] || null; },
    setItem(k, v) { mem[k] = v; },
  };
  ctx.fetch = async (url, opt) => {
    posts.push({ url: String(url), method: opt && opt.method, body: opt && opt.body });
    return { ok: true, async json() { return []; } };
  };
  const mapa = mapaDeLinhasComissaoRc([
    { pessoa: 'RICARDO MIRANDA', cod: '749002', nome: 'Cencosud Brasil Comercial S.a' },
  ]);
  const gravado = await guardarMapaComissaoRc(mapa);
  assert.equal(gravado.ok, true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].method, 'POST');
  assert.ok(!/vendas_quadro|vendas_cliente|nfe|id=eq\.v1/.test(posts[0].url + posts[0].body));
  const body = JSON.parse(posts[0].body);
  assert.equal(body.id, COMISSAO_RC_SUPA_ID);
  assert.equal(body.id, 'comissao_rc');
  assert.ok(body.data.rcs.some(r => r.clientes.some(c => c.cod === '749002')));
  ctx.fetch = async () => ({ ok: false, status: 500, async json() { return []; } });
  const falha = await guardarMapaComissaoRc(mapaDeLinhasComissaoRc([
    { pessoa: 'JOCINEI NEVES', cod: '1', nome: 'Novo' },
  ]));
  assert.equal(falha.ok, false);
  assert.ok(/mantém-se|não foi/i.test(falha.erro));
});

check('o ecrã Dados tem o carregador por baixo da lista de clientes', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const iSap = html.indexOf('>Carregar Lista SAP<');
  const iRc = html.indexOf('>Carregar lista de RC<');
  const iDiv = html.indexOf('>Carregar Dívidas<');
  assert.ok(iSap > 0 && iRc > iSap && iDiv > iRc);
  assert.ok(html.includes('dados-rc-input'));
  assert.ok(html.includes('Nomes de vendedor'));
  assert.ok(html.includes('o que for Diogo é ignorado'));
  const mark = 'async function carregarListaComissaoRc(';
  const start = html.indexOf(mark);
  assert.ok(start > 0);
  const brace = html.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  const fn = html.slice(start, end);
  const iDiag = fn.indexOf('diagnosticoExcelListaSap');
  const iRead = fn.indexOf('XLSX.read');
  const iSub = fn.indexOf('substituirMapaComissaoRc(');
  const iSave = fn.indexOf('await guardarMapaComissaoRc(');
  assert.ok(iDiag > 0 && iRead > iDiag && iSub > iRead && iSave > iSub, [iDiag, iRead, iSub, iSave].join(','));
  assert.ok(fn.includes("toast('Guardado')"));
  assert.ok(!fn.includes('publicarListaClientesSupabase'));
  assert.ok(!fn.includes('vendas_quadro'));
  assert.ok(sw.includes('v2026-10-13-comissao-rc-carga'));
  assert.ok(html.includes('v2026-10-13-comissao-rc-carga'));
});

for (const [title, fn] of queue) {
  try {
    await fn();
    console.log('OK  ' + title);
  } catch (e) {
    console.error('FAIL ' + title);
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }
}

if (!process.exitCode) console.log('comissão de RC: testes ok');
