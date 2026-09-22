#!/usr/bin/env node
/**
 * Ranking Accuracy de fecho por vendedor: soma canais, accuracy no agregado,
 * rank, 1 canal vs N canais. Não altera o mapa mensal.
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('Função em falta: ' + name);
  const paren = src.indexOf('(', start);
  let depth = 0;
  let bodyBrace = -1;
  for (let i = paren; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        bodyBrace = src.indexOf('{', i);
        break;
      }
    }
  }
  if (bodyBrace < 0) throw new Error('Corpo em falta: ' + name);
  depth = 0;
  for (let i = bodyBrace; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('Chaveta não fechou: ' + name);
}

function extractConst(src, name) {
  const start = src.indexOf(`const ${name} =`);
  if (start < 0) throw new Error('const em falta: ' + name);
  const first = src.slice(start);
  const eq = first.indexOf('=');
  let i = eq + 1;
  while (i < first.length && /\s/.test(first[i])) i++;
  const open = first[i];
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) throw new Error('const não é objecto/array: ' + name);
  let depth = 0;
  for (let j = i; j < first.length; j++) {
    if (first[j] === open) depth++;
    else if (first[j] === close) {
      depth--;
      if (depth === 0) {
        let end = j + 1;
        if (first[end] === ';') end++;
        return first.slice(0, end);
      }
    }
  }
  throw new Error('const não fechou: ' + name);
}

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

const context = {
  console,
  Math,
  Number,
  String,
  Array,
  Object,
  _pvAccFiltro: '',
  _pvView: 'accuracy',
};
vm.createContext(context);

for (const name of ['ADMINS', 'PREV_VENDAS_ACESSO', 'PREV_VENDAS_SO_CONSULTA', 'PV_ACC_RANKING_VENDEDORES', 'PV_ACC_CANAL_VENDEDOR']) {
  vm.runInContext(extractConst(html, name), context);
}
for (const name of [
  'pvAccuracyPct',
  'pvFmtAccuracy',
  'pvAccuracyMedia',
  'pvAccMetaDeCanal',
  'pvAccVendedorDeCanal',
  'pvAccLabelDeCanal',
  'pvAccLinhaValidaParaSoma',
  'pvAccAgregarPares',
  'pvAccParesDeItem',
  'pvAccBuildRanking',
  'pvAccItemNoFiltro',
  'pvFmtNum',
  'pvRenderAccuracyRankingHtml',
]) {
  vm.runInContext(extractFn(html, name), context);
}
context.encodeURIComponent = encodeURIComponent;

const {
  pvAccuracyPct,
  pvAccAgregarPares,
  pvAccBuildRanking,
  pvAccVendedorDeCanal,
  pvAccItemNoFiltro,
} = context;
const PV_ACC_RANKING_VENDEDORES = vm.runInContext('PV_ACC_RANKING_VENDEDORES', context);
const PV_ACC_CANAL_VENDEDOR = vm.runInContext('PV_ACC_CANAL_VENDEDOR', context);

function canal(id, empresa, parent, meses) {
  const prevMeses = {};
  const nMeses = {};
  const accMeses = {};
  (meses || []).forEach((p, m) => {
    if (!p) return;
    prevMeses[m] = p.prev;
    nMeses[m] = p.n;
    accMeses[m] = pvAccuracyPct({ prevFecho: p.prev, n: p.n });
  });
  return { id, empresa, tipo: 'canal', parent, meses: accMeses, prevMeses, nMeses };
}

check('ADMINS e Eduardo não entram no ranking; os 4 do mapa sim', () => {
  const rank = PV_ACC_RANKING_VENDEDORES;
  ['Filipe Neves', 'Diogo Oliveira', 'Marcio Gorga', 'Massimo Bottello'].forEach(n => {
    assert.ok(rank.includes(n), n + ' deveria estar no ranking');
  });
  ['Carlos Castro', 'Christian Souza', 'Andrea Albuquerque', 'Daniela Kucinski', 'Daniela Kucinsky', 'Eduardo Moreira'].forEach(n => {
    assert.ok(!rank.includes(n), n + ' não entra no ranking');
  });
});

check('Diogo: 4 códigos documentados (ok) — 99520018/004/30001/30005', () => {
  const diogo = Object.entries(PV_ACC_CANAL_VENDEDOR)
    .filter(([, m]) => m.vendedor === 'Diogo Oliveira' && m.certainty === 'ok');
  assert.equal(diogo.length, 4);
  const codes = diogo.flatMap(([, m]) => m.codes).sort();
  assert.deepEqual(codes, [99520004, 99520018, 99530001, 99530005]);
  assert.equal(pvAccVendedorDeCanal('dfb_ret_mod'), 'Diogo Oliveira');
  assert.equal(pvAccVendedorDeCanal('dfb_dist_ret'), 'Diogo Oliveira');
  assert.equal(pvAccVendedorDeCanal('qb_ret_mod'), 'Diogo Oliveira');
  assert.equal(pvAccVendedorDeCanal('qb_dist_ret'), 'Diogo Oliveira');
});

check('Restauração QB sem dono (incerto) — não soma em ninguém', () => {
  assert.equal(pvAccVendedorDeCanal('qb_rest'), '');
  assert.equal(PV_ACC_CANAL_VENDEDOR.qb_rest.certainty, 'incerto');
  assert.deepEqual(PV_ACC_CANAL_VENDEDOR.qb_rest.codes, [99530003]);
});

check('soma de canais: accuracy no agregado, não média das %', () => {
  const agg = pvAccAgregarPares([
    { prevFecho: 1000, n: 1000 },
    { prevFecho: 10, n: 0 },
  ]);
  assert.equal(agg.prev, 1010);
  assert.equal(agg.n, 1000);
  assert.equal(agg.nLinhas, 2);
  const mediaPct = (100 + 0) / 2;
  assert.equal(agg.acc, pvAccuracyPct({ prevFecho: 1010, n: 1000 }));
  assert.equal(agg.acc, 99);
  assert.notEqual(agg.acc, mediaPct);
});

check('ignora linhas sem N/Prev, Prev≤0 ou N inválido', () => {
  const agg = pvAccAgregarPares([
    { prevFecho: 100, n: null },
    { prevFecho: '', n: 80 },
    { prevFecho: 0, n: 10 },
    { prevFecho: 100, n: -5 },
    { prevFecho: 200, n: 180 },
  ]);
  assert.equal(agg.nLinhas, 1);
  assert.equal(agg.prev, 200);
  assert.equal(agg.n, 180);
  assert.equal(agg.acc, 90);
  assert.equal(pvAccAgregarPares([]).acc, null);
  assert.equal(pvAccAgregarPares([{ prevFecho: 100, n: null }]).acc, null);
});

check('vendedor com 1 canal: accuracy = da linha', () => {
  const list = [
    canal('dfb_rest', 'RESTAURAÇÃO', 'dfb', [{ prev: 100, n: 85 }]),
  ];
  const { rows } = pvAccBuildRanking(list);
  const filipe = rows.find(r => r.vendedor === 'Filipe Neves');
  assert.equal(filipe.nCanais, 1);
  assert.equal(filipe.prev, 100);
  assert.equal(filipe.n, 85);
  assert.equal(filipe.acc, 85);
  assert.equal(filipe.pos, 1);
});

check('vendedor com N canais (Diogo): soma 4 canais, ignora incompleto', () => {
  const list = [
    canal('dfb_ret_mod', 'RETALHO MODERNO', 'dfb', [{ prev: 100, n: 100 }]),
    canal('dfb_dist_ret', 'DISTRIBUIDORES DE RETALHO', 'dfb', [{ prev: 100, n: 80 }]),
    canal('qb_ret_mod', 'RETALHO MODERNO', 'qb', [{ prev: 200, n: 200 }]),
    canal('qb_dist_ret', 'DISTRIBUIDORES DE RETALHO', 'qb', [{ prev: 50, n: null }]),
    { id: 'dfb', empresa: 'DELTA FOODS BRASIL', tipo: 'grupo', parent: undefined, meses: {}, prevMeses: { 0: 999999 }, nMeses: { 0: 1 } },
    { id: 'total', empresa: 'Total', tipo: 'total', meses: {}, prevMeses: { 0: 999999 }, nMeses: { 0: 1 } },
  ];
  const { rows } = pvAccBuildRanking(list);
  const diogo = rows.find(r => r.vendedor === 'Diogo Oliveira');
  assert.equal(diogo.nCanais, 4);
  assert.equal(diogo.prev, 400);
  assert.equal(diogo.n, 380);
  assert.equal(diogo.acc, 95);
  assert.ok(!diogo.hasProposto);
  assert.ok(diogo.hasOk);
});

check('canais de meses distintos somam no agregado anual', () => {
  const list = [
    canal('dfb_inst', 'INSTITUCIONAL', 'dfb', [
      { prev: 100, n: 100 },
      { prev: 100, n: 80 },
    ]),
  ];
  const { rows } = pvAccBuildRanking(list);
  const marcio = rows.find(r => r.vendedor === 'Marcio Gorga');
  assert.equal(marcio.prev, 200);
  assert.equal(marcio.n, 180);
  assert.equal(marcio.acc, 90);
});

check('Restauração QB (incerto) e grupo/total não entram na soma', () => {
  const list = [
    canal('qb_rest', 'RESTAURAÇÃO', 'qb', [{ prev: 5000, n: 5000 }]),
    canal('dfb_ret_mod', 'RETALHO MODERNO', 'dfb', [{ prev: 100, n: 90 }]),
  ];
  const { rows, semDono } = pvAccBuildRanking(list);
  const diogo = rows.find(r => r.vendedor === 'Diogo Oliveira');
  assert.equal(diogo.prev, 100);
  assert.equal(diogo.n, 90);
  assert.ok(semDono.some(c => c.id === 'qb_rest'));
  rows.forEach(r => {
    if (r.vendedor !== 'Diogo Oliveira') {
      assert.equal(r.acc, null);
      assert.equal(r.pos, null);
    }
  });
});

check('ranking: melhor mais perto de 100%; empate = mesmo lugar + nome', () => {
  const list = [
    canal('dfb_ret_mod', 'RETALHO MODERNO', 'dfb', [{ prev: 100, n: 90 }]),
    canal('dfb_inst', 'INSTITUCIONAL', 'dfb', [{ prev: 100, n: 100 }]),
    canal('dfb_rest', 'RESTAURAÇÃO', 'dfb', [{ prev: 100, n: 90 }]),
  ];
  const { rows } = pvAccBuildRanking(list);
  assert.equal(rows[0].vendedor, 'Marcio Gorga');
  assert.equal(rows[0].acc, 100);
  assert.equal(rows[0].pos, 1);
  assert.equal(rows[1].acc, 90);
  assert.equal(rows[2].acc, 90);
  assert.equal(rows[1].pos, 2);
  assert.equal(rows[2].pos, 2);
  assert.equal(rows[1].vendedor, 'Diogo Oliveira');
  assert.equal(rows[2].vendedor, 'Filipe Neves');
  const mass = rows.find(r => r.vendedor === 'Massimo Bottello');
  assert.equal(mass.pos, null);
});

check('filtro: só linhas do vendedor; grupo/total escondidos; 0/— não exigem clique', () => {
  const itemDiogo = canal('dfb_ret_mod', 'RETALHO MODERNO', 'dfb', [{ prev: 10, n: 10 }]);
  const itemMarcio = canal('dfb_inst', 'INSTITUCIONAL', 'dfb', [{ prev: 10, n: 10 }]);
  const grupo = { id: 'dfb', empresa: 'DELTA FOODS BRASIL', tipo: 'grupo' };
  context._pvAccFiltro = '';
  assert.equal(pvAccItemNoFiltro(itemDiogo), true);
  assert.equal(pvAccItemNoFiltro(grupo), true);
  context._pvAccFiltro = 'Diogo Oliveira';
  assert.equal(pvAccItemNoFiltro(itemDiogo), true);
  assert.equal(pvAccItemNoFiltro(itemMarcio), false);
  assert.equal(pvAccItemNoFiltro(grupo), false);
  context._pvAccFiltro = '__incerto__';
  const qbRest = canal('qb_rest', 'RESTAURAÇÃO', 'qb', [{ prev: 10, n: 10 }]);
  assert.equal(pvAccItemNoFiltro(qbRest), true);
  assert.equal(pvAccItemNoFiltro(itemDiogo), false);
  context._pvAccFiltro = '';
});

check('mapa mensal não agrupa nem usa o ranking', () => {
  const mapaFn = extractFn(html, 'pvRenderMapaHtml');
  assert.ok(!mapaFn.includes('pvAccBuildRanking'));
  assert.ok(!mapaFn.includes('PV_ACC_CANAL_VENDEDOR'));
  assert.ok(!mapaFn.includes('Ranking de Accuracy'));
  assert.ok(!mapaFn.includes('pvAccFiltrar'));
  assert.ok(html.includes('id="pv-tab-mapa"'));
  assert.ok(html.includes('function pvRenderMapaHtml('));
});

check('UI Accuracy: ranking acima do detalhe, drill-down e fórmula do agregado', () => {
  assert.ok(html.includes('id="pv-acc-ranking-tbl"'));
  assert.ok(html.includes('id="pv-acc-detalhe-tbl"'));
  assert.ok(html.includes('pvAccLimparFiltro()'));
  assert.ok(html.includes('Filtro:'));
  assert.ok(html.includes('✕ Limpar filtro'));
  assert.ok(html.includes('Não é a média das % das linhas'));
  assert.ok(html.includes('|ΣN − ΣPrev|'));
  assert.ok(html.includes('pv-acc-click'));
  assert.ok(html.includes('a confirmar'));
  const accFn = extractFn(html, 'pvRenderAccuracyHtml');
  const rankFn = extractFn(html, 'pvRenderAccuracyRankingHtml');
  assert.ok(accFn.includes('pvRenderAccuracyRankingHtml'));
  assert.ok(accFn.indexOf('pvRenderAccuracyRankingHtml') < accFn.indexOf('pv-acc-detalhe-tbl'));
  assert.ok(rankFn.includes('pv-acc-ranking-tbl'));
  assert.ok(!accFn.includes('mailto:'));
});

check('HTML do ranking renderiza clique, fórmula e canais incertos', () => {
  const list = [
    canal('dfb_ret_mod', 'RETALHO MODERNO', 'dfb', [{ prev: 100, n: 90 }]),
    canal('qb_rest', 'RESTAURAÇÃO', 'qb', [{ prev: 10, n: 10 }]),
  ];
  const out = context.pvRenderAccuracyRankingHtml(pvAccBuildRanking(list), 2026);
  assert.ok(out.includes('id="pv-acc-ranking-tbl"'));
  assert.ok(out.includes('Diogo Oliveira'));
  assert.ok(out.includes('pvAccFiltrar'));
  assert.ok(out.includes('por confirmar'));
  assert.ok(out.includes('99530003'));
  assert.ok(out.includes('|ΣN − ΣPrev|'));
  assert.ok(!out.includes('mailto:'));
});

check('readonly dos vendedores não reabre edição', () => {
  assert.ok(html.includes('PREV_VENDAS_SO_CONSULTA'));
  const editFn = extractFn(html, 'pvPodeEditar');
  assert.ok(editFn.includes('PREV_VENDAS_SO_CONSULTA'));
  assert.ok(editFn.includes('isAdmin'));
});

if (process.exitCode) {
  console.error('\nAlguns testes de ranking falharam.');
} else {
  console.log('\nTodos os testes de ranking Accuracy passaram.');
}
