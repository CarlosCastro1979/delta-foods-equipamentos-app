#!/usr/bin/env node
/**
 * Contratos Registados · Distribuidores: só Massimo Bottello + Eduardo Madeira.
 * Horeca não deve misturar Dist; cache não pode saltar de canal.
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

function extractConstObj(src, name) {
  const re = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error('Const em falta: ' + name);
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(m.index, i + 1);
    }
  }
  throw new Error('Objecto não fechou: ' + name);
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

const DIST_OK = new Set(['MASSIMO BOTTELLO', 'EDUARDO MADEIRA']);
const HORECA = ['PAULO FONTES', 'HELCIO GREGIO', 'DANIELA SANTOS', 'FILIPE NEVES'];

check('CANAIS_APP Dist = Massimo + Eduardo Madeira', () => {
  assert.ok(html.includes("id: 'distribuidores'"));
  assert.ok(html.includes("vendedores: ['Eduardo Madeira', 'Massimo Bottello']"));
  assert.ok(html.includes("vendedores: ['Hélcio Grégio', 'Paulo Fontes', 'Daniela Santos', 'Filipe Neves']"));
});

check('cache IndexedDB v3 por canal (não reutiliza Horeca no Dist)', () => {
  assert.ok(html.includes("delta_contratos_tab_v3"));
  assert.ok(html.includes('contratosRowsDoCanalActivo'));
  assert.ok(html.includes('contratosMemoriaDoCanalActivo'));
  assert.ok(html.includes('contratosCanalCacheKey'));
  const load = html.slice(
    html.indexOf('async function loadContratosTab'),
    html.indexOf('function filtrarContratosTabela')
  );
  assert.ok(load.includes('contratosMemoriaDoCanalActivo'));
  assert.ok(load.includes('contratosTabApplyPacked(packed)'));
  const filtrar = extractFn(html, 'filtrarContratosVendedor');
  assert.ok(filtrar.includes('contratosRowsDoCanalActivo'));
  const exportFn = extractFn(html, 'exportContratosExcel');
  assert.ok(exportFn.includes('contratosRowsDoCanalActivo'));
  const abrir = extractFn(html, 'abrirCanalConfirmado');
  assert.ok(abrir.includes('_contratosAllRows = null'));
  assert.ok(abrir.includes('prevCanal'));
});

const ctx = {
  console,
  Date,
  String,
  Array,
  Number,
  Set,
  Map,
  Object,
  parseInt,
  isNaN,
  localStorage: {
    _s: Object.create(null),
    getItem(k) { return k in this._s ? this._s[k] : null; },
    setItem(k, v) { this._s[k] = String(v); },
    removeItem(k) { delete this._s[k]; },
  },
  document: {
    body: { classList: { contains: () => true } },
  },
  window: {},
  _canalActivo: null,
  contratosCache: null,
};
vm.createContext(ctx);
vm.runInContext(extractConstObj(html, 'CANAIS_APP'), ctx);
vm.runInContext(extractFn(html, 'normNomeUtilizador'), ctx);
vm.runInContext(extractFn(html, 'getVendedoresNomesDoCanal'), ctx);
vm.runInContext(extractFn(html, 'getCanalIdPorVendedorNome'), ctx);
vm.runInContext(extractFn(html, 'resolveCanalActivoId'), ctx);
vm.runInContext(extractFn(html, 'vendedorPertenceAoCanalActivo'), ctx);
vm.runInContext(extractFn(html, 'filterByCanalActivo'), ctx);
vm.runInContext(extractFn(html, 'contratosCanalCacheKey'), ctx);
vm.runInContext(extractFn(html, 'contratosRowsDoCanalActivo'), ctx);
vm.runInContext(extractFn(html, 'contratosMemoriaDoCanalActivo'), ctx);
vm.runInContext(extractFn(html, 'contratosTabApplyPacked'), ctx);
vm.runInContext(extractFn(html, 'contratosFpIgual'), ctx);

const fixture = [
  { vendedor: 'Paulo Fontes', contrato: 'H1' },
  { vendedor: 'Hélcio Grégio', contrato: 'H2' },
  { vendedor: 'Daniela Santos', contrato: 'H3' },
  { vendedor: 'Filipe Neves', contrato: 'H4' },
  { vendedor: 'Massimo Bottello', contrato: 'D1' },
  { vendedor: 'Eduardo Madeira', contrato: 'D2' },
  { vendedor: 'Eduardo Moreira', contrato: 'D3' }, // alias legado
  { vendedor: 'Marcio Gorga', contrato: 'E1' },
  { vendedor: 'Diogo Oliveira', contrato: 'V1' },
];

check('Dist: resumo/listagem ⊆ {Massimo Bottello, Eduardo Madeira}', () => {
  ctx._canalActivo = 'distribuidores';
  const rows = ctx.contratosRowsDoCanalActivo(fixture);
  const sellers = [...new Set(rows.map(r => ctx.normNomeUtilizador(r.vendedor)))];
  assert.ok(sellers.length >= 1, 'Dist deve ter linhas');
  for (const s of sellers) {
    assert.ok(DIST_OK.has(s), 'vendedor Dist inválido: ' + s);
  }
  assert.ok(sellers.includes('MASSIMO BOTTELLO'));
  assert.ok(sellers.includes('EDUARDO MADEIRA'));
  assert.equal(rows.length, 3); // Massimo + Madeira + Moreira(alias)
  for (const h of HORECA) {
    assert.ok(!sellers.includes(h), 'Horeca no Dist: ' + h);
  }
});

check('Horeca: sem Massimo/Eduardo Dist', () => {
  ctx._canalActivo = 'horeca';
  const rows = ctx.contratosRowsDoCanalActivo(fixture);
  const sellers = [...new Set(rows.map(r => ctx.normNomeUtilizador(r.vendedor)))];
  assert.ok(sellers.includes('PAULO FONTES'));
  assert.ok(sellers.includes('HELCIO GREGIO'));
  assert.ok(sellers.includes('DANIELA SANTOS'));
  assert.ok(sellers.includes('FILIPE NEVES'));
  assert.ok(!sellers.includes('MASSIMO BOTTELLO'));
  assert.ok(!sellers.includes('EDUARDO MADEIRA'));
});

check('cache packed de outro canal é rejeitado', () => {
  ctx._canalActivo = 'distribuidores';
  ctx.window._contratosAllRows = null;
  const ok = ctx.contratosTabApplyPacked({
    canalId: 'horeca',
    rows: [{ vendedor: 'Paulo Fontes' }],
    fp: { canalId: 'horeca', ym: '2026-10' },
  });
  assert.equal(ok, false);
  assert.ok(!ctx.window._contratosAllRows || !ctx.window._contratosAllRows.length);
});

check('memória de outro canal invalida e força recompute', () => {
  ctx._canalActivo = 'distribuidores';
  ctx.window._contratosAllRows = [{ vendedor: 'Paulo Fontes' }];
  ctx.window._contratosAllRowsCanal = 'horeca';
  assert.equal(ctx.contratosMemoriaDoCanalActivo(), false);
  assert.equal(ctx.window._contratosAllRows, null);
});

check('fp desigual se canal muda', () => {
  const a = { ym: '2026-10', canalId: 'horeca', vendasN: 1, nRegs: 1, sig: 'x', vendasCarga: 't' };
  assert.ok(ctx.contratosFpIgual(a, { ...a }));
  assert.ok(!ctx.contratosFpIgual(a, { ...a, canalId: 'distribuidores' }));
});

check('alias Eduardo Moreira pertence ao Dist', () => {
  ctx._canalActivo = 'distribuidores';
  assert.ok(ctx.vendedorPertenceAoCanalActivo('Eduardo Moreira'));
  assert.ok(ctx.vendedorPertenceAoCanalActivo('Eduardo Madeira'));
  assert.ok(ctx.vendedorPertenceAoCanalActivo('Massimo Bottello'));
  assert.ok(!ctx.vendedorPertenceAoCanalActivo('Paulo Fontes'));
});

if (process.exitCode) {
  console.error('\nFalhou pelo menos um teste Dist vendedores.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes Dist Contratos (Massimo/Eduardo) passaram.');
