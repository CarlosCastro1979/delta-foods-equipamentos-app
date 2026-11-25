#!/usr/bin/env node
/**
 * Dist carga Excel: NF ↔ código SAP 1:1.
 * Dois códigos com o mesmo nome (Beer Bev) não partilham NFs nem registo.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.dirname(fileURLToPath(import.meta.url));
const CACHE = 'v2026-11-24-sap-lista-atualizado';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.ok(html.includes(CACHE), 'index cache bump');
assert.ok(sw.includes(CACHE), 'sw cache bump');
assert.ok(html.includes('só por código SAP'), 'comentário: match só por código');
assert.ok(html.includes('function distCargaRowIsCodSuspect('), 'helper poluição CEP/nome');

const byClienteSrc = html.slice(
  html.indexOf('function distCargaByCliente'),
  html.indexOf('function distNormNf')
);
assert.ok(!/byNome\.includes\(nn\)|nn\.includes\(byNome\)/.test(byClienteSrc), 'sem fallback fuzzy por nome');
assert.ok(!/opts\.nome/.test(byClienteSrc), 'opts.nome não usado no match');

const findRegSrc = html.slice(
  html.indexOf('function distFindRegistoForCliente'),
  html.indexOf('async function loadPendentes')
);
assert.ok(!/distNormNomeCliente/.test(findRegSrc), 'registo Dist sem match por nome');

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

const beerNome = 'BEER BEV COM.IMP.E DIST. DE BEBIDAS LTDA';
const rows = [
  { id: 'a1', nf: '1001', cod_cliente: '458529', nome_cliente: beerNome, codigo_sap: 'EQ1', qty: 10 },
  { id: 'a2', nf: '1002', cod_cliente: '458529', nome_cliente: beerNome, codigo_sap: 'EQ1', qty: 5 },
  { id: 'b1', nf: '2001', cod_cliente: '458532', nome_cliente: beerNome, codigo_sap: 'EQ2', qty: 8 },
  { id: 'b2', nf: '2002', cod_cliente: '458532', nome_cliente: beerNome, codigo_sap: 'EQ2', qty: 7 },
];

const ctx = {
  console,
  Map,
  Set,
  String,
  Number,
  Math,
  Array,
  Object,
  JSON,
  formatSapCod(s) { return String(s || '').trim(); },
  normCod(v) { return String(v || '').trim().replace(/^0+/, '') || '0'; },
  distSanitizeQty(q) {
    const n = Number(q);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
  },
  distCargaAllRows() { return rows; },
};
vm.createContext(ctx);

for (const name of [
  'distLooksLikeCep',
  'distNormNomeCliente',
  'distNormCodCliente',
  'distCargaByCliente',
  'distCargaRowIsCodSuspect',
  'distCargaQtyForCliente',
  'distFindRegistoForCliente',
]) {
  vm.runInContext(extractFn(html, name), ctx);
}

const r529 = ctx.distCargaByCliente('458529', { nome: beerNome });
const r532 = ctx.distCargaByCliente('458532', { nome: beerNome });
assert.equal(r529.length, 2, '458529 só as suas 2 linhas');
assert.equal(r532.length, 2, '458532 só as suas 2 linhas');
assert.deepEqual(r529.map(r => r.nf).sort(), ['1001', '1002']);
assert.deepEqual(r532.map(r => r.nf).sort(), ['2001', '2002']);
assert.equal(ctx.distCargaQtyForCliente('458529', { nome: beerNome }), 15);
assert.equal(ctx.distCargaQtyForCliente('458532', { nome: beerNome }), 15);

// Mesmo nome, código sem carga → 0 (não herda NFs do irmão)
assert.equal(ctx.distCargaByCliente('999999', { nome: beerNome }).length, 0);
assert.equal(ctx.distCargaQtyForCliente('999999', { nome: beerNome }), 0);

assert.equal(ctx.distCargaRowIsCodSuspect({ cod_cliente: '69058-411' }), true);
assert.equal(ctx.distCargaRowIsCodSuspect({ cod_cliente: beerNome }), true);
assert.equal(ctx.distCargaRowIsCodSuspect({ cod_cliente: '458529' }), false);

const idx = new Map();
idx.set('458529', { id: 'reg1', cod: '458529', nome: beerNome });
idx.set('458532', { id: 'reg2', cod: '458532', nome: beerNome });
assert.equal(ctx.distFindRegistoForCliente({ cod: '458529', nome: beerNome }, idx).id, 'reg1');
assert.equal(ctx.distFindRegistoForCliente({ cod: '458532', nome: beerNome }, idx).id, 'reg2');
assert.equal(ctx.distFindRegistoForCliente({ cod: '111111', nome: beerNome }, idx), null);

// Import: substituição não apaga outro código SAP da mesma empresa
assert.ok(html.includes('prevIsTouchedOrSuspect'), 'import só toca códigos + poluição');
assert.ok(
  html.includes('preserva outros códigos SAP da mesma empresa')
    || html.includes('NÃO apagar outro código SAP'),
  'comentário anti Beer Bev wipe'
);

console.log('test-dist-carga-por-codigo: ok');
