#!/usr/bin/env node
/** Contratos → Registados: colunas visíveis NF | Contrato (verde quando carregado). */
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
const filtrarFn = html.slice(
  html.indexOf('function filtrarContratosVendedor'),
  html.indexOf('const STORAGE_BUCKET')
);
const markFn = extractFn(html, 'contratoMarkExisting');
const abrirFn = extractFn(html, 'contratoAbrirDocs');
const marcarFn = extractFn(html, 'contratoMarcarBotao');

check('CSS .ct-doc-btn e .ct-doc-btn.is-loaded', () => {
  assert.ok(html.includes('.ct-doc-btn {'));
  assert.ok(html.includes('.ct-doc-btn.is-loaded'));
  assert.ok(html.includes('#docs-row-nf.is-loaded'));
  assert.ok(html.includes('#docs-row-ct.is-loaded'));
  assert.ok(html.includes('background: #ecfdf5'));
});

check('tabela principal tem colunas NF e Contrato (não 📄 DOCS)', () => {
  assert.ok(/min-width:72px">NF<\/th>/.test(loadFn));
  assert.ok(/min-width:92px">Contrato<\/th>/.test(loadFn));
  assert.ok(!loadFn.includes('📄 DOCS'));
  assert.ok(!loadFn.includes('>📁<'));
  assert.equal((loadFn.match(/contratoDocBtnHtml\('nf'/g) || []).length, 1);
  assert.equal((loadFn.match(/contratoDocBtnHtml\('ct'/g) || []).length, 1);
});

check('tabela filtrada tem colunas NF e Contrato (não 📄 DOCS)', () => {
  assert.ok(/min-width:72px">NF<\/th>/.test(filtrarFn));
  assert.ok(/min-width:92px">Contrato<\/th>/.test(filtrarFn));
  assert.ok(!filtrarFn.includes('📄 DOCS'));
  assert.ok(!filtrarFn.includes('>📁<'));
  assert.equal((filtrarFn.match(/contratoDocBtnHtml\('nf'/g) || []).length, 1);
  assert.equal((filtrarFn.match(/contratoDocBtnHtml\('ct'/g) || []).length, 1);
});

check('nenhuma coluna única 📁/📄 DOCS nas tabelas de contratos', () => {
  assert.ok(!loadFn.includes('📄 DOCS'));
  assert.ok(!filtrarFn.includes('📄 DOCS'));
  assert.ok(!html.includes('>📄 DOCS<'));
  assert.ok(!markFn.includes('📁'));
  assert.ok(!abrirFn.includes('📁'));
  assert.ok(!marcarFn.includes('📁'));
});

check('contratoMarkExisting pinta as pílulas via contratoDocsRefreshRow', () => {
  assert.ok(markFn.includes('contratoDocsRefreshRow(cod, num)'));
  assert.ok(!markFn.includes("button[onclick*=\"contratoAbrirDocs"));
});

check('contratoMarcarBotao pinta NF e Contrato em separado', () => {
  assert.ok(marcarFn.includes('contratoDocsSetLoaded'));
  assert.ok(marcarFn.includes("btn.dataset.uploadTipo === tipo"));
});

check('contratoAbrirDocs destaca a linha do modal (nf vs ct) a verde', () => {
  assert.ok(abrirFn.includes('focusTipo'));
  assert.ok(abrirFn.includes('#ecfdf5'));
  assert.ok(abrirFn.includes("classList.toggle('is-loaded'"));
  assert.ok(abrirFn.includes("classList.toggle('is-focus'"));
  assert.ok(abrirFn.includes('this.dataset.docsCod'));
});

check('contratoUploadPdf mantém ✅ NF / ✅ CT e is-loaded', () => {
  const up = extractFn(html, 'contratoUploadPdf');
  assert.ok(up.includes("'✅ NF'"));
  assert.ok(up.includes("'✅ CT'"));
  assert.ok(up.includes("classList.add('is-loaded')"));
  assert.ok(up.includes('contratoMarcarBotao'));
});

const context = {
  console,
  String,
  document: { querySelectorAll() { return []; } },
};
vm.createContext(context);
vm.runInContext(extractFn(html, 'contratoDocBtnHtml'), context);
vm.runInContext(extractFn(html, 'contratoDocsSetLoaded'), context);

check('nº de contrato com / vai no data-attribute, não parte o onclick', () => {
  const btn = context.contratoDocBtnHtml('ct', '100', 'B0029/25');
  assert.ok(btn.includes('class="ct-doc-btn"'));
  assert.ok(btn.includes('data-upload-num="B0029/25"'));
  assert.ok(btn.includes('data-upload-tipo="ct"'));
  assert.ok(btn.includes('this.dataset.uploadCod'));
  assert.ok(btn.includes('this.dataset.uploadNum'));
  assert.ok(!btn.includes("contratoAbrirDocs('100','B0029/25'"));
  const nf = context.contratoDocBtnHtml('nf', '100', 'B0029/25');
  assert.ok(nf.includes('>NF</button>'));
  assert.ok(btn.includes('>Contrato</button>'));
});

check('contratoDocsSetLoaded liga/desliga is-loaded e o visto', () => {
  const el = {
    dataset: { uploadTipo: 'nf' },
    classList: {
      _s: new Set(),
      toggle(name, on) { if (on) this._s.add(name); else this._s.delete(name); },
      contains(name) { return this._s.has(name); },
    },
    style: {},
    textContent: 'NF',
    title: '',
  };
  context.contratoDocsSetLoaded(el, true);
  assert.ok(el.classList.contains('is-loaded'));
  assert.equal(el.textContent, '✅ NF');
  assert.equal(el.dataset.hasDoc, '1');
  context.contratoDocsSetLoaded(el, false);
  assert.ok(!el.classList.contains('is-loaded'));
  assert.equal(el.textContent, 'NF');
  const ct = {
    dataset: { uploadTipo: 'ct' },
    classList: {
      _s: new Set(),
      toggle(name, on) { if (on) this._s.add(name); else this._s.delete(name); },
      contains(name) { return this._s.has(name); },
    },
    style: {},
    textContent: 'Contrato',
    title: '',
  };
  context.contratoDocsSetLoaded(ct, true);
  assert.equal(ct.textContent, '✅ Contrato');
  assert.ok(ct.classList.contains('is-loaded'));
});

if (process.exitCode) {
  console.error('\nFalhou pelo menos um teste de docs NF/Contrato.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes de docs NF/Contrato passaram.');
