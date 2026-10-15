#!/usr/bin/env node
/**
 * Orçamento 2027 · Sazonalidade.
 * Jan–Set 2026 = Fatur. do mês. Out/Nov/Dez = Previsão Out a Dez ÷ 3 até alguém gravar.
 * A média (Jan+…+Set)/9 não é o defeito. 2027 começa pelos pesos e cada mês edita-se.
 * Um mês de 2027 escrito fica quando o 4.º trimestre muda. Dif 2027 = soma − orçamento.
 * Empresa e Institucional somam os filhos. Quem edita o Orç Valor edita estes meses.
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const CACHE = 'v2026-10-15-sazonalidade-editar';

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
  const start = src.indexOf(`const ${name} =`);
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

function perto(a, b, msg) {
  assert.ok(Math.abs(Number(a) - Number(b)) < 0.02, (msg || '') + ' ' + a + ' vs ' + b);
}

function cents(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const store = new Map();
const timers = [];
const posts = [];
let nuvem = { version: 1, canais: {} };
const hint = { style: {}, n: 0, _t: '' };
Object.defineProperty(hint, 'textContent', {
  get() { return this._t; },
  set(v) { this._t = v; this.n += 1; },
});

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
  console, Math, Number, String, Date, Object, Array, JSON, parseInt, isNaN,
  SUPA_KEY: 'test-key',
  document: {
    getElementById(id) { return id === 'orc27-autosave-hint' ? hint : null; },
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
    const method = (opts && opts.method) || 'GET';
    if (!u.includes('orcamento_2027_sazonalidade')) return Promise.resolve(jsonRes(404, {}));
    if (method === 'POST') {
      const body = JSON.parse(opts.body);
      posts.push(body);
      nuvem = body;
      return Promise.resolve(jsonRes(200, body));
    }
    return Promise.resolve(jsonRes(200, nuvem));
  },
};
vm.createContext(ctx);

for (const name of ['ADMINS', 'PREV_VENDAS_ACESSO', 'PREV_VENDAS_SO_CONSULTA']) {
  vm.runInContext(extractArrayConst(html, name), ctx);
}
for (const name of [
  'PV_SEED_AGOSTO_2026',
  'PV_MAPA_CANAL_VENDA',
  'PV_INST_BALCAO_CODS',
  'PV_INST_HORECA_CODS',
  'PV_INST_BALCAO_NOMES',
  'PV_INST_HORECA_NOMES',
  'SAZ27_LS_KEY',
  'SAZ27_FILTRO_LS',
  'SAZ27_CLOUD_PATH',
  'SAZ27_DEBOUNCE_MS',
  'SAZ27_MESES',
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
  'pvNormVendMapa',
  'pvCodNaCelulaVenda',
  'pvLadoInstitucionalCelula',
  'pvCentavosMapa',
  'pvMapaPadLeft',
  'pvTsMs',
  'pvParseNumInput',
  'npessDeCelulaExcel',
  'npessVendaIgnorado',
  'orc27Yms',
  'orc27PeriodoN1',
  'orc27PeriodoYtd',
  'orc27TemNumero',
  'orc27LinhasBase',
  'orc27IdFolha',
  'orc27CelulaDevolucao',
  'orc27SomarFaturYm',
  'orc27SomarPeriodo',
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
  'orc27FmtRs',
  'orc27FmtInput',
  'orc27Esc',
  'orc27EntradaPronta',
  'orc27SubNavHtml',
  'orc27CanaisDePayload',
  'orc27Flash',
  'saz27MesManual',
  'saz27DozeNulos',
  'saz27FaturMes',
  'saz27MesesReais',
  'saz27Media9',
  'saz27PrevisaoFolha',
  'saz27Partir3',
  'saz27PertoCent',
  'saz27TresIguaisAMedia',
  'saz27GuardadoEMediaAntiga',
  'saz27DefeitoMes',
  'saz27EstadoQ4',
  'saz27LerQ4',
  'saz27Distribuir2027',
  'saz27Mes2027',
  'saz27IdxMes',
  'saz27ChavesQ4',
  'saz27Chaves2027',
  'saz27CopiarBloco',
  'saz27MergeY2027',
  'saz27Misturar2027',
  'saz27AnoEl',
  'saz27PesoDoMes',
  'saz27SomarIdx',
  'saz27AplicarSomas',
  'saz27Montar',
  'saz27MergeCanais',
  'saz27LocalPrecisaNuvem',
  'saz27AplicarEdicao',
  'saz27ValorIgual',
  'saz27InputHtml',
  'saz27HtmlMes',
  'saz27HtmlTotal',
  'saz27HtmlDif',
  'saz27NomesCanal',
  'saz27NomeEmpresa',
  'saz27CurtoEmpresa',
  'saz27FolhasEmpresa',
  'saz27GruposFiltro',
  'saz27IdsFolha',
  'saz27FiltroValido',
  'saz27LerFiltro',
  'saz27FiltroActual',
  'saz27CanaisSeleccionados',
  'saz27GravarFiltro',
  'saz27Repintar',
  'saz27OnFiltroCanal',
  'saz27TirarCanal',
  'saz27LimparFiltro',
  'saz27RotuloChip',
  'saz27FiltroHtml',
  'saz27ClonarLinha',
  'saz27AcertarAlvoPais',
  'saz27LinhasVisiveis',
  'saz27LinhasVista',
  'saz27LinhasNoEcra',
  'saz27RenderHtml',
  'saz27CloudUrl',
  'saz27FetchCloud',
  'saz27Upload',
  'saz27EnviarCorpo',
  'saz27PedirNuvem',
  'saz27PatchCalculos',
  'saz27Agendar',
  'saz27Flush',
  'saz27OnInput',
  'saz27OnBlur',
];
for (const name of fns) vm.runInContext(extractFn(html, name), ctx);
vm.runInContext('function orc27QuadroActual(){ return _quadro; }', ctx);

function cel(empresa, canal, valor, extra) {
  return Object.assign({ empresa, canal, valor, vendedor: 'X', npess: 1 }, extra || {});
}

const quadro = { meses: {} };
function add(ym, key, cell) {
  if (!quadro.meses[ym]) quadro.meses[ym] = { celulas: {} };
  quadro.meses[ym].celulas[key] = cell;
}
for (let m = 1; m <= 9; m++) {
  add('2026-' + String(m).padStart(2, '0'), 'lojas', cel('Delta Foods Brasil', 'Lojas online', 10, { npess: 99520001 }));
}
add('2026-09', 'dev', cel('Delta Foods Brasil', 'Lojas online', 1000000, { npess: 99520099, vendedor: '99520099 - QBRASIL' }));
add('2026-10', 'lojas', cel('Delta Foods Brasil', 'Lojas online', 99999, { npess: 99520001 }));
add('2026-01', 'rest', cel('Delta Foods Brasil', 'Restauração', 100, { npess: 99520002 }));
add('2026-03', 'rest', cel('Delta Foods Brasil', 'Restauração', 50, { npess: 99520002 }));
add('2026-09', 'rest', cel('Delta Foods Brasil', 'Restauração', 25, { npess: 99520002 }));
add('2026-02', 'bal', cel('Delta Foods Brasil', 'Institucional', 9, { npess: 99520011, vendedor: 'MARCIO GORGA' }));
add('2026-10', 'bal', cel('Delta Foods Brasil', 'Institucional', 777, { npess: 99520011, vendedor: 'MARCIO GORGA' }));

const orc = {
  dfb: { prevOutDez: 999999, orcamento: 888888 },
  dfb_inst: { prevOutDez: 777777, orcamento: 666666 },
  dfb_lojas: { prevOutDez: 30, orcamento: 240 },
  dfb_rest: { orcamento: 300 },
  dfb_inst_balcao: { prevOutDez: 3, orcamento: 18 },
  qb_dist_reg: { orcamento: 80 },
};

ctx._quadro = quadro;
ctx._orc27Doc = { version: 1, canais: orc };
ctx._saz27Doc = { version: 1, canais: {} };
ctx._saz27Filtro = null;
ctx._saz27Dirty = false;
ctx._saz27Timer = null;
ctx._saz27CloudCache = null;
ctx._saz27CloudFetchedAt = 0;
ctx._saz27Fila = Promise.resolve();
ctx._orc27HintTimer = null;
ctx._pvView = 'orcamento';
ctx._orc27Sub = 'sazonalidade';

function byId(linhas) {
  const map = {};
  linhas.forEach(r => { map[r.id] = r; });
  return map;
}

function folhasSob(linhas, id) {
  const out = [];
  function walk(pid) {
    linhas.forEach(r => {
      if (!r || r.parent !== pid) return;
      if (r.tipo === 'canal') out.push(r);
      else walk(r.id);
    });
  }
  walk(id);
  return out;
}

function trDe(vista, id, ano) {
  const parts = vista.split('<tr ').slice(1);
  return parts.find(t => t.includes('data-saz-id="' + id + '"') && t.includes('data-saz-ano="' + ano + '"')) || '';
}

function tdMes(vista, id, ano, mes) {
  const tr = trDe(vista, id, ano);
  const m = tr.match(new RegExp('data-saz-mes="' + mes + '"[^>]*>([\\s\\S]*?)</td>'));
  return m ? m[1] : '';
}

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

const VENDEDORES = ['Filipe Neves', 'Diogo Oliveira', 'Marcio Gorga', 'Massimo Bottello'];

check('Jan–Set são o Fatur. de cada mês; Outubro e 99520099 ficam de fora', () => {
  assert.equal(vm.runInContext('SAZ27_DEBOUNCE_MS', ctx), 1000);
  assert.equal(vm.runInContext('SAZ27_CLOUD_PATH', ctx), 'previsao/orcamento_2027_sazonalidade.json');
  assert.ok(sw.includes(CACHE));
  assert.ok(html.includes(CACHE));
  assert.ok(html.includes('id="orc27-sub-sazonalidade"'));
  assert.ok(html.includes('>Sazonalidade</button>'));
  assert.ok(extractFn(html, 'saz27OnInput').includes('orc27PodeEditar'));
  assert.ok(!extractFn(html, 'saz27OnInput').includes('pvPodeEditar'));
  assert.ok(extractFn(html, 'pvOnCampoInput').includes('pvPodeEditar'));

  const linhas = ctx.saz27Montar(quadro, orc, {});
  assert.equal(quadro.meses['2026-10'].celulas.lojas.valor, 99999);
  assert.equal(quadro.meses['2026-09'].celulas.dev.valor, 1000000);
  const map = byId(linhas);
  const lojas = map.dfb_lojas;
  assert.deepEqual(lojas.m2026.slice(0, 9), [10, 10, 10, 10, 10, 10, 10, 10, 10]);
  assert.notEqual(lojas.m2026[9], 99999);
  const rest = map.dfb_rest;
  assert.equal(rest.m2026[0], 100);
  assert.equal(rest.m2026[1], 0);
  assert.equal(rest.m2026[2], 50);
  assert.equal(rest.m2026[3], 0);
  assert.equal(rest.m2026[8], 25);
  assert.equal(map.dfb_inst_balcao.m2026[1], 9);
  assert.equal(map.dfb_inst_balcao.m2026[9], 1);
  assert.equal(map.dfb_inst_balcao.m2026[10], 1);
  assert.equal(map.dfb_inst_balcao.m2026[11], 1);
  assert.notEqual(map.dfb_inst_balcao.m2026[9], 777);
  assert.ok(html.includes('id="orc27-btn-excel"'));
  assert.ok(extractFn(html, 'orc27SubNavHtml').includes('orc27ExportarExcel'));
  assert.ok(extractFn(html, 'saz27RenderHtml').includes('saz27FiltroHtml'));
  assert.deepEqual(linhas.map(r => r.id), ctx.orc27LinhasBase().map(r => r.id));
});

check('Out, Nov e Dez por defeito são a Previsão Out a Dez ÷ 3, não a média de Jan–Set', () => {
  ctx._saz27Filtro = [];
  const linhas = ctx.saz27Montar(quadro, orc, {});
  const map = byId(linhas);
  const lojas = map.dfb_lojas;
  assert.equal(lojas.media, 10);
  assert.equal(lojas.q4.out.gravado, false);
  assert.equal(lojas.m2026[9], 10);
  assert.equal(lojas.m2026[10], 10);
  assert.equal(lojas.m2026[11], 10);
  assert.equal(cents(lojas.m2026[9] + lojas.m2026[10] + lojas.m2026[11]), 30);
  assert.equal(lojas.totalSaz2026, 120);
  assert.equal(lojas.total2026, 120);
  assert.equal(lojas.dif2026, 0);
  assert.equal(lojas.dif2027, 0);
  assert.equal(lojas.totalSaz2027, 240);

  const rest = map.dfb_rest;
  const media = cents(175 / 9);
  assert.equal(media, 19.44);
  assert.equal(rest.media, media);
  assert.equal(rest.q4.out.vazio, true);
  assert.equal(rest.q4.nov.gravado, false);
  assert.equal(rest.m2026[9], 0);
  assert.equal(rest.m2026[10], 0);
  assert.equal(rest.m2026[11], 0);
  assert.notEqual(rest.m2026[9], media);
  assert.equal(rest.totalSaz2026, 175);
  assert.equal(rest.total2026, 175);
  assert.equal(rest.dif2026, 0);

  const balcao = map.dfb_inst_balcao;
  assert.equal(cents(balcao.m2026[9] + balcao.m2026[10] + balcao.m2026[11]), 3);
  assert.equal(balcao.dif2026, 0);

  const vista = ctx.saz27RenderHtml(true, linhas);
  assert.ok(tdMes(vista, 'dfb_lojas', '2026', 'out').includes('value="10"'));
  const novRest = tdMes(vista, 'dfb_rest', '2026', 'nov');
  assert.ok(novRest.includes('value=""'));
  assert.ok(!novRest.includes('19,44'));
  assert.ok(vista.includes('id="orc27-btn-excel"'));
  assert.ok(vista.includes('id="saz27-filtro"'));
  assert.ok(vista.includes('>Sazonalidade</button>'));
  assert.ok(vista.includes('>Dif</th>'));
  assert.ok(vista.includes('>Jan</th>'));
  assert.ok(vista.includes('>Dez</th>'));
});

check('previsão que não divide por 3: cêntimos em Dezembro, soma exacta, Dif 2026 = 0', () => {
  ctx._saz27Filtro = [];
  const orc2 = JSON.parse(JSON.stringify(orc));
  orc2.dfb_rest = { prevOutDez: 10, orcamento: 300 };
  const linhas = ctx.saz27Montar(quadro, orc2, {});
  const rest = byId(linhas).dfb_rest;
  assert.equal(rest.media, 19.44);
  assert.equal(rest.m2026[9], 3.33);
  assert.equal(rest.m2026[10], 3.33);
  assert.equal(rest.m2026[11], 3.34);
  assert.notEqual(rest.m2026[9], rest.media);
  assert.equal(cents(rest.m2026[9] + rest.m2026[10] + rest.m2026[11]), 10);
  assert.equal(rest.totalSaz2026, cents(175 + 10));
  assert.equal(rest.total2026, cents(175 + 10));
  assert.equal(rest.dif2026, 0);
  assert.equal(rest.totalSaz2027, 300);
  assert.equal(rest.dif2027, 0);
  const vista = ctx.saz27RenderHtml(true, linhas);
  assert.ok(tdMes(vista, 'dfb_rest', '2026', 'out').includes('value="3,33"'));
  assert.ok(tdMes(vista, 'dfb_rest', '2026', 'dez').includes('value="3,34"'));
});

check('média antiga gravada não ganha; um mês escrito fica; o vazio explícito conta 0', () => {
  const orc2 = JSON.parse(JSON.stringify(orc));
  orc2.dfb_rest = { prevOutDez: 10, orcamento: 300 };
  const media = 19.44;
  const ts = '2026-10-01T00:00:00.000Z';
  let rest = byId(ctx.saz27Montar(quadro, orc2, {
    dfb_rest: { out: media, nov: media, dez: 19.45, cellTs: { out: ts, nov: ts, dez: ts } },
  })).dfb_rest;
  assert.equal(rest.q4.out.gravado, false);
  assert.equal(rest.q4.dez.gravado, false);
  assert.equal(rest.m2026[9], 3.33);
  assert.equal(rest.m2026[10], 3.33);
  assert.equal(rest.m2026[11], 3.34);
  assert.equal(rest.dif2026, 0);

  rest = byId(ctx.saz27Montar(quadro, orc2, {
    dfb_rest: { out: media, nov: media, dez: media, cellTs: { out: ts, nov: ts, dez: ts } },
  })).dfb_rest;
  assert.equal(rest.m2026[11], 3.34);
  assert.equal(rest.q4.nov.gravado, false);

  rest = byId(ctx.saz27Montar(quadro, orc2, {
    dfb_rest: { out: 40, nov: media, dez: media, cellTs: { out: ts, nov: ts, dez: ts } },
  })).dfb_rest;
  assert.equal(rest.m2026[9], 40);
  assert.equal(rest.q4.out.gravado, true);
  assert.notEqual(rest.m2026[9], rest.media);
  assert.equal(rest.m2026[10], 3.33);
  assert.equal(rest.m2026[11], 3.34);

  rest = byId(ctx.saz27Montar(quadro, orc2, {
    dfb_rest: { out: 50, nov: 50, dez: 50, cellTs: { out: ts, nov: ts, dez: ts } },
  })).dfb_rest;
  assert.equal(rest.m2026[9], 50);
  assert.equal(rest.m2026[10], 50);
  assert.equal(rest.m2026[11], 50);
  assert.equal(rest.q4.dez.gravado, true);

  rest = byId(ctx.saz27Montar(quadro, orc2, {
    dfb_rest: { out: null, cellTs: { out: ts } },
  })).dfb_rest;
  assert.equal(rest.q4.out.vazio, true);
  assert.equal(rest.q4.out.gravado, true);
  assert.equal(rest.m2026[9], 0);
  assert.equal(rest.m2026[10], 3.33);
  assert.equal(rest.m2026[11], 3.34);

  const escrito = ctx.saz27AplicarEdicao({ canais: {} }, 'dfb_rest', 'out', 40, ts).doc;
  assert.equal(escrito.canais.dfb_rest.out, 40);
  rest = byId(ctx.saz27Montar(quadro, orc2, escrito.canais)).dfb_rest;
  assert.equal(rest.m2026[9], 40);
  assert.equal(rest.q4.out.gravado, true);
  assert.equal(rest.m2026[10], 3.33);
  assert.notEqual(40, rest.media);

  ctx._saz27Filtro = [];
  ctx._orc27Doc = { version: 1, canais: orc2 };
  ctx._saz27Doc = { version: 1, canais: {} };
  ctx._saz27Dirty = false;
  setUser('Filipe Neves');
  ctx.saz27OnBlur(el({ 'data-saz-id': 'dfb_rest', 'data-saz-mes': 'out' }, '3,33'));
  assert.equal(ctx._saz27Doc.canais.dfb_rest, undefined);
  assert.equal(ctx._saz27Dirty, false);

  const mediaEscrita = ctx.saz27AplicarEdicao({ canais: {} }, 'dfb_rest', 'dez', media, ts).doc;
  assert.equal(mediaEscrita.canais.dfb_rest.dez, media);
  rest = byId(ctx.saz27Montar(quadro, orc2, mediaEscrita.canais)).dfb_rest;
  assert.equal(rest.m2026[11], 3.34);
  assert.equal(rest.q4.dez.gravado, false);

  ctx._orc27Doc = { version: 1, canais: orc };
  ctx._saz27Doc = { version: 1, canais: {} };
  ctx._saz27Dirty = false;
  ctx._saz27Filtro = [];
});

check('um Out escrito substitui a previsão ÷ 3 e não volta; o vazio explícito conta 0', () => {
  let doc = { canais: {} };
  let r = ctx.saz27AplicarEdicao(doc, 'dfb_lojas', 'out', 40, '2026-10-15T12:00:00.000Z');
  assert.equal(r.changed, true);
  doc = r.doc;
  const ts = doc.canais.dfb_lojas.cellTs.out;
  r = ctx.saz27AplicarEdicao(doc, 'dfb_lojas', 'out', 40, '2026-10-15T13:00:00.000Z');
  assert.equal(r.changed, false);
  assert.equal(doc.canais.dfb_lojas.cellTs.out, ts);
  r = ctx.saz27AplicarEdicao(doc, 'dfb_lojas', 'jan', 5, '2026-10-15T13:00:00.000Z');
  assert.equal(r.changed, false);
  r = ctx.saz27AplicarEdicao(doc, 'dfb', 'out', 5, '2026-10-15T13:00:00.000Z');
  assert.equal(r.changed, false);
  assert.equal(doc.canais.dfb, undefined);

  let linhas = ctx.saz27Montar(quadro, orc, doc.canais);
  let lojas = byId(linhas).dfb_lojas;
  assert.equal(lojas.m2026[9], 40);
  assert.equal(lojas.m2026[10], 10);
  assert.equal(lojas.m2026[11], 10);
  assert.equal(lojas.q4.out.gravado, true);
  linhas = ctx.saz27Montar(quadro, orc, doc.canais);
  assert.equal(byId(linhas).dfb_lojas.m2026[9], 40);

  r = ctx.saz27AplicarEdicao(doc, 'dfb_lojas', 'nov', null, '2026-10-15T14:00:00.000Z');
  assert.equal(r.changed, true);
  doc = r.doc;
  assert.equal(doc.canais.dfb_lojas.nov, null);
  assert.equal(doc.canais.dfb_lojas.out, 40);
  r = ctx.saz27AplicarEdicao(doc, 'dfb_lojas', 'nov', null, '2026-10-15T15:00:00.000Z');
  assert.equal(r.changed, false);
  linhas = ctx.saz27Montar(quadro, orc, doc.canais);
  lojas = byId(linhas).dfb_lojas;
  assert.equal(lojas.q4.nov.vazio, true);
  assert.equal(lojas.m2026[10], 0);
  assert.equal(lojas.m2026[9], 40);
  assert.equal(lojas.m2026[11], 10);
  linhas = ctx.saz27Montar(quadro, orc, doc.canais);
  assert.equal(byId(linhas).dfb_lojas.m2026[10], 0);

  const vista = ctx.saz27RenderHtml(true, linhas);
  const nov = tdMes(vista, 'dfb_lojas', '2026', 'nov');
  assert.ok(nov.includes('<input'));
  assert.ok(nov.includes('value=""'));
  assert.ok(!nov.includes('value="10"'));
});

check('2027 segue os pesos, Dezembro acerta os cêntimos, e a Dif 2026 é a folga do Orç Valor', () => {
  let doc = { canais: {} };
  const r = ctx.saz27AplicarEdicao(doc, 'dfb_lojas', 'out', 40, '2026-10-15T12:00:00.000Z');
  doc = r.doc;
  const linhas = ctx.saz27Montar(quadro, orc, doc.canais);
  const lojas = byId(linhas).dfb_lojas;
  assert.equal(lojas.totalSaz2026, 150);
  assert.equal(lojas.total2026, 120);
  assert.equal(lojas.dif2026, 30);
  assert.equal(lojas.dif2026, cents(lojas.totalSaz2026 - lojas.total2026));

  const alvo = 240;
  const soma = lojas.totalSaz2026;
  const esp = [];
  let acc = 0;
  for (let i = 0; i < 11; i++) {
    const p = cents(alvo * (lojas.m2026[i] / soma));
    esp.push(p);
    acc = cents(acc + p);
  }
  esp.push(cents(alvo - acc));
  assert.deepEqual(lojas.m2027, esp);
  assert.equal(esp[0], 16);
  assert.equal(esp[9], 64);
  assert.equal(lojas.totalSaz2027, 240);
  assert.equal(lojas.dif2027, 0);
  assert.notEqual(lojas.m2027[0], 20);

  const rest = byId(linhas).dfb_rest;
  assert.equal(rest.tem2027, true);
  assert.equal(rest.totalSaz2027, 300);
  assert.equal(rest.dif2027, 0);
  let somaRest = 0;
  rest.m2027.forEach(v => { somaRest = cents(somaRest + v); });
  assert.equal(somaRest, 300);

  const semPeso = byId(linhas).qb_dist_reg;
  assert.equal(semPeso.totalSaz2026, 0);
  assert.equal(semPeso.tem2027, false);
  assert.equal(semPeso.dif2027, null);
  semPeso.m2027.forEach(v => assert.equal(v, null));

  const semOrc = byId(linhas).qb_ret_mod;
  assert.equal(semOrc.orcamento, null);
  assert.equal(semOrc.tem2027, false);
  assert.equal(semOrc.dif2027, null);

  const vista = ctx.saz27RenderHtml(true, linhas);
  const difHtml = tdMes(vista, 'dfb_lojas', '2026', 'dif');
  assert.ok(difHtml.includes('30'), difHtml);
  assert.ok(!difHtml.includes('<input'));
  assert.ok(tdMes(vista, 'qb_dist_reg', '2027', 'jan').includes('—'));
  assert.ok(tdMes(vista, 'qb_dist_reg', '2027', 'dif').includes('—'));
  assert.ok(tdMes(vista, 'qb_ret_mod', '2027', 'dez').includes('—'));
  assert.ok(tdMes(vista, 'dfb_lojas', '2027', 'total').includes('240'));
  const fechado = ctx.saz27Montar(quadro, orc, { dfb_lojas: { out: 0, cellTs: { out: '2026-10-15T12:00:00.000Z' } } });
  const neg = ctx.saz27RenderHtml(false, fechado);
  assert.ok(tdMes(neg, 'dfb_lojas', '2026', 'dif').includes('#b91c1c'));
});

check('a empresa e o Institucional são a soma dos filhos, mês a mês', () => {
  const doc = ctx.saz27AplicarEdicao({ canais: {} }, 'dfb_lojas', 'out', 40, '2026-10-15T12:00:00.000Z').doc;
  const linhas = ctx.saz27Montar(quadro, orc, doc.canais);
  const map = byId(linhas);
  assert.equal(map.dfb.orcamento, 240 + 300 + 18);
  assert.notEqual(map.dfb.orcamento, 888888);
  assert.equal(map.dfb_inst.orcamento, 18);
  assert.notEqual(map.dfb_inst.orcamento, 666666);

  function somaMes(rows, campo, i) {
    let s = 0;
    let any = false;
    rows.forEach(r => {
      if (!r[campo] || !ctx.orc27TemNumero(r[campo][i])) return;
      any = true;
      s += Number(r[campo][i]);
    });
    return any ? cents(s) : null;
  }
  const instFolhas = folhasSob(linhas, 'dfb_inst');
  const dfbFolhas = folhasSob(linhas, 'dfb');
  assert.deepEqual(instFolhas.map(r => r.id).sort(), ['dfb_inst_balcao', 'dfb_inst_horeca']);
  for (let i = 0; i < 12; i++) {
    assert.equal(map.dfb_inst.m2026[i], somaMes(instFolhas, 'm2026', i), 'inst 2026 ' + i);
    assert.equal(map.dfb.m2026[i], somaMes(dfbFolhas, 'm2026', i), 'dfb 2026 ' + i);
    assert.equal(map.dfb.m2027[i], somaMes(dfbFolhas.filter(r => r.tem2027), 'm2027', i), 'dfb 2027 ' + i);
  }
  assert.equal(map.dfb_inst.m2026[1], 9);
  assert.equal(map.dfb_inst.m2026[9], 1);
  assert.equal(map.dfb.m2026[9], cents(40 + 1));
  assert.equal(map.dfb.dif2027, 0);
  assert.equal(map.dfb.totalSaz2027, map.dfb.orcamento);
  assert.equal(map.total.m2026[0], cents(map.dfb.m2026[0] + map.qb.m2026[0]));

  const vista = ctx.saz27RenderHtml(true, linhas);
  assert.ok(!trDe(vista, 'dfb', '2026').includes('<input'));
  assert.ok(!trDe(vista, 'dfb_inst', '2026').includes('<input'));
  assert.ok(!trDe(vista, 'total', '2027').includes('<input'));
  assert.ok(!tdMes(vista, 'dfb', '2026', 'out').includes('<input'));
});

check('o vendedor edita Out/Nov/Dez; célula calculada, empresa e mapa não', () => {
  VENDEDORES.forEach(nome => {
    setUser(nome);
    assert.equal(ctx.podeAcederPrevisaoVendas(), true, nome);
    assert.equal(ctx.orc27PodeEditar(), true, nome);
    assert.equal(ctx.pvPodeEditar(), false, nome + ' mapa');
  });
  setUser('Filipe Neves');
  const linhas = ctx.saz27Montar(quadro, orc, {});
  const vista = ctx.saz27RenderHtml(ctx.orc27PodeEditar(), linhas);
  const canais = linhas.filter(r => r.tipo === 'canal');
  let inputs = 0;
  canais.forEach(row => {
    ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'total', 'dif'].forEach(mes => {
      assert.ok(!tdMes(vista, row.id, '2026', mes).includes('<input'), row.id + ' ' + mes);
    });
    ['out', 'nov', 'dez'].forEach(mes => {
      const celula = tdMes(vista, row.id, '2026', mes);
      assert.ok(celula.includes('<input'), row.id + ' ' + mes);
      assert.ok(celula.includes('data-saz-ano="2026"'));
      assert.ok(celula.includes('data-saz-mes="' + mes + '"'));
      inputs += 1;
    });
    ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'].forEach(mes => {
      const celula = tdMes(vista, row.id, '2027', mes);
      assert.ok(celula.includes('<input'), row.id + ' 2027 ' + mes);
      assert.ok(celula.includes('data-saz-ano="2027"'));
      inputs += 1;
    });
  });
  assert.equal(inputs, canais.length * 15);
  assert.ok(!trDe(vista, 'dfb', '2026').includes('<input'));
  assert.ok(!trDe(vista, 'dfb', '2027').includes('<input'));
  assert.ok(!trDe(vista, 'dfb_inst', '2026').includes('<input'));
  assert.ok(!trDe(vista, 'dfb_inst', '2027').includes('<input'));
  assert.ok(!trDe(vista, 'qb', '2026').includes('<input'));
  assert.ok(!trDe(vista, 'qb', '2027').includes('<input'));
  assert.ok(!trDe(vista, 'total', '2026').includes('<input'));
  assert.ok(!trDe(vista, 'total', '2027').includes('<input'));
  const fechado = ctx.saz27RenderHtml(false, linhas);
  assert.ok(!fechado.includes('saz27-input'));
  assert.ok(fechado.includes('type="checkbox"'));

  ctx._saz27Doc = { version: 1, canais: {} };
  ctx._saz27Dirty = false;
  ctx.saz27OnInput(el({ 'data-saz-id': 'dfb_lojas', 'data-saz-mes': 'jan' }, '99'));
  assert.equal(ctx._saz27Doc.canais.dfb_lojas, undefined);
  ctx.saz27OnInput(el({ 'data-saz-id': 'dfb', 'data-saz-mes': 'out' }, '99'));
  assert.equal(ctx._saz27Doc.canais.dfb, undefined);
  ctx.saz27OnInput(el({ 'data-saz-id': 'dfb_lojas', 'data-saz-mes': 'out' }, '40'));
  assert.equal(ctx._saz27Doc.canais.dfb_lojas.out, 40);
  const vivo = ctx.saz27Montar(quadro, orc, ctx._saz27Doc.canais);
  assert.equal(byId(vivo).dfb_lojas.m2027[9], 64);

  setUser('Hélcio Grégio');
  const antes = ctx._saz27Doc.canais.dfb_lojas.out;
  ctx._saz27Dirty = false;
  ctx.saz27OnInput(el({ 'data-saz-id': 'dfb_lojas', 'data-saz-mes': 'out' }, '1'));
  assert.equal(ctx._saz27Doc.canais.dfb_lojas.out, antes);
  assert.equal(ctx.saz27Flush(), false);
});

check('2027 escrito fica quando o 4.º trimestre muda; a Dif é soma − orçamento; o defeito ÷ 3 não se grava', () => {
  setUser('Massimo Bottello');
  assert.equal(ctx.orc27PodeEditar(), true);
  assert.equal(ctx.pvPodeEditar(), false);
  ctx._orc27Doc = { version: 1, canais: orc };
  ctx._saz27Doc = { version: 1, canais: {} };
  ctx._saz27Dirty = false;
  ctx._saz27Filtro = [];

  const base = byId(ctx.saz27Montar(quadro, orc, {}));
  assert.equal(base.dfb_lojas.m2026[9], 10);
  assert.equal(base.dfb_lojas.m2026[10], 10);
  assert.equal(base.dfb_lojas.m2026[11], 10);
  assert.equal(cents(base.dfb_lojas.m2026[9] + base.dfb_lojas.m2026[10] + base.dfb_lojas.m2026[11]), 30);
  assert.notEqual(base.dfb_rest.m2026[9], base.dfb_rest.media);
  assert.equal(base.dfb_lojas.dif2027, 0);
  assert.equal(base.dfb_lojas.totalSaz2027, 240);
  assert.equal(base.dfb_lojas.m2027[1], 20);

  const vista = ctx.saz27RenderHtml(true, ctx.saz27Montar(quadro, orc, {}));
  ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set'].forEach(mes => {
    assert.ok(!tdMes(vista, 'dfb_lojas', '2026', mes).includes('<input'), mes);
  });
  assert.ok(tdMes(vista, 'dfb_lojas', '2026', 'out').includes('<input'));
  assert.ok(tdMes(vista, 'dfb_lojas', '2026', 'out').includes('data-saz-ano="2026"'));
  ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'].forEach(mes => {
    const celula = tdMes(vista, 'dfb_lojas', '2027', mes);
    assert.ok(celula.includes('<input'), mes);
    assert.ok(celula.includes('data-saz-ano="2027"'));
  });
  assert.ok(!trDe(vista, 'dfb', '2027').includes('<input'));
  assert.ok(!trDe(vista, 'dfb_inst', '2027').includes('<input'));
  assert.ok(!trDe(vista, 'total', '2027').includes('<input'));

  ctx.saz27OnBlur(el({ 'data-saz-id': 'dfb_lojas', 'data-saz-mes': 'fev', 'data-saz-ano': '2027' }, '20'));
  assert.equal(ctx._saz27Doc.canais.dfb_lojas, undefined);

  ctx.saz27OnInput(el({ 'data-saz-id': 'dfb_lojas', 'data-saz-mes': 'jan', 'data-saz-ano': '2027' }, '99'));
  assert.equal(ctx._saz27Doc.canais.dfb_lojas.y2027.jan, 99);
  assert.equal(ctx._saz27Doc.canais.dfb_lojas.y2027.fev, undefined);
  assert.equal(ctx._saz27Doc.canais.dfb_lojas.out, undefined);

  ctx.saz27OnInput(el({ 'data-saz-id': 'dfb_lojas', 'data-saz-mes': 'out', 'data-saz-ano': '2026' }, '40'));
  assert.equal(ctx._saz27Doc.canais.dfb_lojas.out, 40);
  assert.equal(ctx._saz27Doc.canais.dfb_lojas.y2027.jan, 99);

  const lojas = byId(ctx.saz27Montar(quadro, orc, ctx._saz27Doc.canais)).dfb_lojas;
  assert.equal(lojas.m2026[9], 40);
  assert.equal(lojas.m2027[0], 99);
  assert.equal(lojas.y2027[0].gravado, true);
  const fevEsp = cents(240 * (lojas.m2026[1] / lojas.totalSaz2026));
  assert.equal(lojas.m2027[1], fevEsp);
  assert.notEqual(lojas.m2027[1], 99);
  assert.equal(lojas.y2027[1].gravado, false);
  let soma27 = 0;
  lojas.m2027.forEach(v => { soma27 = cents(soma27 + v); });
  assert.equal(lojas.totalSaz2027, soma27);
  assert.equal(lojas.dif2027, cents(soma27 - lojas.orcamento));
  assert.notEqual(lojas.dif2027, 0);
  const vivo = ctx.saz27Montar(quadro, orc, ctx._saz27Doc.canais);
  const dif = tdMes(ctx.saz27RenderHtml(true, vivo), 'dfb_lojas', '2027', 'dif');
  assert.equal(dif, ctx.orc27FmtRs(lojas.dif2027, true));
  assert.ok(!dif.includes('—'));

  const limpou = ctx.saz27AplicarEdicao(ctx._saz27Doc, 'dfb_lojas', 'mar', null, '2026-10-15T12:02:00.000Z', '2027');
  assert.equal(limpou.changed, true);
  ctx._saz27Doc = limpou.doc;
  const limpo = byId(ctx.saz27Montar(quadro, orc, ctx._saz27Doc.canais)).dfb_lojas;
  assert.equal(limpo.y2027[2].vazio, true);
  assert.equal(limpo.y2027[2].gravado, true);
  assert.equal(limpo.m2027[2], 0);
  assert.equal(limpo.m2027[0], 99);
  const mar = tdMes(ctx.saz27RenderHtml(true, ctx.saz27Montar(quadro, orc, ctx._saz27Doc.canais)), 'dfb_lojas', '2027', 'mar');
  assert.ok(mar.includes('value=""'));
  assert.equal(limpo.dif2027, cents(limpo.totalSaz2027 - limpo.orcamento));
  assert.notEqual(limpo.dif2027, 0);

  const reaberto = byId(ctx.saz27Montar(quadro, orc, JSON.parse(JSON.stringify(ctx._saz27Doc.canais)))).dfb_lojas;
  assert.equal(reaberto.m2027[0], 99);
  assert.equal(ctx._saz27Doc.canais.dfb_lojas.y2027.fev, undefined);
  assert.notEqual(reaberto.m2027[0], cents(240 * (reaberto.m2026[0] / reaberto.totalSaz2026)));

  const linhas = ctx.saz27Montar(quadro, orc, ctx._saz27Doc.canais);
  const map = byId(linhas);
  let somaJan = 0;
  let algum = false;
  folhasSob(linhas, 'dfb').forEach(r => {
    if (!r.m2027 || !ctx.orc27TemNumero(r.m2027[0])) return;
    algum = true;
    somaJan += Number(r.m2027[0]);
  });
  assert.equal(algum, true);
  assert.equal(map.dfb.m2027[0], cents(somaJan));
  assert.ok(!trDe(ctx.saz27RenderHtml(true, linhas), 'dfb', '2027').includes('<input'));
  assert.ok(!trDe(ctx.saz27RenderHtml(true, linhas), 'dfb_inst', '2027').includes('<input'));

  const merged = ctx.saz27MergeCanais({
    dfb_lojas: {
      out: 40,
      cellTs: { out: '2026-10-02T00:00:00.000Z' },
      y2027: { jan: 99, cellTs: { jan: '2026-10-03T00:00:00.000Z' } },
    },
  }, {
    dfb_lojas: {
      out: 1,
      nov: 2,
      cellTs: { out: '2026-10-01T00:00:00.000Z', nov: '2026-10-04T00:00:00.000Z' },
      y2027: { jan: 5, fev: 8, cellTs: { jan: '2026-10-01T00:00:00.000Z', fev: '2026-10-05T00:00:00.000Z' } },
    },
  });
  assert.equal(merged.dfb_lojas.out, 40);
  assert.equal(merged.dfb_lojas.nov, 2);
  assert.equal(merged.dfb_lojas.y2027.jan, 99);
  assert.equal(merged.dfb_lojas.y2027.fev, 8);

  let doc = ctx.saz27AplicarEdicao({ canais: {} }, 'dfb_lojas', 'jan', 5, '2026-10-15T12:00:00.000Z').doc;
  assert.equal(doc.canais.dfb_lojas, undefined);
  doc = ctx.saz27AplicarEdicao({ canais: {} }, 'dfb_lojas', 'jan', 99, '2026-10-15T12:00:00.000Z', '2027').doc;
  doc = ctx.saz27AplicarEdicao(doc, 'dfb_lojas', 'out', 40, '2026-10-15T12:01:00.000Z').doc;
  assert.equal(doc.canais.dfb_lojas.out, 40);
  assert.equal(doc.canais.dfb_lojas.y2027.jan, 99);

  setUser('Hélcio Grégio');
  const janAntes = ctx._saz27Doc.canais.dfb_lojas.y2027.jan;
  ctx.saz27OnInput(el({ 'data-saz-id': 'dfb_lojas', 'data-saz-mes': 'fev', 'data-saz-ano': '2027' }, '1'));
  assert.equal(ctx._saz27Doc.canais.dfb_lojas.y2027.jan, janAntes);
  assert.equal(ctx._saz27Doc.canais.dfb_lojas.y2027.fev, undefined);

  setUser('Filipe Neves');
  ctx._saz27Doc = { version: 1, canais: {} };
  ctx._saz27Dirty = false;
  ctx._orc27Doc = { version: 1, canais: orc };
});

check('filtro de canal: dois canais, pais só com esses filhos, limpar volta ao quadro', () => {
  const filtroLs = vm.runInContext('SAZ27_FILTRO_LS', ctx);
  const docLs = vm.runInContext('SAZ27_LS_KEY', ctx);
  assert.equal(filtroLs, 'dfb_orcamento_2027_sazonalidade_filtro_v1');
  assert.notEqual(filtroLs, docLs);
  assert.ok(extractFn(html, 'vol27RenderHtml').includes('id="vol27-filtro"'));
  assert.ok(!extractFn(html, 'vol27RenderHtml').includes('multiple'));
  assert.ok(!extractFn(html, 'vol27RenderHtml').includes('saz27'));
  assert.ok(!extractFn(html, 'orc27RenderHtml').includes('saz27-filtro'));
  assert.ok(!extractFn(html, 'saz27EnviarCorpo').includes('SAZ27_FILTRO_LS'));
  assert.ok(!extractFn(html, 'saz27Flush').includes('SAZ27_FILTRO_LS'));
  assert.ok(!extractFn(html, 'saz27GravarFiltro').includes('SAZ27_LS_KEY'));
  assert.ok(!extractFn(html, 'saz27GravarFiltro').includes('_saz27Dirty'));

  const grupos = ctx.saz27GruposFiltro();
  assert.deepEqual(grupos.map(g => g.nome), ['Delta Foods Brasil', 'Q Brasil']);
  assert.deepEqual(grupos[0].canais.map(c => c.nome), [
    'Lojas online', 'Distribuidores regionais', 'Restauração', 'Distribuidores de retalho',
    'Retalho moderno', 'Site próprio', 'Institucional Balcão', 'Institucional Horeca',
  ]);
  assert.deepEqual(grupos[1].canais.map(c => c.nome), [
    'Retalho moderno', 'Distribuidores de retalho', 'Restauração', 'Distribuidores regionais',
  ]);

  const todas = ctx.saz27Montar(quadro, orc, {});
  const full = byId(todas);
  const vis = ctx.saz27LinhasVisiveis(todas, ['dfb_rest', 'dfb_lojas']);
  assert.deepEqual(vis.map(r => r.id), ['dfb', 'dfb_lojas', 'dfb_rest', 'total']);
  const map = byId(vis);
  assert.equal(map.dfb_lojas.total2026, full.dfb_lojas.total2026);
  assert.equal(map.dfb_lojas.orcamento, full.dfb_lojas.orcamento);
  assert.equal(map.dfb_lojas.dif2026, full.dfb_lojas.dif2026);
  assert.equal(map.dfb_lojas.dif2027, full.dfb_lojas.dif2027);
  assert.equal(map.dfb_lojas.dif2026, cents(map.dfb_lojas.totalSaz2026 - map.dfb_lojas.total2026));
  assert.equal(map.dfb_rest.dif2026, full.dfb_rest.dif2026);
  assert.equal(map.dfb.m2026[0], cents(map.dfb_lojas.m2026[0] + map.dfb_rest.m2026[0]));
  assert.equal(map.dfb.m2026[9], cents(map.dfb_lojas.m2026[9] + map.dfb_rest.m2026[9]));
  assert.equal(map.dfb.totalSaz2026, cents(map.dfb_lojas.totalSaz2026 + map.dfb_rest.totalSaz2026));
  assert.equal(map.dfb.totalSaz2027, cents(map.dfb_lojas.totalSaz2027 + map.dfb_rest.totalSaz2027));
  assert.equal(map.dfb.orcamento, cents(Number(map.dfb_lojas.orcamento) + Number(map.dfb_rest.orcamento)));
  assert.equal(map.dfb.total2026, cents(Number(map.dfb_lojas.total2026) + Number(map.dfb_rest.total2026)));
  assert.notEqual(map.dfb.orcamento, full.dfb.orcamento);
  assert.notEqual(map.dfb.total2026, full.dfb.total2026);
  assert.equal(map.dfb.dif2026, cents(map.dfb.totalSaz2026 - map.dfb.total2026));
  assert.equal(map.dfb.dif2027, cents(map.dfb.totalSaz2027 - map.dfb.orcamento));
  assert.equal(map.dfb.dif2026, cents(map.dfb_lojas.dif2026 + map.dfb_rest.dif2026));
  assert.equal(map.total.totalSaz2026, map.dfb.totalSaz2026);
  assert.equal(map.total.orcamento, map.dfb.orcamento);
  assert.equal(full.dfb.orcamento, 240 + 300 + 18);
  assert.ok(full.qb);
  assert.ok(full.dfb_inst);

  const inst = ctx.saz27LinhasVisiveis(todas, ['dfb_inst_balcao']);
  assert.deepEqual(inst.map(r => r.id), ['dfb', 'dfb_inst', 'dfb_inst_balcao', 'total']);
  assert.equal(byId(inst).dfb_inst.totalSaz2026, byId(inst).dfb_inst_balcao.totalSaz2026);
  assert.equal(byId(inst).dfb.orcamento, byId(inst).dfb_inst_balcao.orcamento);
  assert.equal(byId(inst).dfb_inst_balcao.dif2026, full.dfb_inst_balcao.dif2026);
  assert.ok(!inst.some(r => r.id === 'qb' || r.id === 'dfb_lojas' || r.id === 'dfb_inst_horeca'));

  const cruzado = ctx.saz27LinhasVisiveis(todas, ['dfb_lojas', 'qb_rest']);
  assert.deepEqual(cruzado.map(r => r.id), ['dfb', 'dfb_lojas', 'qb', 'qb_rest', 'total']);
  assert.equal(byId(cruzado).dfb.totalSaz2026, byId(cruzado).dfb_lojas.totalSaz2026);
  assert.equal(byId(cruzado).qb.totalSaz2026, byId(cruzado).qb_rest.totalSaz2026);
  assert.equal(byId(cruzado).total.totalSaz2026, cents(byId(cruzado).dfb_lojas.totalSaz2026 + byId(cruzado).qb_rest.totalSaz2026));
  assert.equal(byId(cruzado).dfb_lojas.dif2027, full.dfb_lojas.dif2027);
  assert.ok(!cruzado.some(r => r.id === 'dfb_inst'));

  const limpo = ctx.saz27LinhasVisiveis(todas, []);
  assert.deepEqual(limpo.map(r => r.id), todas.map(r => r.id));
  assert.equal(byId(limpo).dfb.orcamento, full.dfb.orcamento);
  assert.equal(byId(limpo).dfb.totalSaz2026, full.dfb.totalSaz2026);

  const docAntes = JSON.stringify(ctx._saz27Doc);
  const dirtyAntes = ctx._saz27Dirty;
  ctx.saz27GravarFiltro(['qb_rest', 'dfb_lojas']);
  assert.deepEqual(ctx._saz27Filtro, ['dfb_lojas', 'qb_rest']);
  ctx.saz27GravarFiltro(['dfb_lojas', 'dfb_rest']);
  assert.equal(JSON.stringify(ctx._saz27Doc), docAntes);
  assert.equal(ctx._saz27Dirty, dirtyAntes);

  const vista = ctx.saz27RenderHtml(true, todas);
  assert.ok(vista.includes('id="saz27-filtro"'));
  assert.ok(vista.includes('>Canal</label>'));
  assert.ok(vista.includes('id="saz27-filtro-limpar"'));
  assert.ok(vista.includes('>Limpar</button>'));
  assert.ok(vista.includes('Delta Foods Brasil'));
  assert.ok(vista.includes('>Q Brasil</legend>'));
  assert.ok(vista.includes('Lojas online'));
  assert.ok(vista.includes('Institucional Balcão'));
  assert.ok(vista.includes('Institucional Horeca'));
  assert.ok(vista.includes('data-saz-canal="dfb_lojas" checked'));
  assert.ok(vista.includes('data-saz-canal="dfb_rest" checked'));
  assert.ok(!vista.includes('data-saz-canal="dfb_site" checked'));
  assert.ok(vista.includes('data-saz-id="dfb_lojas"'));
  assert.ok(vista.includes('data-saz-id="dfb_rest"'));
  assert.ok(!vista.includes('data-saz-id="dfb_site"'));
  assert.ok(!vista.includes('data-saz-id="qb_rest"'));
  assert.ok(!vista.includes('data-saz-id="dfb_inst"'));
  assert.ok(vista.includes('data-saz-canal="qb_rest"'));
  assert.ok(vista.includes('Delta · Lojas online'));
  assert.ok(vista.includes('Delta · Restauração'));
  assert.ok(trDe(vista, 'dfb_lojas', '2026'));
  assert.ok(trDe(vista, 'dfb_lojas', '2027'));
  assert.ok(trDe(vista, 'dfb_lojas', '2026').includes('<input'));
  assert.ok(!trDe(vista, 'dfb', '2026').includes('<input'));

  ctx._saz27Filtro = null;
  assert.deepEqual(ctx.saz27LerFiltro(), ['dfb_lojas', 'dfb_rest']);
  assert.deepEqual(ctx.saz27FiltroActual(), ['dfb_lojas', 'dfb_rest']);

  ctx.saz27TirarCanal('dfb_lojas');
  assert.deepEqual(ctx._saz27Filtro, ['dfb_rest']);
  ctx.saz27OnFiltroCanal({
    getAttribute(name) { return name === 'data-saz-canal' ? 'dfb_rest' : ''; },
    checked: false,
  });
  assert.deepEqual(ctx._saz27Filtro, []);
  assert.equal(store.has(vm.runInContext('SAZ27_FILTRO_LS', ctx)), false);
  const outra = ctx.saz27RenderHtml(true, todas);
  assert.ok(outra.includes('data-saz-id="qb_dist_reg"'));
  assert.ok(outra.includes('data-saz-id="dfb_inst_horeca"'));
  assert.ok(outra.includes('Todos os canais'));
  assert.equal(ctx.saz27LinhasNoEcra(todas).length, todas.length);
  ctx.saz27LimparFiltro();
  assert.deepEqual(ctx._saz27Filtro, []);
});

const chain = Promise.resolve();
function later(title, fn) {
  return chain.then(() => check(title, fn));
}

await later('autosave aos 1000 ms, uma vez, sem apagar o resto do mapa', async () => {
  ctx._saz27Filtro = [];
  setUser('Diogo Oliveira');
  posts.length = 0;
  hint.n = 0;
  hint._t = '';
  nuvem = {
    version: 1,
    canais: {
      dfb_rest: { dez: 7, cellTs: { dez: '2020-01-01T00:00:00.000Z' } },
    },
  };
  ctx._saz27CloudCache = null;
  ctx._saz27CloudFetchedAt = 0;
  ctx._saz27Fila = Promise.resolve();
  ctx._saz27Doc = { version: 1, canais: {} };
  ctx._saz27Dirty = false;
  const antes = timers.length;
  ctx.saz27OnInput(el({ 'data-saz-id': 'dfb_lojas', 'data-saz-mes': 'out' }, '4'));
  ctx.saz27OnInput(el({ 'data-saz-id': 'dfb_lojas', 'data-saz-mes': 'out' }, '40'));
  assert.equal(ctx._saz27Dirty, true);
  assert.equal(hint.n, 0);
  assert.equal(posts.length, 0);
  const pendentes = timers.slice(antes).filter(t => t.fn && t.ms === 1000);
  assert.equal(pendentes.length, 1);
  pendentes[0].fn();
  await ctx._saz27Fila;
  assert.equal(posts.length, 1);
  assert.equal(hint._t, 'Guardado');
  assert.equal(hint.n, 1);
  assert.equal(posts[0].actualizadoPor, 'Diogo Oliveira');
  assert.equal(posts[0].canais.dfb_lojas.out, 40);
  assert.equal(posts[0].canais.dfb_rest.dez, 7);

  const marks = hint.n;
  ctx.saz27OnBlur(el({ 'data-saz-id': 'dfb_lojas', 'data-saz-mes': 'nov' }, ''));
  await ctx._saz27Fila;
  const limpo = posts[posts.length - 1];
  assert.equal(limpo.canais.dfb_lojas.nov, null);
  assert.equal(limpo.canais.dfb_lojas.out, 40);
  assert.equal(limpo.canais.dfb_rest.dez, 7);
  assert.equal(hint.n, marks + 1);
  const depois = ctx.saz27Montar(quadro, orc, ctx._saz27Doc.canais);
  assert.equal(byId(depois).dfb_lojas.m2026[10], 0);
  assert.equal(byId(depois).dfb_lojas.q4.nov.vazio, true);

  ctx._saz27Doc = { version: 1, canais: {} };
  ctx._saz27Dirty = false;
  const nPosts = posts.length;
  ctx.saz27OnBlur(el({ 'data-saz-id': 'dfb_lojas', 'data-saz-mes': 'dez' }, '10'));
  assert.equal(ctx._saz27Doc.canais.dfb_lojas, undefined);
  assert.equal(posts.length, nPosts);
});

await later('o filtro fica no browser e Out/Nov/Dez grava sem apagar o resto', async () => {
  setUser('Filipe Neves');
  posts.length = 0;
  hint.n = 0;
  hint._t = '';
  nuvem = {
    version: 1,
    canais: {
      qb_dist_reg: { dez: 9, cellTs: { dez: '2026-10-01T00:00:00.000Z' } },
      dfb_rest: { nov: 3, cellTs: { nov: '2026-10-01T00:00:00.000Z' } },
    },
  };
  ctx._saz27CloudCache = null;
  ctx._saz27CloudFetchedAt = 0;
  ctx._saz27Fila = Promise.resolve();
  ctx._saz27Doc = {
    version: 1,
    canais: {
      qb_dist_reg: { dez: 9, cellTs: { dez: '2026-10-01T00:00:00.000Z' } },
      dfb_rest: { nov: 3, cellTs: { nov: '2026-10-01T00:00:00.000Z' } },
    },
  };
  ctx._saz27Dirty = false;
  ctx.saz27GravarFiltro(['dfb_lojas', 'dfb_rest']);
  assert.equal(ctx._saz27Dirty, false);
  assert.equal(ctx._saz27Doc.canais.qb_dist_reg.dez, 9);
  assert.equal(ctx._saz27Doc.canais.dfb_rest.nov, 3);
  assert.equal(posts.length, 0);
  const antes = timers.length;
  ctx.saz27OnInput(el({ 'data-saz-id': 'dfb_lojas', 'data-saz-mes': 'out' }, '40'));
  assert.equal(ctx._saz27Doc.canais.dfb_lojas.out, 40);
  assert.equal(ctx._saz27Doc.canais.qb_dist_reg.dez, 9);
  assert.equal(ctx._saz27Doc.canais.dfb_rest.nov, 3);
  assert.equal(ctx._saz27Doc.filtro, undefined);
  const pendentes = timers.slice(antes).filter(t => t.fn && t.ms === 1000);
  assert.equal(pendentes.length, 1);
  pendentes[0].fn();
  await ctx._saz27Fila;
  assert.equal(posts.length, 1);
  const body = posts[0];
  assert.equal(body.canais.dfb_lojas.out, 40);
  assert.equal(body.canais.qb_dist_reg.dez, 9);
  assert.equal(body.canais.dfb_rest.nov, 3);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'filtro'), false);
  const docLs = vm.runInContext('SAZ27_LS_KEY', ctx);
  const filtroLs = vm.runInContext('SAZ27_FILTRO_LS', ctx);
  const saved = JSON.parse(store.get(docLs));
  assert.equal(saved.filtro, undefined);
  assert.equal(saved.canais.dfb_lojas.out, 40);
  assert.equal(saved.canais.qb_dist_reg.dez, 9);
  assert.equal(saved.canais.dfb_rest.nov, 3);
  assert.deepEqual(JSON.parse(store.get(filtroLs)), ['dfb_lojas', 'dfb_rest']);
  ctx._saz27Filtro = null;
  assert.deepEqual(ctx.saz27FiltroActual(), ['dfb_lojas', 'dfb_rest']);
  const vista = ctx.saz27RenderHtml(true, ctx.saz27Montar(quadro, orc, ctx._saz27Doc.canais));
  assert.ok(tdMes(vista, 'dfb_lojas', '2026', 'out').includes('value="40"'));
  assert.ok(tdMes(vista, 'dfb_rest', '2026', 'nov').includes('value="3"'));
  assert.ok(!vista.includes('data-saz-id="qb_dist_reg"'));
  ctx.saz27LimparFiltro();
  assert.equal(ctx._saz27Doc.canais.dfb_lojas.out, 40);
  assert.equal(ctx._saz27Doc.canais.qb_dist_reg.dez, 9);
});

await later('um mês de 2027 grava aos 1000 ms sem apagar Out/Nov/Dez nem o resto', async () => {
  setUser('Diogo Oliveira');
  posts.length = 0;
  hint.n = 0;
  hint._t = '';
  nuvem = {
    version: 1,
    canais: {
      dfb_lojas: { out: 40, cellTs: { out: '2026-10-01T00:00:00.000Z' } },
      dfb_rest: { dez: 7, cellTs: { dez: '2026-10-01T00:00:00.000Z' } },
    },
  };
  ctx._saz27CloudCache = null;
  ctx._saz27CloudFetchedAt = 0;
  ctx._saz27Fila = Promise.resolve();
  ctx._saz27Doc = {
    version: 1,
    canais: {
      dfb_lojas: { out: 40, cellTs: { out: '2026-10-01T00:00:00.000Z' } },
      dfb_rest: { dez: 7, cellTs: { dez: '2026-10-01T00:00:00.000Z' } },
    },
  };
  ctx._saz27Dirty = false;
  ctx._orc27Doc = { version: 1, canais: orc };
  const antes = timers.length;
  ctx.saz27OnInput(el({ 'data-saz-id': 'dfb_lojas', 'data-saz-mes': 'jan', 'data-saz-ano': '2027' }, '99'));
  assert.equal(ctx._saz27Doc.canais.dfb_lojas.y2027.jan, 99);
  assert.equal(ctx._saz27Doc.canais.dfb_lojas.out, 40);
  assert.equal(ctx._saz27Doc.canais.dfb_rest.dez, 7);
  assert.equal(ctx._saz27Doc.canais.dfb_lojas.y2027.fev, undefined);
  const pendentes = timers.slice(antes).filter(t => t.fn && t.ms === 1000);
  assert.equal(pendentes.length, 1);
  pendentes[0].fn();
  await ctx._saz27Fila;
  assert.equal(posts.length, 1);
  const body = posts[0];
  assert.equal(body.canais.dfb_lojas.y2027.jan, 99);
  assert.equal(body.canais.dfb_lojas.y2027.fev, undefined);
  assert.equal(body.canais.dfb_lojas.out, 40);
  assert.equal(body.canais.dfb_rest.dez, 7);
  const outra = byId(ctx.saz27Montar(quadro, orc, body.canais)).dfb_lojas;
  assert.equal(outra.m2027[0], 99);
  assert.notEqual(outra.m2027[1], 99);
  assert.equal(outra.dif2027, cents(outra.totalSaz2027 - outra.orcamento));
  assert.notEqual(outra.dif2027, 0);
});

if (process.exitCode) {
  console.error('test-orcamento-sazonalidade: falhou');
  process.exit(process.exitCode);
}
console.log('test-orcamento-sazonalidade: ok');
