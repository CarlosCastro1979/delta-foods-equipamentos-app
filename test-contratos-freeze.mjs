#!/usr/bin/env node
/** Contratos → Cumprimento: freeze panes (cabeçalho + CÓD/CLIENTE) e scroll no viewport da tabela. */
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

const loadFn = html.slice(
  html.indexOf('async function loadContratosTab'),
  html.indexOf('function filtrarContratosTabela')
);
const filtrarFn = extractFn(html, 'filtrarContratosVendedor');
const helperFn = extractFn(html, 'buildContratosCumprimentoTableHtml');
const resumoFn = extractFn(html, 'buildContratosResumoHtml');
const multiFn = extractFn(html, 'renderContratosMultiCliente');
const cacheFn = extractFn(html, 'renderContratosFromCache');
const tabelaFn = extractFn(html, 'filtrarContratosTabela');

check('CSS freeze: viewport da tabela com overflow e max-height', () => {
  assert.ok(html.includes('.table-wrap.table-wrap--freeze'));
  assert.ok(html.includes('max-height: min(70vh, calc(100vh - 220px))'));
  assert.ok(/overflow:\s*auto\s*!important/.test(html));
  assert.ok(html.includes('position: sticky'));
  assert.ok(html.includes('.freeze-1'));
  assert.ok(html.includes('.freeze-2'));
  assert.ok(html.includes('sticky-col-last'));
  assert.ok(html.includes('z-index: 3'));
  assert.ok(html.includes('z-index: 4'));
});

check('não se renomeia filtrarContratosTabela (slice dos testes de docs/cache)', () => {
  assert.ok(tabelaFn.startsWith('function filtrarContratosTabela'));
  assert.ok(html.includes('function filtrarContratosTabela(vend, nivel)'));
});

check('helper pinta freeze + NF/Contrato + PDV badge classes', () => {
  assert.ok(helperFn.includes('table-wrap table-wrap--freeze'));
  assert.ok(helperFn.includes('data-table wide'));
  assert.ok(helperFn.includes('sticky-col freeze-1'));
  assert.ok(helperFn.includes('sticky-col freeze-2 sticky-col-last'));
  assert.ok(/min-width:72px">NF<\/th>/.test(helperFn));
  assert.ok(/min-width:92px">Contrato<\/th>/.test(helperFn));
  assert.ok(helperFn.includes("contratoDocBtnHtml('nf'"));
  assert.ok(helperFn.includes("contratoDocBtnHtml('ct'"));
  assert.ok(helperFn.includes('contratoHtmlCodCliente'));
});

check('loadContratosTab e filtrarContratosVendedor usam o mesmo helper', () => {
  assert.ok(loadFn.includes('buildContratosCumprimentoTableHtml(rows)'));
  assert.ok(filtrarFn.includes('buildContratosCumprimentoTableHtml(rows)'));
  assert.ok(filtrarFn.includes('table-wrap--freeze') || helperFn.includes('table-wrap--freeze'));
  assert.ok(filtrarFn.includes('contratosSyncFreezeOffsets'));
});

check('resumo por vendedor (drill-down) NÃO usa freeze no wrap', () => {
  assert.ok(resumoFn.includes('class="table-wrap"'));
  assert.ok(!resumoFn.includes('table-wrap--freeze'));
  assert.ok(resumoFn.includes('limparFiltroNivelContratos'));
  assert.ok(resumoFn.includes('data-nivel'));
  assert.ok(resumoFn.includes('color:var(--muted);">—</td>') || resumoFn.includes("color:var(--muted);\">—</td>"));
});

check('Dist/multi-cliente detalhe também tem freeze panes', () => {
  assert.ok(multiFn.includes('table-wrap table-wrap--freeze'));
  assert.ok(multiFn.includes('sticky-col freeze-1'));
  assert.ok(multiFn.includes('sticky-col freeze-2'));
  assert.ok(multiFn.includes('sticky-col freeze-3 sticky-col-last'));
  assert.ok(multiFn.includes('contratosSyncFreezeOffsets'));
  assert.ok(!multiFn.includes('overflow-x:auto;width:100%'));
});

check('cache HTML reaplica offsets sticky', () => {
  assert.ok(cacheFn.includes('contratosSyncFreezeOffsets'));
});

check('CÓD congelado mantém badge PDV Multi', () => {
  const codFn = extractFn(html, 'contratoHtmlCodCliente');
  assert.ok(codFn.includes('ct-cod-freeze'));
  assert.ok(codFn.includes('ct-pdv-multi-badge'));
  assert.ok(codFn.includes('PDV Multi'));
});

const context = {
  console,
  String,
  Math,
  Number,
  Array,
  window: {},
  document: { querySelectorAll() { return []; } },
};
vm.createContext(context);
for (const name of [
  'escHtml',
  'contratoHtmlCodCliente',
  'contratoDocBtnHtml',
  'buildContratosCumprimentoTableHtml',
]) {
  vm.runInContext(extractFn(html, name), context);
}

check('helper gera HTML sticky com pills clicáveis e PDV Multi visível', () => {
  const out = context.buildContratosCumprimentoTableHtml([{
    cod: '442779',
    nome: 'Café Central',
    pdv: 'multi',
    cods: ['442779', '748174'],
    nomes: ['Café Central', 'Café Anexo'],
    contrato: 'B0902/26',
    inicioFmt: 'Ago/2026',
    fimFmt: 'Ago/2029',
    duracao: 36,
    unidade: 'Capsulas',
    consumoMes: 500,
    totalContratado: 18000,
    consumoEsperado: 500,
    consumoReal: 200,
    pct: 40,
    pctTotal: 1,
    mesesDecorridos: 1,
    alerta: 'sem_consumo',
  }]);
  assert.ok(out.includes('table-wrap--freeze'));
  assert.ok(out.includes('data-table wide'));
  assert.ok(out.includes('sticky-col freeze-1'));
  assert.ok(out.includes('sticky-col-last'));
  assert.ok(out.includes('PDV Multi'));
  assert.ok(out.includes('442779'));
  assert.ok(out.includes('class="ct-doc-btn"'));
  assert.ok(out.includes('data-upload-tipo="nf"'));
  assert.ok(out.includes('data-upload-tipo="ct"'));
  assert.ok(out.includes('Sem Consumo'));
  assert.ok(!out.includes('[object Object]'));
});

if (process.exitCode) process.exit(process.exitCode);
console.log('test-contratos-freeze: todos os checks passaram');
