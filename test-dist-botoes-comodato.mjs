#!/usr/bin/env node
/**
 * Dist Por registar: dois botões gravam a decisão.
 * Comodato abre o menu com anexos de NF e contrato.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const CACHE = 'v2026-11-24-dist-sem-equip-auto';

assert.ok(html.includes(CACHE));
assert.ok(sw.includes(CACHE));
assert.ok(/<!--\s*dfb-build:[^>]*dist-sem-equip-auto[^>]*-->/.test(html.slice(0, 400)));
assert.ok(!html.includes('Indicar comodato'));
assert.ok(html.includes('data-dist-decisao="comodato"'));
assert.ok(html.includes('data-dist-decisao="sem"'));
assert.ok(html.includes('>comodato</button>'));
assert.ok(html.includes('>sem comodatos</button>'));
assert.ok(html.includes('function distRegistarPorDecisao'));
assert.ok(html.includes('function distClientePodeAutoSemComodato'));
assert.ok(html.includes('function distAutoMarcarSemComodato'));
assert.ok(html.includes('Quem tem equipamentos na carga preenche o comodato'));
assert.ok(html.includes('tem_comodato: !!comComodato'));
assert.ok(html.includes("contrato: 'SEM_COMODATO'"));
assert.ok(html.includes('function distAbrirDocDoCard'));
assert.ok(html.includes("contratoAbrirDocs(cod, num, tipo)"));
assert.ok(html.includes('decidido.tem_comodato === false'));
assert.ok(html.includes('O cadastro e o MC00 estão nas abas acima.'));

console.log('test-dist-botoes-comodato: ok');
