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

check('gravação NF/Contrato espera o PATCH em docs (não fire-and-forget com HEADERS)', () => {
  const persist = extractFn(html, 'contratoDocsPersistSupabase');
  const many = extractFn(html, 'contratoDocsPersistMany');
  const up = extractFn(html, 'contratoUploadPdf');
  const modal = extractFn(html, 'contratoDocsUpload');
  const del = extractFn(html, 'contratoDocsDelete');
  const fazer = extractFn(html, 'contratoDocsFazerUpload');
  assert.ok(many.includes('registosReadHeaders'));
  assert.ok(many.includes("method: 'PATCH'"));
  assert.ok(!many.includes('headers: HEADERS') && !many.includes('headers:HEADERS'));
  assert.ok(persist.includes('contratoDocsPersistMany'));
  assert.ok(fazer.includes('await contratoDocsPersistSupabase'));
  assert.ok(up.includes('contratoDocsFazerUpload'));
  assert.ok(modal.includes('contratoDocsFazerUpload'));
  assert.ok(del.includes('await contratoDocsPersistSupabase'));
  assert.ok(!del.includes('headers:HEADERS') && !del.includes('headers: HEADERS'));
});

check('abre a lista a partir do Storage e sincroniza o JSON docs', () => {
  assert.ok(filtrarFn.includes('contratoDocsHydrateFromStorage'));
  assert.ok(html.includes('contratoDocsHydrateFromStorage(window._contratosAllRows)'));
  assert.ok(html.includes('contratoDocsListStorageFiles'));
  assert.ok(html.includes('contratoDocsPersistMany(pending)'));
  assert.ok(html.includes("STORAGE_LIST = 'https://qnscwppgljobelplgbkp.supabase.co/storage/v1/object/list/'"));
});

const context = {
  console,
  String,
  document: { querySelectorAll() { return []; } },
  window: {},
  localStorage: {
    _s: Object.create(null),
    getItem(k) { return k in this._s ? this._s[k] : null; },
    setItem(k, v) { this._s[k] = String(v); },
    removeItem(k) { delete this._s[k]; },
  },
};
vm.createContext(context);
for (const name of [
  'normNumContrato',
  'contratoDocsExtensao',
  'contratoDocFileName',
  'contratoDocsProximoNome',
  'contratoDocsTipoFicheiro',
  'contratoDocsIsStorageFile',
  'contratoDocsNormLista',
  'contratoDocsListaCanon',
  'contratoDocsValorOk',
  'contratoDocsMergeValor',
  'contratoDocsContagem',
  'numsContratoEquivalentes',
  'contratoDocsCampo',
  'contratoDocsPickEntry',
  'contratoDocsParseStoragePath',
  'contratoDocsApplyFlags',
  'contratoDocsLidos',
  'contratoDocBtnHtml',
  'contratoDocsSetLoaded',
]) {
  vm.runInContext(extractFn(html, name), context);
}

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

check('B0902 e B0902/26 são o mesmo número de contrato', () => {
  assert.ok(context.numsContratoEquivalentes('B0902', 'B0902/26'));
  assert.ok(context.numsContratoEquivalentes('B0027/26', 'B0027 / 26'));
  assert.ok(!context.numsContratoEquivalentes('B0902', 'B0001/24'));
});

check('caminho Storage com / no nº (cod/B0027/26/nf.pdf)', () => {
  const nf = context.contratoDocsParseStoragePath('421542/B0027/26/nf.pdf');
  assert.deepEqual(nf, { cod: '421542', num: 'B0027/26', tipo: 'nf', path: '421542/B0027/26/nf.pdf' });
  const ct = context.contratoDocsParseStoragePath('753534/B0902/26/contrato_assinado.pdf');
  assert.equal(ct.cod, '753534');
  assert.equal(ct.num, 'B0902/26');
  assert.equal(ct.tipo, 'ct');
  assert.equal(context.contratoDocsParseStoragePath('previsao/x.json'), null);
});

