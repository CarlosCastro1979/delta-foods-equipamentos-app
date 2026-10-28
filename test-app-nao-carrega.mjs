/**
 * App não carrega: timeouts no boot/agregado + SW register seguro.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.dirname(fileURLToPath(import.meta.url));
const CACHE = 'v2026-10-28-dividas-balancete';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.ok(html.includes(CACHE), 'index cache bump');
assert.ok(sw.includes(CACHE), 'sw cache bump');
assert.ok(html.includes('function withTimeout('), 'withTimeout helper');
assert.ok(html.includes('function fetchWithTimeout('), 'fetchWithTimeout helper');
assert.ok(html.includes('let _idbBroken = false'), 'IDB broken flag');
assert.ok(html.includes("withTimeout(openP, 8000, 'IndexedDB')"), 'IDB open timeout');
assert.ok(html.includes('const probeStatus = (async () => {'), 'status em paralelo com lista SAP');
assert.ok(html.includes("withTimeout(sincronizarListaClientes(), 60000"), 'sync lista com timeout');
assert.ok(html.includes("withTimeout(lerVendasQuadroPersistida(), 25000, 'Agregado vendas')"), 'agregado com timeout');
assert.ok(html.includes("toast('Não foi possível ler o agregado"), 'toast se agregado falhar');
assert.ok(html.includes('onclick="loadVendasQuadro()"'), 'botão tentar de novo no quadro');
assert.ok(html.includes('registerSwSafe'), 'SW seguro');
assert.ok(html.includes("document.visibilityState === 'hidden'"), 'SW evita documento hidden');

// withTimeout rejeita quando a promise não resolve a tempo
const start = html.indexOf('function withTimeout(promise, ms, label)');
assert.ok(start > 0);
let depth = 0;
let end = -1;
const brace = html.indexOf('{', start);
for (let i = brace; i < html.length; i++) {
  if (html[i] === '{') depth++;
  else if (html[i] === '}') {
    depth--;
    if (depth === 0) { end = i + 1; break; }
  }
}
const fnSrc = html.slice(start, end);
const ctx = { setTimeout, clearTimeout, Promise, Error, Number, Math, console };
vm.createContext(ctx);
vm.runInContext(fnSrc, ctx);
await assert.rejects(
  () => ctx.withTimeout(new Promise(() => {}), 30, 'Teste hang'),
  /Teste hang excedeu 30ms/
);

console.log('test-app-nao-carrega: ok');
