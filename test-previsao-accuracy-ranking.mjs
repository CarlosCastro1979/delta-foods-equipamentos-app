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
  'pvAccCertaintyForaDaSoma',
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

check('confirmados: canais com dono ok; Institucional é misto e não soma', () => {
  Object.entries(PV_ACC_CANAL_VENDEDOR).forEach(([id, m]) => {
    if (id === 'dfb_inst') {
      assert.equal(m.certainty, 'misto', 'Institucional deve ser misto');
      assert.equal(pvAccVendedorDeCanal(id), '');
      return;
    }
    assert.equal(m.certainty, 'ok', id + ' deveria estar confirmado');
    assert.ok(m.vendedor, id + ' precisa de vendedor');
    assert.ok(pvAccVendedorDeCanal(id), id + ' deve somar no ranking');
  });
});

check('Restauração QB → Marcio (99530003) — entra na soma', () => {
  assert.equal(pvAccVendedorDeCanal('qb_rest'), 'Marcio Gorga');
  assert.equal(PV_ACC_CANAL_VENDEDOR.qb_rest.certainty, 'ok');
  assert.deepEqual(PV_ACC_CANAL_VENDEDOR.qb_rest.codes, [99530003]);
});

check('Lojas online DFB = só Marcio 99520001 (sem Diogo / 99520009)', () => {
  assert.equal(pvAccVendedorDeCanal('dfb_lojas'), 'Marcio Gorga');
  assert.deepEqual(PV_ACC_CANAL_VENDEDOR.dfb_lojas.codes, [99520001]);
  assert.ok(!PV_ACC_CANAL_VENDEDOR.dfb_lojas.codes.includes(99520009));
  assert.equal(pvAccVendedorDeCanal('dfb_site'), 'Marcio Gorga');
  assert.deepEqual(PV_ACC_CANAL_VENDEDOR.dfb_site.codes, []);
});

check('Institucional DFB: misto no P&L, fora da soma; códigos do print Carlos', () => {
  assert.equal(pvAccVendedorDeCanal('dfb_inst'), '');
  assert.equal(PV_ACC_CANAL_VENDEDOR.dfb_inst.certainty, 'misto');
  assert.equal(PV_ACC_CANAL_VENDEDOR.dfb_inst.vendedor, '');
  const codes = PV_ACC_CANAL_VENDEDOR.dfb_inst.codes.slice().sort();
  assert.deepEqual(codes, [99520005, 99520011, 99520012, 99520015, 99520016, 99520017, 99520019]);
  assert.deepEqual(PV_ACC_CANAL_VENDEDOR.dfb_inst.codesMarcio.slice().sort(), [99520005, 99520011, 99520012]);
  assert.deepEqual(PV_ACC_CANAL_VENDEDOR.dfb_inst.codesFilipe.slice().sort(), [99520015, 99520016, 99520017, 99520019]);
  assert.ok(context.pvAccCertaintyForaDaSoma('misto'));
  assert.ok(!html.includes('dfb_inst_balcao') && !html.includes('dfb_inst_office'));
  assert.ok(!html.includes("id: 'dfb_inst_"));
  const instLinhasMapa = html.match(/id: 'dfb_inst'/g) || [];
  assert.equal(instLinhasMapa.length, 6, 'mapa: 1 linha INSTITUCIONAL por seed (6 meses), sem NPess');
});

check('Restauração DFB: equipa no Filipe (chefe)', () => {
  assert.equal(pvAccVendedorDeCanal('dfb_rest'), 'Filipe Neves');
  const codes = PV_ACC_CANAL_VENDEDOR.dfb_rest.codes.slice().sort();
  assert.deepEqual(codes, [99520002, 99520006, 99520007, 99520010, 99520019]);
});

