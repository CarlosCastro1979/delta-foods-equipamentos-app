#!/usr/bin/env node
/**
 * Autosave rascunho — Gerar Contrato por código de cliente:
 * abrir sem código = branco; código A restaura A; código B ≠ dados de A.
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const CACHE = 'v2026-10-28-dividas-balancete';

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
  assert.ok(html.includes('ctBlankForm'));
  assert.ok(html.includes('ctLoadDraftForCod'));
  assert.ok(html.includes('ctDraftStorageKey'));
  assert.ok(html.includes('Rascunho com autosave'));
  assert.ok(html.includes('Adicionar outra gama'));
  assert.ok(html.includes('ctCollectGamas'));
  assert.ok(html.includes('ctOnCodInput'));
  // Ao abrir NÃO restaura rascunho global
  assert.ok(html.includes('Não restaurar rascunho global ao abrir'));
  assert.ok(!/const draft = ctLoadDraftLocal\(\);\s*\n\s*if \(draft && !ctDraftIsEmpty\(draft\)\) \{\s*\n\s*ctApplyDraft\(draft\);/.test(html));
});

check('rascunho por código (não só chave global) e debounce ~1s', () => {
  assert.ok(html.includes("const CT_DRAFT_LS = 'dfb_ct_gerar_draft'"));
  assert.ok(html.includes('CT_DRAFT_LS + \'_\' + key') || html.includes("CT_DRAFT_LS + '_' + key"));
  assert.ok(html.includes('const CT_AUTOSAVE_MS = 1000'));
  assert.ok(html.includes('ctClearDraft()'), 'limpa rascunho após gerar');
  assert.ok(html.includes('ctMigrateLegacyDraftOnce'));
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

function resetDom() {
  Object.keys(els).forEach(id => {
    if (els[id].value !== undefined) {
      if (id === 'ct_unidade') els[id].value = 'Caps';
      else els[id].value = '';
    }
    if (els[id].textContent !== undefined) els[id].textContent = '';
    if (els[id].style) els[id].style.display = 'none';
  });
  context.ctCurrentStep = 1;
  context._ctDraftActiveCod = '';
  context.ctRenderGamas([{ lote: '', unidade: 'Caps', qtd: '' }]);
}

[
  'ct_cod', 'ct_num_contrato', 'ct_empresa', 'ct_cnpj', 'ct_endereco',
  'ct_rep_nome', 'ct_rep_rg', 'ct_rep_cpf', 'ct_email', 'ct_vendedor',
  'ct_lote', 'ct_unidade', 'ct_qtd_mes', 'ct_dur_num', 'ct_dias_num', 'ct_valor_equip',
  'ct_t1_nome', 'ct_t1_cpf', 'ct_t2_nome', 'ct_t2_cpf',
  'ct_cliente_found', 'ct_found_txt', 'ct-autosave-hint', 'ct_gamas_list',
].forEach(id => { els[id] = makeEl(''); });
els.ct_gamas_list.children = { length: 0 };
els.ct_unidade.value = 'Caps';

for (let i = 1; i <= 8; i++) {
  els[`ct_a1_${i}_qtd`] = makeEl('');
  els[`ct_a1_${i}_equip`] = makeEl('');
  els[`ct_a1_${i}_serie`] = makeEl('');
  els[`ct_a1_${i}_nf`] = makeEl('');
  els[`ct_a1_${i}_valor`] = makeEl('');
  els[`ct_a1_${i}_gama`] = makeEl('0');
}
for (let i = 1; i <= 5; i++) {
  els[`ct_a2_${i}_qtd`] = makeEl('');
  els[`ct_a2_${i}_equip`] = makeEl('');
  els[`ct_a2_${i}_serie`] = makeEl('');
  els[`ct_a2_${i}_nf`] = makeEl('');
  els[`ct_a2_${i}_valor`] = makeEl('');
  els[`ct_a2_${i}_gama`] = makeEl('0');
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
  ctGamaCount: 1,
  _ctDraftActiveCod: '',
  _ctLegacyDraftMigrated: false,
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  },
  document: {
    getElementById(id) { return els[id] || null; },
    querySelectorAll() { return []; },
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
vm.runInContext('var _ctAutosaveTimer = null; var _ctAutosaveHintTimer = null; var _ctAutosaveReady = true; var _ctAutosaveAbort = null; var _ctDraftActiveCod = ""; var _ctLegacyDraftMigrated = false;', context);

context.ctRenderGamas = function (gamas) {
  const list = (Array.isArray(gamas) && gamas.length) ? gamas : [{ lote: '', unidade: 'Caps', qtd: '' }];
  context.ctGamaCount = list.length;
  for (let i = 0; i < 8; i++) {
    delete els[`ct_gama_${i}_lote`];
    delete els[`ct_gama_${i}_unidade`];
    delete els[`ct_gama_${i}_qtd`];
  }
  list.forEach((g, i) => {
    els[`ct_gama_${i}_lote`] = makeEl(g.lote || '');
    els[`ct_gama_${i}_unidade`] = makeEl(g.unidade || 'Caps');
    els[`ct_gama_${i}_qtd`] = makeEl(g.qtd || '');
  });
  els.ct_gamas_list.children = { length: list.length };
  context.ctSyncLegacyGamaFields();
};
context.ctRefreshAnexoGamaSelects = function () {};

for (const name of [
  'ctEmptyGama',
  'ctCollectGamas',
  'ctSyncLegacyGamaFields',
  'ctNormalizeGamasDraft',
  'ctFlashAutosave',
  'ctCollectAnexoDraft',
  'ctCollectDraft',
  'ctDraftIsEmpty',
  'ctDraftCodKey',
  'ctDraftStorageKey',
  'ctMigrateLegacyDraftOnce',
  'ctSaveDraftUnderCod',
  'ctPersistActiveDraft',
  'ctSaveDraftLocal',
  'ctLoadDraftLocal',
  'ctClearDraft',
  'ctBlankForm',
  'ctOnCodInput',
  'ctOnCodConfirm',
  'ctLoadDraftForCod',
  'ctApplyAnexoDraft',
  'ctApplyDraft',
  'ctFlushAutosave',
]) {
  vm.runInContext(extractFn(html, name), context);
}

// 1 gama inicial (compat single)
els.ct_gama_0_lote = makeEl('');
els.ct_gama_0_unidade = makeEl('Caps');
els.ct_gama_0_qtd = makeEl('');
els.ct_gamas_list.children = { length: 1 };

check('ctDraftIsEmpty reconhece formulário vazio', () => {
  assert.equal(context.ctDraftIsEmpty(context.ctCollectDraft()), true);
});

check('abrir sem código: load sem cod = null; formulário em branco', () => {
  resetDom();
  Object.keys(store).forEach(k => delete store[k]);
  // Simular rascunho legado global — NÃO deve ser aplicado só por existir
  store[context.CT_DRAFT_LS] = JSON.stringify({
    v: 2,
    fields: { ct_cod: '111', ct_empresa: 'Legado SA', ct_email: 'x@y.z' },
    gamas: [{ lote: 'X', unidade: 'Caps', qtd: '1' }],
    a1: [], a2: [],
  });
  context._ctLegacyDraftMigrated = false;
  assert.equal(context.ctLoadDraftLocal(''), null);
  assert.equal(context.ctLoadDraftLocal(), null);
  // Migração move para chave do código, remove global
  context.ctMigrateLegacyDraftOnce();
  assert.equal(store[context.CT_DRAFT_LS], undefined);
  assert.ok(store[context.CT_DRAFT_LS + '_111']);
  // Sem introduzir código, formulário continua vazio
  assert.equal(els.ct_empresa.value, '');
  assert.equal(els.ct_email.value, '');
});

check('grava sob chave do código e restaura só com esse código', () => {
  resetDom();
  Object.keys(store).forEach(k => delete store[k]);
  context._ctLegacyDraftMigrated = true;

  els.ct_cod.value = '12345';
  els.ct_num_contrato.value = 'B0099/26';
  els.ct_empresa.value = 'Cliente Teste Lda';
  els.ct_cnpj.value = '12.345.678/0001-99';
  els.ct_rep_nome.value = 'Ana Silva';
  els.ct_rep_rg.value = '12.345.678-9';
  els.ct_rep_cpf.value = '123.456.789-00';
  els.ct_email.value = 'ana@cliente.com';
  els.ct_gama_0_lote.value = 'Delta Q Caps 10';
  els.ct_gama_0_unidade.value = 'Caps';
  els.ct_gama_0_qtd.value = '40';
  context.ctSyncLegacyGamaFields();
  els.ct_dur_num.value = '24';
  els.ct_dias_num.value = '30';
  els.ct_a1_1_qtd.value = '2';
  els.ct_a1_1_equip.value = 'eq-99';
  els.ct_a1_1_serie.value = 'SN-001';
  els.ct_a1_1_nf.value = '552211';
  els.ct_cliente_found.style.display = 'block';
  els.ct_found_txt.textContent = 'Cliente Teste Lda · Ana';
  context.ctCurrentStep = 3;
  context._ctDraftActiveCod = '12345';

  assert.equal(context.ctSaveDraftLocal(), true);
  const keyA = context.CT_DRAFT_LS + '_12345';
  assert.ok(store[keyA], 'rascunho na chave por código');
  assert.equal(store[context.CT_DRAFT_LS], undefined, 'sem chave global');
  const saved = JSON.parse(store[keyA]);
  assert.ok(Array.isArray(saved.gamas));
  assert.equal(saved.gamas[0].lote, 'Delta Q Caps 10');

  // Simular sair/voltar: limpar DOM — sem código não carrega
  resetDom();
  assert.equal(context.ctLoadDraftLocal(), null);
  assert.equal(els.ct_empresa.value, '');

  // Introduzir código A → restaura
  els.ct_cod.value = '12345';
  const loaded = context.ctLoadDraftLocal('12345');
  assert.ok(loaded, 'carrega rascunho A');
  assert.equal(context.ctDraftIsEmpty(loaded), false);
  assert.equal(context.ctApplyDraft(loaded), true);

  assert.equal(els.ct_cod.value, '12345');
  assert.equal(els.ct_num_contrato.value, 'B0099/26');
  assert.equal(els.ct_empresa.value, 'Cliente Teste Lda');
  assert.equal(els.ct_email.value, 'ana@cliente.com');
  assert.equal(els.ct_lote.value, 'Delta Q Caps 10');
  assert.equal(els.ct_qtd_mes.value, '40');
  assert.equal(els.ct_gama_0_lote.value, 'Delta Q Caps 10');
  assert.equal(els.ct_dur_num.value, '24');
  assert.equal(els.ct_a1_1_equip.value, 'eq-99');
  assert.equal(els.ct_a1_1_serie.value, 'SN-001');
  assert.equal(els.ct_a1_1_nf.value, '552211');
  assert.equal(els.ct_cliente_found.style.display, 'block');
  assert.equal(els.ct_found_txt.textContent, 'Cliente Teste Lda · Ana');
  assert.equal(context.ctCurrentStep, 3);
});

check('código B não mostra dados do cliente A', () => {
  // A já está no store; gravar B distinto
  resetDom();
  els.ct_cod.value = '99999';
  els.ct_empresa.value = 'Cliente B';
  els.ct_email.value = 'b@b.com';
  els.ct_num_contrato.value = 'B0001/26';
  context._ctDraftActiveCod = '99999';
  context.ctCurrentStep = 1;
  assert.equal(context.ctSaveDraftLocal(), true);

  // Carregar B
  resetDom();
  assert.equal(context.ctLoadDraftForCod('99999'), true);
  assert.equal(els.ct_empresa.value, 'Cliente B');
  assert.equal(els.ct_email.value, 'b@b.com');
  assert.notEqual(els.ct_empresa.value, 'Cliente Teste Lda');

  // Trocar para A
  assert.equal(context.ctLoadDraftForCod('12345'), true);
  assert.equal(els.ct_empresa.value, 'Cliente Teste Lda');
  assert.equal(els.ct_email.value, 'ana@cliente.com');

  // Código sem rascunho → branco (com o novo código)
  assert.equal(context.ctLoadDraftForCod('77777', { blankIfMissing: true }), false);
  assert.equal(els.ct_empresa.value, '');
  assert.equal(els.ct_email.value, '');
  assert.equal(els.ct_cod.value, '77777');
});

check('sem código não grava rascunho global', () => {
  resetDom();
  const before = Object.keys(store).filter(k => k === context.CT_DRAFT_LS).length;
  els.ct_cod.value = '';
  els.ct_empresa.value = 'Não deve gravar';
  context._ctDraftActiveCod = '';
  assert.equal(context.ctSaveDraftLocal(), true);
  assert.equal(store[context.CT_DRAFT_LS], undefined);
  assert.equal(Object.keys(store).filter(k => k === context.CT_DRAFT_LS).length, before);
});

check('limpar campo de propósito fica vazio no rascunho', () => {
  resetDom();
  els.ct_cod.value = '12345';
  context._ctDraftActiveCod = '12345';
  const draft = context.ctLoadDraftLocal('12345');
  context.ctApplyDraft(draft);
  els.ct_email.value = '';
  context.ctCurrentStep = 3;
  assert.equal(context.ctSaveDraftLocal(), true);
  const again = context.ctLoadDraftLocal('12345');
  assert.equal(again.fields.ct_email, '');
  assert.equal(again.fields.ct_empresa, 'Cliente Teste Lda');
});

check('ctClearDraft remove só o rascunho do código (após gerar)', () => {
  context._ctDraftActiveCod = '12345';
  els.ct_cod.value = '12345';
  context.ctClearDraft();
  assert.equal(context.ctLoadDraftLocal('12345'), null);
  // B continua
  assert.ok(context.ctLoadDraftLocal('99999'));
});

check('ctOnCodInput com código vazio limpa formulário', () => {
  resetDom();
  els.ct_cod.value = '99999';
  context.ctLoadDraftForCod('99999');
  assert.equal(els.ct_empresa.value, 'Cliente B');
  els.ct_cod.value = '';
  context._ctAutosaveReady = true;
  context.ctOnCodInput();
  assert.equal(els.ct_empresa.value, '');
  assert.equal(els.ct_email.value, '');
});

if (!process.exitCode) console.log('\nTodos os testes de autosave de contratos passaram.');
