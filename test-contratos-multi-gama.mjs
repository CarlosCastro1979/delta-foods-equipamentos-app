#!/usr/bin/env node
/**
 * Contratos multi-gama: 2 gamas no rascunho, prazo/duração únicos, payload Word com ambas.
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const CACHE = 'v2026-10-29-dividas-cod-cliente';

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

check('cache e UI multi-gama presentes', () => {
  assert.ok(sw.includes(CACHE), 'sw.js tem ' + CACHE);
  assert.ok(html.includes(CACHE), 'index.html tem ' + CACHE);
  assert.ok(html.includes('Adicionar outra gama'));
  assert.ok(html.includes('ct_gamas_list'));
  assert.ok(html.includes('function ctAddGama'));
  assert.ok(html.includes('function ctRemoveGama'));
  assert.ok(html.includes('function ctCollectGamas'));
  assert.ok(html.includes('function ctNormalizeGamasDraft'));
  assert.ok(html.includes('gamas: ctCollectGamas()'));
});

const store = Object.create(null);
const els = Object.create(null);

function makeEl(value) {
  return {
    value: value == null ? '' : String(value),
    textContent: '',
    innerHTML: '',
    children: { length: 0 },
    style: { display: 'none' },
    options: [],
    selectedIndex: 0,
  };
}

[
  'ct_cod', 'ct_num_contrato', 'ct_empresa', 'ct_cnpj', 'ct_endereco',
  'ct_rep_nome', 'ct_rep_rg', 'ct_rep_cpf', 'ct_email', 'ct_vendedor',
  'ct_lote', 'ct_unidade', 'ct_qtd_mes', 'ct_dur_num', 'ct_dias_num', 'ct_valor_equip',
  'ct_t1_nome', 'ct_t1_cpf', 'ct_t2_nome', 'ct_t2_cpf',
  'ct_cliente_found', 'ct_found_txt', 'ct-autosave-hint', 'ct_total_info',
  'ct_gamas_list', 'ct_a1_table', 'ct_a2_table', 'ct_review',
].forEach(id => { els[id] = makeEl(''); });

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

const MESES_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const CT_TESTEMUNHA_FILIPE = { nome: 'Filipe Neves', cpf: '123.423.841-14' };

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
  equipCatalog: [],
  MESES_PT,
  CT_TESTEMUNHA_FILIPE,
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
  ctAutoExtenso() {},
  ctGoto(step) { context.ctCurrentStep = step; },
  ctEquipSelected() {},
  ctScheduleAutosave() {},
  ctResolveEnderecoCliente() { return ''; },
  ctResolveVendedorContrato() { return ''; },
  ctContratoEhDistribuidores() { return false; },
  numToExtenso(n) { return String(n || 0); },
};
vm.createContext(context);

vm.runInContext(extractConstAsVar(html, 'CT_DRAFT_LS'), context);
vm.runInContext(extractConstAsVar(html, 'CT_AUTOSAVE_MS'), context);
vm.runInContext(extractConstAsVar(html, 'CT_DRAFT_FIELD_IDS'), context);
vm.runInContext('var _ctAutosaveTimer = null; var _ctAutosaveHintTimer = null; var _ctAutosaveReady = true; var _ctAutosaveAbort = null; var _ctDraftActiveCod = ""; var _ctLegacyDraftMigrated = true;', context);

function ensureGamaEls(n) {
  for (let i = 0; i < n; i++) {
    if (!els[`ct_gama_${i}_lote`]) els[`ct_gama_${i}_lote`] = makeEl('');
    if (!els[`ct_gama_${i}_unidade`]) els[`ct_gama_${i}_unidade`] = makeEl('Caps');
    if (!els[`ct_gama_${i}_qtd`]) els[`ct_gama_${i}_qtd`] = makeEl('');
  }
  // remove extras
  for (let i = n; i < 8; i++) {
    delete els[`ct_gama_${i}_lote`];
    delete els[`ct_gama_${i}_unidade`];
    delete els[`ct_gama_${i}_qtd`];
  }
  context.ctGamaCount = n;
  els.ct_gamas_list.children = { length: n };
}

// Stub render: só materializa inputs em vez de HTML real
context.ctRenderGamas = function (gamas) {
  const list = (Array.isArray(gamas) && gamas.length) ? gamas : [{ lote: '', unidade: 'Caps', qtd: '' }];
  ensureGamaEls(list.length);
  list.forEach((g, i) => {
    els[`ct_gama_${i}_lote`].value = g.lote || '';
    els[`ct_gama_${i}_unidade`].value = g.unidade || 'Caps';
    els[`ct_gama_${i}_qtd`].value = g.qtd || '';
  });
  context.ctSyncLegacyGamaFields();
};

for (const name of [
  'ctEmptyGama',
  'ctGamaLabel',
  'ctCollectGamas',
  'ctSyncLegacyGamaFields',
  'ctNormalizeGamasDraft',
  'ctOnGamaChange',
  'ctAddGama',
  'ctRemoveGama',
  'ctFormatGamasLote',
  'ctFormatGamasQtdMes',
  'ctFormatGamasQtdTotal',
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
  'ctApplyAnexoDraft',
  'ctApplyDraft',
  'ctRefreshAnexoGamaSelects',
  'ctGamaSelectOptionsHtml',
  'ctGetData',
  'ctValidateStep',
]) {
  if (name === 'ctRenderGamas') continue;
  vm.runInContext(extractFn(html, name), context);
}

ensureGamaEls(1);

check('rascunho antigo single-gama abre como 1 gama', () => {
  const old = {
    v: 1,
    step: 2,
    fields: {
      ct_lote: 'Delta Q Caps 10',
      ct_unidade: 'Caps',
      ct_qtd_mes: '40',
      ct_dur_num: '24',
      ct_dias_num: '30',
      ct_empresa: 'X',
    },
    a1: [],
    a2: [],
  };
  const gamas = context.ctNormalizeGamasDraft(old);
  assert.equal(gamas.length, 1);
  assert.equal(gamas[0].lote, 'Delta Q Caps 10');
  assert.equal(gamas[0].unidade, 'Caps');
  assert.equal(gamas[0].qtd, '40');
});

check('duas gamas gravadas e restauradas; prazo/duração únicos', () => {
  ensureGamaEls(2);
  els.ct_gama_0_lote.value = 'Delta Q Caps 10';
  els.ct_gama_0_unidade.value = 'Caps';
  els.ct_gama_0_qtd.value = '40';
  els.ct_gama_1_lote.value = 'Café Grão Especial';
  els.ct_gama_1_unidade.value = 'Kg';
  els.ct_gama_1_qtd.value = '50';
  els.ct_dur_num.value = '24';
  els.ct_dias_num.value = '30';
  els.ct_empresa.value = 'Cliente Multi Gama';
  els.ct_cod.value = '99901';
  context.ctSyncLegacyGamaFields();
  context.ctCurrentStep = 2;

  assert.equal(context.ctSaveDraftLocal(), true);
  const key = context.CT_DRAFT_LS + '_99901';
  const raw = JSON.parse(store[key]);
  assert.ok(Array.isArray(raw.gamas));
  assert.equal(raw.gamas.length, 2);
  assert.equal(raw.gamas[0].lote, 'Delta Q Caps 10');
  assert.equal(raw.gamas[1].unidade, 'Kg');
  assert.equal(raw.fields.ct_dur_num, '24');
  assert.equal(raw.fields.ct_dias_num, '30');
  // prazo/duração não repetidos por gama
  assert.equal(raw.gamas[0].duracao, undefined);
  assert.equal(raw.gamas[0].prazo, undefined);

  // reload simulado — só carrega com o código
  ensureGamaEls(1);
  els.ct_gama_0_lote.value = '';
  els.ct_dur_num.value = '';
  els.ct_dias_num.value = '';
  els.ct_empresa.value = '';
  els.ct_cod.value = '';
  context.ctCurrentStep = 1;
  assert.equal(context.ctLoadDraftLocal(), null);

  els.ct_cod.value = '99901';
  const loaded = context.ctLoadDraftLocal('99901');
  assert.ok(loaded);
  assert.equal(context.ctApplyDraft(loaded), true);
  assert.equal(context.ctGamaCount, 2);
  assert.equal(els.ct_gama_0_lote.value, 'Delta Q Caps 10');
  assert.equal(els.ct_gama_0_qtd.value, '40');
  assert.equal(els.ct_gama_1_lote.value, 'Café Grão Especial');
  assert.equal(els.ct_gama_1_unidade.value, 'Kg');
  assert.equal(els.ct_gama_1_qtd.value, '50');
  assert.equal(els.ct_dur_num.value, '24');
  assert.equal(els.ct_dias_num.value, '30');
  assert.equal(els.ct_empresa.value, 'Cliente Multi Gama');
});

check('ctGetData / payload Word contém ambas as gamas + prazo/duração únicos', () => {
  ensureGamaEls(2);
  els.ct_gama_0_lote.value = 'Delta Q Caps 10';
  els.ct_gama_0_unidade.value = 'Caps';
  els.ct_gama_0_qtd.value = '40';
  els.ct_gama_1_lote.value = 'Café Grão Especial';
  els.ct_gama_1_unidade.value = 'Kg';
  els.ct_gama_1_qtd.value = '50';
  els.ct_dur_num.value = '24';
  els.ct_dias_num.value = '30';
  els.ct_empresa.value = 'Empresa LTDA';
  els.ct_cnpj.value = '11.222.333/0001-44';
  els.ct_num_contrato.value = 'B0100/26';
  els.ct_rep_nome.value = 'Ana';
  els.ct_rep_rg.value = '1';
  els.ct_rep_cpf.value = '2';
  els.ct_t1_nome.value = 'Filipe Neves';
  els.ct_t1_cpf.value = '123.423.841-14';
  els.ct_t2_nome.value = 'Paulo Fontes';
  els.ct_t2_cpf.value = '189.665.258-14';
  context.ctSyncLegacyGamaFields();

  const data = context.ctGetData();
  assert.ok(Array.isArray(data.GAMAS));
  assert.equal(data.GAMAS.length, 2);
  assert.ok(data.LOTE.includes('Delta Q Caps 10'));
  assert.ok(data.LOTE.includes('Café Grão Especial'));
  assert.ok(data.QTD_MES.includes('40 Caps'));
  assert.ok(data.QTD_MES.includes('50 Kg'));
  assert.ok(data.QTD_TOTAL.includes('Caps'));
  assert.ok(data.QTD_TOTAL.includes('Kg'));
  assert.equal(data.DURACAO_NUM, '24');
  assert.equal(data.DIAS_PAG_NUM, '30');
});

check('validação exige pelo menos uma gama completa; remove deixa mínimo 1', () => {
  ensureGamaEls(2);
  els.ct_gama_0_lote.value = 'Caps A';
  els.ct_gama_0_qtd.value = '10';
  els.ct_gama_0_unidade.value = 'Caps';
  els.ct_gama_1_lote.value = 'Grão B';
  els.ct_gama_1_qtd.value = '20';
  els.ct_gama_1_unidade.value = 'Kg';
  els.ct_dur_num.value = '12';
  els.ct_dias_num.value = '30';
  let errs = context.ctValidateStep(2);
  assert.equal(errs.length, 0);

  els.ct_gama_1_lote.value = '';
  errs = context.ctValidateStep(2);
  assert.ok(errs.some(e => /gama 2/i.test(e)));

  context.ctRemoveGama(1);
  assert.equal(context.ctGamaCount, 1);
  assert.ok(els.ct_gama_0_lote);
  assert.equal(els.ct_gama_1_lote, undefined);

  // não remove a última
  context.ctRemoveGama(0);
  assert.equal(context.ctGamaCount, 1);
});

check('limpar campo de propósito fica vazio no rascunho (gama)', () => {
  ensureGamaEls(2);
  els.ct_cod.value = '99901';
  els.ct_gama_0_lote.value = 'A';
  els.ct_gama_0_qtd.value = '1';
  els.ct_gama_1_lote.value = 'B';
  els.ct_gama_1_qtd.value = '2';
  els.ct_dur_num.value = '24';
  context.ctSaveDraftLocal();
  els.ct_gama_1_lote.value = '';
  context.ctSaveDraftLocal();
  const again = context.ctLoadDraftLocal('99901');
  assert.equal(again.gamas[1].lote, '');
  assert.equal(again.gamas[0].lote, 'A');
});

if (!process.exitCode) console.log('\nTodos os testes multi-gama de contratos passaram.');
