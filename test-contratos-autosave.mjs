#!/usr/bin/env node
/**
 * Autosave rascunho — Gerar Contrato: gravar campos, simular reload, restaurar.
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const CACHE = 'v2026-10-21-vendas-merge-dias';

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

check('cache SW e index actualizados', () => {
  assert.ok(sw.includes(CACHE), 'sw.js tem ' + CACHE);
  assert.ok(html.includes(CACHE), 'index.html tem ' + CACHE);
  assert.ok(html.includes('dfb_ct_gerar_draft'));
  assert.ok(html.includes('ctScheduleAutosave'));
  assert.ok(html.includes('ctApplyDraft'));
  assert.ok(html.includes('ctClearDraft'));
  assert.ok(html.includes('Rascunho com autosave'));
});

check('um só rascunho (chave única) e debounce ~1s', () => {
  assert.ok(html.includes("const CT_DRAFT_LS = 'dfb_ct_gerar_draft'"));
  assert.ok(html.includes('const CT_AUTOSAVE_MS = 1000'));
  assert.ok(html.includes('ctClearDraft()'), 'limpa rascunho após gerar');
});

const store = Object.create(null);
const els = Object.create(null);

function makeEl(value) {
  return {
    value: value == null ? '' : String(value),
    textContent: '',
    style: { display: 'none' },
  };
}

[
  'ct_cod', 'ct_num_contrato', 'ct_empresa', 'ct_cnpj', 'ct_endereco',
  'ct_rep_nome', 'ct_rep_rg', 'ct_rep_cpf', 'ct_email', 'ct_vendedor',
  'ct_lote', 'ct_unidade', 'ct_qtd_mes', 'ct_dur_num', 'ct_dias_num', 'ct_valor_equip',
  'ct_t1_nome', 'ct_t1_cpf', 'ct_t2_nome', 'ct_t2_cpf',
  'ct_cliente_found', 'ct_found_txt', 'ct-autosave-hint',
].forEach(id => { els[id] = makeEl(''); });

for (let i = 1; i <= 8; i++) {
  els[`ct_a1_${i}_qtd`] = makeEl('');
  els[`ct_a1_${i}_equip`] = makeEl('');
  els[`ct_a1_${i}_serie`] = makeEl('');
  els[`ct_a1_${i}_nf`] = makeEl('');
  els[`ct_a1_${i}_valor`] = makeEl('');
}
for (let i = 1; i <= 5; i++) {
  els[`ct_a2_${i}_qtd`] = makeEl('');
  els[`ct_a2_${i}_equip`] = makeEl('');
  els[`ct_a2_${i}_serie`] = makeEl('');
  els[`ct_a2_${i}_nf`] = makeEl('');
  els[`ct_a2_${i}_valor`] = makeEl('');
}

const context = {
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  parseInt,
  setTimeout,
  clearTimeout,
  ctCurrentStep: 2,
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  },
  document: {
    getElementById(id) { return els[id] || null; },
  },
  ctCalcTotal() {},
  ctRecalcValor() {},
  ctAplicarTestemunhasDelta() {},
  ctGoto(step) { context.ctCurrentStep = step; },
  ctEquipSelected() {},
};
vm.createContext(context);

vm.runInContext(extractConstAsVar(html, 'CT_DRAFT_LS'), context);
vm.runInContext(extractConstAsVar(html, 'CT_AUTOSAVE_MS'), context);
vm.runInContext(extractConstAsVar(html, 'CT_DRAFT_FIELD_IDS'), context);
vm.runInContext('var _ctAutosaveTimer = null; var _ctAutosaveHintTimer = null; var _ctAutosaveReady = true; var _ctAutosaveAbort = null;', context);

for (const name of [
  'ctFlashAutosave',
  'ctCollectAnexoDraft',
  'ctCollectDraft',
  'ctDraftIsEmpty',
  'ctSaveDraftLocal',
  'ctLoadDraftLocal',
  'ctClearDraft',
  'ctApplyAnexoDraft',
  'ctApplyDraft',
  'ctFlushAutosave',
]) {
  vm.runInContext(extractFn(html, name), context);
}

check('ctDraftIsEmpty reconhece formulário vazio', () => {
  assert.equal(context.ctDraftIsEmpty(context.ctCollectDraft()), true);
});

check('grava e restaura após reload simulado (localStorage)', () => {
  els.ct_cod.value = '12345';
  els.ct_num_contrato.value = 'B0099/26';
  els.ct_empresa.value = 'Cliente Teste Lda';
  els.ct_cnpj.value = '12.345.678/0001-99';
  els.ct_rep_nome.value = 'Ana Silva';
  els.ct_rep_rg.value = '12.345.678-9';
  els.ct_rep_cpf.value = '123.456.789-00';
  els.ct_email.value = 'ana@cliente.com';
  els.ct_lote.value = 'Delta Q Caps 10';
  els.ct_unidade.value = 'Caps';
  els.ct_qtd_mes.value = '40';
  els.ct_dur_num.value = '24';
  els.ct_dias_num.value = '30';
  els.ct_a1_1_qtd.value = '2';
  els.ct_a1_1_equip.value = 'eq-99';
  els.ct_a1_1_serie.value = 'SN-001';
  els.ct_a1_1_nf.value = '552211';
  els.ct_cliente_found.style.display = 'block';
  els.ct_found_txt.textContent = 'Cliente Teste Lda · Ana';
  context.ctCurrentStep = 3;

  assert.equal(context.ctSaveDraftLocal(), true);
  assert.ok(store[context.CT_DRAFT_LS], 'rascunho no localStorage');

  // Simular reload: limpar DOM e reaplicar draft
  Object.keys(els).forEach(id => {
    if (els[id].value !== undefined) els[id].value = '';
    if (els[id].textContent !== undefined) els[id].textContent = '';
    if (els[id].style) els[id].style.display = 'none';
  });
  context.ctCurrentStep = 1;

  const loaded = context.ctLoadDraftLocal();
  assert.ok(loaded, 'carrega rascunho');
  assert.equal(context.ctDraftIsEmpty(loaded), false);
  assert.equal(context.ctApplyDraft(loaded), true);

  assert.equal(els.ct_cod.value, '12345');
  assert.equal(els.ct_num_contrato.value, 'B0099/26');
  assert.equal(els.ct_empresa.value, 'Cliente Teste Lda');
  assert.equal(els.ct_email.value, 'ana@cliente.com');
  assert.equal(els.ct_lote.value, 'Delta Q Caps 10');
  assert.equal(els.ct_qtd_mes.value, '40');
  assert.equal(els.ct_dur_num.value, '24');
  assert.equal(els.ct_a1_1_equip.value, 'eq-99');
  assert.equal(els.ct_a1_1_serie.value, 'SN-001');
  assert.equal(els.ct_a1_1_nf.value, '552211');
  assert.equal(els.ct_cliente_found.style.display, 'block');
  assert.equal(els.ct_found_txt.textContent, 'Cliente Teste Lda · Ana');
  assert.equal(context.ctCurrentStep, 3);
});

check('limpar campo de propósito fica vazio no rascunho', () => {
  els.ct_email.value = '';
  context.ctCurrentStep = 3;
  assert.equal(context.ctSaveDraftLocal(), true);
  const again = context.ctLoadDraftLocal();
  assert.equal(again.fields.ct_email, '');
  assert.equal(again.fields.ct_empresa, 'Cliente Teste Lda');
});

check('ctClearDraft remove o rascunho (após gerar)', () => {
  context.ctClearDraft();
  assert.equal(context.ctLoadDraftLocal(), null);
});

if (!process.exitCode) console.log('\nTodos os testes de autosave de contratos passaram.');
