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
  console, Math, Number, String, Object, Array, JSON, Date, Intl,
  parseInt, decodeURIComponent, encodeURIComponent, isFinite, isNaN,
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
  aplicarCarryComissao,
  estadoMensalComissaoRc,
  resumoAnualComissaoRc,
  htmlResumoAnualComissaoRc,
  montarEmailComissaoRc,
  nomeFicheiroResumoAnualComissaoRc,
  textoNotaResumoAnualExcelComissaoRc,
  escreverFolhaResumoAnualComissaoRc,
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

function mesFatur(cod, valor) {
  return { clientes: { [cod + '\t1']: { cod: String(cod), valor, nome: 'Cliente' } } };
}

check('abatimento: negativo não se paga, depois abate até zerar', () => {
  const mapa = mapaDeLinhasComissaoRc([
    { pessoa: 'RICARDO MIRANDA', cod: '5', nome: 'Devolução' },
    { pessoa: 'JOCINEI NEVES', cod: '9', nome: 'Positivo' },
  ]);
  const store = {
    meses: {
      '2026-01': {
        clientes: {
          '5\t1': { cod: '5', valor: -250, nome: 'Devolução' },
          '9\t1': { cod: '9', valor: 500, nome: 'Positivo' },
        },
      },
      '2026-02': mesFatur('5', 100),
      '2026-03': mesFatur('5', 500),
      '2026-04': mesFatur('5', 200),
    },
  };
  const a = estadoMensalComissaoRc(mapa, store, '2026-01').linhas.find(r => r.nome === 'RICARDO MIRANDA');
  assert.equal(a.comissao, -10);
  assert.equal(a.abatimento, 0);
  assert.equal(a.aPagar, 0);
  assert.equal(a.saldo, -10);
  const joc = estadoMensalComissaoRc(mapa, store, '2026-01').linhas.find(r => r.nome === 'JOCINEI NEVES');
  assert.equal(joc.comissao, 20);
  assert.equal(joc.abatimento, 0);
  assert.equal(joc.aPagar, 20);
  assert.equal(joc.saldo, 0);

  const b = estadoMensalComissaoRc(mapa, store, '2026-02').linhas.find(r => r.nome === 'RICARDO MIRANDA');
  assert.equal(b.comissao, 4);
  assert.equal(b.abatimento, 4);
  assert.equal(b.aPagar, 0);
  assert.equal(b.saldo, -6);

  const c = estadoMensalComissaoRc(mapa, store, '2026-03').linhas.find(r => r.nome === 'RICARDO MIRANDA');
  assert.equal(c.comissao, 20);
  assert.equal(c.abatimento, 6);
  assert.equal(c.aPagar, 14);
  assert.equal(c.saldo, 0);

  const d = estadoMensalComissaoRc(mapa, store, '2026-04').linhas.find(r => r.nome === 'RICARDO MIRANDA');
  assert.equal(d.comissao, 8);
  assert.equal(d.abatimento, 0);
  assert.equal(d.aPagar, 8);
  assert.equal(d.saldo, 0);
  assert.equal(aplicarCarryComissao(8, 0).aPagar, 8);
});

check('dois meses negativos acumulam a dívida', () => {
  const mapa = mapaDeLinhasComissaoRc([
    { pessoa: 'RICARDO MIRANDA', cod: '5', nome: 'Devolução' },
  ]);
  const store = {
    meses: {
      '2026-01': mesFatur('5', -250),
      '2026-02': mesFatur('5', -125),
    },
  };
  const a = estadoMensalComissaoRc(mapa, store, '2026-01').linhas[0];
  const b = estadoMensalComissaoRc(mapa, store, '2026-02').linhas[0];
  assert.equal(a.comissao, -10);
  assert.equal(a.aPagar, 0);
  assert.equal(a.saldo, -10);
  assert.equal(b.comissao, -5);
  assert.equal(b.abatimento, 0);
  assert.equal(b.aPagar, 0);
  assert.equal(b.saldo, -15);
});