check('qualquer ficheiro anexado conta como OK (não se lê o PDF)', () => {
  assert.equal(context.contratoDocsExtensao('nota.docx'), '.docx');
  assert.equal(context.contratoDocsExtensao('ficheiro.sem.ext'), '.ext');
  assert.equal(context.contratoDocFileName('nf', 'nota.docx'), 'nf.docx');
  assert.equal(context.contratoDocFileName('ct', 'scan.jpg'), 'contrato_assinado.jpg');
  assert.equal(context.contratoDocsTipoFicheiro('nf.docx'), 'nf');
  assert.equal(context.contratoDocsTipoFicheiro('contrato_assinado.jpg'), 'ct');
  assert.equal(context.contratoDocsTipoFicheiro('scan.png'), 'ct');
  assert.equal(context.contratoDocsValorOk('456320/B0902/26/nf.docx'), true);
  assert.equal(context.contratoDocsCampo({ 'B0902/26': { nf: '456320/B0902/26/nf.docx' } }, 'B0902/26', 'nf'), '456320/B0902/26/nf.docx');
  const word = context.contratoDocsParseStoragePath('421542/B0027/26/nf.docx');
  assert.equal(word.tipo, 'nf');
  assert.equal(context.contratoDocsParseStoragePath('753534/B0902/26/scan.png').tipo, 'ct');
  assert.equal(context.contratoDocsIsStorageFile({ name: 'nf.docx', id: 'abc' }), true);
  assert.equal(context.contratoDocsIsStorageFile({ name: '456320', id: null, metadata: null }), false);
  const up = extractFn(html, 'contratoUploadPdf');
  const modal = extractFn(html, 'contratoDocsUpload');
  const list = extractFn(html, 'contratoDocsListStorageFiles');
  assert.ok(html.includes('contratoDocsMime'));
  assert.ok(!/input\.accept = 'application\/pdf'/.test(up));
  assert.ok(!/input\.accept = 'application\/pdf'/.test(modal));
  assert.ok(!/Apenas PDFs são aceites/.test(up));
  assert.ok(!/Apenas PDFs são aceites/.test(modal));
  assert.ok(html.includes('⬆ Adicionar ficheiro'));
  assert.ok(!list.includes('if (!/\\.pdf$/i.test(it.name)) continue;'));
  assert.ok(!/\.pdf\$\/i\.test\(name\)/.test(list));
  assert.ok(list.includes('contratoDocsIsStorageFile'));
});

check('false no JSON docs não conta como carregado', () => {
  assert.equal(context.contratoDocsValorOk(false), false);
  assert.equal(context.contratoDocsValorOk(null), false);
  assert.equal(context.contratoDocsValorOk(''), false);
  assert.equal(context.contratoDocsValorOk(true), true);
  assert.equal(context.contratoDocsValorOk('753534/B0902/26/nf.pdf'), true);
});

check('chave B0902 pinta a linha B0902/26; {} vazio não tapa o PDF', () => {
  const docs = {
    B0902: { nf: '753534/B0902/26/nf.pdf' },
    'B0902/26': {},
  };
  const e = context.contratoDocsPickEntry(docs, 'B0902/26');
  assert.equal(e.nf, '753534/B0902/26/nf.pdf');
  assert.equal(e.ct, undefined);
});

check('localStorage vazio não esconde docs do servidor', () => {
  context.window._contratosDocsMap = {
    794161: { '031/2022': { nf: '794161/031/2022/nf.pdf', ct: '794161/031/2022/contrato_assinado.pdf' } },
  };
  context.localStorage.removeItem('delta_docs_794161');
  const st = context.contratoDocsLidos('794161', '031/2022');
  assert.equal(st.nf, true);
  assert.equal(st.ct, true);
});

check('localStorage false (apagado) prevalece sobre o servidor', () => {
  context.window._contratosDocsMap = {
    794161: { '031/2022': { nf: '794161/031/2022/nf.pdf' } },
  };
  context.localStorage.setItem('delta_docs_794161', JSON.stringify({ '031/2022': { nf: false } }));
  const st = context.contratoDocsLidos('794161', '031/2022');
  assert.equal(st.nf, false);
});

