#!/usr/bin/env node
/** Contratos Registados: cache local + vendas só dos códigos do contrato. */
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
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
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

const loadFn = html.slice(
  html.indexOf('async function loadContratosTab'),
  html.indexOf('function filtrarContratosTabela')
);
const aplicarFn = extractFn(html, 'aplicarUtilizador');
const porRegistarFn = extractFn(html, 'loadContratosPorRegistar');
const filtrarFn = extractFn(html, 'filtrarContratosVendedor');
const clearFn = extractFn(html, 'clearContratosCache');

check('não descarrega todas as vendas na abertura', () => {
  assert.ok(loadFn.includes('getVendasParaContratos'));
  assert.ok(!loadFn.includes('getVendas()'));
  assert.ok(loadFn.includes('loadRegistosParaContratos'));
});

check('pinta cache em memória/IndexedDB sem spinner', () => {
  assert.ok(loadFn.includes('CONTRATOS_TAB_IDB_KEY') || html.includes("idbGet(CONTRATOS_TAB_IDB_KEY)"));
  assert.ok(html.includes("idbGet(CONTRATOS_TAB_IDB_KEY)"));
  assert.ok(loadFn.includes('contratosRevalidateBg'));
  assert.ok(loadFn.includes('_contratosAllRows.length'));
});

check('cache IndexedDB de contratos usa v2 para não reutilizar dups antigos', () => {
  assert.ok(html.includes("delta_contratos_tab_v2"));
  assert.ok(!html.includes("delta_contratos_tab_v1"));
  const apply = extractFn(html, 'contratosTabApplyPacked');
  assert.ok(apply.includes('resolverContratosDuplicados'));
});

check('filtro já não força refresh completo', () => {
  assert.ok(filtrarFn.includes('loadContratosTab(false)'));
  assert.ok(!filtrarFn.includes('loadContratosTab(true)'));
});

check('mudar de utilizador não apaga o quadro calculado', () => {
  assert.ok(!aplicarFn.includes('clearContratosCache()'));
  assert.ok(!aplicarFn.includes('_contratosAllRows = null'));
});

check('Por registar reutiliza allData/cache', () => {
  assert.ok(porRegistarFn.includes('getRegistosCache'));
  assert.ok(porRegistarFn.includes('_contratosPorRegistar'));
});

check('invalidar cache limpa memória e IndexedDB', () => {
  assert.ok(clearFn.includes('_contratosAllRows = null'));
  assert.ok(clearFn.includes('CONTRATOS_TAB_IDB_KEY'));
  assert.ok(clearFn.includes('_contratosDocsHydrated = false'));
});

const ctx = {
  console,
  Date,
  String,
  Array,
  Number,
  Set,
  localStorage: {
    _s: Object.create(null),
    getItem(k) { return k in this._s ? this._s[k] : null; },
    setItem(k, v) { this._s[k] = String(v); },
  },
  normalizaCodSC(raw) {
    return String(raw || '').replace(/^0+/, '') || '0';
  },
};
vm.createContext(ctx);
for (const name of [
  'contratosYmKey',
  'parseContentRangeTotal',
  'vendasCargaStamp',
  'contratosSigFromRegistos',
  'contratosFpIgual',
  'filterVendasPorCods',
]) {
  vm.runInContext(extractFn(html, name), ctx);
}

check('contratosYmKey YYYY-MM', () => {
  assert.equal(ctx.contratosYmKey(new Date(2026, 7, 28)), '2026-08');
});

check('parseContentRangeTotal', () => {
  assert.equal(ctx.parseContentRangeTotal('0-0/71234'), 71234);
  assert.equal(ctx.parseContentRangeTotal('0-0/*'), null);
  assert.equal(ctx.parseContentRangeTotal(''), null);
});

check('contratosSigFromRegistos muda se o consumo muda', () => {
  const a = [{ cod: '1', contratos: [{ num: 'A', inicio: '2024-01', consumo: 10, duracao: 12 }] }];
  const b = [{ cod: '1', contratos: [{ num: 'A', inicio: '2024-01', consumo: 11, duracao: 12 }] }];
  assert.notEqual(ctx.contratosSigFromRegistos(a), ctx.contratosSigFromRegistos(b));
  assert.equal(ctx.contratosSigFromRegistos(a), ctx.contratosSigFromRegistos(a));
});

check('contratosSigFromRegistos muda ao juntar códigos PDV Multi', () => {
  const a = [{ cod: '1', contratos: [{ num: '031/2022', inicio: '2022-01', consumo: 10, duracao: 12, pdv: 'unico' }] }];
  const b = [{ cod: '1', contratos: [{ num: '031/2022', inicio: '2022-01', consumo: 10, duracao: 12, pdv: 'multi', cods: ['794161', '792643'] }] }];
  assert.notEqual(ctx.contratosSigFromRegistos(a), ctx.contratosSigFromRegistos(b));
});

check('contratosFpIgual: mesmo mês e mesmas vendas = cache válido', () => {
  const fp = { ym: '2026-08', vendasN: 10, nRegs: 4, sig: 'x', vendasCarga: 't' };
  assert.ok(ctx.contratosFpIgual(fp, { ...fp }));
  assert.ok(!ctx.contratosFpIgual(fp, { ...fp, ym: '2026-09' }));
  assert.ok(!ctx.contratosFpIgual(fp, { ...fp, vendasN: 11 }));
  assert.ok(!ctx.contratosFpIgual(fp, { ...fp, vendasCarga: 'outro' }));
});

check('filterVendasPorCods só devolve os códigos pedidos', () => {
  const vendas = [
    { cod: '001', qty: 1 },
    { cod: '002', qty: 2 },
    { cod: '003', qty: 3 },
  ];
  const out = ctx.filterVendasPorCods(vendas, new Set(['1', '003']));
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(v => v.cod).sort(), ['001', '003']);
});

check('vendasCargaStamp lê a última carga local', () => {
  ctx.localStorage.setItem('delta_vendas_ultima_carga', JSON.stringify({
    data: '2026-08-01T10:00:00.000Z', novos: 12, noPeriodo: 100,
  }));
  assert.equal(ctx.vendasCargaStamp(), '2026-08-01T10:00:00.000Z|12|100');
});

if (process.exitCode) {
  console.error('\nFalhou pelo menos um teste de cache de contratos.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes de cache de contratos passaram.');
