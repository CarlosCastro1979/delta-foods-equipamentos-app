#!/usr/bin/env node
/**
 * Dist: menu «Resumo carga» — qty + valor por código distribuidor.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.dirname(fileURLToPath(import.meta.url));
const CACHE = 'v2026-11-24-dividas-balancete-dup';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.ok(html.includes(CACHE), 'index cache');
assert.ok(sw.includes(CACHE), 'sw cache');
assert.ok(html.includes('id="sub-resumo-carga"'), 'tab Resumo carga');
assert.ok(html.includes('id="panel-resumo-carga"'), 'painel Resumo carga');
assert.ok(html.includes('function distBuildResumoCargaRows('), 'agregador');
assert.ok(html.includes('function loadDistResumoCarga('), 'loader');
assert.ok(html.includes('function renderDistResumoCarga('), 'render');
assert.ok(html.includes("'resumo-carga'"), 'switchSubTab conhece resumo-carga');
assert.ok(html.includes('hideResumoCarga'), 'tabs state Dist');
assert.ok(html.includes('distResumoLimparFiltro'), 'limpar filtro resumo');

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

const rows = [
  { cod_cliente: '458532', nome_cliente: 'BEER BEV', qty: 10, meta: { valor: 1000 } },
  { cod_cliente: '458532', nome_cliente: 'BEER BEV', qty: 5, meta: { valor: 500 } },
  { cod_cliente: '749286', nome_cliente: 'EUROBRASIL', qty: 8, meta: { valor: 0 } },
  { cod_cliente: '458529', nome_cliente: 'BEER BEV OUTRO', qty: 3, meta: { valor: 200 } },
];

const ctx = {
  console,
  Map,
  String,
  Number,
  Math,
  Array,
  Object,
  JSON,
  normCod(v) { return String(v || '').trim().replace(/^0+/, '') || '0'; },
  distNormCodCliente(cod) {
    const s = String(cod || '').trim().replace(/^0+/, '');
    return s || '';
  },
  distSanitizeQty(q) {
    const n = Number(q);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
  },
  distCargaRowValor(r) {
    const m = r && r.meta;
    return m && m.valor != null ? Number(m.valor) || 0 : 0;
  },
  distCargaAllRows() { return rows; },
  getListaClientesActiva() {
    return [
      { cod: '458532', nome: 'BEER BEV COM.IMP', vendedor: 'EDUARDO MADEIRA', cep: '01000-000' },
      { cod: '749286', nome: 'EUROBRASIL', vendedor: 'MASSIMO BOTTELLO', cep: '02000-000' },
    ];
  },
  clientePertenceAoCanal() { return true; },
};
vm.createContext(ctx);
vm.runInContext(extractFn(html, 'canalRegistosTabsState'), ctx);
vm.runInContext(extractFn(html, 'distBuildResumoCargaRows'), ctx);

const st = ctx.canalRegistosTabsState('distribuidores');
assert.equal(st.hideResumoCarga, false);
assert.equal(ctx.canalRegistosTabsState('horeca').hideResumoCarga, true);

const agg = ctx.distBuildResumoCargaRows();
assert.equal(agg.length, 3, '3 códigos distintos');
const beer = agg.find(r => r.cod === '458532');
assert.ok(beer);
assert.equal(beer.qty, 15);
assert.equal(beer.valor, 1500);
assert.equal(beer.vendedor, 'EDUARDO MADEIRA');
const euro = agg.find(r => r.cod === '749286');
assert.equal(euro.qty, 8);
assert.equal(euro.valor, 0);
const other = agg.find(r => r.cod === '458529');
assert.equal(other.qty, 3);
assert.equal(other.valor, 200);
// Ordenação: maior valor primeiro
assert.equal(agg[0].cod, '458532');

console.log('test-dist-resumo-carga: ok');
