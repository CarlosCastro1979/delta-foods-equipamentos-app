#!/usr/bin/env node
/** Catálogo MC00: com códigos SAP no cadastro, a lista DFB não fica a zero quando o stock SAP está vazio. */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

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

const context = { console, String, Array, Set, Object };
vm.createContext(context);
for (const name of ['mc00CodesFrom', 'mc00ListArtigosDfb']) {
  vm.runInContext(extractFn(html, name), context);
}

const params = [
  { ean: '5601082035154', descricao: 'DELTA COLÔMBIA COFFEE MU 250g', cat: 'Café moído', subcat: '250g', descontinuado: false },
  { ean: '5601082035161', descricao: 'DELTA TIMOR COFFEE MU 250g', cat: 'Café moído', subcat: '250g', descontinuado: false },
  { ean: '5607623010956', descricao: 'VINHO', cat: 'Vinho', subcat: '', descontinuado: false },
  { ean: '999', descricao: 'SEM CODIGO', cat: 'X', subcat: '', descontinuado: false },
  { ean: '5609060024664', descricao: 'DESCONTINUADO', cat: 'Máquinas', subcat: '', descontinuado: true },
];

check('stock DFB vazio mas cadastro com códigos SAP não devolve zero', () => {
  const stockVazio = {};
  const codes = {
    '5601082035154': ['7801734'],
    '5601082035161': ['7802415'],
    '5607623010956': ['701473', '701622'],
    '5609060024664': ['017562'],
  };
  const out = context.mc00ListArtigosDfb(params, stockVazio, codes);
  assert.ok(out.length > 0, 'lista vazia');
  assert.equal(out.length, 3);
  const col = out.find(p => p.ean === '5601082035154');
  assert.equal(col.sapCode, '7801734');
  assert.equal(col.descricao, 'DELTA COLÔMBIA COFFEE MU 250g');
  assert.equal(col.cat, 'Café moído');
  const vinho = out.find(p => p.ean === '5607623010956');
  assert.equal(vinho.sapCode, '701473');
  assert.deepEqual(vinho.sapCodes, ['701473', '701622']);
  assert.equal(out.some(p => p.ean === '999'), false);
  assert.equal(out.some(p => p.ean === '5609060024664'), false);
});

check('código do stock DFB fica à frente do código da cloud', () => {
  const stock = {
    '5601082035154': { ean: '5601082035154', desc: 'DESC STOCK', sapCodes: new Set(['012345']), preco: 10, qt: 4 },
  };
  const codes = { '5601082035154': ['7801734'] };
  const out = context.mc00ListArtigosDfb(params, stock, codes);
  const col = out.find(p => p.ean === '5601082035154');
  assert.equal(col.sapCode, '012345');
  assert.deepEqual(col.sapCodes, ['012345', '7801734']);
  assert.equal(col.descricao, 'DESC STOCK');
  assert.equal(col.qt, 4);
});

check('stock com quantidade e código entra mesmo sem ficha no cadastro', () => {
  const stock = {
    '5600000000001': { ean: '5600000000001', desc: 'SÓ STOCK', sapCodes: ['7809999'], preco: 1, qt: 2 },
    '5600000000002': { ean: '5600000000002', desc: 'QT ZERO', sapCodes: ['7800001'], preco: 1, qt: 0 },
  };
  const out = context.mc00ListArtigosDfb([], stock, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].sapCode, '7809999');
  assert.equal(out[0].ean, '5600000000001');
});

check('sem códigos em lado nenhum a lista fica vazia', () => {
  const out = context.mc00ListArtigosDfb(params, {}, {});
  assert.equal(out.length, 0);
});

check('o catálogo lê margens e vendas DFB, não só sap_data', () => {
  assert.ok(html.includes('function mc00ListArtigosDfb('));
  assert.ok(html.includes("mc00FetchPagedJson('/margens?select=ean,material')"));
  assert.ok(html.includes("/logistica_vendas?select=ean,mat_code&empresa=eq.DFB"));
  assert.ok(html.includes('mc00ListArtigosDfb(params, stockByEan, codeByEan)'));
  assert.ok(!html.includes('Confirma o stock DFB no SAPxUnilog'));
});

check('service worker com versão nova', () => {
  assert.ok(sw.includes('v2026-10-02-vendas-perdas-mes'));
  assert.ok(html.includes('v2026-10-02-vendas-perdas-mes'));
  assert.ok(!sw.includes('v2026-10-02-por-registar-helcio'));
  assert.ok(!html.includes('v2026-10-02-por-registar-helcio'));
});

if (process.exitCode) process.exit(process.exitCode);
console.log('test-mc00-catalogo: ok');
