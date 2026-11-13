#!/usr/bin/env node
/**
 * Pedido AT: cliente registado com máquina deve aparecer mesmo fora da lista SAP.
 * Caso Nata 7 / 458816 — registo e equipamentos ok, código ausente na última carga SAP.
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
  if (bodyBrace < 0) throw new Error('Corpo em falta: ' + name);
  depth = 0;
  for (let i = bodyBrace; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
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

const ctx = {
  console,
  String,
  Array,
  Object,
  Set,
  Map,
  Math,
  Number,
  parseInt,
  AT_EXCLUIR_EQUIP: ['EQUIPAMENTO PROPRIO'],
  AT_DOMESTICO: 'MAQ DOMESTICA DELTA Q',
  normNomeUtilizador(s) {
    return String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  },
};
vm.createContext(ctx);
for (const name of ['atEquipElegivelTipo', 'atNormCodCliente', 'atFundirClientesRegistoNaLista']) {
  vm.runInContext(extractFn(html, name), ctx);
}

check('cache do Pedido AT inclui o fix fora da lista SAP', () => {
  assert.ok(sw.includes('v2026-11-13-dist-cadastro-email'));
  assert.ok(html.includes('v2026-11-13-dist-cadastro-email'));
  assert.ok(html.includes('atFundirClientesRegistoNaLista'));
  assert.ok(html.includes("fetchRegistosPaginado('cod,nome,cep,vendedor,equipamentos'"));
});

check('Nata 7 com máquina entra no Pedido AT mesmo fora da lista SAP', () => {
  const sap = [
    { cod: '100', nome: 'Cliente SAP', cep: '01000-000', vendedor: 'PAULO FONTES' },
  ];
  const regs = [
    {
      cod: '458816',
      nome: 'Nata 7 Ltda',
      cep: '01310-913',
      vendedor: 'PAULO FONTES',
      equipamentos: [
        { tipo: 'MOINHO RANCILIO KYRO 65 OD', tag: '' },
        { tipo: 'MAQ. MAYOR DIG. 2GR. PRETA', tag: '' },
      ],
    },
    {
      cod: '999',
      nome: 'Outro vendedor',
      vendedor: 'HÉLCIO GRÉGIO',
      equipamentos: [{ tipo: 'MAQ. MAYOR DIG. 2GR. PRETA', tag: '' }],
    },
    {
      cod: '888',
      nome: 'Sem máquina comercial',
      vendedor: 'PAULO FONTES',
      equipamentos: [{ tipo: 'MAQ DOMESTICA DELTA Q', tag: '' }],
    },
  ];
  const out = ctx.atFundirClientesRegistoNaLista(sap, regs, 'PAULO FONTES', 'comercial');
  const cods = out.map(c => String(c.cod));
  assert.ok(cods.includes('100'), 'mantém o cliente da lista SAP');
  assert.ok(cods.includes('458816'), 'junta o Nata 7 do registo');
  assert.ok(!cods.includes('999'), 'não junta cliente de outro vendedor');
  assert.ok(!cods.includes('888'), 'doméstico não entra no pedido comercial');
  const nata = out.find(c => c.cod === '458816');
  assert.equal(nata.nome, 'Nata 7 Ltda');
  assert.equal(nata.cep, '01310-913');
});

check('não duplica se o código já está na lista SAP', () => {
  const sap = [{ cod: '0458816', nome: 'Nata SAP', cep: '1', vendedor: 'PAULO FONTES' }];
  const regs = [{
    cod: '458816',
    nome: 'Nata 7 Ltda',
    cep: '01310-913',
    vendedor: 'PAULO FONTES',
    equipamentos: [{ tipo: 'MAQ. MAYOR DIG. 2GR. PRETA', tag: '' }],
  }];
  const out = ctx.atFundirClientesRegistoNaLista(sap, regs, 'PAULO FONTES', 'comercial');
  assert.equal(out.filter(c => ctx.atNormCodCliente(c.cod) === '458816').length, 1);
  assert.equal(out[0].nome, 'Nata SAP', 'prefere a linha da lista SAP');
});

check('EQUIPAMENTO PROPRIO não é elegível no comercial', () => {
  assert.equal(ctx.atEquipElegivelTipo('EQUIPAMENTO PROPRIO', 'comercial'), false);
  assert.equal(ctx.atEquipElegivelTipo('MAQ. MAYOR DIG. 2GR. PRETA', 'comercial'), true);
  assert.equal(ctx.atEquipElegivelTipo('MAQ DOMESTICA DELTA Q', 'domestico'), true);
  assert.equal(ctx.atEquipElegivelTipo('MAQ DOMESTICA DELTA Q', 'comercial'), false);
});

if (process.exitCode) {
  console.error('\nFalhou.');
  process.exit(1);
}
console.log('\nTudo OK.');
