#!/usr/bin/env node
/** Unicidade do nº de contrato — um número = um contrato. */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

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

const context = {
  console,
  normCod(v) { return String(v || '').trim().replace(/^0+/, '') || '0'; },
};
vm.createContext(context);
for (const name of [
  'normNumContrato',
  'isNumContratoPlaceholder',
  'numsContratoDoRegisto',
  'msgContratoJaCriado',
  'encontrarContratoNasLinhas',
  'detectarNumerosContratoDuplicados',
]) {
  vm.runInContext(extractFn(html, name), context);
}

function check(title, fn) {
  try {
    fn();
    console.log('OK  ' + title);
  } catch (e) {
    console.error('FAIL ' + title);
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }
}

check('normaliza espaços e maiúsculas', () => {
  assert.equal(context.normNumContrato('b0029 / 25'), 'B0029/25');
});

check('SEM_COMODATO não conta', () => {
  assert.equal(context.isNumContratoPlaceholder('SEM_COMODATO'), true);
  assert.equal(context.isNumContratoPlaceholder('B0029/25'), false);
});

check('recolhe nº do campo, Horeca e Dist', () => {
  const nums = context.numsContratoDoRegisto({
    contrato: 'A001, B002',
    contratos: [{ num: 'A001' }, { num: 'C003' }],
    dist_contratos: [{ numero: 'D004' }],
  });
  assert.deepEqual(nums.map(n => context.normNumContrato(n)).sort(), ['A001', 'B002', 'C003', 'D004']);
});

const rows = [
  { id: '1', cod: '100', nome: 'Cliente A', contrato: 'B0029/25' },
  { id: '2', cod: '200', nome: 'Cliente B', contratos: [{ num: 'b0029 / 25' }] },
  { id: '3', cod: '300', nome: 'Cliente C', contrato: 'X111' },
];

check('mesmo número em dois clientes é duplicado', () => {
  const hit = context.encontrarContratoNasLinhas('B0029/25', rows);
  assert.ok(hit);
  assert.equal(hit.cod, '100');
});

check('editar o mesmo cliente (exceptId) não dispara', () => {
  const hit = context.encontrarContratoNasLinhas('X111', rows, { exceptId: '3' });
  assert.equal(hit, null);
});

check('gerar de novo o mesmo nº (sem except) encontra o existente', () => {
  const hit = context.encontrarContratoNasLinhas('X111', rows);
  assert.ok(hit);
  assert.equal(hit.cod, '300');
});

check('mensagem diz que o contrato já foi criado', () => {
  const msg = context.msgContratoJaCriado('B0029/25', { cod: '100', nome: 'Cliente A' });
  assert.ok(/já foi criado/i.test(msg));
  assert.ok(msg.includes('B0029/25'));
  assert.ok(msg.includes('100'));
});

check('detecta números repetidos entre clientes', () => {
  const dups = context.detectarNumerosContratoDuplicados(rows);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].key, 'B0029/25');
  assert.equal(dups[0].clientes.length, 2);
});

check('index.html bloqueia gerar/guardar se o nº já existe', () => {
  assert.ok(html.includes('erroSeContratoJaCriado(numGerar)'));
  assert.ok(html.includes('dupNovo'));
  assert.ok(html.includes('dupEdit'));
  assert.ok(!html.includes('actualizar se sim, adicionar se não'));
});

if (process.exitCode) {
  console.error('\nFalhou pelo menos um teste.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes de contrato único passaram.');