check('PATCH docs aplica NF e CT no mesmo objecto (sem uma gravar por cima da outra)', () => {
  const docs = context.contratoDocsApplyFlags({}, '031/2022', 'nf', '794161/031/2022/nf.pdf');
  context.contratoDocsApplyFlags(docs, '031/2022', 'ct', '794161/031/2022/contrato_assinado.pdf');
  assert.equal(docs['031/2022'].nf, '794161/031/2022/nf.pdf');
  assert.equal(docs['031/2022'].ct, '794161/031/2022/contrato_assinado.pdf');
  const split = context.contratoDocsApplyFlags(
    { B0902: { nf: '753534/B0902/26/nf.pdf' }, 'B0902/26': {} },
    'B0902/26',
    'ct',
    '753534/B0902/26/contrato_assinado.pdf'
  );
  assert.equal(split.B0902.ct, '753534/B0902/26/contrato_assinado.pdf');
  assert.equal(split['B0902/26'].ct, '753534/B0902/26/contrato_assinado.pdf');
  assert.equal(split.B0902.nf, '753534/B0902/26/nf.pdf');
});

check('lista de ficheiros: string para 1, array para 2+', () => {
  assert.equal(context.contratoDocsValorOk(['a/nf.pdf', 'a/nf_2.pdf']), true);
  assert.equal(context.contratoDocsValorOk([]), false);
  assert.deepEqual(context.contratoDocsNormLista('cod/B1/nf.pdf'), ['cod/B1/nf.pdf']);
  assert.deepEqual(context.contratoDocsNormLista(['cod/B1/nf.pdf', 'cod/B1/nf_2.pdf']), ['cod/B1/nf.pdf', 'cod/B1/nf_2.pdf']);
  assert.deepEqual(context.contratoDocsListaCanon(['x', 'x', 'y']), ['x', 'y']);
  const two = context.contratoDocsListaCanon(['cod/B1/nf.pdf', 'cod/B1/nf_2.pdf']);
  assert.ok(Array.isArray(two) && two.length === 2);
  assert.equal(context.contratoDocsListaCanon(['so-um.pdf']), 'so-um.pdf');
  const docs = context.contratoDocsApplyFlags({}, 'B1', 'nf', 'cod/B1/nf.pdf');
  assert.equal(docs.B1.nf, 'cod/B1/nf.pdf');
  context.contratoDocsApplyFlags(docs, 'B1', 'nf', 'cod/B1/nf_2.pdf');
  assert.deepEqual(docs.B1.nf, ['cod/B1/nf.pdf', 'cod/B1/nf_2.pdf']);
  context.contratoDocsApplyFlags(docs, 'B1', 'nf', 'cod/B1/nf_2.pdf', 'remove');
  assert.equal(docs.B1.nf, 'cod/B1/nf.pdf');
});

check('nf_2.pdf é NF; próximo nome incrementa', () => {
  assert.equal(context.contratoDocsTipoFicheiro('nf_2.pdf'), 'nf');
  assert.equal(context.contratoDocsTipoFicheiro('nf-3.jpg'), 'nf');
  assert.equal(context.contratoDocFileName('nf', 'nota.docx'), 'nf.docx');
  assert.equal(context.contratoDocFileName('nf', 'nota.docx', 2), 'nf_2.docx');
  assert.equal(context.contratoDocsProximoNome('nf', 'x.pdf', ['cod/B1/nf.pdf']), 'nf_2.pdf');
});

check('upload acrescenta e não apaga os outros do mesmo tipo; modal Adicionar', () => {
  const up = extractFn(html, 'contratoUploadPdf');
  const modal = extractFn(html, 'contratoDocsUpload');
  const fazer = extractFn(html, 'contratoDocsFazerUpload');
  const abrir = extractFn(html, 'contratoAbrirDocs');
  assert.ok(!up.includes('contratoDocsApagarOutrosDoTipo'));
  assert.ok(!modal.includes('contratoDocsApagarOutrosDoTipo'));
  assert.ok(!fazer.includes('contratoDocsApagarOutrosDoTipo'));
  assert.ok(abrir.includes('Adicionar ficheiro'));
  assert.ok(html.includes('Adicionar ficheiro'));
  assert.ok(up.includes('multiple = true') || up.includes('input.multiple'));
  assert.ok(modal.includes('multiple = true') || modal.includes('input.multiple'));
});

if (process.exitCode) {
  console.error('\nFalhou pelo menos um teste de docs NF/Contrato.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes de docs NF/Contrato passaram.');
