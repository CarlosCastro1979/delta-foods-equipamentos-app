#!/usr/bin/env node
/**
 * Orçamento 2027 · Sazonalidade.
 * Jan–Set 2026 = Fatur. do mês. Out/Nov/Dez = média /9 até alguém gravar.
 * 2027 segue os pesos e soma o Orçamento 2027. Dif 2026 fecha com o Orç Valor.
 * Empresa e Institucional somam os filhos. O vendedor escreve só os três meses.
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const CACHE = 'v2026-10-15-orcamento-sazonalidade';

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
  'saz27EstadoQ4',
  'saz27LerQ4',
  'saz27Distribuir2027',
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
  assert.equal(map.dfb_inst_balcao.m2026[9], map.dfb_inst_balcao.media);
  assert.notEqual(map.dfb_inst_balcao.m2026[9], 777);
  assert.deepEqual(linhas.map(r => r.id), ctx.orc27LinhasBase().map(r => r.id));
});

check('Out, Nov e Dez por defeito são a mesma média (Jan..Set)/9', () => {
  const linhas = ctx.saz27Montar(quadro, orc, {});
  const map = byId(linhas);
  const lojas = map.dfb_lojas;
  assert.equal(lojas.media, 10);
  assert.equal(lojas.q4.out.gravado, false);
  assert.equal(lojas.m2026[9], 10);
  assert.equal(lojas.m2026[10], 10);
  assert.equal(lojas.m2026[11], 10);
  assert.equal(lojas.totalSaz2026, 120);
  assert.equal(lojas.dif2026, 0);

  const rest = map.dfb_rest;
  const media = cents(175 / 9);
  assert.equal(media, 19.44);
  assert.equal(rest.media, media);
  assert.equal(rest.m2026[9], media);
  assert.equal(rest.m2026[10], media);
  assert.equal(rest.m2026[11], media);
  perto(rest.dif2026, media * 3);

  const vista = ctx.saz27RenderHtml(true, linhas);
  assert.ok(tdMes(vista, 'dfb_lojas', '2026', 'out').includes('value="10"'));
  assert.ok(tdMes(vista, 'dfb_rest', '2026', 'nov').includes('value="19,44"'));
  assert.ok(vista.includes('>Sazonalidade</button>'));
  assert.ok(vista.includes('>Dif</th>'));
  assert.ok(vista.includes('>Jan</th>'));
  assert.ok(vista.includes('>Dez</th>'));
});

check('um Out escrito substitui a média e não volta; o vazio explícito conta 0', () => {
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
  assert.equal(map.dfb.m2026[9], cents(40 + 19.44 + 1));
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
      assert.ok(celula.includes('data-saz-mes="' + mes + '"'));
      inputs += 1;
    });
    assert.ok(!trDe(vista, row.id, '2027').includes('<input'), row.id + ' 2027');
  });
  assert.equal(inputs, canais.length * 3);
  assert.ok(!trDe(vista, 'dfb', '2026').includes('<input'));
  assert.ok(!trDe(vista, 'dfb_inst', '2026').includes('<input'));
  assert.ok(!trDe(vista, 'qb', '2026').includes('<input'));
  assert.ok(!trDe(vista, 'total', '2026').includes('<input'));
  const fechado = ctx.saz27RenderHtml(false, linhas);
  assert.ok(!fechado.includes('<input'));

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

const chain = Promise.resolve();
function later(title, fn) {
  return chain.then(() => check(title, fn));
}

await later('autosave aos 1000 ms, uma vez, sem apagar o resto do mapa', async () => {
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

if (process.exitCode) {
  console.error('test-orcamento-sazonalidade: falhou');
  process.exit(process.exitCode);
}
console.log('test-orcamento-sazonalidade: ok');
