#!/usr/bin/env node
/**
 * Pedido de Instalação: payload alinhado ao schema de chamados_at
 * (sem cod / nome_cliente / data_instalacao / equipamentos / id UUID).
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

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
  depth = 0;
  for (let i = bodyBrace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('Chaveta não fechou: ' + name);
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

const ctx = { console, String, Array, Object, Date, Math, Number, parseInt };
vm.createContext(ctx);
vm.runInContext(extractFn(html, 'montarPayloadInstalacaoAt'), ctx);

const COLUNAS = new Set([
  'data', 'hora', 'vendedor', 'cliente_cod', 'cliente_nome',
  'equip_tipo', 'equip_tag', 'avaria', 'descricao', 'urgencia',
  'tipo_equip', 'modelo_dom', 'estado', 'numero', 'id',
]);

check('cache do Pedido de Instalação', () => {
  assert.ok(sw.includes('v2026-11-13-exceljs-local'));
  assert.ok(html.includes('v2026-11-13-exceljs-local'));
  assert.ok(html.includes('montarPayloadInstalacaoAt'));
  assert.ok(html.includes('instResolverCliente'));
  assert.ok(!/data_instalacao\s*:/.test(extractFn(html, 'enviarPedidoInstalacao')));
});

check('payload Nata 7 só usa colunas reais de chamados_at', () => {
  const agora = new Date(2026, 10, 12, 15, 14, 0);
  const body = ctx.montarPayloadInstalacaoAt({
    agora,
    cod: '458816',
    nome: 'Nata 7 Ltda',
    vendedor: 'PAULO FONTES',
    equipamentos: [
      { tipo: 'MOINHO MAYOR', tag: '' },
      { tipo: 'MAQ. MAYOR DIG. 2GR. PRETA', tag: '' },
    ],
    dataDesejada: '2026-11-13',
    obs: 'Estacionamento pago bem na frente da loja',
    urgencia: 'Normal',
  });
  Object.keys(body).forEach(k => assert.ok(COLUNAS.has(k), 'coluna inválida: ' + k));
  assert.equal(body.cliente_cod, '458816');
  assert.equal(body.cliente_nome, 'Nata 7 Ltda');
  assert.equal(body.vendedor, 'PAULO FONTES');
  assert.equal(body.tipo_equip, 'instalacao');
  assert.equal(body.avaria, 'Instalação');
  assert.equal(body.urgencia, 'Normal');
  assert.equal(body.estado, 'aberto');
  assert.ok(body.equip_tipo.includes('MOINHO MAYOR'));
  assert.ok(body.equip_tipo.includes('MAQ. MAYOR DIG. 2GR. PRETA'));
  assert.ok(body.descricao.includes('Data desejada:'));
  assert.ok(body.descricao.includes('13/11/2026') || body.descricao.includes('2026-11-13'));
  assert.ok(body.descricao.includes('Estacionamento pago'));
  assert.ok(!('cod' in body));
  assert.ok(!('nome_cliente' in body));
  assert.ok(!('data_instalacao' in body));
  assert.ok(!('equipamentos' in body));
  assert.ok(!('id' in body));
});

if (process.exitCode) {
  console.error('\nFalhou.');
  process.exit(1);
}
console.log('\nTudo OK.');
