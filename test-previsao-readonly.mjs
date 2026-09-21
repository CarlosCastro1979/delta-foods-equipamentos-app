#!/usr/bin/env node
/**
 * Mapa mensal da Previsão: vendedores só consultam; só ADMINS persistem.
 * Filipe / Diogo / Marcio / Massimo não são editores (não estão em ADMINS).
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

function extractArrayConst(src, name) {
  const start = src.indexOf(`const ${name} =`);
  if (start < 0) throw new Error('const em falta: ' + name);
  const lb = src.indexOf('[', start);
  let depth = 0;
  for (let i = lb; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('Array não fechou: ' + name);
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

const store = new Map();
const context = {
  console,
  Date,
  Number,
  String,
  Array,
  JSON,
  Math,
  _pvData: null,
  toast() {},
  document: { getElementById() { return null; } },
  localStorage: {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    key(i) { return Array.from(store.keys())[i]; },
    get length() { return store.size; },
  },
};
vm.createContext(context);

for (const name of ['ADMINS', 'PREV_VENDAS_ACESSO', 'PREV_VENDAS_SO_CONSULTA']) {
  vm.runInContext(extractArrayConst(html, name), context);
}
for (const name of [
  'normNomeUtilizador',
  'getUtilizadorAtual',
  'isAdmin',
  'podeAcederPrevisaoVendas',
  'pvPodeEditar',
  'pvStoreKey',
  'pvSaveData',
  'pvAutosave',
  'pvOnCampoInput',
  'pvParseNumInput',
  'pvFmtNum',
  'pvFmtEdit',
  'pvEditCell',
]) {
  vm.runInContext(extractFn(html, name), context);
}

function setUser(nome) {
  if (nome) store.set('dfb_utilizador', nome);
  else store.delete('dfb_utilizador');
}

function previsaoKeys() {
  return Array.from(store.keys()).filter(k => String(k).startsWith('dfb_previsao_mapa_'));
}

function clearPrevisaoStore() {
  previsaoKeys().forEach(k => store.delete(k));
  context._pvData = null;
}

function sampleData(overrides) {
  return {
    ano: 2026,
    mes: 8,
    linhas: [{
      id: 'dfb_lojas',
      empresa: 'LOJAS ONLINE',
      tipo: 'canal',
      parent: 'dfb',
      prevFecho: 858000,
      n: null,
      myr: 853855,
      n1: 648451,
      budget: 1092541,
      ...(overrides || {}),
    }],
  };
}

const VENDEDORES = ['Filipe Neves', 'Diogo Oliveira', 'Marcio Gorga', 'Massimo Bottello'];
const ADMINS_TEST = ['Carlos Castro', 'Christian Souza', 'Andrea Albuquerque', 'Daniela Kucinski', 'Daniela Kucinsky'];

check('listas: vendedores em consulta, não em ADMINS', () => {
  const adm = vm.runInContext('ADMINS', context).map(context.normNomeUtilizador);
  const cons = vm.runInContext('PREV_VENDAS_SO_CONSULTA', context).map(context.normNomeUtilizador);
  const aceso = vm.runInContext('PREV_VENDAS_ACESSO', context).map(context.normNomeUtilizador);
  VENDEDORES.forEach(n => {
    const k = context.normNomeUtilizador(n);
    assert.ok(cons.includes(k), n + ' deveria estar em SO_CONSULTA');
    assert.ok(aceso.includes(k), n + ' deveria poder aceder');
    assert.ok(!adm.includes(k), n + ' não pode ser ADMIN');
  });
  ADMINS_TEST.forEach(n => {
    assert.ok(adm.includes(context.normNomeUtilizador(n)), n + ' deveria ser ADMIN');
  });
});

check('UI: banner de consulta e Publicar escondido por omissão', () => {
  assert.ok(html.includes('id="pv-readonly-banner"'));
  assert.ok(html.includes('Só consulta</strong> — a previsão é editada pela direcção.'));
  assert.ok(html.includes('pv-btn-publicar'));
  assert.ok(/id="pv-btn-publicar"[^>]*display:none/.test(html));
  assert.ok(html.includes('onclick="pvExportarExcel()"'));
  assert.ok(html.includes('id="pv-ano"'));
  assert.ok(html.includes('id="pv-mes"'));
  assert.ok(!/function pvExportarExcel\(\) \{\s*if \(!pvPodeEditar/.test(html));
  assert.ok(html.includes('Vendedores: só consulta. Edição: direcção'));
});

VENDEDORES.forEach(nome => {
  check(nome + ': acede, não edita, não persiste', () => {
    clearPrevisaoStore();
    setUser(nome);
    assert.equal(context.isAdmin(), false);
    assert.equal(context.podeAcederPrevisaoVendas(), true);
    assert.equal(context.pvPodeEditar(), false);

    context._pvData = sampleData({ prevFecho: 1 });
    assert.equal(context.pvSaveData(), false);
    assert.deepEqual(previsaoKeys(), []);

    const el = { getAttribute: () => '0', value: '999999' };
    context._pvData = sampleData({ prevFecho: 858000 });
    context.pvOnCampoInput(el, 'prevFecho');
    assert.equal(context._pvData.linhas[0].prevFecho, 858000);
    assert.deepEqual(previsaoKeys(), []);

    const cell = context.pvEditCell('prevFecho', 0, { tipo: 'canal', prevFecho: 858000 }, true, '#eff6ff');
    assert.ok(!cell.includes('<input'), 'célula não pode ser input: ' + cell);
    assert.ok(!cell.includes('oninput'));
  });
});

ADMINS_TEST.forEach(nome => {
  check(nome + ': edita e persiste', () => {
    clearPrevisaoStore();
    setUser(nome);
    assert.equal(context.isAdmin(), true);
    assert.equal(context.podeAcederPrevisaoVendas(), true);
    assert.equal(context.pvPodeEditar(), true);

    context._pvData = sampleData({ prevFecho: 2521200 });
    assert.equal(context.pvSaveData(), true);
    const key = context.pvStoreKey(2026, 8);
    const raw = store.get(key);
    assert.ok(raw, 'admin tem de gravar localStorage');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.linhas[0].prevFecho, 2521200);
    assert.equal(parsed.actualizadoPor, nome);
    assert.ok(parsed.actualizadoEm);

    const cell = context.pvEditCell('n', 0, { tipo: 'canal', n: 1234 }, true, '#f0fdf4');
    assert.ok(cell.includes('<input'), 'admin vê input');
    assert.ok(cell.includes('pv-n-input'));
    assert.ok(cell.includes('pvOnRealNInput'));
  });
});

check('vendedor não sobrescreve o que o admin gravou', () => {
  clearPrevisaoStore();
  setUser('Carlos Castro');
  context._pvData = sampleData({ prevFecho: 777000, n: 700000 });
  assert.equal(context.pvSaveData(), true);
  const key = context.pvStoreKey(2026, 8);
  const before = store.get(key);

  setUser('Diogo Oliveira');
  context._pvData.linhas[0].prevFecho = 1;
  context._pvData.linhas[0].n = 1;
  context._pvData.linhas[0].myr = 1;
  context._pvData.linhas[0].n1 = 1;
  context._pvData.linhas[0].budget = 1;
  assert.equal(context.pvPodeEditar(), false);
  assert.equal(context.pvSaveData(), false);
  assert.equal(store.get(key), before);
  const parsed = JSON.parse(store.get(key));
  assert.equal(parsed.linhas[0].prevFecho, 777000);
  assert.equal(parsed.linhas[0].n, 700000);
  assert.equal(parsed.actualizadoPor, 'Carlos Castro');
});

check('Hélcio (vendedor Horeca) sem acesso ao mapa e sem persist', () => {
  clearPrevisaoStore();
  setUser('Hélcio Grégio');
  assert.equal(context.isAdmin(), false);
  assert.equal(context.podeAcederPrevisaoVendas(), false);
  assert.equal(context.pvPodeEditar(), false);
  context._pvData = sampleData();
  assert.equal(context.pvSaveData(), false);
  assert.deepEqual(previsaoKeys(), []);
});

check('sem utilizador: não edita nem persiste', () => {
  clearPrevisaoStore();
  setUser('');
  assert.equal(context.pvPodeEditar(), false);
  context._pvData = sampleData();
  assert.equal(context.pvSaveData(), false);
  assert.deepEqual(previsaoKeys(), []);
});

check('admin com edit=false renderiza texto (Accuracy / consulta visual)', () => {
  setUser('Andrea Albuquerque');
  const cell = context.pvEditCell('myr', 0, { tipo: 'canal', myr: 500 }, false, '#fffbeb');
  assert.ok(!cell.includes('<input'));
});

check('pvAutosave de vendedor não agenda escrita', () => {
  clearPrevisaoStore();
  setUser('Massimo Bottello');
  context._pvData = sampleData({ prevFecho: 42 });
  context.pvAutosave();
  assert.deepEqual(previsaoKeys(), []);
});

if (process.exitCode) {
  console.error('\nAlguns testes de previsão read-only falharam.');
} else {
  console.log('\nTodos os testes de previsão read-only passaram.');
}
