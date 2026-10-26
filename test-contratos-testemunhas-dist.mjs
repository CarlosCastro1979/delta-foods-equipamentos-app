#!/usr/bin/env node
/**
 * Contratos — testemunhas Delta por canal:
 * Horeca: Filipe + vendedor; Distribuidores: Massimo + Eduardo Madeira.
 * Apelido Eduardo Madeira (não Moreira).
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const CACHE = 'v2026-10-26-eduardo-cpf';
const EDUARDO_CPF = '225.668.708-29';

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

function extractConstAsVar(src, name) {
  const start = src.indexOf(`const ${name} =`);
  if (start < 0) throw new Error('Const em falta: ' + name);
  let i = src.indexOf('=', start);
  let depth = 0;
  let inStr = null;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === inStr && src[i - 1] !== '\\') inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ';' && depth === 0) {
      return 'var ' + src.slice(start + 'const '.length, i + 1);
    }
  }
  throw new Error('Const sem fim: ' + name);
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

check('cache testemunhas-dist', () => {
  assert.ok(sw.includes(CACHE), 'sw.js tem ' + CACHE);
  assert.ok(html.includes(CACHE), 'index.html tem ' + CACHE);
});

check('UI hint menciona Horeca e Distribuidores', () => {
  assert.ok(html.includes('id="ct_testemunhas_hint"'));
  assert.ok(html.includes('Massimo Bottello'));
  assert.ok(html.includes('Eduardo Madeira'));
  assert.ok(html.includes('Filipe Neves'));
  assert.ok(html.includes('vendedor do cliente'));
});

check('login e canais usam Eduardo Madeira (não Moreira como nome)', () => {
  assert.ok(html.includes('value="Eduardo Madeira"'));
  assert.ok(html.includes(">Eduardo Madeira<") || html.includes('Eduardo Madeira</option>'));
  assert.ok(!html.includes('value="Eduardo Moreira"'));
  assert.ok(!html.includes('Eduardo Moreira</option>'));
  // Nome de display / mapas NPess
  assert.ok(html.includes("'EDUARDO MADEIRA'") || html.includes('"EDUARDO MADEIRA"'));
  assert.ok(!/\bEduardo Moreira\b/.test(html));
  assert.ok(!/"EDUARDO MOREIRA"/.test(html));
  assert.ok(!/'EDUARDO MOREIRA':/.test(html));
  // Alias legado só em normNomeUtilizador
  assert.ok(html.includes("if (n === 'EDUARDO MOREIRA') n = 'EDUARDO MADEIRA'"));
});

check('constantes Dist presentes', () => {
  assert.ok(html.includes("CT_TESTEMUNHA_MASSIMO"));
  assert.ok(html.includes("CT_TESTEMUNHA_EDUARDO"));
  assert.ok(html.includes("nome: 'Eduardo Madeira'"));
  assert.ok(html.includes("nome: 'Massimo Bottello'"));
  assert.ok(html.includes('function ctContratoEhDistribuidores'));
  assert.ok(html.includes('function ctAplicarTestemunhasDelta'));
});

const els = Object.create(null);
function makeEl(value) {
  return {
    value: value == null ? '' : String(value),
    textContent: '',
    innerHTML: '',
    style: {},
  };
}
['ct_t1_nome', 'ct_t1_cpf', 'ct_t2_nome', 'ct_t2_cpf', 'ct_vendedor', 'ct_cod',
  'ct_testemunhas_hint', 'ct_t2_lbl'].forEach(id => { els[id] = makeEl(''); });
els.ct_t2_lbl.textContent = 'Testemunha 2 — Nome';

let canalActivo = 'horeca';

const context = {
  console,
  String,
  Number,
  parseInt,
  Array,
  Object,
  _canalActivo: null,
  resolveCanalActivoId() { return canalActivo; },
  isCanalDistribuidores() { return canalActivo === 'distribuidores'; },
  getListaClientesActiva() { return []; },
  getUtilizadorAtual() { return 'Carlos Castro'; },
  document: {
    getElementById(id) { return els[id] || null; },
  },
};

vm.createContext(context);
for (const name of [
  'CT_TESTEMUNHA_FILIPE',
  'CT_TESTEMUNHA_MASSIMO',
  'CT_TESTEMUNHA_EDUARDO',
  'CT_TESTEMUNHAS_VENDEDOR_CPF',
]) {
  vm.runInContext(extractConstAsVar(html, name), context);
}
for (const name of [
  'ctFmtCpfDigits',
  'ctNormVendKey',
  'ctContratoEhDistribuidores',
  'ctResolveTestemunhaVendedor',
  'ctResolveVendedorContrato',
  'ctActualizarUiTestemunhas',
  'ctAplicarTestemunhasDelta',
]) {
  vm.runInContext(extractFn(html, name), context);
}

check('Horeca: T1=Filipe Neves, T2=vendedor (Carlos Castro sem CPF no mapa)', () => {
  canalActivo = 'horeca';
  els.ct_vendedor.value = 'Carlos Castro';
  context.ctAplicarTestemunhasDelta();
  assert.equal(els.ct_t1_nome.value, 'Filipe Neves');
  assert.equal(els.ct_t1_cpf.value, '123.423.841-14');
  assert.equal(els.ct_t2_nome.value, 'Carlos Castro');
  assert.ok(els.ct_testemunhas_hint.innerHTML.includes('Filipe Neves'));
  assert.ok(els.ct_testemunhas_hint.innerHTML.includes('vendedor'));
  assert.equal(els.ct_t2_lbl.textContent, 'Testemunha 2 — Vendedor');
});

check('Horeca: T2=Paulo Fontes com CPF do mapa', () => {
  canalActivo = 'horeca';
  els.ct_vendedor.value = 'Paulo Fontes';
  context.ctAplicarTestemunhasDelta();
  assert.equal(els.ct_t1_nome.value, 'Filipe Neves');
  assert.equal(els.ct_t2_nome.value, 'Paulo Fontes');
  assert.equal(els.ct_t2_cpf.value, '189.665.258-14');
});

check('Distribuidores: T1=Massimo, T2=Eduardo Madeira com CPF (sem Filipe)', () => {
  canalActivo = 'distribuidores';
  els.ct_vendedor.value = 'Carlos Castro';
  context.ctAplicarTestemunhasDelta();
  assert.equal(els.ct_t1_nome.value, 'Massimo Bottello');
  assert.equal(els.ct_t2_nome.value, 'Eduardo Madeira');
  assert.equal(els.ct_t2_cpf.value, EDUARDO_CPF);
  assert.equal(context.CT_TESTEMUNHA_EDUARDO.cpf, EDUARDO_CPF);
  assert.ok(!els.ct_t1_nome.value.includes('Filipe'));
  assert.ok(!els.ct_t2_nome.value.includes('Filipe'));
  assert.ok(!els.ct_t2_nome.value.includes('Carlos'));
  assert.ok(els.ct_testemunhas_hint.innerHTML.includes('Massimo Bottello'));
  assert.ok(els.ct_testemunhas_hint.innerHTML.includes('Eduardo Madeira'));
  assert.ok(!els.ct_testemunhas_hint.innerHTML.includes('Filipe'));
  assert.equal(els.ct_t2_lbl.textContent, 'Testemunha 2 — Nome');
});

check('mapa CPF resolve Eduardo Madeira → 225.668.708-29', () => {
  const t2 = context.ctResolveTestemunhaVendedor('Eduardo Madeira');
  assert.equal(t2.nome, 'Eduardo Madeira');
  assert.equal(t2.cpf, EDUARDO_CPF);
  const legado = context.ctResolveTestemunhaVendedor('Eduardo Moreira');
  assert.equal(legado.nome, 'Eduardo Madeira');
  assert.equal(legado.cpf, EDUARDO_CPF);
});

check('normNomeUtilizador alias Moreira → Madeira', () => {
  vm.runInContext(extractFn(html, 'normNomeUtilizador'), context);
  assert.equal(context.normNomeUtilizador('Eduardo Moreira'), 'EDUARDO MADEIRA');
  assert.equal(context.normNomeUtilizador('Eduardo Madeira'), 'EDUARDO MADEIRA');
  assert.equal(context.normNomeUtilizador('EDUARDO MOREIRA'), 'EDUARDO MADEIRA');
});

if (process.exitCode) {
  console.error('\nAlguns testes falharam.');
  process.exit(1);
}
console.log('\nTodos os testes de testemunhas Dist passaram.');
