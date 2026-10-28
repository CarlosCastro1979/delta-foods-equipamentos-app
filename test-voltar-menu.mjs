/**
 * «← Voltar» / «← Menu» regressa ao hub sem logout nem limpar PIN.
 * «Mudar» continua a limpar utilizador + PIN.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const CACHE = 'v2026-10-28-voltar-menu';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.ok(sw.includes(CACHE), 'sw.js tem ' + CACHE);
assert.ok(html.includes(CACHE), 'index.html tem ' + CACHE);
assert.ok(html.includes('id="btn-voltar-home"') && html.includes('data-action="voltar-home"'), 'botão header Voltar');
assert.ok(html.includes('onclick="voltarHome(); return false;"'), 'Voltar chama voltarHome');
assert.ok(html.includes('id="tab-voltar-home"') && html.includes('← Menu'), 'tab Menu no canal');
assert.ok(html.includes('id="btn-voltar-dados"'), 'Voltar em Dados desbloqueado');
assert.ok(html.includes('function atualizarBtnVoltarHome'), 'atualizarBtnVoltarHome');
assert.ok(html.includes('bindVoltarHomeDelegado'), 'listener delegado Voltar');
assert.ok(
  /function voltarHome\(\)[\s\S]{0,900}?NÃO limpar PIN de sessão/.test(html),
  'voltarHome não limpa PIN'
);
assert.ok(
  html.includes('id="btn-mudar-utilizador"') && html.includes('onclick="logoutUtilizador(); return false;"'),
  'Mudar continua logout'
);
assert.ok(!html.includes('onclick="irHomeCanais()" title="Voltar ao menu inicial">Mudar'), 'Mudar ≠ só home');

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
const sessionStore = new Map([['dfb_user_pin_sessao', 'CARLOS CASTRO']]);
const classListFactory = () => {
  const set = new Set(['view-dados']);
  return {
    add(c) { set.add(c); },
    remove(...cs) { cs.forEach(c => set.delete(c)); },
    contains(c) { return set.has(c); },
    toggle(c, on) { if (on) set.add(c); else set.delete(c); },
    toString() { return [...set].join(' '); },
  };
};
const bodyClass = classListFactory();
const els = {
  'home-screen': { classList: classListFactory(), style: { display: 'none' } },
  'main-nav': { style: { display: 'none' } },
  'btn-voltar-home': { style: { display: 'none' } },
  'user-bar': { style: { display: 'inline-flex' } },
  'user-bar-name': { textContent: 'Carlos Castro' },
  'login-overlay': { style: { display: 'none' }, classList: classListFactory(), scrollIntoView() {} },
  'login-select': { value: 'Carlos Castro' },
  'login-erro': { style: { display: 'none' } },
  'home-user-name': { textContent: 'Carlos Castro' },
  'canal-pin-overlay': { style: { display: 'none' }, classList: classListFactory() },
};
['ata-pin-gate', 'af-pin-gate', 'dados-pin-gate', 'pv-pin-gate'].forEach(id => {
  els[id] = { style: { display: 'none' } };
});
['ata-content', 'af-content', 'dados-content', 'pv-content'].forEach(id => {
  els[id] = { style: { display: 'block' } };
});

const context = {
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
    body: { classList: bodyClass, className: 'view-dados', get className() { return [...bodyClass.toString? bodyClass : []]; } },
    getElementById(id) { return els[id] || null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  },
  window: {},
  console,
  Date,
  clearSessionDataCaches() {},
  limparUserPinSessao() { sessionStore.delete('dfb_user_pin_sessao'); context._userPinSessaoOk = null; },
  cancelarUserPin() {},
  fecharUserPinOverlay() {},
  mostrarLoginModal() { els['login-overlay'].style.display = 'flex'; },
  atualizarHomeCanais() {},
  atualizarCanalBar() {},
  pvFlushAutosave() {},
  orc27Flush() {},
  vol27Flush() {},
  saz27Flush() {},
  _canalActivo: 'distribuidores',
  _canalPinPendente: null,
  _pinGateResolve: null,
  _userPinSessaoOk: 'CARLOS CASTRO',
  USER_PIN_SESSAO_KEY: 'dfb_user_pin_sessao',
  history: { replaceState() {} },
  location: { pathname: '/', search: '' },
};
// Fix body className getter properly
Object.defineProperty(context.document.body, 'className', {
  get() {
    const s = [];
    ['view-home','view-canal','view-dados','view-area-tecnica','view-area-financeira','view-previsao-vendas'].forEach(c => {
      if (bodyClass.contains(c)) s.push(c);
    });
    return s.join(' ') || 'view-dados';
  },
  set() {},
});

vm.createContext(context);
for (const name of [
  'getUtilizadorAtual',
  'atualizarBtnVoltarHome',
  'setAppView',
  'voltarHome',
  'logoutUtilizador',
  'irHomeCanais',
]) {
  // getUtilizadorAtual / logout need full extract — logout calls many things
}
vm.runInContext(extractFn(html, 'getUtilizadorAtual'), context);
vm.runInContext(extractFn(html, 'atualizarBtnVoltarHome'), context);
vm.runInContext(extractFn(html, 'setAppView'), context);
vm.runInContext(extractFn(html, 'voltarHome'), context);
context.window.voltarHome = context.voltarHome;
context.window.atualizarBtnVoltarHome = context.atualizarBtnVoltarHome;

// Simula Dados → Voltar
context.atualizarBtnVoltarHome('dados');
assert.equal(els['btn-voltar-home'].style.display, 'inline-flex', 'Voltar visível em Dados');
assert.equal(context.getUtilizadorAtual(), 'Carlos Castro', 'utilizador mantém-se antes de Voltar');
assert.equal(sessionStore.get('dfb_user_pin_sessao'), 'CARLOS CASTRO', 'PIN sessão antes');

context.voltarHome();
assert.ok(bodyClass.contains('view-home'), 'após Voltar: view-home');
assert.equal(context.getUtilizadorAtual(), 'Carlos Castro', 'Voltar NÃO limpa utilizador');
assert.equal(sessionStore.get('dfb_user_pin_sessao'), 'CARLOS CASTRO', 'Voltar NÃO limpa PIN');
assert.equal(els['btn-voltar-home'].style.display, 'none', 'Voltar escondido na home');
assert.equal(els['dados-content'].style.display, 'none', 'dados-content fechado');

console.log('ok: voltar-menu');
