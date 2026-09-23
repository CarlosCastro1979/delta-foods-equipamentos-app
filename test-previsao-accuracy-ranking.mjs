#!/usr/bin/env node
/**
 * Ranking Accuracy de fecho por vendedor: soma canais das duas empresas
 * (DFB + Q Brasil, mesma pessoa), accuracy no agregado, rank.
 * Detalhe Accuracy: agrupado por vendedor (sem blocos DELTA / Q BRASIL).
 * Institucional = Balcão (Marcio) + Horeca (Filipe).
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

for (const name of ['ADMINS', 'PREV_VENDAS_ACESSO', 'PREV_VENDAS_SO_CONSULTA', 'PV_ACC_RANKING_VENDEDORES', 'PV_ACC_CANAL_VENDEDOR', 'PV_SEED_JULHO_2026', 'PV_SEED_AGOSTO_2026', 'PV_SEED_SETEMBRO_2026', 'PV_SEED_OUTUBRO_2026', 'PV_SEED_NOVEMBRO_2026', 'PV_SEED_DEZEMBRO_2026']) {
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
  'pvAccEmpresaDeItem',
  'pvAccLinhaValidaParaSoma',
  'pvAccAgregarPares',
  'pvAccParesDeItem',
  'pvAccBuildRanking',
  'pvAccMesesAgregados',
  'pvAccBuildDetalhePorVendedor',
  'pvAccItemNoFiltro',
  'pvFmtNum',
  'pvRenderAccuracyRankingHtml',
  'pvFilhosDeGrupo',
  'pvMapaPadLeft',
  'pvRecalcSomasOn',
  'pvEditFieldNames',
  'pvYtdFieldNames',
  'pvHasValue',
  'pvTsMs',
  'pvPickEditField',
  'pvIndexLinhasById',
  'pvMergeLinhasLww',
]) {
  vm.runInContext(extractFn(html, name), context);
}
context.encodeURIComponent = encodeURIComponent;

const {
  pvAccuracyPct,
  pvAccAgregarPares,
  pvAccBuildRanking,
  pvAccBuildDetalhePorVendedor,
  pvAccMesesAgregados,
  pvAccVendedorDeCanal,
  pvAccItemNoFiltro,
  pvFilhosDeGrupo,
  pvMapaPadLeft,
  pvRecalcSomasOn,
  pvMergeLinhasLww,
} = context;
const PV_ACC_RANKING_VENDEDORES = vm.runInContext('PV_ACC_RANKING_VENDEDORES', context);
const PV_ACC_CANAL_VENDEDOR = vm.runInContext('PV_ACC_CANAL_VENDEDOR', context);
const PV_SEED_AGOSTO_2026 = vm.runInContext('PV_SEED_AGOSTO_2026', context);
const PV_SEEDS_INST = {
  6: vm.runInContext('PV_SEED_JULHO_2026', context),
  7: PV_SEED_AGOSTO_2026,
  8: vm.runInContext('PV_SEED_SETEMBRO_2026', context),
  9: vm.runInContext('PV_SEED_OUTUBRO_2026', context),
  10: vm.runInContext('PV_SEED_NOVEMBRO_2026', context),
  11: vm.runInContext('PV_SEED_DEZEMBRO_2026', context),
};

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

check('confirmados: canais com dono ok; pai Institucional não é canal do mapa', () => {
  assert.ok(!PV_ACC_CANAL_VENDEDOR.dfb_inst, 'pai dfb_inst não entra no mapa do ranking');
  Object.entries(PV_ACC_CANAL_VENDEDOR).forEach(([id, m]) => {
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

check('Institucional DFB: Balcão → Marcio, Horeca → Filipe; códigos do print Carlos', () => {
  assert.equal(pvAccVendedorDeCanal('dfb_inst'), '');
  assert.equal(pvAccVendedorDeCanal('dfb_inst_balcao'), 'Marcio Gorga');
  assert.equal(pvAccVendedorDeCanal('dfb_inst_horeca'), 'Filipe Neves');
  assert.deepEqual(PV_ACC_CANAL_VENDEDOR.dfb_inst_balcao.codes.slice().sort(), [99520005, 99520011, 99520012]);
  assert.deepEqual(PV_ACC_CANAL_VENDEDOR.dfb_inst_horeca.codes.slice().sort(), [99520015, 99520016, 99520017, 99520019]);
  const instPai = (html.match(/id: 'dfb_inst'(?!_)/g) || []).length;
  const instBalcao = (html.match(/id: 'dfb_inst_balcao'/g) || []).length;
  const instHoreca = (html.match(/id: 'dfb_inst_horeca'/g) || []).length;
  assert.equal(instPai, 6, 'mapa: 1 linha pai INSTITUCIONAL por seed (6 meses)');
  assert.equal(instBalcao, 6, 'mapa: 1 Balcão por seed');
  assert.equal(instHoreca, 6, 'mapa: 1 Horeca por seed');
  assert.ok(!html.includes('qb_inst'));
  assert.ok(!html.includes('id="pv-acc-misto-box"'));
  assert.ok(!html.includes('partido por código no P&L'));
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

check('Restauração QB + Balcão no Marcio; Horeca no Filipe; pai não soma', () => {
  const list = [
    canal('qb_rest', 'RESTAURAÇÃO', 'qb', [{ prev: 5000, n: 5000 }]),
    canal('dfb_inst_balcao', 'Institucional Balcão', 'dfb_inst', [{ prev: 100, n: 80 }]),
    canal('dfb_inst_horeca', 'Institucional Horeca', 'dfb_inst', [{ prev: 40, n: 40 }]),
    canal('dfb_lojas', 'LOJAS ONLINE', 'dfb', [{ prev: 200, n: 200 }]),
    { id: 'dfb_inst', empresa: 'INSTITUCIONAL', tipo: 'grupo', parent: 'dfb', prevMeses: { 0: 140 }, nMeses: { 0: 120 } },
  ];
  const { rows, semDono, foraSoma } = pvAccBuildRanking(list);
  const marcio = rows.find(r => r.vendedor === 'Marcio Gorga');
  const filipe = rows.find(r => r.vendedor === 'Filipe Neves');
  assert.equal(marcio.prev, 5300);
  assert.equal(marcio.n, 5280);
  assert.equal(marcio.nCanais, 3);
  assert.ok(marcio.canais.includes('Institucional Balcão'));
  assert.ok(!marcio.canais.includes('Institucional Horeca'));
  assert.equal(filipe.prev, 40);
  assert.equal(filipe.n, 40);
  assert.equal(filipe.nCanais, 1);
  assert.ok(filipe.canais.includes('Institucional Horeca'));
  assert.ok(!semDono.some(c => c.id === 'qb_rest' || c.id === 'dfb_inst' || c.id === 'dfb_inst_balcao' || c.id === 'dfb_inst_horeca'));
  assert.ok(!(foraSoma || []).some(c => c.id === 'dfb_inst'));
  assert.equal(marcio.acc, pvAccuracyPct({ prevFecho: 5300, n: 5280 }));
});

check('DFB + Q Brasil, mesma pessoa: um agregado, não dois rankings nem média das %', () => {
  // Massimo: canal grande DFB a 100% + canal pequeno QB a 0%.
  // Média das % = 50. Soma das duas empresas = 99. Só DFB = 100.
  const list = [
    canal('dfb_dist_reg', 'DISTRIBUIDORES REGIONAIS', 'dfb', [{ prev: 1000, n: 1000 }]),
    canal('qb_dist_reg', 'DISTRIBUIDORES REGIONAIS', 'qb', [{ prev: 10, n: 0 }]),
    { id: 'dfb', empresa: 'DELTA FOODS BRASIL', tipo: 'grupo', prevMeses: { 0: 1000 }, nMeses: { 0: 1000 }, meses: { 0: 100 } },
    { id: 'qb', empresa: 'Q BRASIL', tipo: 'grupo', prevMeses: { 0: 10 }, nMeses: { 0: 0 }, meses: { 0: 0 } },
  ];
  const { rows } = pvAccBuildRanking(list);
  const massimos = rows.filter(r => r.vendedor === 'Massimo Bottello');
  assert.equal(massimos.length, 1, 'uma linha de ranking por vendedor');
  const mass = massimos[0];
  assert.deepEqual(mass.canalIds.slice().sort(), ['dfb_dist_reg', 'qb_dist_reg']);
  assert.ok(mass.empresas.includes('DFB'));
  assert.ok(mass.empresas.includes('Q Brasil'));
  assert.equal(mass.nCanais, 2);
  assert.equal(mass.prev, 1010);
  assert.equal(mass.n, 1000);
  assert.equal(mass.acc, 99);
  const mediaPct = (100 + 0) / 2;
  assert.notEqual(mass.acc, mediaPct);
  assert.notEqual(mass.acc, 100, 'o agregado não pode ficar só na DFB');
  assert.notEqual(mass.prev, 10, 'o agregado não pode ficar só na Q Brasil');
  rows.forEach(r => {
    assert.ok(!/delta|q brasil|empresa/i.test(r.vendedor), 'ranking não parte por empresa: ' + r.vendedor);
  });
  assert.equal(rows.filter(r => /brasil/i.test(r.vendedor)).length, 0);

  // Diogo: 4 linhas varejo DFB+QB. Média das 4 % ≠ accuracy do Σ.
  const diogoList = [
    canal('dfb_ret_mod', 'RETALHO MODERNO', 'dfb', [{ prev: 200, n: 100 }]),
    canal('dfb_dist_ret', 'DISTRIBUIDORES DE RETALHO', 'dfb', [{ prev: 100, n: 80 }]),
    canal('qb_ret_mod', 'RETALHO MODERNO', 'qb', [{ prev: 400, n: 400 }]),
    canal('qb_dist_ret', 'DISTRIBUIDORES DE RETALHO', 'qb', [{ prev: 300, n: 150 }]),
  ];
  const diogoRows = pvAccBuildRanking(diogoList).rows;
  const diogos = diogoRows.filter(r => r.vendedor === 'Diogo Oliveira');
  assert.equal(diogos.length, 1);
  const diogo = diogos[0];
  assert.equal(diogo.nCanais, 4);
  assert.equal(diogo.prev, 1000);
  assert.equal(diogo.n, 730);
  assert.equal(diogo.acc, pvAccuracyPct({ prevFecho: 1000, n: 730 }));
  assert.equal(diogo.acc, 73);
  const mediaDiogo = (50 + 80 + 100 + 50) / 4;
  assert.equal(mediaDiogo, 70);
  assert.notEqual(diogo.acc, mediaDiogo);
  assert.ok(diogo.empresas.includes('DFB') && diogo.empresas.includes('Q Brasil'));
  const soDfb = pvAccAgregarPares([
    { prevFecho: 200, n: 100 },
    { prevFecho: 100, n: 80 },
  ]);
  assert.equal(soDfb.acc, 60);
  assert.notEqual(diogo.acc, soDfb.acc);
});

check('ranking não usa a coluna Média (média das % por canal/empresa)', () => {
  const build = extractFn(html, 'pvAccBuildRanking');
  assert.ok(!build.includes('pvAccuracyMedia'));
  assert.ok(build.includes('pvAccAgregarPares'));
  assert.ok(build.includes('pvAccEmpresaDeItem'));
  assert.ok(html.includes('DFB + Q Brasil, mesma pessoa'));
  const rankFn = extractFn(html, 'pvRenderAccuracyRankingHtml');
  assert.ok(rankFn.includes('DFB + Q Brasil, mesma pessoa'));
  assert.ok(rankFn.includes('Não é a média das % das linhas'));
});

check('detalhe Accuracy: DFB + QB do mesmo vendedor na mesma secção; sem grupos empresa', () => {
  const list = [
    { id: 'dfb', empresa: 'DELTA FOODS BRASIL', tipo: 'grupo', meses: { 0: 90 } },
    canal('dfb_dist_reg', 'DISTRIBUIDORES REGIONAIS', 'dfb', [{ prev: 1000, n: 1000 }]),
    canal('dfb_lojas', 'LOJAS ONLINE', 'dfb', [{ prev: 200, n: 200 }]),
    canal('dfb_rest', 'RESTAURAÇÃO', 'dfb', [{ prev: 400, n: 400 }]),
    { id: 'dfb_inst', empresa: 'INSTITUCIONAL', tipo: 'grupo', parent: 'dfb', meses: { 0: 80 } },
    canal('dfb_inst_balcao', 'Institucional Balcão', 'dfb_inst', [{ prev: 30, n: 30 }]),
    canal('dfb_inst_horeca', 'Institucional Horeca', 'dfb_inst', [{ prev: 70, n: 70 }]),
    { id: 'qb', empresa: 'Q BRASIL', tipo: 'grupo', meses: { 0: 50 } },
    canal('qb_dist_reg', 'DISTRIBUIDORES REGIONAIS', 'qb', [{ prev: 10, n: 0 }]),
    canal('qb_rest', 'RESTAURAÇÃO', 'qb', [{ prev: 100, n: 100 }]),
    canal('qb_ret_mod', 'RETALHO MODERNO', 'qb', [{ prev: 50, n: 50 }]),
    { id: 'total', empresa: 'Total', tipo: 'total', meses: { 0: 86 } },
  ];
  const ranking = pvAccBuildRanking(list);
  const detalhe = pvAccBuildDetalhePorVendedor(list, ranking);

  assert.ok(detalhe.sections.length >= 3);
  detalhe.sections.forEach(sec => {
    assert.ok(sec.vendedor);
    assert.ok(!/DELTA FOODS|Q BRASIL/i.test(sec.vendedor));
  });

  const mass = detalhe.sections.find(s => s.vendedor === 'Massimo Bottello');
  assert.ok(mass, 'secção Massimo');
  assert.deepEqual(mass.canais.map(c => c.id).sort(), ['dfb_dist_reg', 'qb_dist_reg']);
  assert.equal(mass.total.meses[0], 99, 'Total Massimo = Σ DFB+QB (não média)');
  assert.equal(mass.total.meses[0], ranking.rows.find(r => r.vendedor === 'Massimo Bottello').acc);

  const marcio = detalhe.sections.find(s => s.vendedor === 'Marcio Gorga');
  assert.ok(marcio);
  const marcioIds = marcio.canais.map(c => c.id).sort();
  assert.ok(marcioIds.includes('dfb_lojas'));
  assert.ok(marcioIds.includes('qb_rest'));
  assert.ok(marcioIds.includes('dfb_inst_balcao'));
  assert.ok(!marcioIds.includes('dfb_inst_horeca'));

  const filipe = detalhe.sections.find(s => s.vendedor === 'Filipe Neves');
  assert.ok(filipe.canais.some(c => c.id === 'dfb_inst_horeca'));
  assert.ok(filipe.canais.some(c => c.id === 'dfb_rest'));

  // Ordem das secções = ordem do ranking (melhor accuracy primeiro)
  assert.deepEqual(
    detalhe.sections.map(s => s.vendedor),
    ranking.rows.filter(r => r.nCanais > 0).map(r => r.vendedor)
  );

  // Labels DFB/QB preservados nos canais
  assert.ok(mass.canais.some(c => /DFB/i.test(context.pvAccLabelDeCanal(c))));
  assert.ok(mass.canais.some(c => /QB/i.test(context.pvAccLabelDeCanal(c))));

  // Total geral agrega todos os canais uma vez (sem double-count de grupos empresa)
  assert.ok(detalhe.totalGeral);
  const allCanais = detalhe.sections.flatMap(s => s.canais);
  assert.equal(detalhe.totalGeral.meses[0], pvAccMesesAgregados(allCanais)[0]);

  // HTML do detalhe não emite cabeçalhos de empresa a partir o mesmo vendedor
  const accFn = extractFn(html, 'pvRenderAccuracyHtml');
  assert.ok(accFn.includes('pvAccBuildDetalhePorVendedor'));
  assert.ok(accFn.includes('Total '));
  assert.ok(accFn.includes('agrupado por vendedor'));
  assert.ok(!accFn.includes('pvMapaPadLeft'));
  assert.ok(html.includes('DFB + Q Brasil juntos'));
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
  const itemBalcao = canal('dfb_inst_balcao', 'Institucional Balcão', 'dfb_inst', [{ prev: 10, n: 10 }]);
  const itemHoreca = canal('dfb_inst_horeca', 'Institucional Horeca', 'dfb_inst', [{ prev: 10, n: 10 }]);
  const grupo = { id: 'dfb', empresa: 'DELTA FOODS BRASIL', tipo: 'grupo' };
  const grupoInst = { id: 'dfb_inst', empresa: 'INSTITUCIONAL', tipo: 'grupo', parent: 'dfb' };
  context._pvAccFiltro = '';
  assert.equal(pvAccItemNoFiltro(itemDiogo), true);
  assert.equal(pvAccItemNoFiltro(grupo), true);
  assert.equal(pvAccItemNoFiltro(itemBalcao), true);
  assert.equal(pvAccItemNoFiltro(itemHoreca), true);
  context._pvAccFiltro = 'Diogo Oliveira';
  assert.equal(pvAccItemNoFiltro(itemDiogo), true);
  assert.equal(pvAccItemNoFiltro(itemMarcio), false);
  assert.equal(pvAccItemNoFiltro(itemBalcao), false);
  assert.equal(pvAccItemNoFiltro(grupo), false);
  assert.equal(pvAccItemNoFiltro(grupoInst), false);
  context._pvAccFiltro = '__incerto__';
  const semMapa = canal('canal_sem_mapa', 'CANAL DESCONHECIDO', 'dfb', [{ prev: 10, n: 10 }]);
  assert.equal(pvAccItemNoFiltro(semMapa), true);
  assert.equal(pvAccItemNoFiltro(itemDiogo), false);
  assert.equal(pvAccItemNoFiltro(itemBalcao), false);
  const qbRest = canal('qb_rest', 'RESTAURAÇÃO', 'qb', [{ prev: 10, n: 10 }]);
  assert.equal(pvAccItemNoFiltro(qbRest), false);
  context._pvAccFiltro = 'Marcio Gorga';
  assert.equal(pvAccItemNoFiltro(qbRest), true);
  assert.equal(pvAccItemNoFiltro(itemBalcao), true);
  assert.equal(pvAccItemNoFiltro(itemHoreca), false);
  context._pvAccFiltro = 'Filipe Neves';
  assert.equal(pvAccItemNoFiltro(itemHoreca), true);
  assert.equal(pvAccItemNoFiltro(itemBalcao), false);
  assert.equal(pvAccItemNoFiltro(grupoInst), false);
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
  assert.ok(html.includes('DFB + Q Brasil, mesma pessoa'));
  assert.ok(html.includes('|ΣN − ΣPrev|'));
  assert.ok(html.includes('pv-acc-click'));
  assert.ok(html.includes('a confirmar'));
  assert.ok(html.includes('function pvAccBuildDetalhePorVendedor('));
  assert.ok(!html.includes('id="pv-acc-misto-box"'));
  assert.ok(!html.includes('__misto__'));
  assert.ok(!html.includes('fora do ranking'));
  const accFn = extractFn(html, 'pvRenderAccuracyHtml');
  const rankFn = extractFn(html, 'pvRenderAccuracyRankingHtml');
  assert.ok(accFn.includes('pvRenderAccuracyRankingHtml'));
  assert.ok(accFn.includes('pvAccBuildDetalhePorVendedor'));
  assert.ok(accFn.indexOf('pvRenderAccuracyRankingHtml') < accFn.indexOf('pv-acc-detalhe-tbl'));
  assert.ok(rankFn.includes('pv-acc-ranking-tbl'));
  assert.ok(rankFn.includes('DFB + Q Brasil, mesma pessoa'));
  assert.ok(!rankFn.includes('pv-acc-misto-box'));
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
  assert.ok(outOk.includes('DFB + Q Brasil, mesma pessoa'));
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

check('Institucional no ranking: Balcão no Marcio, Horeca no Filipe, sem caixa misto', () => {
  const list = [
    canal('dfb_lojas', 'LOJAS ONLINE', 'dfb', [{ prev: 200, n: 200 }]),
    canal('dfb_rest', 'RESTAURAÇÃO', 'dfb', [{ prev: 400, n: 400 }]),
    canal('dfb_inst_balcao', 'Institucional Balcão', 'dfb_inst', [{ prev: 30, n: 30 }]),
    canal('dfb_inst_horeca', 'Institucional Horeca', 'dfb_inst', [{ prev: 70, n: 70 }]),
    { id: 'dfb_inst', empresa: 'INSTITUCIONAL', tipo: 'grupo', parent: 'dfb', prevMeses: { 0: 100 }, nMeses: { 0: 100 } },
  ];
  const ranking = pvAccBuildRanking(list);
  const marcio = ranking.rows.find(r => r.vendedor === 'Marcio Gorga');
  const filipe = ranking.rows.find(r => r.vendedor === 'Filipe Neves');
  assert.equal(marcio.prev, 230);
  assert.equal(marcio.n, 230);
  assert.ok(marcio.canais.includes('Institucional Balcão'));
  assert.ok(!marcio.canais.includes('Institucional Horeca'));
  assert.equal(filipe.prev, 470);
  assert.equal(filipe.n, 470);
  assert.ok(filipe.canais.includes('Institucional Horeca'));
  assert.ok(!filipe.canais.includes('Institucional Balcão'));
  assert.ok(!(ranking.foraSoma || []).length);
  assert.ok(!ranking.semDono.some(c => /inst/i.test(c.id)));
  const out = context.pvRenderAccuracyRankingHtml(ranking, 2026);
  assert.ok(!out.includes('id="pv-acc-misto-box"'));
  assert.ok(!out.includes('partido por código no P&L'));
  assert.ok(out.includes('Institucional Balcão'));
  assert.ok(out.includes('Institucional Horeca'));
  assert.ok(out.includes('Marcio Gorga'));
  assert.ok(out.includes('Filipe Neves'));
  assert.ok(!out.includes('por confirmar'));
  assert.ok(!out.includes('__misto__'));
});

check('mapa: pai INSTITUCIONAL é grupo e soma as 2 filhas; total sem double count', () => {
  const linhas = PV_SEED_AGOSTO_2026.linhas.map(r => ({ ...r }));
  const pai = linhas.find(r => r.id === 'dfb_inst');
  const balcao = linhas.find(r => r.id === 'dfb_inst_balcao');
  const horeca = linhas.find(r => r.id === 'dfb_inst_horeca');
  const dfb = linhas.find(r => r.id === 'dfb');
  const total = linhas.find(r => r.id === 'total');
  assert.equal(pai.tipo, 'grupo');
  assert.equal(pai.parent, 'dfb');
  assert.equal(balcao.tipo, 'canal');
  assert.equal(balcao.parent, 'dfb_inst');
  assert.equal(horeca.parent, 'dfb_inst');
  ['prevFecho', 'myr'].forEach(k => {
    assert.equal(balcao[k], null, 'Balcão sem previsão/MYR do pai: ' + k);
    assert.equal(horeca[k], null, 'Horeca sem previsão/MYR do pai: ' + k);
  });
  assert.equal(pai.n1, null, 'pai não guarda N-1 próprio (evita double count)');
  assert.equal(pai.budget, null, 'pai não guarda Budget próprio');
  assert.equal(pai.n, null, 'Agosto: N do pai nasce vazio e passa a ser a soma');
  assert.equal(pai.prevFecho, 26000);
  assert.equal(balcao.n1, 5275);
  assert.equal(horeca.n1, 9161);
  assert.equal(balcao.n + horeca.n, 21006);
  const filhosInst = pvFilhosDeGrupo(pai, linhas);
  assert.deepEqual(filhosInst.map(r => r.id).sort(), ['dfb_inst_balcao', 'dfb_inst_horeca']);
  const filhosDfb = pvFilhosDeGrupo(dfb, linhas);
  assert.ok(filhosDfb.some(r => r.id === 'dfb_inst'));
  assert.ok(!filhosDfb.some(r => r.id === 'dfb_inst_balcao'));
  const filhosTotal = pvFilhosDeGrupo(total, linhas);
  assert.deepEqual(filhosTotal.map(r => r.id).sort(), ['dfb', 'qb']);

  pvRecalcSomasOn(linhas, 'n1');
  pvRecalcSomasOn(linhas, 'n');
  assert.equal(linhas.find(r => r.id === 'dfb_inst').n1, 14436, 'soma das filhas (print 14.437, diff 1)');
  assert.equal(linhas.find(r => r.id === 'dfb_inst').n, 21006);
  assert.equal(linhas.find(r => r.id === 'dfb').n, null, 'DFB não herda só o N institucional');
  pvRecalcSomasOn(linhas, 'prevFecho');
  assert.equal(linhas.find(r => r.id === 'dfb_inst').prevFecho, 26000, 'filhas sem previsão: pai mantém o total');

  balcao.prevFecho = 10000;
  horeca.prevFecho = 16000;
  pvRecalcSomasOn(linhas, 'prevFecho');
  assert.equal(linhas.find(r => r.id === 'dfb_inst').prevFecho, 26000);
  const dfbApos = linhas.find(r => r.id === 'dfb').prevFecho;
  const qbPrev = linhas.find(r => r.id === 'qb').prevFecho;
  const totalApos = linhas.find(r => r.id === 'total').prevFecho;
  assert.equal(totalApos, dfbApos + qbPrev);
  assert.ok(totalApos !== dfbApos + qbPrev + 26000);

  assert.equal(pvMapaPadLeft(dfb, linhas), '8px');
  assert.equal(pvMapaPadLeft(pai, linhas), '18px');
  assert.equal(pvMapaPadLeft(balcao, linhas), '32px');
  assert.equal(pvMapaPadLeft(linhas.find(r => r.id === 'dfb_lojas'), linhas), '18px');
});

check('merge por id cria as 2 filhas sem copiar o total antigo', () => {
  const seed = PV_SEED_AGOSTO_2026.linhas;
  const local = [
    { id: 'dfb', empresa: 'DELTA FOODS BRASIL', tipo: 'grupo', prevFecho: 2521200, n: null, myr: 2770900 },
    { id: 'dfb_lojas', empresa: 'LOJAS ONLINE', tipo: 'canal', parent: 'dfb', prevFecho: 858000, n: 800000, myr: 853855 },
    { id: 'dfb_inst', empresa: 'INSTITUCIONAL', tipo: 'canal', parent: 'dfb', prevFecho: 26000, n: 20000, n1: 14437, budget: 28026, myr: 26136 },
  ];
  const merged = pvMergeLinhasLww(local, [], seed, {}, {}, '2026-09-21T10:00:00.000Z', null);
  const byId = {};
  merged.linhas.forEach(r => { byId[r.id] = r; });
  assert.ok(byId.dfb_inst_balcao, 'filha Balcão criada a partir do seed');
  assert.ok(byId.dfb_inst_horeca, 'filha Horeca criada a partir do seed');
  assert.equal(byId.dfb_inst.tipo, 'grupo');
  assert.equal(byId.dfb_inst.parent, 'dfb');
  assert.equal(byId.dfb_inst.prevFecho, 26000);
  assert.equal(byId.dfb_inst.n, 20000, 'N local do pai mantém-se até ao recalc');
  assert.equal(byId.dfb_inst.n1, 14437, 'N-1 local do pai não é apagado pelo seed vazio');
  assert.equal(byId.dfb_inst_balcao.prevFecho, null, 'não copia a previsão do pai');
  assert.equal(byId.dfb_inst_horeca.prevFecho, null);
  assert.notEqual(byId.dfb_inst_balcao.n, 20000);
  assert.notEqual(byId.dfb_inst_horeca.n, 20000);
  assert.equal(byId.dfb_inst_balcao.n + byId.dfb_inst_horeca.n, 21006);
  assert.equal(byId.dfb_inst_balcao.n1 + byId.dfb_inst_horeca.n1, 14436);
  const linhasRecalc = merged.linhas.map(r => ({ ...r }));
  pvRecalcSomasOn(linhasRecalc, 'n1');
  pvRecalcSomasOn(linhasRecalc, 'n');
  const paiRecalc = linhasRecalc.find(r => r.id === 'dfb_inst');
  const dfbRecalc = linhasRecalc.find(r => r.id === 'dfb');
  assert.equal(paiRecalc.n1, 14436, 'recalc substitui o total antigo pela soma, não soma por cima');
  assert.equal(paiRecalc.n, 21006);
  assert.notEqual(paiRecalc.n, 20000 + 21006);
  assert.equal(dfbRecalc.n, null, 'sem N nos outros canais, a DFB não fica só com o Institucional');
  assert.equal(byId.dfb_lojas.n, 800000);
  const ids = merged.linhas.map(r => r.id);
  assert.ok(ids.indexOf('dfb_inst') < ids.indexOf('dfb_inst_balcao'));
  assert.ok(ids.indexOf('dfb_inst_balcao') < ids.indexOf('dfb_inst_horeca'));
  assert.ok(ids.indexOf('dfb_inst_horeca') < ids.indexOf('qb'));
});

check('cloud com filhas vazias não apaga N-1/Budget/N do seed', () => {
  // Forma da cloud de produção: pai com o total antigo, filhas presentes mas
  // a null, e cellTs em campos vazios. Vazio não pode tapar o seed.
  const TS = '2026-09-22T20:44:05.011Z';
  const campos = ['n1', 'budget', 'n', 'prevFecho', 'myr'];
  Object.keys(PV_SEEDS_INST).forEach(mesKey => {
    const mes = Number(mesKey);
    const seed = PV_SEEDS_INST[mes].linhas.map(r => ({ ...r }));
    const cloud = seed.map(r => ({ ...r }));
    const pai = cloud.find(r => r.id === 'dfb_inst');
    pai.n1 = 18634;
    pai.budget = 14995;
    if (mes !== 6) pai.n = 20000;
    ['dfb_inst_balcao', 'dfb_inst_horeca'].forEach(id => {
      const row = cloud.find(r => r.id === id);
      campos.forEach(k => { row[k] = null; });
    });
    const lojas = cloud.find(r => r.id === 'dfb_lojas');
    lojas.n = 810000;
    lojas.prevFecho = 900000;
    const cellTs = {};
    ['dfb_inst', 'dfb_inst_balcao', 'dfb_inst_horeca', 'dfb_lojas'].forEach(id => {
      cellTs[id] = { n: TS, prevFecho: TS, myr: TS, n1: TS, budget: TS };
    });
    const merged = pvMergeLinhasLww(cloud, cloud, seed, cellTs, cellTs, TS, TS);
    const byId = {};
    merged.linhas.forEach(r => { byId[r.id] = r; });
    const seedBalcao = seed.find(r => r.id === 'dfb_inst_balcao');
    const seedHoreca = seed.find(r => r.id === 'dfb_inst_horeca');
    ['n1', 'budget', 'n'].forEach(k => {
      assert.equal(byId.dfb_inst_balcao[k], seedBalcao[k], mes + ' Balcão ' + k);
      assert.equal(byId.dfb_inst_horeca[k], seedHoreca[k], mes + ' Horeca ' + k);
    });
    assert.equal(byId.dfb_inst_balcao.prevFecho, null, mes + ' Balcão sem previsão do pai');
    assert.equal(byId.dfb_inst_horeca.prevFecho, null, mes + ' Horeca sem previsão do pai');
    assert.equal(byId.dfb_inst_balcao.myr, null);
    assert.equal(byId.dfb_inst_horeca.myr, null);
    assert.equal(byId.dfb_lojas.n, 810000, mes + ' N de outro canal intacto');
    assert.equal(byId.dfb_lojas.prevFecho, 900000, mes + ' previsão de outro canal intacta');
    const linhas = merged.linhas.map(r => ({ ...r }));
    pvRecalcSomasOn(linhas, 'n1');
    pvRecalcSomasOn(linhas, 'n');
    const paiRecalc = linhas.find(r => r.id === 'dfb_inst');
    const b = linhas.find(r => r.id === 'dfb_inst_balcao');
    const h = linhas.find(r => r.id === 'dfb_inst_horeca');
    assert.equal(paiRecalc.n1, b.n1 + h.n1, mes + ' pai soma N-1, não acumula o total da cloud');
    if (b.n == null && h.n == null) {
      assert.equal(b.n, null);
      assert.equal(h.n, null);
      if (mes === 6) assert.equal(paiRecalc.n, 34073, 'Julho: fecho fica no pai');
      else assert.equal(paiRecalc.n, 20000, mes + ' sem N nas filhas, o N do pai não é apagado');
    } else {
      assert.equal(paiRecalc.n, b.n + h.n, mes + ' pai soma o N das filhas');
      assert.notEqual(paiRecalc.n, 20000 + b.n + h.n);
    }
    assert.equal(linhas.find(r => r.id === 'dfb_lojas').n, 810000);
  });
});

check('P&L Institucional Jul–Dez: Balcão+Horeca = total do print; sem N fora de Ago/Set', () => {
  const codigosBalcao = [99520011, 99520012, 99520005];
  const codigosHoreca = [99520019, 99520015, 99520016, 99520017];
  assert.deepEqual(PV_ACC_CANAL_VENDEDOR.dfb_inst_balcao.codes.slice().sort(), codigosBalcao.slice().sort());
  assert.deepEqual(PV_ACC_CANAL_VENDEDOR.dfb_inst_horeca.codes.slice().sort(), codigosHoreca.slice().sort());
  const extra = [99520011, 99520012, 99520005, 99520019, 99520015, 99520016, 99520017];
  codigosBalcao.forEach(c => assert.ok(!codigosHoreca.includes(c), 'código do Marcio no Horeca: ' + c));
  codigosHoreca.forEach(c => assert.ok(!codigosBalcao.includes(c), 'código do Filipe no Balcão: ' + c));

  // Célula vazia do print = 0 na soma. Números como no P&L (ponto = milhar).
  const detalhe = {
    6: {
      mes: 'Julho', print: { n1: 18634, budget: 14995, n: null },
      linhas: {
        99520011: { n1: 2838, budget: 1087 },
        99520012: { n1: 1027, budget: 5706 },
        99520005: {},
        99520015: { n1: 4338, budget: 2236 },
        99520016: { n1: 10430, budget: 3925 },
        99520017: { budget: 2009 },
        99520019: { budget: 33 },
      },
    },
    7: {
      mes: 'Agosto', print: { n1: 14437, budget: 28026, n: 21006 },
      linhas: {
        99520011: { n1: 1766, n: 7888, budget: 2031 },
        99520012: { n1: 3509, n: 3847, budget: 10665 },
        99520005: {},
        99520016: { n1: 816, n: 4953, budget: 7335 },
        99520017: { n1: 3102, n: 3965, budget: 3755 },
        99520015: { n1: 5243, n: 353, budget: 4178 },
        99520019: { budget: 62 },
      },
    },
    8: {
      mes: 'Setembro', print: { n1: 24902, budget: 22490, n: 18483 },
      linhas: {
        99520011: { n1: 3432, n: 11336, budget: 1630 },
        99520012: { n1: 2677, budget: 8558 },
        99520005: {},
        99520017: { n1: 4235, n: 2483, budget: 3013 },
        99520016: { n1: 9742, n: 1426, budget: 5886 },
        99520015: { n1: 4816, n: 3239, budget: 3353 },
        99520019: { budget: 50 },
      },
    },
    9: {
      mes: 'Outubro', print: { n1: 22412, budget: 23420, n: null },
      linhas: {
        99520011: { n1: 400, budget: 1697 },
        99520012: { budget: 8912 },
        99520005: {},
        99520017: { n1: 1589, budget: 3138 },
        99520016: { n1: 11647, budget: 6130 },
        99520015: { n1: 8777, budget: 3492 },
        99520019: { budget: 52 },
      },
    },
    10: {
      mes: 'Novembro', print: { n1: 25310, budget: 35728, n: null },
      linhas: {
        99520011: { n1: 1438, budget: 2589 },
        99520012: { budget: 13596 },
        99520005: {},
        99520017: { n1: 13858, budget: 4787 },
        99520016: { n1: 10014, budget: 9351 },
        99520015: { budget: 5327 },
        99520019: { budget: 79 },
      },
    },
    11: {
      mes: 'Dezembro', print: { n1: 1171, budget: 20961, n: null },
      linhas: {
        99520011: { n1: 1171, budget: 1519 },
        99520012: { n1: 0, budget: 7977 },
        99520005: {},
        99520017: { n1: 0, budget: 2808 },
        99520016: { budget: 5486 },
        99520015: { budget: 3125 },
        99520019: { budget: 46 },
      },
    },
  };

  function soma(linhas, codigos, campo) {
    return codigos.reduce((s, c) => s + (Number(linhas[c] && linhas[c][campo]) || 0), 0);
  }

  Object.keys(detalhe).forEach(mesKey => {
    const mes = Number(mesKey);
    const d = detalhe[mes];
    const seed = PV_SEEDS_INST[mes];
    const linhas = seed.linhas.map(r => ({ ...r }));
    const pai = linhas.find(r => r.id === 'dfb_inst');
    const balcao = linhas.find(r => r.id === 'dfb_inst_balcao');
    const horeca = linhas.find(r => r.id === 'dfb_inst_horeca');
    const dfb = linhas.find(r => r.id === 'dfb');
    assert.equal(seed.mes, mes, d.mes);
    assert.deepEqual(Object.keys(d.linhas).map(Number).sort(), extra.slice().sort(), d.mes + ' só os 7 códigos');

    const bN1 = soma(d.linhas, codigosBalcao, 'n1');
    const hN1 = soma(d.linhas, codigosHoreca, 'n1');
    const bBud = soma(d.linhas, codigosBalcao, 'budget');
    const hBud = soma(d.linhas, codigosHoreca, 'budget');
    assert.equal(balcao.n1, bN1, d.mes + ' Balcão N-1');
    assert.equal(horeca.n1, hN1, d.mes + ' Horeca N-1');
    assert.equal(balcao.budget, bBud, d.mes + ' Balcão Budget');
    assert.equal(horeca.budget, hBud, d.mes + ' Horeca Budget');
    assert.ok(Math.abs((bN1 + hN1) - d.print.n1) <= 1, d.mes + ' N-1 vs print');
    assert.ok(Math.abs((bBud + hBud) - d.print.budget) <= 1, d.mes + ' Budget vs print');
    assert.equal(balcao.prevFecho, null, d.mes + ' Balcão sem previsão');
    assert.equal(horeca.prevFecho, null, d.mes + ' Horeca sem previsão');
    assert.equal(balcao.myr, null);
    assert.equal(horeca.myr, null);
    assert.equal(pai.n1, null, d.mes + ' pai sem N-1 próprio');
    assert.equal(pai.budget, null, d.mes + ' pai sem Budget próprio');

    if (d.print.n == null) {
      assert.equal(balcao.n, null, d.mes + ' sem fecho: Balcão N vazio');
      assert.equal(horeca.n, null, d.mes + ' sem fecho: Horeca N vazio');
    } else {
      const bN = soma(d.linhas, codigosBalcao, 'n');
      const hN = soma(d.linhas, codigosHoreca, 'n');
      assert.equal(balcao.n, bN, d.mes + ' Balcão N');
      assert.equal(horeca.n, hN, d.mes + ' Horeca N');
      assert.ok(Math.abs((bN + hN) - d.print.n) <= 1, d.mes + ' N vs print');
      const dfbNAntes = dfb.n;
      pvRecalcSomasOn(linhas, 'n');
      assert.equal(linhas.find(r => r.id === 'dfb_inst').n, bN + hN);
      assert.equal(linhas.find(r => r.id === 'dfb').n, dfbNAntes, d.mes + ' DFB não fica só com o N institucional');
    }
    pvRecalcSomasOn(linhas, 'n1');
    pvRecalcSomasOn(linhas, 'budget');
    assert.equal(linhas.find(r => r.id === 'dfb_inst').n1, bN1 + hN1);
    assert.equal(linhas.find(r => r.id === 'dfb_inst').budget, bBud + hBud);
    assert.notEqual(linhas.find(r => r.id === 'dfb_inst').n1, (bN1 + hN1) * 2);
  });

  const jul = PV_SEEDS_INST[6].linhas.find(r => r.id === 'dfb_inst');
  assert.equal(jul.n, 34073, 'Julho: fecho antigo do pai fica; o print não parte o N');
  assert.equal(jul.prevFecho, 15000);
  const ago = PV_SEEDS_INST[7].linhas.find(r => r.id === 'dfb_inst');
  assert.equal(ago.prevFecho, 26000, 'previsão de Agosto não é partida');
  assert.equal(ago.myr, 26136);
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
