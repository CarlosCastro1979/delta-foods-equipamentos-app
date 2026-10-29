#!/usr/bin/env node
/**
 * Dist: Word Anexo I só com nome do equipamento (sem «Gama N — lote —»).
 * Email contrato Dist: Eduardo → CC Massimo+Carlos; Massimo → CC Eduardo.
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

check('cache SW / index alinhados', () => {
  assert.ok(sw.includes(CACHE), 'sw.js tem ' + CACHE);
  assert.ok(html.includes(CACHE), 'index.html tem ' + CACHE);
  assert.ok(html.includes('function ctContratoEmailCc'));
  assert.ok(html.includes('prefixGamaWord'));
  assert.ok(html.includes('ctContratoEmailCc(criador)'));
});

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

let _dist = true;
let _user = 'Eduardo Madeira';

const MESES_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const CT_TESTEMUNHA_FILIPE = { nome: 'Filipe Neves', cpf: '123.423.841-14' };
const CT_TESTEMUNHA_MASSIMO = { nome: 'Massimo Bottello', cpf: '017.941.856-40' };
const CT_TESTEMUNHA_EDUARDO = { nome: 'Eduardo Madeira', cpf: '225.668.708-29' };

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
  MESES_PT,
  CT_TESTEMUNHA_FILIPE,
  CT_TESTEMUNHA_MASSIMO,
  CT_TESTEMUNHA_EDUARDO,
  ctGamaCount: 2,
  document: {
    getElementById(id) { return els[id] || null; },
  },
  ctAplicarTestemunhasDelta() {},
  ctResolveEnderecoCliente() { return ''; },
  ctResolveVendedorContrato() { return ''; },
  ctContratoEhDistribuidores() { return !!_dist; },
  getUtilizadorAtual() { return _user; },
  numToExtenso(n) { return String(n || 0); },
};
vm.createContext(context);

vm.runInContext(extractConstAsVar(html, 'UTILIZADOR_EMAILS'), context);
vm.runInContext(extractFn(html, 'normNomeUtilizador'), context);
vm.runInContext(extractFn(html, 'getEmailUtilizador'), context);
vm.runInContext(extractFn(html, 'ctEmptyGama'), context);
vm.runInContext(extractFn(html, 'ctGamaLabel'), context);
vm.runInContext(extractFn(html, 'ctCollectGamas'), context);
vm.runInContext(extractFn(html, 'ctSyncLegacyGamaFields'), context);
vm.runInContext(extractFn(html, 'ctFormatGamasLote'), context);
vm.runInContext(extractFn(html, 'ctFormatGamasQtdMes'), context);
vm.runInContext(extractFn(html, 'ctFormatGamasQtdTotal'), context);
vm.runInContext(extractFn(html, 'ctContratoEmailCc'), context);
vm.runInContext(extractFn(html, 'ctGetData'), context);

function ensureGamaEls(n) {
  for (let i = 0; i < n; i++) {
    if (!els[`ct_gama_${i}_lote`]) els[`ct_gama_${i}_lote`] = makeEl('');
    if (!els[`ct_gama_${i}_unidade`]) els[`ct_gama_${i}_unidade`] = makeEl('Caps');
    if (!els[`ct_gama_${i}_qtd`]) els[`ct_gama_${i}_qtd`] = makeEl('');
  }
  for (let i = n; i < 8; i++) {
    delete els[`ct_gama_${i}_lote`];
    delete els[`ct_gama_${i}_unidade`];
    delete els[`ct_gama_${i}_qtd`];
  }
  context.ctGamaCount = n;
}

function setEquip(row, desc, gamaIdx) {
  const el = els[`ct_a1_${row}_equip`];
  el.value = 'EQ' + row;
  el.options = [
    { value: '', text: '—', dataset: {} },
    { value: 'EQ' + row, text: desc, dataset: { desc } },
  ];
  el.selectedIndex = 1;
  els[`ct_a1_${row}_gama`].value = String(gamaIdx);
  els[`ct_a1_${row}_qtd`].value = '1';
  els[`ct_a1_${row}_valor`].value = '1000';
}

ensureGamaEls(2);
els.ct_gama_0_lote.value = 'TODOS OS LOTES DE GRAOS';
els.ct_gama_0_unidade.value = 'Kg';
els.ct_gama_0_qtd.value = '100';
els.ct_gama_1_lote.value = 'CAPSULAS CAIXA DE 100';
els.ct_gama_1_unidade.value = 'Caps';
els.ct_gama_1_qtd.value = '40';
els.ct_dur_num.value = '24';
els.ct_dias_num.value = '30';
els.ct_empresa.value = 'Dist Cliente';
els.ct_cnpj.value = '00.000.000/0001-00';
els.ct_num_contrato.value = 'B0200/26';
els.ct_rep_nome.value = 'Rep';
els.ct_rep_rg.value = '1';
els.ct_rep_cpf.value = '2';
els.ct_t1_nome.value = 'Massimo Bottello';
els.ct_t1_cpf.value = '017.941.856-40';
els.ct_t2_nome.value = 'Eduardo Madeira';
els.ct_t2_cpf.value = '225.668.708-29';
setEquip(1, 'MAQ. MAYOR DIG. 1GR. PRETA', 0);
setEquip(2, 'QUORUM', 1);
context.ctSyncLegacyGamaFields();

check('Dist Word: DESC só nome do equipamento (sem Gama / lote)', () => {
  _dist = true;
  const data = context.ctGetData();
  assert.equal(data.A1_R1_DESC, 'MAQ. MAYOR DIG. 1GR. PRETA');
  assert.equal(data.A1_R2_DESC, 'QUORUM');
  assert.ok(!/Gama\s*1/i.test(data.A1_R1_DESC));
  assert.ok(!/TODOS OS LOTES/i.test(data.A1_R1_DESC));
  assert.ok(!/CAPSULAS/i.test(data.A1_R2_DESC));
  assert.ok(!data.A1_R1_DESC.includes('—'));
});

check('Horeca multi-gama: DESC mantém prefixo Gama + lote', () => {
  _dist = false;
  const data = context.ctGetData();
  assert.ok(data.A1_R1_DESC.startsWith('Gama 1'));
  assert.ok(data.A1_R1_DESC.includes('TODOS OS LOTES DE GRAOS'));
  assert.ok(data.A1_R1_DESC.includes('MAQ. MAYOR DIG. 1GR. PRETA'));
  assert.ok(data.A1_R2_DESC.startsWith('Gama 2'));
  assert.ok(data.A1_R2_DESC.includes('QUORUM'));
});

check('Eduardo cria Dist → CC Massimo + Carlos', () => {
  _dist = true;
  _user = 'Eduardo Madeira';
  const cc = context.ctContratoEmailCc();
  assert.deepEqual(cc, [
    'massimo.bottello@deltafoodsbrasil.com.br',
    'carlos.castro@deltafoodsbrasil.com.br',
  ]);
  // Alias Moreira → Madeira
  const ccAlias = context.ctContratoEmailCc('Eduardo Moreira');
  assert.deepEqual(ccAlias, cc);
});

check('Massimo cria Dist → CC Eduardo', () => {
  _dist = true;
  _user = 'Massimo Bottello';
  const cc = context.ctContratoEmailCc();
  assert.deepEqual(cc, ['eduardo.moreira@deltafoodsbrasil.com.br']);
});

check('Horeca: ctContratoEmailCc vazio (Filipe fica no ccString)', () => {
  _dist = false;
  _user = 'Filipe Neves';
  assert.deepEqual(context.ctContratoEmailCc(), []);
});

check('ctAbrirEmail usa ctContratoEmailCc + To Daniela', () => {
  const fn = extractFn(html, 'ctAbrirEmail');
  assert.ok(fn.includes("daniela.kucinski@deltafoodsbrasil.com.br"));
  assert.ok(fn.includes('ctContratoEmailCc'));
  assert.ok(fn.includes('ccString(ccList'));
});

if (!process.exitCode) console.log('\nTodos os testes Dist email/equip passaram.');
