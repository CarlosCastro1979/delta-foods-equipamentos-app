/**
 * Botão «Mudar» — limpa utilizador e volta a «Quem és tu?».
 * Simula onclick + caminho delegado (data-action / touchend).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const CACHE = 'v2026-10-27-contratos-dist';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.ok(sw.includes(CACHE), 'sw.js tem ' + CACHE);
assert.ok(html.includes(CACHE), 'index.html tem ' + CACHE);
assert.ok(sw.includes('network-first') || sw.includes('cache: \'no-store\'') || sw.includes('mode === \'navigate\''), 'SW network-first para navegação/index');
assert.ok(
  html.includes('id="btn-mudar-utilizador"') && html.includes('data-action="mudar-utilizador"'),
  'botão Mudar tem id + data-action'
);
assert.ok(
  html.includes('onclick="logoutUtilizador(); return false;"')
  || html.includes('onclick="logoutUtilizador()"'),
  'botão Mudar chama logoutUtilizador'
);
assert.ok(!html.includes('onclick="irHomeCanais()" title="Voltar ao menu inicial">Mudar'), 'Mudar já não só volta à home');
assert.ok(html.includes('Quem és tu?'), 'ecrã Quem és tu?');
assert.ok(/z-index:\s*10050/.test(html), 'login-overlay acima de tudo');
assert.ok(html.includes('bindMudarUtilizadorDelegado') || html.includes('data-action="mudar-utilizador"'), 'listener delegado');
assert.ok(/\.user-pill[\s\S]{0,220}pointer-events:\s*auto/.test(html), 'user-pill pointer-events auto');
assert.ok(/\.user-pill-change[\s\S]{0,220}pointer-events:\s*auto/.test(html), 'Mudar pointer-events auto');

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

function extractIife(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('IIFE em falta: ' + marker);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        // incluir até ao })(); final
        let end = i + 1;
        while (end < src.length && src[end] !== ';') end++;
        return src.slice(start, end + 1);
      }
    }
  }
  throw new Error('IIFE não fechou: ' + marker);
}

const store = new Map([['dfb_utilizador', 'Daniela Santos']]);
const classListFactory = () => {
  const set = new Set();
  return {
    add(c) { set.add(c); },
    remove(...cs) { cs.forEach(c => set.delete(c)); },
    contains(c) { return set.has(c); },
    _set: set,
  };
};
const els = {
  'login-overlay': {
    style: { display: 'none', visibility: 'hidden', opacity: '0', pointerEvents: 'none', zIndex: '' },
    classList: classListFactory(),
    scrollIntoView() {},
  },
  'login-select': { value: 'Daniela Santos' },
  'login-erro': { style: { display: 'block' } },
  'user-bar': { style: { display: 'inline-flex' } },
  'home-user-name': { textContent: 'Daniela Santos' },
  'canal-pin-overlay': { style: { display: 'flex' }, classList: classListFactory() },
};
els['canal-pin-overlay'].classList.add('open');

let voltarHomeCalls = 0;
let atualizarHomeCalls = 0;
let clearSessionCalls = 0;
const listeners = [];

const context = {
  console,
  window: { scrollTo() {} },
  location: { pathname: '/delta-foods-equipamentos-app/', search: '' },
  history: { replaceState() {} },
  Date,
  localStorage: {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  },
  document: {
    getElementById(id) { return els[id] || null; },
    addEventListener(type, fn, opts) { listeners.push({ type, fn, opts }); },
  },
  _canalPinOk: 'x',
  _userPinSessaoOk: 'x',
  _canalPinPendente: 'y',
  USER_PIN_SESSAO_KEY: 'dfb_user_pin_sessao',
  sessionStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  },
  clearSessionDataCaches() { clearSessionCalls++; },
  voltarHome() { voltarHomeCalls++; },
  atualizarHomeCanais() { atualizarHomeCalls++; },
};
context.limparUserPinSessao = function limparUserPinSessao() {
  context._canalPinOk = null;
  context._userPinSessaoOk = null;
  try { context.sessionStorage.removeItem(context.USER_PIN_SESSAO_KEY); } catch (_) {}
};
vm.createContext(context);
vm.runInContext(extractFn(html, 'mostrarLoginModal'), context);
vm.runInContext(extractFn(html, 'logoutUtilizador'), context);
vm.runInContext(extractFn(html, 'getUtilizadorAtual'), context);
vm.runInContext(extractFn(html, 'irHomeCanais'), context);
vm.runInContext('try { window.logoutUtilizador = logoutUtilizador; } catch (_) {}', context);
vm.runInContext('try { window.irHomeCanais = irHomeCanais; } catch (_) {}', context);
vm.runInContext('try { window.mostrarLoginModal = mostrarLoginModal; } catch (_) {}', context);
vm.runInContext(extractIife(html, '(function bindMudarUtilizadorDelegado()'), context);

assert.equal(context.getUtilizadorAtual(), 'Daniela Santos');
context.logoutUtilizador();
assert.equal(context.getUtilizadorAtual(), '', 'logout limpa dfb_utilizador');
assert.equal(store.has('dfb_utilizador'), false, 'chave removida do localStorage');
assert.equal(els['login-overlay'].style.display, 'flex', 'mostra overlay Quem és tu?');
assert.ok(els['login-overlay'].classList.contains('open'), 'classe open no overlay');
assert.equal(els['login-overlay'].style.zIndex, '10050', 'z-index forçado');
assert.equal(els['user-bar'].style.display, 'none', 'esconde barra utilizador');
assert.equal(els['login-select'].value, '', 'select limpo');
assert.equal(els['home-user-name'].textContent, '—', 'nome na home limpo');
assert.equal(els['canal-pin-overlay'].style.display, 'none', 'fecha canal-pin');
assert.ok(voltarHomeCalls >= 1, 'voltarHome chamado');
assert.ok(atualizarHomeCalls >= 1, 'atualizarHomeCanais chamado');
assert.ok(clearSessionCalls >= 1, 'clearSessionDataCaches chamado');
assert.equal(typeof context.window.logoutUtilizador, 'function', 'exposto no window');

// Clique delegado: simular tap em [data-action=mudar-utilizador]
store.set('dfb_utilizador', 'Daniela Kucinski');
els['login-overlay'].style.display = 'none';
els['login-overlay'].classList.remove('open');
els['user-bar'].style.display = 'inline-flex';
const clickListener = listeners.find(l => l.type === 'click');
const touchListener = listeners.find(l => l.type === 'touchend');
assert.ok(clickListener, 'listener click registado');
assert.ok(touchListener, 'listener touchend registado');

const fakeBtn = {
  closest(sel) {
    if (sel.includes('data-action') || sel.includes('btn-mudar')) return fakeBtn;
    return null;
  },
};
const fakeEvent = {
  target: fakeBtn,
  preventDefault() {},
  stopPropagation() {},
};
clickListener.fn(fakeEvent);
assert.equal(context.getUtilizadorAtual(), '', 'click delegado limpa utilizador');
assert.equal(els['login-overlay'].style.display, 'flex', 'click delegado mostra Quem és tu?');

store.set('dfb_utilizador', 'Carlos Castro');
els['login-overlay'].style.display = 'none';
els['user-bar'].style.display = 'inline-flex';
context.irHomeCanais();
assert.equal(context.getUtilizadorAtual(), '', 'irHomeCanais limpa utilizador');
assert.equal(els['login-overlay'].style.display, 'flex', 'irHomeCanais mostra login');

console.log('test-login-mudar: ok');