check('mês sem comissão não abate a dívida', () => {
  const mapa = mapaDeLinhasComissaoRc([
    { pessoa: 'RICARDO MIRANDA', cod: '5', nome: 'Devolução' },
  ]);
  const store = {
    meses: {
      '2026-01': mesFatur('5', -250),
      '2026-02': mesFatur('5', 0),
    },
  };
  const b = estadoMensalComissaoRc(mapa, store, '2026-02').linhas[0];
  assert.equal(b.comissao, 0);
  assert.equal(b.abatimento, 0);
  assert.equal(b.aPagar, 0);
  assert.equal(b.saldo, -10);
});

check('dívida do ano anterior abate em Janeiro', () => {
  const mapa = mapaDeLinhasComissaoRc([
    { pessoa: 'RICARDO MIRANDA', cod: '5', nome: 'Devolução' },
    { pessoa: 'JOCINEI NEVES', cod: '9', nome: 'Outro' },
  ]);
  const store = {
    meses: {
      '2025-11': mesFatur('5', 1000),
      '2025-12': mesFatur('5', -250),
      '2026-02': mesFatur('5', 500),
    },
  };
  const dez = estadoMensalComissaoRc(mapa, store, '2025-12').linhas.find(r => r.nome === 'RICARDO MIRANDA');
  assert.equal(dez.comissao, -10);
  assert.equal(dez.aPagar, 0);
  assert.equal(dez.saldo, -10);

  const jan = estadoMensalComissaoRc(mapa, store, '2026-01').linhas.find(r => r.nome === 'RICARDO MIRANDA');
  assert.equal(jan.comissao, 0);
  assert.equal(jan.abatimento, 0);
  assert.equal(jan.aPagar, 0);
  assert.equal(jan.saldo, -10);

  const fev = estadoMensalComissaoRc(mapa, store, '2026-02').linhas.find(r => r.nome === 'RICARDO MIRANDA');
  assert.equal(fev.comissao, 20);
  assert.equal(fev.abatimento, 10);
  assert.equal(fev.aPagar, 10);
  assert.equal(fev.saldo, 0);

  const anual = resumoAnualComissaoRc(mapa, store, 2026);
  const chavesAno = [];
  for (let m = 1; m <= 12; m++) chavesAno.push('2026-' + String(m).padStart(2, '0'));
  assert.deepEqual(Object.keys(anual.meses), chavesAno);
  assert.deepEqual(anual.rcs, ['JOCINEI NEVES', 'RICARDO MIRANDA']);
  assert.equal(anual.linhas, undefined);
  const ric = (mes) => anual.meses['2026-' + String(mes).padStart(2, '0')].passos['RICARDO MIRANDA'];
  assert.deepEqual(chavesAno.map(ym => anual.meses[ym].passos['RICARDO MIRANDA'].mes), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(ric(1).comissao, 0);
  assert.equal(ric(1).aPagar, 0);
  assert.equal(anual.meses['2026-01'].aPagar['RICARDO MIRANDA'], 0);
  assert.equal(ric(1).saldo, -10);
  assert.equal(ric(2).comissao, 20);
  assert.equal(ric(2).abatimento, 10);
  assert.equal(ric(2).aPagar, 10);
  assert.equal(anual.meses['2026-02'].aPagar['RICARDO MIRANDA'], 10);
  assert.equal(ric(2).saldo, 0);
  assert.equal(ric(12).saldo, 0);
  assert.ok(chavesAno.every(ym => {
    const r = anual.meses[ym].passos['JOCINEI NEVES'];
    return r.aPagar === 0 && r.saldo === 0 && r.comissao === 0;
  }));
  assert.equal(anual.total.saldoDezembro, 0);
});

check('resumo anual é meses × RC: 12 chaves, nomes nas colunas, célula = a pagar', () => {
  const mapa = mapaDeLinhasComissaoRc([
    { pessoa: 'RICARDO MIRANDA', cod: '5', nome: 'Devolução' },
    { pessoa: 'ÁLVARO MESQUITA', cod: '6', nome: 'Positivo' },
    { pessoa: 'DIOGO OLIVEIRA', cod: '7', nome: 'Fora' },
  ]);
  const store = {
    meses: {
      '2026-03': mesFatur('5', -250),
      '2026-04': mesFatur('5', 1000),
      '2026-05': mesFatur('6', 500),
    },
  };
  const anual = resumoAnualComissaoRc(mapa, store, 2026);
  const chaves = [];
  for (let m = 1; m <= 12; m++) chaves.push('2026-' + String(m).padStart(2, '0'));
  assert.equal(Object.keys(anual.meses).length, 12);
  assert.deepEqual(Object.keys(anual.meses), chaves);
  assert.deepEqual(anual.rcs, ['ÁLVARO MESQUITA', 'RICARDO MIRANDA']);
  assert.equal(anual.linhas, undefined);
  for (const ym of chaves) {
    assert.deepEqual(Object.keys(anual.meses[ym].aPagar), anual.rcs);
    assert.equal(anual.meses[ym].mes, Number(ym.slice(5)));
  }
  assert.equal(anual.meses['2026-03'].aPagar['RICARDO MIRANDA'], 0);
  assert.equal(anual.meses['2026-03'].passos['RICARDO MIRANDA'].comissao, -10);
  assert.equal(anual.meses['2026-03'].passos['RICARDO MIRANDA'].saldo, -10);
  assert.equal(anual.meses['2026-04'].aPagar['RICARDO MIRANDA'], 30);
  assert.equal(anual.meses['2026-04'].passos['RICARDO MIRANDA'].abatimento, 10);
  assert.equal(anual.meses['2026-05'].aPagar['ÁLVARO MESQUITA'], 20);
  assert.equal(anual.meses['2026-05'].aPagar['RICARDO MIRANDA'], 0);
  assert.equal(anual.meses['2026-03'].total, 0);
  assert.equal(anual.meses['2026-04'].total, 30);
  assert.equal(anual.meses['2026-05'].total, 20);
  assert.equal(anual.total.porRc['RICARDO MIRANDA'], 30);
  assert.equal(anual.total.porRc['ÁLVARO MESQUITA'], 20);
  assert.equal(anual.total.aPagar, 50);
  assert.equal(anual.total.saldoDezembro, 0);
  assert.deepEqual(anual.total.saldosDezembro, []);

  const html = htmlResumoAnualComissaoRc(anual);
  assert.equal((html.match(/<tr/g) || []).length, 14);
  for (const mes of ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']) {
    assert.equal(html.split(mes).length - 1, 1, mes);
  }
  assert.ok(html.indexOf('>Mês<') < html.indexOf('>ÁLVARO MESQUITA<'));
  assert.ok(html.indexOf('>ÁLVARO MESQUITA<') < html.indexOf('>RICARDO MIRANDA<'));
  assert.ok(html.indexOf('>RICARDO MIRANDA<') < html.indexOf('>Total<'));
  assert.equal(html.split('ÁLVARO MESQUITA').length - 1, 1);
  assert.equal(html.split('RICARDO MIRANDA').length - 1, 1);
  assert.ok(!html.includes('Abatimento'));
  assert.ok(!html.includes('Comissão do mês'));
  assert.ok(!html.includes('<th>RC</th>'));
  assert.ok(html.includes('Comissão negativa não é paga'));
  assert.ok(!html.includes('Saldo a transportar em Dezembro'));
  assert.ok(!/diogo/i.test(html));

  const fim = resumoAnualComissaoRc(mapa, { meses: { '2026-11': mesFatur('5', -250) } }, 2026);
  assert.equal(fim.meses['2026-11'].aPagar['RICARDO MIRANDA'], 0);
  assert.equal(fim.meses['2026-12'].aPagar['RICARDO MIRANDA'], 0);
  assert.equal(fim.meses['2026-12'].passos['RICARDO MIRANDA'].saldo, -10);
  assert.deepEqual(fim.total.saldosDezembro, [{ nome: 'RICARDO MIRANDA', saldo: -10 }]);
  const nota = htmlResumoAnualComissaoRc(fim);
  assert.equal((nota.match(/<tr/g) || []).length, 14);
  assert.equal(nota.split('RICARDO MIRANDA').length - 1, 2);
  assert.ok(nota.includes('Saldo a transportar em Dezembro'));
  assert.ok(nota.includes('vq-var-neg'));
  assert.ok(nota.includes('10,00'));
  assert.equal(nota.split('ÁLVARO MESQUITA').length - 1, 1);
});

check('submenus mensal e anual e o carregador de RC mantêm-se', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'comissao-rc.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const iTab = html.indexOf("showAreaFinanceira('comissao-rc')");
  const iSec = html.indexOf('id="af-sec-comissao-rc"');
  const iMensal = html.indexOf('id="cr-sub-mensal"');
  const iAnual = html.indexOf('id="cr-sub-anual"');
  assert.ok(iTab > 0 && iSec > iTab && iMensal > iSec && iAnual > iMensal);
  assert.ok(html.includes('>Comissão de RC<'));
  assert.ok(html.includes('>Comissão Mensal<'));
  assert.ok(html.includes('>Resumo anual<'));
  assert.ok(html.includes('id="cr-mes-wrap"'));
  const iSap = html.indexOf('>Carregar Lista SAP<');
  const iRc = html.indexOf('>Carregar lista de RC<');
  assert.ok(iSap > 0 && iRc > iSap);
  assert.ok(js.includes('Comissão do mês'));
  assert.ok(js.includes('>Abatimento<'));
  assert.ok(js.includes('>A pagar<'));
  assert.ok(js.includes('Saldo a transportar'));
  assert.ok(js.includes('>Mês<'));
  assert.ok(js.includes('em dívida'));
  assert.ok(js.includes('não se apaga em Janeiro'));
  assert.ok(js.includes("n === 0 ? '0' : '—'"));
  assert.ok(html.includes('id="cr-btn-email"'));
  assert.ok(html.includes('Exportar e enviar email'));
  const iBtn = html.indexOf('id="cr-btn-email"');
  const iHost = html.indexOf('id="cr-host"');
  assert.ok(iBtn > iMensal && iBtn < iHost);
  assert.ok(js.includes('ccExact: true'));
  assert.ok(js.includes('estadoMensalComissaoRc(_crMapa, store, periodo.ym)'));
  assert.ok(js.includes("emailBtn.style.display = _crVista === 'anual' ? 'none' : ''"));
  assert.ok(sw.includes('v2026-10-15-orcamento-sazonalidade'));
  assert.ok(html.includes('v2026-10-15-orcamento-sazonalidade'));
});

