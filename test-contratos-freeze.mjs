#!/usr/bin/env node
/** Contratos: freeze panes (cabeçalho + CÓD/CLIENTE) e scroll no viewport da tabela. */
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
const tableFn = extractFn(html, 'buildContratosCumprimentoTableHtml');
const resumoFn = extractFn(html, 'buildContratosResumoHtml');
const cssStart = html.indexOf('.table-wrap.table-wrap--freeze');
const cssEnd = html.indexOf('table.data-table {', cssStart);
const freezeCss = html.slice(cssStart, cssEnd > cssStart ? cssEnd : cssStart + 8000);

check('não se renomeou filtrarContratosTabela (slice dos testes de docs)', () => {
  assert.ok(html.includes('function filtrarContratosTabela(vend, nivel)'));
});

check('CSS: viewport da tabela (não da página) com max-height e overflow auto', () => {
  assert.ok(freezeCss.includes('position: relative'));
  assert.ok(freezeCss.includes('overflow: auto'));
  assert.ok(/overflow:\s*auto\s*!important/.test(freezeCss));
  assert.ok(freezeCss.includes('max-height: min(70vh, calc(100vh - 220px))'));
  assert.ok(freezeCss.includes('width: 100%'));
});

check('CSS: thead sticky top z-index 3 e fundo sólido', () => {
  assert.ok(freezeCss.includes('position: sticky'));
  assert.ok(freezeCss.includes('top: 0'));
  assert.ok(freezeCss.includes('z-index: 3'));
  assert.ok(freezeCss.includes('background: #f5f5f5'));
});

check('CSS: colunas CÓD/CLIENTE sticky left com offsets acumulados', () => {
  assert.ok(freezeCss.includes('.freeze-1 { left: 0; }'));
  assert.ok(freezeCss.includes('.freeze-2 { left: var(--freeze-1'));
  assert.ok(freezeCss.includes('z-index: 2'));
  assert.ok(freezeCss.includes('z-index: 4'));
  assert.ok(freezeCss.includes('sticky-col-last'));
  assert.ok(freezeCss.includes('box-shadow:'));
});

check('CSS: zebra nas células sticky e badge PDV Multi visível', () => {
  assert.ok(freezeCss.includes('nth-child(odd) td.sticky-col'));
  assert.ok(freezeCss.includes('nth-child(even) td.sticky-col'));
  assert.ok(freezeCss.includes('.ct-pdv-multi-badge'));
  assert.ok(freezeCss.includes('flex-shrink: 0'));
  assert.ok(freezeCss.includes('text-overflow: ellipsis'));
});

check('paint inicial e filtro usam o mesmo helper com table-wrap--freeze', () => {
  assert.ok(loadFn.includes('buildContratosCumprimentoTableHtml(rows)'));
  assert.ok(filtrarFn.includes('buildContratosCumprimentoTableHtml(rows)'));
  assert.ok(tableFn.includes('table-wrap table-wrap--freeze'));
  assert.ok(tableFn.includes('data-table wide'));
  assert.ok(tableFn.includes('sticky-col freeze-1'));
  assert.ok(tableFn.includes('sticky-col freeze-2 sticky-col-last'));
  assert.ok(tableFn.includes('max-height') === false);
});

check('resumo acima da tabela NÃO fica no viewport freeze (drill-down intacto)', () => {
  assert.ok(!resumoFn.includes('table-wrap--freeze'));
  assert.ok(resumoFn.includes('data-nivel'));
  assert.ok(resumoFn.includes('limparFiltroNivelContratos'));
  assert.ok(resumoFn.includes('color:var(--muted);">—</td>'));
  assert.ok(resumoFn.includes('cursor:pointer;text-decoration:underline'));
});

check('NF/Contrato e alertas continuam no helper da tabela', () => {
  assert.ok(/min-width:72px">NF<\/th>/.test(tableFn));
  assert.ok(/min-width:92px">Contrato<\/th>/.test(tableFn));
  assert.ok(tableFn.includes("contratoDocBtnHtml('nf'"));
  assert.ok(tableFn.includes("contratoDocBtnHtml('ct'"));
  assert.ok(tableFn.includes('Contrato Finalizado'));
  assert.ok(tableFn.includes('contratoHtmlCodCliente'));
});

check('Dist contratos em falta e multi-cliente também congelam CÓD/CLIENTE', () => {
  const distChunk = html.slice(
    html.indexOf('id="panel-contratos-falta"'),
    html.indexOf('id="dist-falta-body"') + 80
  );
  assert.ok(distChunk.includes('table-wrap--freeze'));
  assert.ok(distChunk.includes('sticky-col freeze-1'));
  const distRender = extractFn(html, 'renderDistContratosFalta');
  assert.ok(distRender.includes('sticky-col freeze-1'));
  assert.ok(distRender.includes('sticky-col freeze-2 sticky-col-last'));
  const multiFn = extractFn(html, 'renderContratosMultiCliente');
  assert.ok(multiFn.includes('table-wrap--freeze'));
  assert.ok(multiFn.includes('col-contract sticky-col freeze-1'));
  assert.ok(multiFn.includes('col-code sticky-col freeze-2'));
  assert.ok(multiFn.includes('col-nome sticky-col freeze-3 sticky-col-last'));
});

const ctx = {
  console,
  String,
  Array,
  Math,
  Number,
  Date,
  window: {},
  document: { getElementById() { return null; } },
  escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
  contratoDocBtnHtml(tipo, cod, num) {
    return `<button type="button" class="ct-doc-btn" data-upload-tipo="${tipo}" data-upload-cod="${cod}" data-upload-num="${num}">${tipo === 'nf' ? 'NF' : 'Contrato'}</button>`;
  },
};
vm.createContext(ctx);
vm.runInContext(extractFn(html, 'contratoHtmlCodCliente'), ctx);
vm.runInContext(tableFn, ctx);

check('helper gera HTML sticky + pílulas clicáveis + badge PDV Multi', () => {
  const out = ctx.buildContratosCumprimentoTableHtml([
    {
      cod: '442779',
      nome: 'Café Central com nome muito longo para ellipsis',
      contrato: 'B0902/26',
      pdv: 'multi',
      cods: ['442779', '748174'],
      nomes: ['Café Central', 'Café Anexo'],
      inicioFmt: 'Ago/2026',
      fimFmt: 'Ago/2029',
      duracao: 36,
      unidade: 'Capsulas',
      consumoMes: 500,
      totalContratado: 18000,
      consumoEsperado: 1000,
      consumoReal: 400,
      pct: 40,
      pctTotal: 2,
      mesesDecorridos: 2,
      alerta: 'sem_consumo',
    },
  ]);
  assert.ok(out.includes('table-wrap--freeze'));
  assert.ok(out.includes('class="col-code sticky-col freeze-1"'));
  assert.ok(out.includes('class="col-nome sticky-col freeze-2 sticky-col-last"'));
  assert.ok(out.includes('ct-pdv-multi-badge'));
  assert.ok(out.includes('PDV Multi'));
  assert.ok(out.includes('data-upload-tipo="nf"'));
  assert.ok(out.includes('data-upload-tipo="ct"'));
  assert.ok(out.includes('ct-doc-btn'));
  assert.ok(out.includes('Sem Consumo'));
  assert.ok(out.includes('title="Café Central · Café Anexo"') || out.includes('Café Anexo'));
});

if (process.exitCode) process.exit(process.exitCode);
console.log('Todos os testes de freeze panes passaram.');
