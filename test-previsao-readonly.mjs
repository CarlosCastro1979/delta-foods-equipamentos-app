#!/usr/bin/env node
/**
 * Mapa mensal: Filipe / Diogo / Marcio / Massimo editam só a Previsão de fecho
 * dos canais que já são deles. N, MYR, Budget e canais alheios continuam bloqueados.
 * Orçamento 2027 não passa por pvPodeEditar.
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

function extractObjectConst(src, name) {
  const start = src.indexOf(`const ${name} =`);
  if (start < 0) throw new Error('const em falta: ' + name);
  const lb = src.indexOf('{', start);
  let depth = 0;
  for (let i = lb; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('Object não fechou: ' + name);
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
const sess = new Map();
const context = {
  console,
  Date,
  Number,
  String,
  Array,
  JSON,
  Math,
  Intl,
  Object,
  _pvData: null,
  _pvBaseVendedor: null,
  _pvAutosaveTimer: null,
  _pvAutosaveHintTimer: null,
  _pvRelogio() { return new Date(2026, 9, 20); },
  PV_MES_SESSAO_KEY: 'dfb_pv_mes_escolhido',
  toast() {},
  setTimeout() { return 1; },
  clearTimeout() {},
  pvRecalcSomas() {},
  pvRefreshSomasDom() {},
  pvUpdateRowPercents() {},
  pvFlashAutosave() {},
  pvScheduleCloudSync() {},
  document: { getElementById() { return null; } },
  sessionStorage: {
    getItem(k) { return sess.has(k) ? sess.get(k) : null; },
    setItem(k, v) { sess.set(k, String(v)); },
    removeItem(k) { sess.delete(k); },
  },
  localStorage: {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    key(i) { return Array.from(store.keys())[i]; },
    get length() { return store.size; },
  },
};
vm.createContext(context);

for (const name of ['ADMINS', 'PREV_VENDAS_ACESSO', 'PREV_VENDAS_SO_CONSULTA', 'PV_ACC_RANKING_VENDEDORES']) {
  vm.runInContext(extractArrayConst(html, name), context);
}
vm.runInContext(extractObjectConst(html, 'PV_ACC_CANAL_VENDEDOR'), context);
for (const name of [
  'normNomeUtilizador',
  'getUtilizadorAtual',
  'isAdmin',
  'podeAcederPrevisaoVendas',
  'pvPodeEditar',
  'pvPodeGravarPrevFecho',
  'pvPodeEditarPrevFechoLinha',
  'pvPodeEditarCampo',
  'pvAccMetaDeCanal',
  'pvAccCertaintyForaDaSoma',
  'pvAccVendedorDeCanal',
  'pvEditFieldNames',
  'pvCapturarBaseVendedor',
  'pvRestaurarCamposBloqueados',
  'pvTouchCell',
  'pvMesCalendario',
  'pvAnoCalendario',
  'pvMapaEhMesCorrente',
  'pvDocumentoEhMesCorrente',
  'pvMesPorOmissao',
  'pvMemorizarMesEscolhido',
  'pvAgoraSaoPaulo',
  'pvStoreKey',
  'pvSaveData',
  'pvPersistLocalSilent',
  'pvFlushAutosave',
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
    mes: 9,
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
  assert.ok(html.includes('Vendedores: escrevem a Previsão de fecho dos seus canais no mapa mensal, só no mês corrente'));
  assert.ok(html.includes('function pvMapaEhMesCorrente('));
  assert.ok(!html.includes('value="7" selected'));
  assert.ok(html.includes("timeZone: 'America/Sao_Paulo'"));
});

const CANAIS = {
  'Filipe Neves': ['dfb_rest', 'dfb_inst_horeca'],
  'Diogo Oliveira': ['dfb_ret_mod', 'dfb_dist_ret', 'qb_ret_mod', 'qb_dist_ret'],
  'Marcio Gorga': ['dfb_lojas', 'dfb_site', 'dfb_inst_balcao', 'qb_rest'],
  'Massimo Bottello': ['dfb_dist_reg', 'qb_dist_reg'],
};

function linhaCanal(id, extra) {
  return {
    id,
    empresa: id,
    tipo: 'canal',
    parent: id.startsWith('qb_') ? 'qb' : 'dfb',
    prevFecho: 100,
    n: 80,
    myr: 90,
    n1: 70,
    budget: 110,
    ...(extra || {}),
  };
}

VENDEDORES.forEach(nome => {
  check(nome + ': previsão de fecho dos seus canais; N, MYR e canais alheios bloqueados', () => {
    clearPrevisaoStore();
    sess.clear();
    setUser(nome);
    context._pvBaseVendedor = null;
    context._pvRelogio = () => new Date(2026, 9, 20);
    context._pvData = { ano: 2026, mes: 9, linhas: [] };
    assert.equal(context.isAdmin(), false);
    assert.equal(context.podeAcederPrevisaoVendas(), true);
    assert.equal(context.pvPodeEditar(), false, 'mapa inteiro continua fechado');
    assert.equal(context.pvPodeGravarPrevFecho(), true);

    const meus = CANAIS[nome];
    const alheio = meus.includes('dfb_lojas') ? 'dfb_rest' : 'dfb_lojas';
    meus.forEach(id => {
      const row = linhaCanal(id);
      assert.equal(context.pvPodeEditarPrevFechoLinha(row), true, id);
      const cell = context.pvEditCell('prevFecho', 0, row, false, '#eff6ff');
      assert.ok(cell.includes('<input'), 'previsão editável: ' + id);
      assert.ok(cell.includes('pvOnPrevInput'));
      assert.ok(!context.pvEditCell('n', 0, row, false, '#f0fdf4').includes('<input'), 'N bloqueado ' + id);
      assert.ok(!context.pvEditCell('myr', 0, row, false, '#fffbeb').includes('<input'), 'MYR bloqueado ' + id);
      assert.ok(!context.pvEditCell('n1', 0, row, false, '#fff').includes('<input'), 'N-1 bloqueado ' + id);
      assert.ok(!context.pvEditCell('budget', 0, row, false, '#fff').includes('<input'), 'Budget bloqueado ' + id);
      const ligado = linhaCanal(id, { nLigado: true, n: 50 });
      assert.ok(!context.pvEditCell('n', 0, ligado, true, '#f0fdf4').includes('<input'), 'N ligado bloqueado ' + id);
    });
    assert.equal(context.pvPodeEditarPrevFechoLinha(linhaCanal(alheio)), false, alheio);
    assert.ok(!context.pvEditCell('prevFecho', 0, linhaCanal(alheio), false, '#eff6ff').includes('<input'));
    assert.ok(!context.pvEditCell('prevFecho', 0, { id: 'dfb', tipo: 'grupo', prevFecho: 1 }, false, '#fff').includes('<input'));
    assert.ok(!context.pvEditCell('prevFecho', 0, { id: 'total', tipo: 'total', prevFecho: 1 }, false, '#fff').includes('<input'));

    context._pvData = {
      ano: 2026,
      mes: 9,
      actualizadoEm: '2026-10-01T12:00:00.000Z',
      linhas: [linhaCanal(meus[0]), linhaCanal(alheio)],
      cellTs: {},
    };
    context.pvCapturarBaseVendedor();
    context.pvOnCampoInput({ getAttribute: () => '0', value: '999' }, 'prevFecho');
    assert.equal(context._pvData.linhas[0].prevFecho, 999);
    context.pvOnCampoInput({ getAttribute: () => '0', value: '1' }, 'n');
    assert.equal(context._pvData.linhas[0].n, 80, 'N não muda');
    context.pvOnCampoInput({ getAttribute: () => '0', value: '2' }, 'myr');
    assert.equal(context._pvData.linhas[0].myr, 90, 'MYR não muda');
    context.pvOnCampoInput({ getAttribute: () => '1', value: '5' }, 'prevFecho');
    assert.equal(context._pvData.linhas[1].prevFecho, 100, 'canal alheio não muda');

    assert.equal(context.pvSaveData(), true);
    const key = context.pvStoreKey(2026, 9);
    const parsed = JSON.parse(store.get(key));
    assert.equal(parsed.linhas[0].prevFecho, 999);
    assert.equal(parsed.linhas[0].n, 80);
    assert.equal(parsed.linhas[0].myr, 90);
    assert.equal(parsed.linhas[1].prevFecho, 100);
    assert.equal(parsed.linhas[1].n, 80);
    assert.equal(parsed.actualizadoPor, nome);
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
    const key = context.pvStoreKey(2026, 9);
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

check('vendedor não sobrescreve N nem a previsão de um canal que não é dele', () => {
  clearPrevisaoStore();
  setUser('Carlos Castro');
  context._pvBaseVendedor = null;
  context._pvData = {
    ano: 2026,
    mes: 9,
    linhas: [linhaCanal('dfb_lojas', { prevFecho: 777000, n: 700000 })],
    cellTs: {},
  };
  assert.equal(context.pvSaveData(), true);
  const key = context.pvStoreKey(2026, 9);

  setUser('Diogo Oliveira');
  context.pvCapturarBaseVendedor();
  context._pvData.linhas[0].prevFecho = 1;
  context._pvData.linhas[0].n = 1;
  context._pvData.linhas[0].myr = 1;
  assert.equal(context.pvPodeEditar(), false);
  assert.equal(context.pvPodeEditarPrevFechoLinha(context._pvData.linhas[0]), false);
  assert.equal(context.pvSaveData(), true);
  const parsed = JSON.parse(store.get(key));
  assert.equal(parsed.linhas[0].prevFecho, 777000);
  assert.equal(parsed.linhas[0].n, 700000);
  assert.equal(parsed.linhas[0].myr, 90);
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

check('pvAutosave de vendedor grava a previsão e o flush também', () => {
  clearPrevisaoStore();
  setUser('Massimo Bottello');
  context._pvBaseVendedor = null;
  context._pvData = {
    ano: 2026,
    mes: 9,
    linhas: [linhaCanal('dfb_dist_reg', { prevFecho: 42, n: 10 })],
    cellTs: {},
  };
  context.pvCapturarBaseVendedor();
  context._pvData.linhas[0].prevFecho = 42000;
  context.pvTouchCell(0, 'prevFecho');
  assert.equal(context.pvFlushAutosave(), true);
  const parsed = JSON.parse(store.get(context.pvStoreKey(2026, 9)));
  assert.equal(parsed.linhas[0].prevFecho, 42000);
  assert.equal(parsed.linhas[0].n, 10);
  assert.ok(extractFn(html, 'pvAutosave').includes('150'));
  assert.ok(extractFn(html, 'pvScheduleCloudSync').includes('1200'));
});

check('vendedor grava localStorage da previsão; campos bloqueados e Hélcio não', () => {
  clearPrevisaoStore();
  setUser('Filipe Neves');
  const data = {
    ano: 2026,
    mes: 9,
    linhas: [linhaCanal('dfb_rest', { prevFecho: 400000, n: 810000 })],
  };
  assert.equal(context.pvPersistLocalSilent(2026, 9, data), true);
  assert.ok(store.get(context.pvStoreKey(2026, 9)));
  assert.ok(extractFn(html, 'pvPersistLocalSilent').includes('pvPodeEditar'));
  assert.ok(extractFn(html, 'pvScheduleCloudSync').includes('pvPodeEditar'));
  assert.ok(extractFn(html, 'pvSyncMapsToCloud').includes('pvPodeEditar'));
  assert.ok(extractFn(html, 'pvBindAutosaveLifecycle').includes('pvPodeEditar'));
  assert.ok(extractFn(html, 'pvPublicarProducao').includes('if (!pvPodeEditar())'));
});

check('previsão de fecho só no mês corrente; Agosto 2026 fechado para vendedor e admin', () => {
  const outubro = new Date(2026, 9, 20);
  const novembro = new Date(2026, 10, 1);
  context._pvRelogio = () => outubro;
  assert.equal(context.pvMapaEhMesCorrente(2026, 9, outubro), true);
  assert.equal(context.pvMapaEhMesCorrente(2026, 7, outubro), false, 'Agosto não é o corrente');
  assert.equal(context.pvMapaEhMesCorrente(2026, 10, outubro), false, 'Novembro ainda é futuro');
  assert.equal(context.pvMapaEhMesCorrente(2025, 9, outubro), false, 'Outubro de 2025 é histórico');
  assert.equal(context.pvMapaEhMesCorrente(2026, 10, novembro), true, 'em Novembro o corrente muda');
  assert.equal(context.pvMapaEhMesCorrente(2026, 9, novembro), false);

  clearPrevisaoStore();
  setUser('Diogo Oliveira');
  context._pvBaseVendedor = null;
  context._pvData = { ano: 2026, mes: 9, linhas: [linhaCanal('dfb_ret_mod', { prevFecho: 50 })], cellTs: {} };
  assert.equal(context.pvPodeEditarPrevFechoLinha(context._pvData.linhas[0]), true);
  assert.ok(context.pvEditCell('prevFecho', 0, context._pvData.linhas[0], false, '#eff6ff').includes('<input'));

  context._pvData.mes = 7;
  assert.equal(context.pvDocumentoEhMesCorrente(context._pvData), false);
  assert.equal(context.pvPodeEditarPrevFechoLinha(context._pvData.linhas[0]), false);
  assert.ok(!context.pvEditCell('prevFecho', 0, context._pvData.linhas[0], false, '#eff6ff').includes('<input'));
  assert.ok(!context.pvEditCell('n', 0, context._pvData.linhas[0], true, '#fff').includes('<input'));
  const keyAgo = context.pvStoreKey(2026, 7);
  context._pvData.linhas[0].prevFecho = 1;
  assert.equal(context.pvSaveData(), false, 'Agosto não grava');
  assert.equal(context.pvPersistLocalSilent(2026, 7, context._pvData), false);
  assert.equal(store.get(keyAgo) || null, null);
  context.pvOnCampoInput({ getAttribute: () => '0', value: '999' }, 'prevFecho');
  assert.equal(context._pvData.linhas[0].prevFecho, 1, 'input de Agosto não altera a previsão');

  setUser('Carlos Castro');
  context._pvData = { ano: 2026, mes: 7, linhas: [linhaCanal('dfb_lojas', { prevFecho: 80, n: 70 })], cellTs: {} };
  assert.equal(context.pvPodeEditar(), true, 'admin continua admin');
  assert.equal(context.pvPodeEditarPrevFechoLinha(context._pvData.linhas[0]), false);
  assert.ok(!context.pvEditCell('prevFecho', 0, context._pvData.linhas[0], true, '#eff6ff').includes('<input'));
  assert.ok(!context.pvEditCell('n', 0, context._pvData.linhas[0], true, '#f0fdf4').includes('<input'));
  assert.ok(!context.pvEditCell('myr', 0, context._pvData.linhas[0], true, '#fffbeb').includes('<input'));
  assert.equal(context.pvSaveData(), false);
  assert.equal(context.pvPersistLocalSilent(2026, 7, context._pvData), false);
  assert.equal(store.get(keyAgo) || null, null);

  context._pvData.mes = 10;
  assert.equal(context.pvPodeEditarPrevFechoLinha(context._pvData.linhas[0]), false, 'mês futuro fechado');
  assert.equal(context.pvSaveData(), false);

  setUser('Filipe Neves');
  clearPrevisaoStore();
  context._pvBaseVendedor = null;
  context._pvData = {
    ano: 2026,
    mes: 9,
    linhas: [linhaCanal('dfb_rest', { prevFecho: 400 })],
    cellTs: {},
  };
  context.pvCapturarBaseVendedor();
  context.pvOnCampoInput({ getAttribute: () => '0', value: '' }, 'prevFecho');
  assert.equal(context._pvData.linhas[0].prevFecho, null);
  assert.equal(context.pvSaveData(), true);
  const limpo = JSON.parse(store.get(context.pvStoreKey(2026, 9)));
  assert.equal(limpo.linhas[0].prevFecho, null, 'limpar o mês corrente fica vazio');

  context._pvRelogio = () => novembro;
  context._pvData = { ano: 2026, mes: 10, linhas: [linhaCanal('dfb_rest', { prevFecho: 10 })] };
  assert.equal(context.pvPodeEditarPrevFechoLinha(context._pvData.linhas[0]), true, 'Novembro abre quando o calendário é Novembro');
  context._pvData.mes = 9;
  assert.equal(context.pvPodeEditarPrevFechoLinha(context._pvData.linhas[0]), false, 'Outubro passa a histórico');
  context._pvRelogio = () => outubro;
});

check('mês por omissão é o calendário actual, não Agosto; a escolha da sessão mantém-se', () => {
  sess.clear();
  assert.equal(context.pvMesCalendario(new Date(2026, 9, 20)), 9);
  assert.equal(context.pvMesCalendario(new Date(2026, 10, 1)), 10);
  assert.equal(context.pvMesPorOmissao(new Date(2026, 9, 20)), 9);
  assert.notEqual(context.pvMesPorOmissao(new Date(2026, 9, 20)), 7);
  assert.equal(context.pvMesPorOmissao(new Date(2026, 7, 15)), 7, 'Agosto só quando o calendário é Agosto');
  context.pvMemorizarMesEscolhido('3');
  assert.equal(context.pvMesPorOmissao(new Date(2026, 9, 20)), 3);
  sess.clear();
  assert.equal(context.pvMesPorOmissao(new Date(2026, 10, 20)), 10);
  const agora = context.pvAgoraSaoPaulo();
  assert.ok(agora instanceof Date);
  assert.equal(context.pvMesCalendario(agora), agora.getMonth());
});

if (process.exitCode) {
  console.error('\nAlguns testes de previsão read-only falharam.');
} else {
  console.log('\nTodos os testes de previsão read-only passaram.');
}