check('email da comissão mensal: destinatários, saudação, quadro e detalhe 749002', () => {
  const mapa = mapaDeLinhasComissaoRc([
    { pessoa: 'RICARDO MIRANDA', cod: '749002', nome: 'Cencosud Brasil Comercial S.a' },
    { pessoa: 'RICARDO MIRANDA', cod: '749004', nome: 'Cencosud Brasil Comercial S.a' },
    { pessoa: 'DIOGO OLIVEIRA', cod: '749068', nome: 'Não entra' },
    { pessoa: 'JOCINEI NEVES', cod: '9', nome: 'Positivo' },
  ]);
  const store = {
    meses: {
      '2026-08': { clientes: { '749002\t1': { cod: '749002', valor: -250, nome: 'Cencosud Brasil Comercial S.a' } } },
      '2026-09': {
        clientes: {
          '749002\t1': { cod: '749002', valor: 1000, nome: 'Cencosud Brasil Comercial S.a' },
          '9\t1': { cod: '9', valor: 500, nome: 'Positivo' },
        },
      },
    },
  };
  const modelo = estadoMensalComissaoRc(mapa, store, '2026-09');
  const manha = montarEmailComissaoRc({
    modelo,
    mes: 9,
    ano: 2026,
    remetente: 'Andrea Albuquerque',
    agora: new Date('2026-09-15T14:30:00Z'),
  });
  assert.equal(manha.to, 'alice.menezes@bakertilly.com.br');
  assert.deepEqual(manha.cc, [
    'andrea.albuquerque@deltafoodsbrasil.com.br',
    'diego.silva@bakertilly.com.br',
    'leticia.silva@bakertilly.com.br',
    'christian.souza@deltafoodsbrasil.com.br',
    'diogo.oliveira@deltafoodsbrasil.com.br',
    'felipe.morgado@bakertilly.com.br',
  ]);
  assert.equal(manha.saudacao, 'Bom dia');
  assert.ok(manha.html.includes('Bom dia'));
  assert.ok(manha.texto.includes('Bom dia'));
  assert.ok(manha.html.includes('segue em anexo as comissões dos RC referente ao mês setembro de 2026.'));
  assert.ok(manha.texto.includes('segue em anexo as comissões dos RC referente ao mês setembro de 2026.'));
  assert.ok(manha.html.includes('Qualquer dúvida ou correção favor enviar a mesma para análise.'));
  assert.ok(manha.texto.includes('Qualquer dúvida ou correção favor enviar a mesma para análise.'));
  assert.ok(manha.html.includes('Muito obrigado,'));
  assert.ok(manha.html.includes('Andrea Albuquerque'));
  assert.ok(manha.texto.trim().endsWith('Andrea Albuquerque'));
  assert.equal(manha.subject, 'Comissões RC — Setembro 2026');
  assert.equal(manha.filename, 'Comissao_RC_2026-09.xlsx');
  for (const col of ['RC', 'Clientes', 'Faturação', 'Comissão do mês', 'Abatimento', 'A pagar', 'Saldo a transportar']) {
    assert.ok(manha.html.includes(col), col);
  }
  assert.ok(manha.html.includes('RICARDO MIRANDA'));
  assert.ok(manha.html.includes('JOCINEI NEVES'));
  assert.ok(!/diogo/i.test(manha.html));
  assert.ok(!/diogo/i.test(manha.texto));

  const ap = manha.folhas.find(f => f.name === 'Apuramento');
  assert.deepEqual(ap.rows[0], ['RC', 'Clientes', 'Faturação', 'Comissão do mês', 'Abatimento', 'A pagar', 'Saldo a transportar']);
  const ric = ap.rows.find(r => r[0] === 'RICARDO MIRANDA');
  assert.deepEqual(ric, ['RICARDO MIRANDA', 2, 1000, 40, 10, 30, 0]);
  const joc = ap.rows.find(r => r[0] === 'JOCINEI NEVES');
  assert.equal(joc[3], 20);
  assert.equal(joc[5], 20);
  assert.equal(ap.rows[ap.rows.length - 1][0], 'Total');

  const det = manha.folhas.find(f => f.name === 'Detalhe');
  assert.deepEqual(det.rows[0], ['RC', 'Código do cliente', 'Nome do cliente', 'Faturação do mês', 'Comissão 4%']);
  const cenco = det.rows.filter(r => String(r[1]) === '749002');
  assert.equal(cenco.length, 1);
  assert.equal(cenco[0][0], 'RICARDO MIRANDA');
  assert.equal(cenco[0][2], 'Cencosud Brasil Comercial S.a');
  assert.equal(cenco[0][3], 1000);
  assert.equal(cenco[0][4], 40);
  const zero = det.rows.find(r => String(r[1]) === '749004');
  assert.ok(zero);
  assert.equal(zero[0], 'RICARDO MIRANDA');
  assert.equal(zero[3], 0);
  assert.equal(zero[4], 0);
  assert.ok(!det.rows.some(r => String(r[1]) === '749068' || /diogo/i.test(String(r[0]))));

  const seed = seedMapaComissaoRc();
  const modeloSeed = estadoMensalComissaoRc(seed, {
    meses: {
      '2026-09': { clientes: { '749002\t1': { cod: '749002', valor: 100, nome: 'Cencosud Brasil Comercial S.a' } } },
    },
  }, '2026-09');
  const emailSeed = montarEmailComissaoRc({
    modelo: modeloSeed,
    mes: 9,
    ano: 2026,
    remetente: 'Christian Souza',
    agora: new Date('2026-09-15T15:00:00Z'),
  });
  const detSeed = emailSeed.folhas.find(f => f.name === 'Detalhe').rows.find(r => String(r[1]) === '749002');
  assert.equal(detSeed[0], 'RICARDO MIRANDA');
  assert.equal(detSeed[2], 'Cencosud Brasil Comercial S.a');
  const ricSeed = seed.rcs.find(r => r.nome === 'RICARDO MIRANDA');
  for (const cli of ricSeed.clientes) {
    assert.ok(emailSeed.folhas[1].rows.some(r => String(r[1]) === cli.cod && r[0] === 'RICARDO MIRANDA'), cli.cod);
  }

  assert.equal(montarEmailComissaoRc({
    modelo, mes: 9, ano: 2026, remetente: 'Christian Souza', agora: new Date('2026-09-15T13:00:00Z'),
  }).saudacao, 'Bom dia');
  const tarde = montarEmailComissaoRc({
    modelo, mes: 9, ano: 2026, remetente: 'Christian Souza', agora: new Date('2026-09-15T15:00:00Z'),
  });
  assert.equal(tarde.saudacao, 'Boa tarde');
  assert.ok(tarde.html.includes('Boa tarde'));
  assert.ok(tarde.html.includes('Christian Souza'));
  assert.equal(montarEmailComissaoRc({
    modelo, mes: 9, ano: 2026, remetente: 'Carlos Castro', agora: new Date('2026-10-13T14:59:00Z'),
  }).saudacao, 'Bom dia');
  assert.equal(montarEmailComissaoRc({
    modelo, mes: 3, ano: 2026, remetente: 'Carlos Castro', agora: new Date('2026-03-01T02:30:00Z'),
  }).saudacao, 'Boa tarde');

  const simples = calcularComissaoRc(mapa, {
    clientes: { '749002\t1': { cod: '749002', valor: 1000, nome: 'Cencosud Brasil Comercial S.a' } },
  });
  const semTransporte = montarEmailComissaoRc({
    modelo: simples, mes: 1, ano: 2026, remetente: 'Carlos Castro', agora: new Date('2026-01-15T18:00:00Z'),
  });
  assert.ok(semTransporte.html.includes('Comissão a pagar'));
  assert.ok(!semTransporte.html.includes('Saldo a transportar'));
  assert.ok(semTransporte.html.includes('janeiro de 2026'));
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
  assert.ok(sw.includes('v2026-10-15-orcamento-sazonalidade'));
  assert.ok(html.includes('v2026-10-15-orcamento-sazonalidade'));
});

