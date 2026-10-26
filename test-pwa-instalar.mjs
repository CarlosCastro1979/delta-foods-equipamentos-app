/**
 * PWA / «Instalar aplicação» — manifest, SW e UI de instalação.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const CACHE = 'v2026-10-26-massimo-cpf';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

assert.ok(sw.includes(CACHE), 'sw.js tem ' + CACHE);
assert.ok(html.includes(CACHE), 'index.html tem ' + CACHE);
assert.ok(sw.includes("addEventListener('fetch'"), 'SW tem fetch handler');
assert.ok(!sw.includes('unregister()'), 'SW não se auto-destrói (bloqueava instalar)');
assert.ok(html.includes("serviceWorker.register('/delta-foods-equipamentos-app/sw.js'"), 'index regista SW');
assert.ok(!/serviceWorker\.getRegistrations\(\)[\s\S]*unregister\(\)/.test(html), 'index não desregista todos os SW');

assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/delta-foods-equipamentos-app/');
assert.equal(manifest.scope, '/delta-foods-equipamentos-app/');
assert.ok(manifest.short_name, 'short_name');
assert.ok(manifest.name, 'name');
assert.ok(manifest.id, 'id');

const sizes = new Set(manifest.icons.map(i => i.sizes));
assert.ok(sizes.has('192x192'), 'ícone 192');
assert.ok(sizes.has('512x512'), 'ícone 512');
assert.ok(manifest.icons.some(i => i.purpose === 'any'), 'purpose any');
assert.ok(manifest.icons.some(i => i.purpose === 'maskable'), 'purpose maskable');

for (const icon of manifest.icons) {
  const rel = icon.src.replace('/delta-foods-equipamentos-app/', '');
  assert.ok(fs.existsSync(path.join(root, rel)), 'ficheiro ícone ' + rel);
}

assert.ok(html.includes('beforeinstallprompt'), 'captura beforeinstallprompt');
assert.ok(html.includes('Instalar aplicação'), 'botão PT Instalar aplicação');
assert.ok(html.includes('Adicionar ao Ecrã Inicial'), 'passos iOS');
assert.ok(html.includes('Adicionar à página inicial') || html.includes('Instalar aplicação'), 'passos Android');
assert.ok(html.includes('pwa-install-login'), 'UI no ecrã de login');
assert.ok(html.includes('pwa-install-header'), 'UI no header');
assert.ok(html.includes('viewport-fit=cover'), 'viewport-fit para standalone');
assert.ok(html.includes('apple-mobile-web-app-capable'), 'meta apple capable');
assert.ok(html.includes('mobile-web-app-capable'), 'meta mobile-web-app-capable');

console.log('test-pwa-instalar: ok');
