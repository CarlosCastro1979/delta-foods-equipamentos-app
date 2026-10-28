/**
 * Balancete de dívidas: Saldo Total, Saldo Vencido, Vencido +120 dias.
 * A entrada no canal abre a lista; a Área Financeira mostra as três colunas.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const CACHE = 'v2026-10-28-dividas-balancete';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.ok(sw.includes(CACHE), 'sw.js tem ' + CACHE);
assert.ok(html.includes(CACHE), 'index.html tem ' + CACHE);
assert.ok(html.includes('id="tab-dividas-canal"'), 'separador Dívidas no canal');
assert.ok(html.includes('id="panel-dividas-canal"'), 'painel de dívidas do canal');
assert.ok(html.includes("switchTab('dividas-canal')"), 'entrar no canal abre dívidas');
assert.ok(html.includes('Saldo Total') && html.includes('Saldo Vencido') && html.includes('Vencido +120 dias'), 'três colunas');
assert.ok(html.includes('function parseBalanceteDividasSheet'), 'parser do balancete');
assert.ok(html.includes("id: DIVIDAS_BALANCETE_ID") || html.includes('dividas_balancete'), 'grava o balancete');
assert.ok(!html.includes('Excel de dívidas — usa a coluna G'), 'texto antigo da carga saiu');

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

const names = [
  'parseValorDivida',
  'round2Divida',
  'valorDividaNaoZero',
  'normHeaderDivida',
  'celulaCodClienteDivida',
  'parseBalanceteDividasSheet',
  'saldoTotalDivida',
  'saldoVencidoDivida',
  'vencido120Divida',
  'getValorDivida',
];
const src = names.map(n => extractFn(html, n)).join('\n');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src, ctx);

const header = new Array(15).fill('');
header[0] = 'Código';
header[1] = 'Nome';
header[2] = 'Vendedor';
header[7] = 'Saldo Total';       // H
header[13] = 'Vencido +120 dias'; // N
header[14] = 'Saldo Vencido';     // O

const parsed = ctx.parseBalanceteDividasSheet([
  ['Balancete Brasil', 'extra'],
  [],
  header,
  ['004102', 'CAFE DO ZE', 'DIOGO OLIVEIRA', '', '', '', '', '1.234,56', '', '', '', '', '', '400,00', '800,10'],
  ['4102', 'CAFE DO ZE', 'DIOGO OLIVEIRA', '', '', '', '', 10, '', '', '', '', '', 0, 5],
  ['441908', 'ZERO', 'MASSIMO BOTTELLO', '', '', '', '', 0, '', '', '', '', '', 0, 0],
  ['', 'TOTAL', '', '', '', '', '', 999, '', '', '', '', '', 1, 1],
  ['55001', 'SÓ +120', 'HÉLCIO GRÉGIO', '', '', '', '', 0, '', '', '', '', '', '90,5', 0],
]);

assert.equal(parsed.ok, true);
assert.equal(parsed.headerRow, 2);
assert.equal(parsed.cols.saldoTotal, 7);
assert.equal(parsed.cols.vencido120, 13);
assert.equal(parsed.cols.saldoVencido, 14);
assert.equal(parsed.itens.length, 2);
const cafe = parsed.itens.find(i => i.cod === '4102');
assert.ok(cafe, 'soma o mesmo código');
assert.equal(cafe.saldoTotal, 1244.56);
assert.equal(cafe.saldoVencido, 805.1);
assert.equal(cafe.vencido120, 400);
assert.equal(cafe.vendedor, 'DIOGO OLIVEIRA');
const so120 = parsed.itens.find(i => i.cod === '55001');
assert.equal(so120.vencido120, 90.5);
assert.equal(so120.saldoTotal, 0);

// Títulos mandam, mesmo fora das letras H/N/O.
const moved = ctx.parseBalanceteDividasSheet([
  ['Cliente', 'Saldo Vencido', 'Vencido +120 dias', 'Saldo Total', 'Nome'],
  [123456, '10,00', '3,00', '40,00', 'LOJA'],
]);
assert.equal(moved.ok, true);
assert.equal(moved.itens[0].cod, '123456');
assert.equal(moved.itens[0].saldoTotal, 40);
assert.equal(moved.itens[0].saldoVencido, 10);
assert.equal(moved.itens[0].vencido120, 3);
assert.equal(moved.itens[0].nome, 'LOJA');

const legado = ctx.parseBalanceteDividasSheet([
  ['CÓDIGO', 'VENCIDO', 'A VENCER', 'TOTAL'],
  ['100', 10, 5, 15],
]);
assert.equal(legado.ok, false);
assert.equal(legado.quase, undefined);

const semCod = ctx.parseBalanceteDividasSheet([
  ['Nome', 'Saldo Total', 'Saldo Vencido', 'Vencido +120 dias'],
  ['X', 1, 1, 1],
]);
assert.equal(semCod.ok, false);
assert.equal(semCod.quase, true);

const divBal = {
  fonte: 'balancete',
  saldoTotal: 100,
  saldoVencido: 40,
  vencido120: 15,
  total: 100,
  vencido: 100,
};
assert.equal(ctx.saldoTotalDivida(divBal), 100);
assert.equal(ctx.saldoVencidoDivida(divBal), 40);
assert.equal(ctx.vencido120Divida(divBal), 15);
assert.equal(ctx.getValorDivida(divBal), 100);

const legadoDiv = { vencido: 80, total: 80, a120: 20 };
assert.equal(ctx.saldoTotalDivida(legadoDiv), 80);
assert.equal(ctx.saldoVencidoDivida(legadoDiv), 80);
assert.equal(ctx.vencido120Divida(legadoDiv), 20);

console.log('test-dividas-balancete: ok');