check('Dist. regionais: Massimo + Eduardo no Massimo; QB = 99530002', () => {
  assert.equal(pvAccVendedorDeCanal('dfb_dist_reg'), 'Massimo Bottello');
  assert.deepEqual(PV_ACC_CANAL_VENDEDOR.dfb_dist_reg.codes, [99520003, 99520020]);
  assert.equal(pvAccVendedorDeCanal('qb_dist_reg'), 'Massimo Bottello');
  assert.deepEqual(PV_ACC_CANAL_VENDEDOR.qb_dist_reg.codes, [99530002]);
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
    canal('dfb_lojas', 'LOJAS ONLINE', 'dfb', [
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

check('canal sem dono no mapa e grupo/total não entram na soma', () => {
  const list = [
    canal('canal_sem_mapa', 'CANAL DESCONHECIDO', 'dfb', [{ prev: 5000, n: 5000 }]),
    canal('dfb_ret_mod', 'RETALHO MODERNO', 'dfb', [{ prev: 100, n: 90 }]),
  ];
  const { rows, semDono } = pvAccBuildRanking(list);
  const diogo = rows.find(r => r.vendedor === 'Diogo Oliveira');
  assert.equal(diogo.prev, 100);
  assert.equal(diogo.n, 90);
  assert.ok(semDono.some(c => c.id === 'canal_sem_mapa'));
  rows.forEach(r => {
    if (r.vendedor !== 'Diogo Oliveira') {
      assert.equal(r.acc, null);
      assert.equal(r.pos, null);
    }
  });
});

check('Restauração QB soma no Marcio; Institucional não entra na soma', () => {
  const list = [
    canal('qb_rest', 'RESTAURAÇÃO', 'qb', [{ prev: 5000, n: 5000 }]),
    canal('dfb_inst', 'INSTITUCIONAL', 'dfb', [{ prev: 100, n: 80 }]),
    canal('dfb_lojas', 'LOJAS ONLINE', 'dfb', [{ prev: 200, n: 200 }]),
  ];
  const { rows, semDono, foraSoma } = pvAccBuildRanking(list);
  const marcio = rows.find(r => r.vendedor === 'Marcio Gorga');
  assert.equal(marcio.prev, 5200);
  assert.equal(marcio.n, 5200);
  assert.equal(marcio.nCanais, 2);
  assert.ok(!semDono.some(c => c.id === 'qb_rest' || c.id === 'dfb_inst'));
  assert.ok(foraSoma.some(c => c.id === 'dfb_inst'));
  assert.equal(marcio.acc, pvAccuracyPct({ prevFecho: 5200, n: 5200 }));
});

check('Dist. DFB: volume de Eduardo entra no Massimo', () => {
  const list = [
    canal('dfb_dist_reg', 'DISTRIBUIDORES REGIONAIS', 'dfb', [{ prev: 400, n: 360 }]),
    canal('qb_dist_reg', 'DISTRIBUIDORES REGIONAIS', 'qb', [{ prev: 100, n: 100 }]),
  ];
  const { rows } = pvAccBuildRanking(list);
  const mass = rows.find(r => r.vendedor === 'Massimo Bottello');
  assert.equal(mass.prev, 500);
  assert.equal(mass.n, 460);
  assert.equal(mass.acc, 92);
  assert.equal(mass.nCanais, 2);
});

check('ranking: melhor mais perto de 100%; empate = mesmo lugar + nome', () => {
  const list = [
    canal('dfb_ret_mod', 'RETALHO MODERNO', 'dfb', [{ prev: 100, n: 90 }]),
    canal('dfb_lojas', 'LOJAS ONLINE', 'dfb', [{ prev: 100, n: 100 }]),
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
  const itemMarcio = canal('dfb_lojas', 'LOJAS ONLINE', 'dfb', [{ prev: 10, n: 10 }]);
  const itemInst = canal('dfb_inst', 'INSTITUCIONAL', 'dfb', [{ prev: 10, n: 10 }]);
  const grupo = { id: 'dfb', empresa: 'DELTA FOODS BRASIL', tipo: 'grupo' };
  context._pvAccFiltro = '';
  assert.equal(pvAccItemNoFiltro(itemDiogo), true);
  assert.equal(pvAccItemNoFiltro(grupo), true);
  assert.equal(pvAccItemNoFiltro(itemInst), true);
  context._pvAccFiltro = 'Diogo Oliveira';
  assert.equal(pvAccItemNoFiltro(itemDiogo), true);
  assert.equal(pvAccItemNoFiltro(itemMarcio), false);
  assert.equal(pvAccItemNoFiltro(itemInst), false);
  assert.equal(pvAccItemNoFiltro(grupo), false);
  context._pvAccFiltro = '__incerto__';
  const semMapa = canal('canal_sem_mapa', 'CANAL DESCONHECIDO', 'dfb', [{ prev: 10, n: 10 }]);
  assert.equal(pvAccItemNoFiltro(semMapa), true);
  assert.equal(pvAccItemNoFiltro(itemDiogo), false);
  assert.equal(pvAccItemNoFiltro(itemInst), false);
  const qbRest = canal('qb_rest', 'RESTAURAÇÃO', 'qb', [{ prev: 10, n: 10 }]);
  assert.equal(pvAccItemNoFiltro(qbRest), false);
  context._pvAccFiltro = 'Marcio Gorga';
  assert.equal(pvAccItemNoFiltro(qbRest), true);
  assert.equal(pvAccItemNoFiltro(itemInst), false);
  context._pvAccFiltro = '__misto__';
  assert.equal(pvAccItemNoFiltro(itemInst), true);
  assert.equal(pvAccItemNoFiltro(itemMarcio), false);
  assert.equal(pvAccItemNoFiltro(grupo), false);
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
  assert.ok(html.includes('id="pv-acc-misto-box"'));
  assert.ok(html.includes('partido por código no P&L'));
  assert.ok(html.includes('__misto__'));
  assert.ok(html.includes('fora do ranking'));
  const accFn = extractFn(html, 'pvRenderAccuracyHtml');
  const rankFn = extractFn(html, 'pvRenderAccuracyRankingHtml');
  assert.ok(accFn.includes('pvRenderAccuracyRankingHtml'));
  assert.ok(accFn.indexOf('pvRenderAccuracyRankingHtml') < accFn.indexOf('pv-acc-detalhe-tbl'));
  assert.ok(rankFn.includes('pv-acc-ranking-tbl'));
  assert.ok(rankFn.includes('pv-acc-misto-box'));
  assert.ok(!accFn.includes('mailto:'));
});

check('HTML do ranking: canais confirmados sem caixa laranja; incerto só se sem mapa', () => {
  const listOk = [
    canal('dfb_ret_mod', 'RETALHO MODERNO', 'dfb', [{ prev: 100, n: 90 }]),
    canal('qb_rest', 'RESTAURAÇÃO', 'qb', [{ prev: 10, n: 10 }]),
  ];
  const outOk = context.pvRenderAccuracyRankingHtml(pvAccBuildRanking(listOk), 2026);
  assert.ok(outOk.includes('id="pv-acc-ranking-tbl"'));
  assert.ok(outOk.includes('Diogo Oliveira'));
  assert.ok(outOk.includes('Marcio Gorga'));
  assert.ok(outOk.includes('Restauração QB'));
  assert.ok(outOk.includes('pvAccFiltrar'));
  assert.ok(outOk.includes('|ΣN − ΣPrev|'));
  assert.ok(!outOk.includes('por confirmar'));
  assert.ok(!outOk.includes('a confirmar'));
  assert.ok(!outOk.includes('mailto:'));

  const listInc = listOk.concat([
    canal('canal_sem_mapa', 'CANAL DESCONHECIDO', 'dfb', [{ prev: 1, n: 1 }]),
  ]);
  const outInc = context.pvRenderAccuracyRankingHtml(pvAccBuildRanking(listInc), 2026);
  assert.ok(outInc.includes('por confirmar'));
  assert.ok(outInc.includes('CANAL DESCONHECIDO') || outInc.includes('Canal DESCONHECIDO') || outInc.includes('canal_sem_mapa') || outInc.includes('DESCONHECIDO'));
});

check('Institucional no ranking: caixa misto, não soma no Marcio, sem split inventado', () => {
  const list = [
    canal('dfb_lojas', 'LOJAS ONLINE', 'dfb', [{ prev: 200, n: 200 }]),
    canal('dfb_inst', 'INSTITUCIONAL', 'dfb', [{ prev: 10000, n: 10000 }]),
  ];
  const ranking = pvAccBuildRanking(list);
  const marcio = ranking.rows.find(r => r.vendedor === 'Marcio Gorga');
  assert.equal(marcio.prev, 200);
  assert.equal(marcio.n, 200);
  assert.ok(!marcio.canais.some(c => /Institucional/i.test(c)));
  assert.equal(ranking.foraSoma.length, 1);
  assert.equal(ranking.foraSoma[0].id, 'dfb_inst');
  assert.ok(!ranking.semDono.some(c => c.id === 'dfb_inst'));
  const out = context.pvRenderAccuracyRankingHtml(ranking, 2026);
  assert.ok(out.includes('id="pv-acc-misto-box"'));
  assert.ok(out.includes('partido por código no P&L'));
  assert.ok(out.includes('99520011'));
  assert.ok(out.includes('99520019'));
  assert.ok(out.includes('99520005'));
  assert.ok(out.includes('Marcio Gorga'));
  assert.ok(out.includes('Filipe Neves'));
  assert.ok(!out.includes('por confirmar'));
  assert.ok(out.includes('__misto__'));
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
