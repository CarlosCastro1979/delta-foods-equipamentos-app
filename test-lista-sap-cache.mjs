#!/usr/bin/env node
/** Lista SAP: normalizar ~29k clientes não pode reler localStorage em cada chamada. */
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

check('pesquisa de texto não redesenha a tabela em cada tecla', () => {
  assert.ok(html.includes('oninput="agendarRenderTabela()"'));
  assert.ok(html.includes('oninput="agendarRenderPendentes()"'));
  assert.ok(html.includes('oninput="agendarFiltroContratos()"'));
  assert.ok(!html.includes('oninput="filtrarContratosVendedor()"'));
  assert.ok(!html.includes('oninput="renderPendentes()"'));
  const filtrar = extractFn(html, 'filtrarContratosVendedor');
  assert.ok(filtrar.includes('buildContratosCumprimentoTableHtml(rows)'));
  assert.ok(filtrar.includes('loadContratosTab(false)'));
  assert.ok(!filtrar.includes('loadContratosTab(true)'));
  assert.ok(filtrar.includes('requestAnimationFrame(syncFreeze)'));
});

check('service worker sobe de versão com o index', () => {
  assert.ok(sw.includes('v2026-10-02-perdas-sem-999'));
  assert.ok(!sw.includes('v2026-10-02-vendedor-atual'));
  assert.ok(!html.includes('v2026-10-02-vendedor-atual'));
  assert.ok(!sw.includes('v2026-10-02-nfe-pdf'));
  assert.ok(!sw.includes('v2026-10-01-nfe-filtros'));
  assert.ok(!sw.includes('v2026-10-01-nfe-dados-canal'));
  assert.ok(html.includes('v2026-10-02-perdas-sem-999'));
  assert.ok(!html.includes('v2026-10-02-nfe-pdf'));
  assert.ok(!html.includes('v2026-10-01-nfe-filtros'));
  assert.ok(!html.includes('v2026-10-01-nfe-dados-canal'));
  assert.ok(!sw.includes('v2026-10-01-vendas-menu-canal'));
  assert.ok(!html.includes('v2026-10-01-vendas-menu-canal'));
  assert.ok(!sw.includes('v2026-10-01-vendas-marco'));
  assert.ok(!html.includes('v2026-10-01-vendas-marco'));
  assert.ok(!sw.includes('v2026-10-01-vendas-ordem'));
  assert.ok(!html.includes('v2026-10-01-vendas-ordem'));
  assert.ok(!sw.includes('v2026-10-01-nfe-zip'));
  assert.ok(!html.includes('v2026-10-01-nfe-zip'));
  assert.ok(!sw.includes('v2026-10-01-mapa-n'));
  assert.ok(!html.includes('v2026-10-01-mapa-n'));
  assert.ok(!sw.includes('v2026-10-01-vendas-rs'));
  assert.ok(!html.includes('v2026-10-01-vendas-rs'));
  assert.ok(!sw.includes('v2026-10-01-vendas-prev'));
  assert.ok(!html.includes('v2026-10-01-vendas-prev'));
  assert.ok(!sw.includes('v2026-10-01-vendas-quadro'));
  assert.ok(!sw.includes('v2026-10-01-vendas-so-hoje'));
  assert.ok(!sw.includes('v2026-10-01-vendas-dia-util'));
  assert.ok(!sw.includes('v2026-09-29-menos-travar'));
});

check('mapa de vendedores e lista normalizada ficam em memória', () => {
  assert.ok(html.includes('if (_vendedoresMapCache) return _vendedoresMapCache;'));
  assert.ok(html.includes('if (_listaNormCache && _listaNormSrc === list) return _listaNormCache;'));
  assert.ok(extractFn(html, 'saveVendedoresCadastro').includes('invalidarCacheListaSap'));
  assert.ok(extractFn(html, 'salvarListaClientesLocal').includes('invalidarCacheListaSap'));
});

const vendStart = html.indexOf('const VEND_STORE_KEY');
const vendEnd = html.indexOf('function renderVendedoresTable(');
if (vendStart < 0 || vendEnd < vendStart) throw new Error('bloco de vendedores não encontrado');

let gets = 0;
const ctx = {
  console,
  String,
  Array,
  Math,
  Number,
  Set,
  Map,
  parseInt,
  isNaN,
  CLIENTES_SISTEMA: [],
  CLIENTES_LS_KEY: 'delta_clientes_sistema',
  CLIENTES_TS_KEY: 'delta_clientes_ts',
  _listaClientesMem: null,
  _listaClientesTs: 1,
  localStorage: {
    getItem() { gets++; return null; },
    setItem() {},
    removeItem() {},
  },
};
vm.createContext(ctx);
vm.runInContext(
  extractFn(html, 'normNomeUtilizador') + '\n' +
  html.slice(vendStart, vendEnd) + '\n' +
  extractFn(html, 'getListaClientesCompleta'),
  ctx
);

function clientes(n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({ cod: String(100000 + i), nome: 'C' + i, npess: 99520010, vendedor: 'FILIPE NEVES' });
  }
  arr.push({ cod: '900001', nome: 'Loja Site', npess: 99520001, vendedor: 'SITE' });
  arr.push({ cod: '900002', nome: 'Nome cruzado', npess: 99520010, vendedor: 'OUTRO' });
  return arr;
}

check('segunda leitura da lista não volta ao localStorage', () => {
  gets = 0;
  ctx._listaClientesMem = clientes(4000);
  const a = ctx.getListaClientesCompleta();
  const getsDepoisDaPrimeira = gets;
  const b = ctx.getListaClientesCompleta();
  assert.ok(getsDepoisDaPrimeira >= 1 && getsDepoisDaPrimeira < 5, 'gets primeira=' + getsDepoisDaPrimeira);
  assert.equal(gets, getsDepoisDaPrimeira);
  assert.equal(a, b);
  assert.equal(a.length, 4002);
  const site = a.find(c => c.cod === '900001');
  const cruzado = a.find(c => c.cod === '900002');
  assert.equal(site.vendedor, 'MARCIO GORGA');
  assert.equal(cruzado.vendedor, 'FILIPE NEVES');
  ctx._listaClientesMem = clientes(3);
  const c = ctx.getListaClientesCompleta();
  assert.notEqual(c, a);
  assert.equal(c.find(x => x.cod === '900001').vendedor, 'MARCIO GORGA');
  assert.equal(gets, getsDepoisDaPrimeira);
});

check('família de códigos não muda com o índice', () => {
  const famCtx = {
    console,
    String,
    Set,
    Map,
    codRelacionados: [
      { cod_pai: '100', cod_filho: '200' },
      { cod_pai: '0300', cod_filho: '400' },
    ],
  };
  vm.createContext(famCtx);
  vm.runInContext(
    extractFn(html, 'normalizaCodSC') + '\n' +
    html.slice(html.indexOf('let _familiaIdx'), html.indexOf('function getUltimaCompraFamilia(')),
    famCtx
  );
  const fam = famCtx.getCodsFamilia('0100');
  assert.ok(fam.has('100') || fam.has('0100'));
  assert.ok(fam.has('200'));
  assert.ok(!fam.has('400'));
  const fam2 = famCtx.getCodsFamilia('300');
  assert.ok(fam2.has('400'));
  assert.ok(fam2.has('300'));
});

if (process.exitCode) process.exit(process.exitCode);
console.log('Todos os testes de cache da lista SAP passaram.');