function folhaExcelFalsa() {
  const cells = new Map();
  const merges = [];
  const cols = {};
  const rows = {};
  const ws = {
    merges,
    views: null,
    getCell(r, c) {
      const k = r + ',' + c;
      if (!cells.has(k)) cells.set(k, {});
      return cells.get(k);
    },
    mergeCells(r1, c1, r2, c2) { merges.push([r1, c1, r2, c2]); },
    getColumn(c) {
      if (!cols[c]) cols[c] = {};
      return cols[c];
    },
    getRow(r) {
      if (!rows[r]) rows[r] = {};
      return rows[r];
    },
    cells,
    cols,
  };
  return ws;
}

function valoresColuna(ws, col, ate) {
  const out = [];
  for (let r = 1; r <= ate; r++) {
    const cell = ws.cells.get(r + ',' + col);
    out.push(cell ? cell.value : undefined);
  }
  return out;
}

check('excel do resumo anual: 12 meses, colunas de RC, líquido pago numérico e totais', () => {
  const mapa = mapaDeLinhasComissaoRc([
    { pessoa: 'RICARDO MIRANDA', cod: '5', nome: 'Devolução' },
    { pessoa: 'ÁLVARO MESQUITA', cod: '6', nome: 'Positivo' },
    { pessoa: 'DIOGO OLIVEIRA', cod: '7', nome: 'Fora' },
  ]);
  const store = {
    meses: {
      '2026-03': mesFatur('5', -250),
      '2026-04': mesFatur('5', 1000),
      '2026-05': mesFatur('6', 500),
    },
  };
  const anual = resumoAnualComissaoRc(mapa, store, 2026);
  const ws = folhaExcelFalsa();
  const meta = escreverFolhaResumoAnualComissaoRc(ws, anual);

  assert.equal(meta.filename, 'Comissao_RC_resumo_anual_2026.xlsx');
  assert.equal(nomeFicheiroResumoAnualComissaoRc(2026), 'Comissao_RC_resumo_anual_2026.xlsx');
  assert.equal(nomeFicheiroResumoAnualComissaoRc(2025), 'Comissao_RC_resumo_anual_2025.xlsx');
  assert.equal(meta.sheetName, 'Resumo anual');
  assert.equal(ws.getCell(1, 1).value, 'Comissão de RC — resumo anual 2026');
  assert.deepEqual(ws.merges[0], [1, 1, 1, 4]);

  const cabecas = [1, 2, 3, 4].map(c => ws.getCell(2, c).value);
  assert.deepEqual(cabecas, ['Mês', 'ÁLVARO MESQUITA', 'RICARDO MIRANDA', 'Total']);
  for (const proibido of ['Comissão do mês', 'Abatimento', 'Saldo a transportar', 'Faturação', 'Clientes', 'A pagar', 'RC']) {
    assert.ok(!cabecas.includes(proibido), proibido);
  }
  assert.ok(!cabecas.some(h => /diogo/i.test(String(h))));
  for (const c of [1, 2, 3, 4]) {
    const h = ws.getCell(2, c);
    assert.equal(h.font.bold, true);
    assert.equal(h.alignment.horizontal, 'center');
    assert.equal(h.fill.pattern, 'solid');
    assert.ok(h.fill.fgColor.argb);
    assert.equal(h.border.top.style, 'thin');
    assert.equal(h.border.bottom.style, 'thin');
    assert.equal(h.border.left.style, 'thin');
    assert.equal(h.border.right.style, 'thin');
  }

  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const colMes = valoresColuna(ws, 1, 20);
  assert.deepEqual(colMes.slice(2, 14), meses);
  assert.equal(colMes[14], 'Total');
  for (const mes of meses) assert.equal(colMes.filter(v => v === mes).length, 1, mes);

  // Março é a 3.ª linha de dados (linha 5). Comissão −10 não entra: a célula é o líquido pago 0.
  const marcoRic = ws.getCell(5, 3);
  assert.equal(typeof marcoRic.value, 'number');
  assert.equal(marcoRic.value, 0);
  assert.equal(marcoRic.numFmt, meta.numFmt);
  assert.ok(marcoRic.numFmt.includes('R$'));
  assert.ok(marcoRic.numFmt.includes('#,##0.00'));
  assert.notEqual(marcoRic.value, anual.meses['2026-03'].passos['RICARDO MIRANDA'].comissao);

  const abrilRic = ws.getCell(6, 3);
  assert.equal(abrilRic.value, 30);
  assert.equal(typeof abrilRic.value, 'number');
  assert.notEqual(abrilRic.value, anual.meses['2026-04'].passos['RICARDO MIRANDA'].comissao);
  assert.notEqual(abrilRic.value, anual.meses['2026-04'].passos['RICARDO MIRANDA'].abatimento);

  const maioAlv = ws.getCell(7, 2);
  assert.equal(maioAlv.value, 20);
  assert.equal(typeof maioAlv.value, 'number');

  for (let r = 3; r <= 14; r++) {
    for (let c = 2; c <= 3; c++) {
      const cell = ws.getCell(r, c);
      assert.equal(typeof cell.value, 'number', r + ',' + c);
      assert.ok(!String(cell.value).includes('R$'));
      assert.equal(cell.numFmt, meta.numFmt);
      assert.equal(cell.border.top.style, 'thin');
    }
    const tot = ws.getCell(r, 4);
    assert.equal(tot.value.formula, 'SUM(B' + r + ':C' + r + ')');
    assert.equal(typeof tot.value.result, 'number');
    assert.equal(tot.numFmt, meta.numFmt);
  }
  assert.equal(ws.getCell(5, 4).value.result, 0);
  assert.equal(ws.getCell(6, 4).value.result, 30);
  assert.equal(ws.getCell(7, 4).value.result, 20);

  assert.equal(ws.getCell(15, 1).value, 'Total');
  assert.equal(ws.getCell(15, 1).font.bold, true);
  assert.equal(ws.getCell(15, 2).value.formula, 'SUM(B3:B14)');
  assert.equal(ws.getCell(15, 2).value.result, 20);
  assert.equal(ws.getCell(15, 2).font.bold, true);
  assert.equal(ws.getCell(15, 3).value.formula, 'SUM(C3:C14)');
  assert.equal(ws.getCell(15, 3).value.result, 30);
  assert.equal(ws.getCell(15, 4).value.formula, 'SUM(D3:D14)');
  assert.equal(ws.getCell(15, 4).value.result, 50);
  assert.equal(ws.getCell(15, 4).font.bold, true);
  assert.equal(ws.getCell(15, 4).numFmt, meta.numFmt);

  assert.equal(meta.note, '');
  assert.equal(meta.noteRow, 0);
  const textos = [];
  for (const cell of ws.cells.values()) {
    if (typeof cell.value === 'string') textos.push(cell.value);
  }
  assert.ok(!textos.some(t => t.includes('Saldo a transportar')));
  assert.ok(!textos.some(t => t.includes('Abatimento')));
  assert.ok(!textos.some(t => t.includes('Comissão do mês')));

  assert.equal(ws.views[0].state, 'frozen');
  assert.equal(ws.views[0].ySplit, 2);
  assert.ok(ws.cols[2].width >= 'ÁLVARO MESQUITA'.length);
  assert.ok(ws.cols[3].width >= 'RICARDO MIRANDA'.length);
  assert.ok(ws.cols[4].width >= 12);

  const fim = resumoAnualComissaoRc(mapa, { meses: { '2026-11': mesFatur('5', -250) } }, 2026);
  const wsFim = folhaExcelFalsa();
  const metaFim = escreverFolhaResumoAnualComissaoRc(wsFim, fim);
  assert.equal(wsFim.getCell(13, 3).value, 0);
  assert.equal(wsFim.getCell(14, 3).value, 0);
  assert.equal(fim.meses['2026-11'].passos['RICARDO MIRANDA'].saldo, -10);
  assert.equal(metaFim.noteRow, 17);
  assert.ok(metaFim.note.startsWith('Comissão negativa não é paga'));
  assert.ok(metaFim.note.includes('Saldo a transportar em Dezembro: RICARDO MIRANDA '));
  assert.equal(wsFim.getCell(17, 1).value, metaFim.note);
  assert.equal(textoNotaResumoAnualExcelComissaoRc(fim), metaFim.note);
  assert.deepEqual(wsFim.merges.find(m => m[0] === 17), [17, 1, 17, 4]);
  assert.ok(wsFim.getCell(17, 1).alignment.wrapText);
  const cabecasFim = [1, 2, 3, 4].map(c => wsFim.getCell(2, c).value);
  assert.deepEqual(cabecasFim, ['Mês', 'ÁLVARO MESQUITA', 'RICARDO MIRANDA', 'Total']);

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'comissao-rc.js'), 'utf8');
  const iAno = html.indexOf('id="cr-ano"');
  const iEmail = html.indexOf('id="cr-btn-email"');
  const iExcel = html.indexOf('id="cr-btn-excel"');
  const iHost = html.indexOf('id="cr-host"');
  assert.ok(iAno > 0 && iEmail > iAno && iExcel > iEmail && iExcel < iHost);
  assert.ok(html.includes('>Exportar para Excel<'));
  assert.ok(html.includes('comissaoRcExportarExcelAnual()'));
  assert.ok(html.includes('id="cr-btn-excel"'));
  assert.ok(js.includes("excelBtn.style.display = _crVista === 'anual' ? '' : 'none'"));
  assert.ok(js.includes("emailBtn.style.display = _crVista === 'anual' ? 'none' : ''"));
  const iFn = js.indexOf('async function comissaoRcExportarExcelAnual');
  const iRet = js.indexOf('\n  return {', iFn);
  const fn = js.slice(iFn, iRet);
  assert.ok(fn.includes("addWorksheet('Resumo anual'"));
  assert.ok(fn.includes('resumoAnualComissaoRc(_crMapa, store, ano)'));
  assert.ok(fn.includes('prosEnsureExcelJS'));
  assert.ok(fn.includes('triggerBlobDownload'));
  assert.ok(!fn.includes('outlookAbrirRascunho'));
  assert.ok(!fn.includes('montarEmailComissaoRc'));
  assert.ok(!fn.includes('estadoMensalComissaoRc'));
  assert.ok(!fn.includes('comissaoRcExportarEmail'));
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
