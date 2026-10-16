#!/usr/bin/env node
/**
 * Orçamento 2027: quem abre a Previsão escreve Orç Valor e Volume.
 * O mapa mensal de fecho continua só para a direcção.
 * O autosave do vendedor leva à cloud só as células que mudou.
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const CACHE = 'v2026-10-16-volume-total-sim';

function extractFn(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('Função em falta: ' + name);
  if (src.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const paren = src.indexOf('(', start);
  let depth = 0;
  let bodyBrace = -1;
  for (let i = paren; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        bodyBrace = src.indexOf('{', i);
        break;
      }
    }
  }
  if (bodyBrace < 0) throw new Error('Corpo em falta: ' + name);
  depth = 0;
  for (let i = bodyBrace; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('Chaveta não fechou: ' + name);
}

function extractConst(src, name) {
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) throw new Error('Const em falta: ' + name);
  let i = src.indexOf('=', start) + 1;
  while (src[i] === ' ' || src[i] === '\n') i++;
  const open = src[i];
  const close = open === '{' ? '}' : (open === '[' ? ']' : '');
  if (!close) {
    const end = src.indexOf(';', i);
    return src.slice(start, end + 1);
  }
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close) {
      depth--;
      if (depth === 0) {
        const end = src[j + 1] === ';' ? j + 2 : j + 1;
        return src.slice(start, end);
      }
    }
  }
  throw new Error('Const não fechou: ' + name);
}

function extractArrayConst(src, name) {
  const start = src.indexOf(`const ${name} =`);
  if (start < 0) throw new Error('Array em falta: ' + name);
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
    const out = fn();
    if (out && typeof out.then === 'function') {
      return out.then(
        () => console.log('OK  ' + title),
        (e) => {
          console.error('FAIL ' + title);
          console.error(e && e.stack ? e.stack : e);
          process.exitCode = 1;
        }
      );
    }
    console.log('OK  ' + title);
  } catch (e) {
    console.error('FAIL ' + title);
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }
  return Promise.resolve();
}

const store = new Map();
const timers = [];
const posts = [];
const nuvem = {
  valor: { version: 1, canais: {} },
  volume: { version: 1, celulas: {} },
};

function jsonRes(status, data) {
  const body = JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => data,
  };
}

const ctx = {
  console,
  Date,
  Number,
  String,
  Array,
  JSON,
  Math,
  Object,
  parseInt,
  isNaN,
  SUPA_KEY: 'test-key',
  document: {
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  },
  localStorage: {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  },
  setTimeout(fn, ms) {
    const id = timers.length + 1;
    timers.push({ id, fn, ms });
    return id;
  },
  clearTimeout(id) {
    const t = timers.find(x => x.id === id);
    if (t) t.fn = null;
  },
  fetch(url, opts) {
    const u = String(url);
    const kind = u.includes('orcamento_2027_volume') ? 'volume' : 'valor';
    const method = (opts && opts.method) || 'GET';
    if (method === 'POST') {
      const body = JSON.parse(opts.body);
      posts.push({ kind, body });
      nuvem[kind] = body;
      return Promise.resolve(jsonRes(200, body));
    }
    return Promise.resolve(jsonRes(200, nuvem[kind]));
  },
};
vm.createContext(ctx);

for (const name of ['ADMINS', 'PREV_VENDAS_ACESSO', 'PREV_VENDAS_SO_CONSULTA']) {
  vm.runInContext(extractArrayConst(html, name), ctx);
}
for (const name of [
  'PV_SEED_AGOSTO_2026',
  'ORC27_LS_KEY',
  'ORC27_CLOUD_PATH',
  'ORC27_DEBOUNCE_MS',
  'VOL27_LS_KEY',
  'VOL27_FILTRO_LS',
  'VOL27_CLOUD_PATH',
  'VOL27_DEBOUNCE_MS',
  'VOL27_FAMILIAS',
  'VOL27_ROTULOS',
  'VOL27_PRECO_MESES',
  'VOL27_PRECO_ROTULO',
]) {
  vm.runInContext(extractConst(html, name), ctx);
}

const fns = [
  'normNomeUtilizador',
  'getUtilizadorAtual',
  'isAdmin',
  'podeAcederPrevisaoVendas',
  'pvPodeEditar',
  'orc27PodeEditar',
  'pvParseNumInput',
  'pvTsMs',
  'pvCentavosMapa',
  'orc27Yms',
  'orc27PeriodoN1',
  'orc27PeriodoYtd',
  'orc27TemNumero',
  'orc27LinhasBase',
  'orc27IdFolha',
  'orc27Total2026',
  'orc27VarPct',
  'orc27Pct27',
  'orc27FecharLinha',
  'orc27SomaTem',
  'orc27SomaManual',
  'orc27FilhosDe',
  'orc27AplicarSomas',
  'orc27ValorManual',
  'orc27Montar',
  'orc27PickCampo',
  'orc27MergeCanais',
  'orc27LocalPrecisaNuvem',
  'orc27AplicarEdicao',
  'orc27FmtRs',
  'orc27FmtPct',
  'orc27CanalUnicoVolume',
  'orc27FmtInput',
  'orc27Esc',
  'orc27SubNavHtml',
  'orc27CelulaManualHtml',
  'orc27RenderHtml',
  'orc27EntradaPronta',
  'orc27CloudUrl',
  'orc27CanaisDePayload',
  'orc27FetchCloud',
  'orc27Upload',
  'orc27EnviarCorpo',
  'orc27PedirNuvem',
  'orc27Flash',
  'orc27Agendar',
  'orc27Flush',
  'orc27PatchCalculos',
  'orc27OnInput',
  'orc27OnBlur',
  'vol27Round',
  'vol27IdsFolha',
  'vol27CanaisDoFiltro',
  'vol27FiltroFolha',
  'vol27FiltroTodos',
  'vol27Somar',
  'vol27Total2026',
  'vol27Chave',
  'vol27ChaveValida',
  'vol27ManualValor',
  'vol27ManualSoma',
  'vol27PrecoCelulaEntra',
  'vol27RotuloPreco',
  'vol27PrecoMedio',
  'vol27Simulacao',
  'vol27Montar',
  'vol27ResumoFora',
  'vol27FmtPlano',
  'vol27FmtQtd',
  'vol27FmtInput',
  'vol27TemMesHistorico',
  'vol27NotaFora',
  'vol27OpcoesFiltro',
  'vol27NomesCanal',
  'vol27NomeEmpresa',
  'vol27CurtoEmpresa',
  'vol27FolhasEmpresa',
  'vol27GruposFiltro',
  'vol27FiltroValido',
  'vol27EscolhaDe',
  'vol27RotuloChip',
  'vol27FiltroHtml',
  'vol27CanalEscrita',
  'vol27CanalDoEl',
  'vol27CelulaManualHtml',
  'vol27OrcValorDoCanal',
  'vol27Centavos',
  'vol27SomaSimulacao',
  'vol27OrcValorSelecao',
  'vol27RodapeHtml',
  'vol27RenderHtml',
  'vol27PickCampo',
  'vol27MergeCelulas',
  'vol27LocalPrecisaNuvem',
  'vol27AplicarEdicao',
  'vol27CloudUrl',
  'vol27CelulasDePayload',
  'vol27FetchCloud',
  'vol27Upload',
  'vol27EnviarCorpo',
  'vol27PedirNuvem',
  'vol27Flash',
  'vol27Agendar',
  'vol27Flush',
  'vol27PatchCalculos',
  'vol27OnInput',
  'vol27OnBlur',
];
for (const name of fns) vm.runInContext(extractFn(html, name), ctx);
vm.runInContext('function orc27QuadroActual(){ return null; }', ctx);

ctx._orc27Doc = { version: 1, canais: {} };
ctx._orc27Dirty = false;
ctx._orc27Timer = null;
ctx._orc27HintTimer = null;
ctx._orc27CloudCache = null;
ctx._orc27CloudFetchedAt = 0;
ctx._orc27Fila = Promise.resolve();
ctx._orc27Linhas = [];
ctx._vol27Doc = { version: 1, celulas: {} };
ctx._vol27Dirty = false;
ctx._vol27Timer = null;
ctx._vol27HintTimer = null;
ctx._vol27Filtro = 'todos';
ctx._vol27Agregado = { version: 1, meses: {} };
ctx._vol27CloudCache = null;
ctx._vol27CloudFetchedAt = 0;
ctx._vol27Fila = Promise.resolve();

const VENDEDORES = ['Filipe Neves', 'Diogo Oliveira', 'Marcio Gorga', 'Massimo Bottello'];

function setUser(nome) {
  if (nome) store.set('dfb_utilizador', nome);
  else store.delete('dfb_utilizador');
}

function el(attrs, value) {
  return {
    value,
    getAttribute(name) { return attrs[name] || ''; },
  };
}

function td(tr, cls) {
  const m = tr.match(new RegExp('<td class="' + cls + '"[^>]*>([\\s\\S]*?)</td>'));
  return m ? m[1] : '';
}

function resetNuvem() {
  posts.length = 0;
  nuvem.valor = {
    version: 1,
    canais: {
      dfb_lojas: {
        prevOutDez: 100,
        orcamento: 200,
        cellTs: { prevOutDez: '2020-01-01T00:00:00.000Z', orcamento: '2020-01-01T00:00:00.000Z' },
      },
      dfb_rest: {
        prevOutDez: 50,
        orcamento: 80,
        cellTs: { prevOutDez: '2020-01-02T00:00:00.000Z', orcamento: '2020-01-02T00:00:00.000Z' },
      },
    },
  };
  nuvem.volume = {
    version: 1,
    celulas: {
      'dfb_lojas|grao': {
        prevOutDez: 4,
        orcamento: 9,
        cellTs: { prevOutDez: '2020-01-01T00:00:00.000Z', orcamento: '2020-01-01T00:00:00.000Z' },
      },
      'dfb_rest|capsulas': {
        prevOutDez: 30,
        orcamento: 40,
        cellTs: { prevOutDez: '2020-01-02T00:00:00.000Z', orcamento: '2020-01-02T00:00:00.000Z' },
      },
    },
  };
  ctx._orc27CloudCache = null;
  ctx._orc27CloudFetchedAt = 0;
  ctx._orc27Fila = Promise.resolve();
  ctx._orc27Dirty = false;
  ctx._vol27CloudCache = null;
  ctx._vol27CloudFetchedAt = 0;
  ctx._vol27Fila = Promise.resolve();
  ctx._vol27Dirty = false;
}

const chain = Promise.resolve();

function later(title, fn) {
  return chain.then(() => check(title, fn));
}

await check('cache novo e o mapa mensal continua fechado aos vendedores', () => {
  assert.ok(sw.includes(CACHE));
  assert.ok(html.includes(CACHE));
  assert.ok(!sw.includes('v2026-10-15-vendas-out'));
  assert.ok(extractFn(html, 'pvSaveData').includes('pvPodeEditar'));
  assert.ok(extractFn(html, 'pvOnCampoInput').includes('pvPodeEditar'));
  assert.ok(!extractFn(html, 'orc27OnInput').includes('pvPodeEditar'));
  assert.ok(extractFn(html, 'orc27OnInput').includes('orc27PodeEditar'));
  assert.ok(extractFn(html, 'orc27Flush').includes('orc27PodeEditar'));
  assert.ok(extractFn(html, 'orc27EnviarCorpo').includes('orc27PodeEditar'));
  assert.ok(extractFn(html, 'orc27Pintar').includes('orc27PodeEditar'));
  assert.ok(extractFn(html, 'vol27OnInput').includes('orc27PodeEditar'));
  assert.ok(extractFn(html, 'vol27Flush').includes('orc27PodeEditar'));
  assert.ok(extractFn(html, 'vol27EnviarCorpo').includes('orc27PodeEditar'));
  assert.equal(vm.runInContext('ORC27_DEBOUNCE_MS', ctx), 1000);
  assert.equal(vm.runInContext('VOL27_DEBOUNCE_MS', ctx), 1000);
  assert.equal(vm.runInContext('ORC27_CLOUD_PATH', ctx), 'previsao/orcamento_2027_canais.json');
  assert.equal(vm.runInContext('VOL27_CLOUD_PATH', ctx), 'previsao/orcamento_2027_volume.json');
});

await check('vendedores da Previsão escrevem o orçamento; Hélcio e o mapa não', () => {
  VENDEDORES.forEach(nome => {
    setUser(nome);
    assert.equal(ctx.podeAcederPrevisaoVendas(), true, nome);
    assert.equal(ctx.pvPodeEditar(), false, nome + ' mapa');
    assert.equal(ctx.orc27PodeEditar(), true, nome + ' orçamento');
  });
  setUser('Carlos Castro');
  assert.equal(ctx.pvPodeEditar(), true);
  assert.equal(ctx.orc27PodeEditar(), true);
  setUser('Hélcio Grégio');
  assert.equal(ctx.podeAcederPrevisaoVendas(), false);
  assert.equal(ctx.pvPodeEditar(), false);
  assert.equal(ctx.orc27PodeEditar(), false);
  setUser('');
  assert.equal(ctx.orc27PodeEditar(), false);
});

await check('Orç Valor: folha é input; total, var e pais não são', () => {
  setUser('Diogo Oliveira');
  const linhas = ctx.orc27Montar(null, {
    dfb_lojas: { prevOutDez: 20, orcamento: 30 },
  });
  const vista = ctx.orc27RenderHtml(ctx.orc27PodeEditar(), linhas);
  const trs = vista.split('<tr ').slice(1);
  let inputs = 0;
  trs.forEach(tr => {
    const id = (tr.match(/data-orc-id="([^"]+)"/) || [])[1];
    const row = linhas.find(r => r.id === id);
    ['orc27-n1', 'orc27-ytd', 'orc27-total', 'orc27-var', 'orc27-pct'].forEach(cls => {
      assert.ok(!td(tr, cls).includes('<input'), cls + ' de ' + id + ' não é input');
    });
    const prev = td(tr, 'orc27-prev');
    const orc = td(tr, 'orc27-orc');
    if (row && row.editavel) {
      assert.ok(prev.includes('<input'), id + ' previsão');
      assert.ok(prev.includes('data-orc-campo="prevOutDez"'));
      assert.ok(orc.includes('<input'), id + ' orçamento');
      assert.ok(orc.includes('data-orc-campo="orcamento"'));
      inputs += 2;
    } else {
      assert.ok(!prev.includes('<input'), id + ' previsão calculada');
      assert.ok(!orc.includes('<input'), id + ' orçamento calculado');
    }
  });
  const canais = linhas.filter(r => r.tipo === 'canal').length;
  assert.ok(canais > 0);
  assert.equal(inputs, canais * 2);
  assert.ok(!vista.includes('data-orc-id="dfb" data-orc-campo'));
  assert.ok(!vista.includes('data-orc-id="dfb_inst" data-orc-campo'));
  assert.ok(!vista.includes('data-orc-id="total" data-orc-campo'));
  const fechado = ctx.orc27RenderHtml(false, linhas);
  assert.ok(!fechado.includes('<input'));
});

await check('Volume: canal tem cinco produtos editáveis; Todos os canais e a empresa não', () => {
  setUser('Marcio Gorga');
  const ag = { version: 1, meses: {} };
  const doc = { celulas: {} };
  const todos = ctx.vol27RenderHtml(ctx.orc27PodeEditar(), ag, doc, 'todos');
  assert.ok(!todos.includes('vol27-input'));
  assert.ok(!todos.includes('data-vol-campo'));
  const empresa = ctx.vol27RenderHtml(ctx.orc27PodeEditar(), ag, doc, 'dfb');
  assert.ok(!empresa.includes('vol27-input'));
  assert.ok(!empresa.includes('data-vol-campo'));
  const lojas = ctx.vol27RenderHtml(ctx.orc27PodeEditar(), ag, doc, 'dfb_lojas');
  const trs = lojas.split('<tr ').slice(1).filter(tr => tr.includes('data-vol-fam='));
  assert.equal(trs.length, 5);
  assert.ok(lojas.includes('data-vol-rodape="total"'));
  assert.ok(lojas.includes('data-vol-rodape="mapa"'));
  assert.ok(!lojas.split('data-vol-rodape="total"')[1].includes('<input'));
  trs.forEach(tr => {
    ['vol27-n1', 'vol27-ytd', 'vol27-total', 'vol27-var', 'vol27-pct'].forEach(cls => {
      assert.ok(!td(tr, cls).includes('<input'));
    });
    assert.ok(td(tr, 'vol27-prev').includes('<input'));
    assert.ok(td(tr, 'vol27-prev').includes('data-vol-campo="prevOutDez"'));
    assert.ok(td(tr, 'vol27-orc').includes('<input'));
    assert.ok(td(tr, 'vol27-orc').includes('data-vol-campo="orcamento"'));
  });
  assert.ok(lojas.includes('data-vol-fam="grao"'));
  assert.ok(lojas.includes('data-vol-fam="moido"'));
  assert.ok(lojas.includes('data-vol-fam="capsulas"'));
  assert.ok(lojas.includes('data-vol-fam="maquina"'));
  assert.ok(lojas.includes('data-vol-fam="vinho"'));
});

await later('vendedor grava Orç Valor na cloud sem apagar o resto do mapa', async () => {
  resetNuvem();
  setUser('Filipe Neves');
  ctx._orc27Doc = { version: 1, canais: {} };
  ctx._orc27Dirty = true;
  assert.equal(ctx.orc27Flush(), true);
  await ctx._orc27Fila;
  assert.equal(posts.length, 0, 'carga vazia não substitui o mapa');

  const antes = timers.length;
  ctx.orc27OnInput(el({ 'data-orc-id': 'dfb_lojas', 'data-orc-campo': 'prevOutDez' }, '1500'));
  assert.equal(ctx._orc27Doc.canais.dfb_lojas.prevOutDez, 1500);
  assert.equal(ctx._orc27Doc.canais.dfb_rest, undefined);
  assert.equal(ctx._orc27Dirty, true);
  assert.ok(timers.length > antes);
  assert.equal(timers[timers.length - 1].ms, 1000);
  ctx.orc27OnBlur(el({ 'data-orc-id': 'dfb_lojas', 'data-orc-campo': 'orcamento' }, '1800'));
  await ctx._orc27Fila;
  assert.equal(posts.length, 1);
  const body = posts[0].body;
  assert.equal(posts[0].kind, 'valor');
  assert.equal(body.actualizadoPor, 'Filipe Neves');
  assert.equal(body.canais.dfb_lojas.prevOutDez, 1500);
  assert.equal(body.canais.dfb_lojas.orcamento, 1800);
  assert.equal(body.canais.dfb_rest.prevOutDez, 50);
  assert.equal(body.canais.dfb_rest.orcamento, 80);

  await new Promise(resolve => setTimeout(resolve, 20));
  ctx.orc27OnBlur(el({ 'data-orc-id': 'dfb_lojas', 'data-orc-campo': 'orcamento' }, ''));
  await ctx._orc27Fila;
  const limpo = posts[posts.length - 1].body;
  assert.equal(limpo.canais.dfb_lojas.orcamento, null);
  assert.equal(limpo.canais.dfb_lojas.prevOutDez, 1500);
  assert.equal(limpo.canais.dfb_rest.prevOutDez, 50);
  assert.equal(limpo.canais.dfb_rest.orcamento, 80);
});

await later('vendedor grava Volume do canal sem apagar as outras células', async () => {
  resetNuvem();
  setUser('Massimo Bottello');
  ctx._vol27Doc = { version: 1, celulas: {} };
  ctx._vol27Filtro = 'todos';
  ctx._vol27Agregado = { version: 1, meses: {} };
  ctx.vol27OnInput(el({ 'data-vol-fam': 'grao', 'data-vol-campo': 'prevOutDez' }, '99'));
  assert.equal(ctx._vol27Dirty, false, 'Todos os canais não é folha');

  ctx._vol27Filtro = 'dfb_lojas';
  const antes = timers.length;
  ctx.vol27OnInput(el({ 'data-vol-fam': 'grao', 'data-vol-campo': 'prevOutDez' }, '12,5'));
  assert.equal(ctx._vol27Doc.celulas['dfb_lojas|grao'].prevOutDez, 12.5);
  assert.equal(ctx._vol27Dirty, true);
  assert.equal(timers[timers.length - 1].ms, 1000);
  assert.ok(timers.length > antes);
  ctx.vol27OnBlur(el({ 'data-vol-fam': 'grao', 'data-vol-campo': 'orcamento' }, '20'));
  await ctx._vol27Fila;
  const vols = posts.filter(p => p.kind === 'volume');
  assert.equal(vols.length, 1);
  const body = vols[0].body;
  assert.equal(body.actualizadoPor, 'Massimo Bottello');
  assert.equal(body.celulas['dfb_lojas|grao'].prevOutDez, 12.5);
  assert.equal(body.celulas['dfb_lojas|grao'].orcamento, 20);
  assert.equal(body.celulas['dfb_rest|capsulas'].prevOutDez, 30);
  assert.equal(body.celulas['dfb_rest|capsulas'].orcamento, 40);
});

await later('Hélcio não grava o orçamento nem o volume', async () => {
  resetNuvem();
  setUser('Hélcio Grégio');
  const antes = posts.length;
  ctx._orc27Doc = {
    version: 1,
    canais: {
      dfb_lojas: { prevOutDez: 1, cellTs: { prevOutDez: '2026-10-15T00:00:00.000Z' } },
    },
  };
  ctx._orc27Dirty = true;
  assert.equal(ctx.orc27Flush(), false);
  ctx.orc27OnInput(el({ 'data-orc-id': 'dfb_lojas', 'data-orc-campo': 'prevOutDez' }, '999'));
  assert.equal(ctx._orc27Doc.canais.dfb_lojas.prevOutDez, 1);
  ctx._vol27Filtro = 'dfb_lojas';
  ctx._vol27Doc = { version: 1, celulas: {} };
  ctx._vol27Dirty = true;
  assert.equal(ctx.vol27Flush(), false);
  ctx.vol27OnInput(el({ 'data-vol-fam': 'grao', 'data-vol-campo': 'prevOutDez' }, '7'));
  assert.equal(ctx._vol27Doc.celulas['dfb_lojas|grao'], undefined);
  await ctx._orc27Fila;
  await ctx._vol27Fila;
  assert.equal(posts.length, antes);
});

if (process.exitCode) {
  console.error('test-orcamento-vendedores: falhou');
  process.exit(process.exitCode);
}
console.log('test-orcamento-vendedores: ok');
