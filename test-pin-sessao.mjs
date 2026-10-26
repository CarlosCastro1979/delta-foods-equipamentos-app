/**
 * PIN de sessão: após unlock, menus não voltam a pedir; «Mudar» limpa e exige PIN de novo.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const CACHE = 'v2026-10-26-eduardo-cpf';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.ok(sw.includes(CACHE), 'sw.js tem ' + CACHE);
assert.ok(html.includes(CACHE), 'index.html tem ' + CACHE);
assert.ok(html.includes('USER_PIN_SESSAO_KEY'), 'chave sessionStorage PIN');
assert.ok(html.includes('function isUserPinSessaoOk'), 'isUserPinSessaoOk');
assert.ok(html.includes('function marcarUserPinSessaoOk'), 'marcarUserPinSessaoOk');
assert.ok(html.includes('function limparUserPinSessao'), 'limparUserPinSessao');
assert.ok(html.includes('isUserPinSessaoOk(nome)'), 'pedirPinUtilizador respeita sessão');
assert.ok(
  /function voltarHome\(\)[\s\S]{0,900}?NÃO limpar PIN de sessão/.test(html)
  || !/function voltarHome\(\)[\s\S]{0,400}?_canalPinOk\s*=\s*null/.test(html),
  'voltarHome não limpa PIN de sessão'
);
assert.ok(html.includes('limparUserPinSessao()'), 'logout/login limpam sessão PIN');
assert.ok(
  /async function entrarCanal[\s\S]{0,800}?isUserPinSessaoOk\(\)/.test(html),
  'entrarCanal usa sessão PIN (não canalId)'
);
assert.ok(
  !/async function abrirDadosHome[\s\S]{0,500}?_canalPinOk\s*=\s*null/.test(html),
  'abrirDadosHome não zera PIN ao entrar'
);
assert.ok(
  !/async function abrirAreaTecnicaHome[\s\S]{0,500}?_canalPinOk\s*=\s*null/.test(html),
  'abrirAreaTecnicaHome não zera PIN ao entrar'
);
assert.ok(
  !/async function abrirPrevisaoVendasHome[\s\S]{0,500}?_canalPinOk\s*=\s*null/.test(html),
  'abrirPrevisaoVendasHome não zera PIN ao entrar'
);

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

const localStore = new Map([['dfb_utilizador', 'Carlos Castro']]);
const sessionStore = new Map();
let pinModalShown = 0;

const classListFactory = () => {
  const set = new Set();
  return {
    add(c) { set.add(c); },
    remove(...cs) { cs.forEach(c => set.delete(c)); },
    contains(c) { return set.has(c); },
  };
};

const els = {
  'canal-pin-overlay': { style: { display: 'none' }, classList: classListFactory() },
  'canal-pin-input': { value: '' },
  'user-pin-confirm': { value: '' },
  'canal-pin-erro': { style: { display: 'none' }, textContent: '' },
  'user-pin-btn': { disabled: false, textContent: 'Entrar' },
  'user-pin-forgot-btn': { style: { display: 'none' }, textContent: '' },
  'user-pin-title': { textContent: '' },
  'canal-pin-desc': { textContent: '' },
  'user-pin-confirm-wrap': { style: { display: 'none' } },
  'login-overlay': {
    style: { display: 'none', visibility: '', opacity: '', pointerEvents: '', zIndex: '' },
    classList: classListFactory(),
    scrollIntoView() {},
  },
  'login-select': { value: 'Carlos Castro' },
  'login-erro': { style: { display: 'none' } },
  'user-bar': { style: { display: 'inline-flex' } },
  'home-user-name': { textContent: 'Carlos Castro' },
};

const context = {
  console,
  window: {},
  setTimeout(fn) { try { fn(); } catch (_) {} },
  localStorage: {
    getItem(k) { return localStore.has(k) ? localStore.get(k) : null; },
    setItem(k, v) { localStore.set(k, String(v)); },
    removeItem(k) { localStore.delete(k); },
  },
  sessionStorage: {
    getItem(k) { return sessionStore.has(k) ? sessionStore.get(k) : null; },
    setItem(k, v) { sessionStore.set(k, String(v)); },
    removeItem(k) { sessionStore.delete(k); },
  },
  document: {
    getElementById(id) { return els[id] || null; },
    querySelectorAll() { return []; },
  },
  toast() {},
  isAdmin() { return true; },
  pinFormatoValido(p) { return /^\d{4}$/.test(String(p || '')); },
  pinSqlAdminMsg() { return ''; },
  pinCacheGet() { return null; },
  pinCacheSet() {},
  isPinBackendUnavailable() { return false; },
  async fetchUtilizadorPinHash() { return 'hash-fake'; },
  async hashPinUtilizador() { return 'hash-fake'; },
  async saveUtilizadorPinHash() {},
  async adminResetUtilizadorPin() { return true; },
  showPinGateUi() {},
  fecharUserPinOverlay() {
    const ov = els['canal-pin-overlay'];
    ov.classList.remove('open');
    ov.style.display = 'none';
  },
  _canalPinOk: null,
  _userPinSessaoOk: null,
  _canalPinPendente: null,
  _pinGateResolve: null,
  _pinGateMode: 'verify',
  _pinGateStoredHash: null,
  _pinGateBusy: false,
  _pinGateOffline: false,
  USER_PIN_SESSAO_KEY: 'dfb_user_pin_sessao',
  clearSessionDataCaches() {},
  voltarHome() {},
  atualizarHomeCanais() {},
  mostrarLoginModal() {
    const lo = els['login-overlay'];
    lo.classList.add('open');
    lo.style.display = 'flex';
  },
  location: { pathname: '/', search: '' },
  history: { replaceState() {} },
};
context.window = context;
vm.createContext(context);

vm.runInContext(extractFn(html, 'normNomeUtilizador'), context);
vm.runInContext(extractFn(html, 'getUtilizadorAtual'), context);
vm.runInContext(extractFn(html, 'isUserPinSessaoOk'), context);
vm.runInContext(extractFn(html, 'marcarUserPinSessaoOk'), context);
vm.runInContext(extractFn(html, 'limparUserPinSessao'), context);
vm.runInContext(extractFn(html, 'logoutUtilizador'), context);

// Pedido real: força overlay (simula 1.ª entrada)
const originalPedir = context.pedirPinUtilizador;
context.pedirPinUtilizador = async function patched(opts) {
  if (context.isUserPinSessaoOk()) return true;
  pinModalShown++;
  context.marcarUserPinSessaoOk(context.getUtilizadorAtual());
  return true;
};

assert.equal(context.isUserPinSessaoOk(), false, 'sem PIN no início');

let ok1 = await context.pedirPinUtilizador({ titulo: 'PIN do canal' });
assert.equal(ok1, true);
assert.equal(pinModalShown, 1, '1.º menu pede PIN');
assert.equal(context.isUserPinSessaoOk(), true, 'sessão marcada após PIN');
assert.equal(sessionStore.get('dfb_user_pin_sessao'), 'Carlos Castro', 'sessionStorage gravado');

// Navegar menus (Contratos / Vendas / outro) — não pede de novo
pinModalShown = 0;
assert.equal(await context.pedirPinUtilizador({ titulo: 'Contratos' }), true);
assert.equal(await context.pedirPinUtilizador({ titulo: 'Previsão de vendas' }), true);
assert.equal(await context.pedirPinUtilizador({ titulo: 'Área Técnica' }), true);
assert.equal(pinModalShown, 0, 'menus seguintes não pedem PIN');

// «Mudar» limpa tudo
context.logoutUtilizador();
assert.equal(context.getUtilizadorAtual(), '', 'Mudar limpa utilizador');
assert.equal(context.isUserPinSessaoOk(), false, 'Mudar limpa PIN sessão');
assert.equal(sessionStore.has('dfb_user_pin_sessao'), false, 'sessionStorage PIN removido');

// Reentrar: PIN obrigatório de novo
localStore.set('dfb_utilizador', 'Carlos Castro');
pinModalShown = 0;
assert.equal(await context.pedirPinUtilizador({ titulo: 'PIN do canal' }), true);
assert.equal(pinModalShown, 1, 'após Mudar, PIN pedido outra vez');

console.log('test-pin-sessao: ok');
