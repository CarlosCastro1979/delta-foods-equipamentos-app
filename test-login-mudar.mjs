/**
 * Botão «Mudar» — limpa utilizador e volta a «Quem és tu?».
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const CACHE = 'v2026-10-22-login-mudar';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.ok(sw.includes(CACHE), 'sw.js tem ' + CACHE);
assert.ok(html.includes(CACHE), 'index.html tem ' + CACHE);
assert.ok(
  html.includes('onclick="logoutUtilizador()" title="Trocar de utilizador">Mudar')
  || html.includes('id="btn-mudar-utilizador"'),
  'botão Mudar chama logoutUtilizador'
);
assert.ok(!html.includes('onclick="irHomeCanais()" title="Voltar ao menu inicial">Mudar'), 'Mudar já não só volta à home');
assert.ok(html.includes('Quem és tu?'), 'ecrã Quem és tu?');
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

const store = new Map([['dfb_utilizador', 'Daniela Santos']]);
const els = {
  'login-overlay': { style: { display: 'none' }, classList: { add() {}, remove() {} } },
  'login-select': { value: 'Daniela Santos' },
  'login-erro': { style: { display: 'block' } },
  'user-bar': { style: { display: 'inline-flex' } },
  'home-user-name': { textContent: 'Daniela Santos' },
};
let voltarHomeCalls = 0;
let atualizarHomeCalls = 0;
let clearSessionCalls = 0;

const context = {
  console,
  window: {},
  localStorage: {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  },
  document: {
    getElementById(id) { return els[id] || null; },
  },
  _canalPinOk: 'x',
  _canalPinPendente: 'y',
  clearSessionDataCaches() { clearSessionCalls++; },
  voltarHome() { voltarHomeCalls++; },
  atualizarHomeCanais() { atualizarHomeCalls++; },
  mostrarLoginModal() {
    const lo = els['login-overlay'];
    lo.style.display = 'flex';
    lo.classList.add('open');
  },
};
vm.createContext(context);
vm.runInContext(extractFn(html, 'logoutUtilizador'), context);
vm.runInContext(extractFn(html, 'getUtilizadorAtual'), context);
vm.runInContext(extractFn(html, 'irHomeCanais'), context);
vm.runInContext('try { window.logoutUtilizador = logoutUtilizador; } catch (_) {}', context);
vm.runInContext('try { window.irHomeCanais = irHomeCanais; } catch (_) {}', context);

assert.equal(context.getUtilizadorAtual(), 'Daniela Santos');
context.logoutUtilizador();
assert.equal(context.getUtilizadorAtual(), '', 'logout limpa dfb_utilizador');
assert.equal(store.has('dfb_utilizador'), false, 'chave removida do localStorage');
assert.equal(els['login-overlay'].style.display, 'flex', 'mostra overlay Quem és tu?');
assert.equal(els['user-bar'].style.display, 'none', 'esconde barra utilizador');
assert.equal(els['login-select'].value, '', 'select limpo');
assert.equal(els['home-user-name'].textContent, '—', 'nome na home limpo');
assert.ok(voltarHomeCalls >= 1, 'voltarHome chamado');
assert.ok(atualizarHomeCalls >= 1, 'atualizarHomeCanais chamado');
assert.ok(clearSessionCalls >= 1, 'clearSessionDataCaches chamado');
assert.equal(typeof context.window.logoutUtilizador, 'function', 'exposto no window');

store.set('dfb_utilizador', 'Carlos Castro');
els['login-overlay'].style.display = 'none';
els['user-bar'].style.display = 'inline-flex';
context.irHomeCanais();
assert.equal(context.getUtilizadorAtual(), '', 'irHomeCanais limpa utilizador');
assert.equal(els['login-overlay'].style.display, 'flex', 'irHomeCanais mostra login');

console.log('test-login-mudar: ok');
