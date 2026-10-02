#!/usr/bin/env node
/** Lista SAP: Excel com etiqueta Microsoft não substitui a lista publicada. */
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

const els = {
  'sap-load-status': { style: { display: 'block' } },
  'sap-result': { style: {}, textContent: '' },
};
const ctx = {
  console,
  Uint8Array,
  Math,
  String,
  document: { getElementById(id) { return els[id] || null; } },
  _sapImportBuffer: { novaLista: [{ cod: '1', nome: 'ANTIGO' }] },
  toast(msg, kind) { ctx.lastToast = [msg, kind]; },
};
vm.createContext(ctx);
vm.runInContext(
  [
    'u8ContemUtf16',
    'oleTemMarcadorProtegido',
    'diagnosticoExcelListaSap',
    'mensagemErroLeituraExcel',
    'abortarCargaSAP',
  ].map(n => extractFn(html, n)).join('\n'),
  ctx
);

function oleCom(marca, at) {
  const u8 = new Uint8Array(8192);
  u8[0] = 0xD0; u8[1] = 0xCF; u8[2] = 0x11; u8[3] = 0xE0;
  const o = at == null ? 1152 : at;
  for (let i = 0; i < marca.length; i++) {
    u8[o + i * 2] = marca.charCodeAt(i);
    u8[o + i * 2 + 1] = 0;
  }
  return u8;
}

check('etiqueta Microsoft (EncryptedPackage) é recusada', () => {
  const msg = ctx.diagnosticoExcelListaSap(oleCom('EncryptedPackage'));
  assert.ok(/protegido|sensibilidade/i.test(msg), msg);
  assert.ok(/não foi alterada/i.test(msg), msg);
});

check('.xls antigo sem cifra segue para o leitor', () => {
  const msg = ctx.diagnosticoExcelListaSap(oleCom('Workbook'));
  assert.equal(msg, '');
});

check('.xlsx zip segue para o leitor', () => {
  const u8 = new Uint8Array(16);
  u8[0] = 0x50; u8[1] = 0x4B; u8[2] = 0x03; u8[3] = 0x04;
  assert.equal(ctx.diagnosticoExcelListaSap(u8), '');
});

check('ficheiro vazio ou estranho não segue', () => {
  assert.ok(/não foi alterada/i.test(ctx.diagnosticoExcelListaSap(new Uint8Array(4))));
  const estranho = new Uint8Array(16);
  estranho[0] = 0x3C;
  assert.ok(/não foi alterada/i.test(ctx.diagnosticoExcelListaSap(estranho)));
});

check('erro do SheetJS em ficheiro cifrado explica-se sem apagar a lista', () => {
  const msg = ctx.mensagemErroLeituraExcel(new Error('ECMA-376 Encrypted file missing /EncryptionInfo'));
  assert.ok(/protegido|sensibilidade/i.test(msg), msg);
  assert.ok(/não foi alterada/i.test(msg), msg);
});

check('abortar a carga limpa o buffer e não deixa confirmar', () => {
  ctx._sapImportBuffer = { novaLista: [{ cod: '748133' }] };
  ctx.abortarCargaSAP('parado');
  assert.equal(ctx._sapImportBuffer, null);
  assert.equal(els['sap-load-status'].style.display, 'none');
  assert.equal(els['sap-result'].textContent, 'parado');
  assert.equal(ctx.lastToast[1], 'error');
});

check('a carga chama o diagnóstico antes do XLSX.read e não grava a lista', () => {
  const mark = 'async function carregarListaSAP(';
  const start = html.indexOf(mark);
  assert.ok(start > 0);
  const brace = html.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  const fn = html.slice(start, end);
  const iDiag = fn.indexOf('diagnosticoExcelListaSap');
  const iRead = fn.indexOf('XLSX.read');
  assert.ok(iDiag > 0 && iRead > iDiag);
  assert.ok(fn.includes('_sapImportBuffer = null'));
  assert.ok(fn.includes('abortarCargaSAP'));
  assert.ok(!fn.includes('salvarListaClientesLocal'));
  assert.ok(!fn.includes('publicarListaClientesSupabase'));
  new Function('return ' + fn);
});

if (process.exitCode) process.exit(process.exitCode);
console.log('Testes do Excel protegido passaram.');
