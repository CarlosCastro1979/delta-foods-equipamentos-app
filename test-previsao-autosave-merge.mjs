#!/usr/bin/env node
/**
 * Autosave Previsão: merge célula-a-célula (N + Previsão, incl. Setembro).
 * Garante que um snapshot cloud 18/08 vazio não apaga N/previsão preenchidos.
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

const context = { console, Math, Number, String, Date, Object, Array };
vm.createContext(context);

const fns = [
  'pvEditFieldNames',
  'pvYtdFieldNames',
  'pvHasValue',
  'pvTsMs',
  'pvPickEditField',
  'pvIndexLinhasById',
  'pvMergeLinhasLww',
  'pvParseStoreKey',
  'pvMonthStamp',
];
for (const name of fns) {
  vm.runInContext(extractFn(html, name), context);
}

context.pvSeedLinhas = (ano, mes) => {
  const m = Number(mes);
  if (m === 7) {
    return [
      { id: 'dfb_lojas', empresa: 'LOJAS ONLINE', tipo: 'canal', parent: 'dfb', prevFecho: 858000, n: null, myr: 853855, n1: 1, budget: 1 },
      { id: 'dfb', empresa: 'DELTA FOODS BRASIL', tipo: 'grupo', prevFecho: 2521200, n: null, myr: 2770900 },
    ];
  }
  if (m === 8) {
    return [
      { id: 'dfb_lojas', empresa: 'LOJAS ONLINE', tipo: 'canal', parent: 'dfb', prevFecho: null, n: null, myr: 1014653, n1: 1, budget: 1 },
      { id: 'dfb', empresa: 'DELTA FOODS BRASIL', tipo: 'grupo', prevFecho: null, n: null, myr: 3292716 },
    ];
  }
  return [];
};

vm.runInContext(extractFn(html, 'pvMergeMonthDocs'), context);
vm.runInContext(extractFn(html, 'pvMergeAllMaps'), context);

const {
  pvHasValue,
  pvPickEditField,
  pvMergeLinhasLww,
  pvParseStoreKey,
  pvMergeMonthDocs,
  pvMergeAllMaps,
} = context;

const CLOUD_18_08 = '2026-08-18T22:22:05.312Z';
const YESTERDAY = '2026-09-15T18:40:00.000Z';

check('0 é valor (N=0 não é vazio)', () => {
  assert.equal(pvHasValue(0), true);
  assert.equal(pvHasValue(-4254), true);
  assert.equal(pvHasValue(null), false);
  assert.equal(pvHasValue(''), false);
  assert.equal(pvHasValue(undefined), false);
});

check('vazio nunca substitui N preenchido (mesmo com ts mais novo)', () => {
  const picked = pvPickEditField(null, YESTERDAY, 2194051, CLOUD_18_08, null);
  assert.equal(picked.value, 2194051);
});

check('N local de ontem ganha ao cloud 18/08 vazio', () => {
  const picked = pvPickEditField(1234567, YESTERDAY, null, CLOUD_18_08, null);
  assert.equal(picked.value, 1234567);
});

check('duas previsões preenchidas: last-write-wins por timestamp', () => {
  const newer = pvPickEditField(900000, YESTERDAY, 858000, CLOUD_18_08, 858000);
  assert.equal(newer.value, 900000);
  const olderLocal = pvPickEditField(900000, CLOUD_18_08, 858000, YESTERDAY, 858000);
  assert.equal(olderLocal.value, 858000);
});

check('seed não substitui previsão preenchida', () => {
  const picked = pvPickEditField(900000, YESTERDAY, null, null, 858000);
  assert.equal(picked.value, 900000);
});

check('seed só preenche se local e cloud vazios', () => {
  const picked = pvPickEditField(null, null, null, null, 858000);
  assert.equal(picked.value, 858000);
});

check('merge não apaga N local quando cloud 18/08 tem n:null (Agosto)', () => {
  const local = [{
    id: 'dfb_lojas', tipo: 'canal', parent: 'dfb', empresa: 'LOJAS ONLINE',
    prevFecho: 858000, n: 810000, myr: 853855,
  }];
  const cloud = [{
    id: 'dfb_lojas', tipo: 'canal', parent: 'dfb', empresa: 'LOJAS ONLINE',
    prevFecho: 858000, n: null, myr: 853855,
  }];
  const seed = context.pvSeedLinhas(2026, 7);
  const merged = pvMergeLinhasLww(
    local, cloud, seed,
    { dfb_lojas: { n: YESTERDAY } },
    {},
    YESTERDAY,
    CLOUD_18_08
  );
  const row = merged.linhas.find(r => r.id === 'dfb_lojas');
  assert.equal(row.n, 810000);
  assert.equal(row.prevFecho, 858000);
});

check('documento cloud 18/08 não substitui células locais mais novas', () => {
  const local = [{
    id: 'dfb_lojas', tipo: 'canal', parent: 'dfb', empresa: 'LOJAS ONLINE',
    prevFecho: 900000, n: 810000, myr: 853855,
  }];
  const cloud = [{
    id: 'dfb_lojas', tipo: 'canal', parent: 'dfb', empresa: 'LOJAS ONLINE',
    prevFecho: 858000, n: null, myr: 853855,
  }];
  const seed = context.pvSeedLinhas(2026, 7);
  const merged = pvMergeLinhasLww(local, cloud, seed, {}, {}, YESTERDAY, CLOUD_18_08);
  const row = merged.linhas.find(r => r.id === 'dfb_lojas');
  assert.equal(row.n, 810000, 'N local tem de ficar');
  assert.equal(row.prevFecho, 900000, 'previsão local mais nova, não a de 18/08');
});

check('seed Agosto não apaga N preenchido (pvMergeMonthDocs)', () => {
  const localDoc = {
    ano: 2026,
    mes: 7,
    actualizadoEm: YESTERDAY,
    linhas: [{
      id: 'dfb_lojas', tipo: 'canal', parent: 'dfb', empresa: 'LOJAS ONLINE',
      prevFecho: 858000, n: 810000, myr: 853855,
    }],
    cellTs: { dfb_lojas: { n: YESTERDAY } },
  };
  const cloudDoc = {
    ano: 2026,
    mes: 7,
    actualizadoEm: CLOUD_18_08,
    linhas: [{
      id: 'dfb_lojas', tipo: 'canal', parent: 'dfb', empresa: 'LOJAS ONLINE',
      prevFecho: 858000, n: null, myr: 853855,
    }],
  };
  const merged = pvMergeMonthDocs(localDoc, cloudDoc, 2026, 7);
  const row = merged.linhas.find(r => r.id === 'dfb_lojas');
  assert.equal(row.n, 810000);
});

check('autosave Setembro (mês 8, calendário 9) sobrevive a cloud/seed vazios', () => {
  assert.equal(pvParseStoreKey('dfb_previsao_mapa_v3_2026_8').mes, 8);
  assert.equal(pvParseStoreKey('dfb_previsao_mapa_v3_2026_7').mes, 7);
  const localDoc = {
    ano: 2026,
    mes: 8,
    actualizadoEm: YESTERDAY,
    linhas: [{
      id: 'dfb_lojas', tipo: 'canal', parent: 'dfb', empresa: 'LOJAS ONLINE',
      prevFecho: 1100000, n: null, myr: 1014653,
    }],
    cellTs: { dfb_lojas: { prevFecho: YESTERDAY } },
  };
  const cloudDoc = {
    ano: 2026,
    mes: 8,
    actualizadoEm: CLOUD_18_08,
    linhas: [{
      id: 'dfb_lojas', tipo: 'canal', parent: 'dfb', empresa: 'LOJAS ONLINE',
      prevFecho: null, n: null, myr: 1014653,
    }],
  };
  const merged = pvMergeMonthDocs(localDoc, cloudDoc, 2026, 8);
  const row = merged.linhas.find(r => r.id === 'dfb_lojas');
  assert.equal(row.prevFecho, 1100000);
  assert.equal(row.n, null);
});

check('publicar só com Agosto local não apaga Setembro da cloud', () => {
  const localMaps = {
    dfb_previsao_mapa_v3_2026_7: {
      ano: 2026,
      mes: 7,
      actualizadoEm: YESTERDAY,
      linhas: [{
        id: 'dfb_lojas', tipo: 'canal', parent: 'dfb', empresa: 'LOJAS ONLINE',
        prevFecho: 858000, n: 810000, myr: 853855,
      }],
      cellTs: { dfb_lojas: { n: YESTERDAY } },
    },
  };
  const cloudMaps = {
    dfb_previsao_mapa_v3_2026_7: {
      ano: 2026,
      mes: 7,
      actualizadoEm: CLOUD_18_08,
      linhas: [{
        id: 'dfb_lojas', tipo: 'canal', parent: 'dfb', empresa: 'LOJAS ONLINE',
        prevFecho: 858000, n: null, myr: 853855,
      }],
    },
    dfb_previsao_mapa_v3_2026_8: {
      ano: 2026,
      mes: 8,
      actualizadoEm: CLOUD_18_08,
      linhas: [{
        id: 'dfb_lojas', tipo: 'canal', parent: 'dfb', empresa: 'LOJAS ONLINE',
        prevFecho: 1100000, n: null, myr: 1014653,
      }],
    },
  };
  const maps = pvMergeAllMaps(localMaps, cloudMaps);
  assert.ok(maps.dfb_previsao_mapa_v3_2026_7, 'Agosto presente');
  assert.ok(maps.dfb_previsao_mapa_v3_2026_8, 'Setembro da cloud não pode desaparecer');
  const ago = maps.dfb_previsao_mapa_v3_2026_7.linhas.find(r => r.id === 'dfb_lojas');
  const set = maps.dfb_previsao_mapa_v3_2026_8.linhas.find(r => r.id === 'dfb_lojas');
  assert.equal(ago.n, 810000);
  assert.equal(set.prevFecho, 1100000);
});

check('payload local de um mês inclui N e previsão no JSON', () => {
  const doc = {
    ano: 2026,
    mes: 8,
    linhas: [
      { id: 'dfb_lojas', tipo: 'canal', n: 810000, prevFecho: 1100000, myr: 1014653 },
    ],
    cellTs: { dfb_lojas: { n: YESTERDAY, prevFecho: YESTERDAY } },
    actualizadoEm: YESTERDAY,
  };
  const raw = JSON.stringify(doc);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.linhas[0].n, 810000);
  assert.equal(parsed.linhas[0].prevFecho, 1100000);
  assert.equal(parsed.mes, 8);
});

check('código: N entra no autosave e flush em blur/visibility/beforeunload', () => {
  const inputFn = extractFn(html, 'pvOnCampoInput');
  const blurFn = extractFn(html, 'pvOnCampoBlur');
  const saveFn = extractFn(html, 'pvSaveData');
  const bindFn = extractFn(html, 'pvBindAutosaveLifecycle');
  assert.ok(html.includes("pvOnCampoInput(el, 'n')") || html.includes("pvOnRealNInput"));
  assert.ok(inputFn.includes('pvTouchCell'));
  assert.ok(inputFn.includes('pvAutosave'));
  assert.ok(blurFn.includes('pvFlushAutosave'));
  assert.ok(saveFn.includes('JSON.stringify(_pvData)'));
  assert.ok(saveFn.includes('pvPodeEditar'));
  assert.ok(extractFn(html, 'pvFlushAutosave').includes('pvPodeEditar'));
  assert.ok(extractFn(html, 'pvPersistLocalSilent').includes('pvPodeEditar'));
  assert.ok(bindFn.includes('visibilitychange'));
  assert.ok(bindFn.includes('pagehide'));
  assert.ok(bindFn.includes('beforeunload'));
  assert.ok(html.includes('pvMergeAllMaps'));
  assert.ok(html.includes('fetchFailed'));
  assert.ok(html.includes('pvDebugLocalMaps'));
  assert.ok(extractFn(html, 'pvBuildMergedCloudPayload').includes('fetchFailed'));
  const seedMerge = extractFn(html, 'pvMergeSeedIntoLinhas');
  assert.ok(seedMerge.includes("['n', 'prevFecho', 'myr']"));
  assert.ok(seedMerge.includes('!pvHasValue(out[k])'));
  assert.ok(!seedMerge.includes('if (s.prevFecho != null && s.prevFecho !== \'\') out.prevFecho = s.prevFecho'));
});

check('mês: Agosto=7 Setembro=8 no selector e seeds', () => {
  assert.ok(html.includes('value="7" selected>Agosto'));
  assert.ok(html.includes('value="8">Setembro'));
  assert.ok(html.includes("'2026_7': PV_SEED_AGOSTO_2026"));
  assert.ok(html.includes("'2026_8': PV_SEED_SETEMBRO_2026"));
});

if (process.exitCode) {
  console.error('\nAlguns testes de autosave/merge falharam.');
} else {
  console.log('\nTodos os testes de autosave/merge da previsão passaram.');
}
