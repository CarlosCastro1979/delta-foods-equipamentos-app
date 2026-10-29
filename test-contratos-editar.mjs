#!/usr/bin/env node
/**
 * Editar contrato em Registados: corrigir nº + campos, persistir, permissões Dist.
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const CACHE = 'v2026-10-29-dividas-cod-cliente';

function extractFn(src, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) throw new Error('Função em falta: ' + name);
  let start = m.index;
  const brace = src.indexOf('{', m.index);
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

check('cache SW e UI de edição presentes', () => {
  assert.ok(sw.includes(CACHE), 'sw.js tem ' + CACHE);
  assert.ok(html.includes(CACHE), 'index.html tem ' + CACHE);
  assert.ok(html.includes('ct-editar-modal'));
  assert.ok(html.includes('abrirEditarContratoRegistado'));
  assert.ok(html.includes('guardarEditarContratoRegistado'));
  assert.ok(html.includes('fecharEditarContratoRegistado'));
  assert.ok(html.includes('podeEditarContratoRegistado'));
  assert.ok(html.includes('aplicarEdicaoContratoArray'));
  assert.ok(html.includes('contratoDocsRenameNum'));
  assert.ok(html.includes('data-ct-edit-cod'));
  assert.ok(html.includes('>Editar</button>'));
  assert.ok(html.includes('ct-edit-num'));
  assert.ok(html.includes('Guardar alterações'));
  assert.ok(html.includes('table-wrap--freeze'));
  assert.ok(html.includes('filtrarContratosTabela'));
  assert.ok(html.includes('limparFiltroNivelContratos'));
  assert.ok(html.includes('regId: principalReg.id'));
  assert.ok(html.includes('inicio: c.inicio'));
});

function makeBaseCtx() {
  const store = Object.create(null);
  const ctx = {
    console,
    String,
    Array,
    Object,
    Set,
    Map,
    Number,
    parseInt,
    parseFloat,
    isNaN,
    Date,
    JSON,
    Promise,
    window: { _contratosAllRows: [], _ctEditCtx: null },
    localStorage: {
      getItem(k) { return k in store ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; },
    },
    _user: '',
    _admin: false,
    _dist: false,
    _horeca: false,
    normCod(v) { return String(v || '').trim().replace(/^0+/, '') || '0'; },
    normNomeUtilizador(n) {
      return String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
    },
    getUtilizadorAtual() { return ctx._user || ''; },
    isAdmin() { return !!ctx._admin; },
    isCanalDistribuidores() { return !!ctx._dist; },
    isCanalHorecaActivo() { return !!ctx._horeca; },
    HORECA_VE_TUDO: ['FILIPE NEVES'],
    getVendedoresNomesDoCanal(id) {
      if (id === 'distribuidores') return ['MASSIMO BOTTELLO', 'EDUARDO MADEIRA'];
      return [];
    },
    podeEditarRegisto(vendedor) {
      if (ctx.isAdmin()) return true;
      return ctx.normNomeUtilizador(ctx.getUtilizadorAtual())
        === ctx.normNomeUtilizador(vendedor);
    },
    toast() {},
    contratoDocsMergeValor(existing, incoming) {
      if (incoming == null) return existing;
      if (existing == null) return incoming;
      return incoming;
    },
  };
  vm.createContext(ctx);
  for (const name of [
    'normNumContrato',
    'isNumContratoPlaceholder',
    'numsContratoIguais',
    'validarDataContrato',
    'contratoDocsRenameNum',
    'aplicarEdicaoContratoArray',
    'podeEditarContratoRegistado',
    'encontrarLinhaContratoRegistado',
  ]) {
    vm.runInContext(extractFn(html, name), ctx);
  }
  return ctx;
}

const context = makeBaseCtx();

check('aplicarEdicaoContratoArray corrige o número e preserva gamas', () => {
  const contratos = [{
    num: 'B0026/26',
    inicio: '2026-10',
    duracao: 48,
    consumo: 72,
    unidade: 'Kg',
    lote: 'L1',
    gamas: [{ lote: 'A', unidade: 'Kg', consumo: 40 }, { lote: 'B', unidade: 'Kg', consumo: 32 }],
  }];
  const out = context.aplicarEdicaoContratoArray(contratos, 'B0026/26', {
    num: 'B0099/26',
    inicio: '2026-09',
    duracao: 36,
    consumo: 80,
    unidade: 'Kg',
  });
  assert.equal(out.found, true);
  assert.equal(out.changed, true);
  assert.equal(out.list[0].num, 'B0099/26');
  assert.equal(out.list[0].inicio, '2026-09');
  assert.equal(out.list[0].duracao, 36);
  assert.equal(out.list[0].consumo, 80);
  assert.equal(out.list[0].lote, 'L1');
  assert.equal(out.list[0].gamas.length, 2);
  assert.equal(contratos[0].num, 'B0026/26', 'original imutável');
});

check('aplicarEdicaoContratoArray não encontra nº errado', () => {
  const out = context.aplicarEdicaoContratoArray(
    [{ num: 'B0001/26', inicio: '2026-01', duracao: 12, consumo: 10, unidade: 'Kg' }],
    'B0026/26',
    { num: 'X' }
  );
  assert.equal(out.found, false);
  assert.equal(out.changed, false);
});

check('contratoDocsRenameNum migra chaves NF/CT', () => {
  const docs = {
    'B0026/26': { nf: '458532/B0026/26/nf.pdf', ct: true },
    'OUTRO': { nf: 'x' },
  };
  const next = context.contratoDocsRenameNum(docs, 'B0026/26', 'B0099/26');
  assert.ok(!next['B0026/26']);
  assert.equal(next['B0099/26'].nf, '458532/B0026/26/nf.pdf');
  assert.equal(next['B0099/26'].ct, true);
  assert.equal(next.OUTRO.nf, 'x');
});

check('permissões: Dist pair Massimo edita Eduardo', () => {
  context._admin = false;
  context._dist = true;
  context._horeca = false;
  context._user = 'Massimo Bottello';
  assert.equal(context.podeEditarContratoRegistado('Eduardo Madeira'), true);
  assert.equal(context.podeEditarContratoRegistado('Massimo Bottello'), true);
});

check('permissões: Horeca só o próprio (ou admin)', () => {
  context._admin = false;
  context._dist = false;
  context._horeca = true;
  context._user = 'Paulo Fontes';
  assert.equal(context.podeEditarContratoRegistado('Paulo Fontes'), true);
  assert.equal(context.podeEditarContratoRegistado('Daniela Santos'), false);
  context._admin = true;
  assert.equal(context.podeEditarContratoRegistado('Daniela Santos'), true);
});

check('encontrarLinhaContratoRegistado por cod+num (caso imagem)', () => {
  context.window._contratosAllRows = [{
    cod: '458532',
    nome: 'BEER BEV',
    vendedor: 'Eduardo Madeira',
    contrato: 'B0026/26',
    inicio: '2026-10',
    duracao: 48,
    consumoMes: 72,
    unidade: 'Kg',
  }];
  const hit = context.encontrarLinhaContratoRegistado('458532', 'B0026/26');
  assert.ok(hit);
  assert.equal(hit.contrato, 'B0026/26');
  assert.equal(context.encontrarLinhaContratoRegistado('458532', 'B0000/00'), null);
});

async function testGuardarPatch() {
  const gctx = makeBaseCtx();
  const patches = [];
  const els = {
    'ct-edit-num': { value: 'B0099/26' },
    'ct-edit-inicio': { value: '2026-10' },
    'ct-edit-duracao': { value: '48' },
    'ct-edit-consumo': { value: '72' },
    'ct-edit-unidade': { value: 'Kg' },
    'ct-edit-status': { textContent: '', style: {} },
    'ct-edit-guardar': { disabled: false, textContent: 'Guardar alterações' },
    'ct-editar-modal': { style: { display: 'flex' } },
  };
  gctx.SUPA_URL = 'https://example.test/registos';
  gctx.SUPA_KEY = 'k';
  gctx.document = { getElementById(id) { return els[id] || null; } };
  gctx.registosReadHeaders = () => ({ apikey: 'k', Authorization: 'Bearer k' });
  gctx.filterByCanalActivo = (rows) => rows;
  gctx.vendedorPertenceAoCanalActivo = () => true;
  gctx.clienteJaTemNumero = () => false;
  gctx.clearRegistosCache = () => {};
  gctx.clearContratosCache = () => {};
  gctx._reloaded = false;
  gctx.loadContratosTab = async () => { gctx._reloaded = true; };
  gctx.fecharEditarContratoRegistado = () => { els['ct-editar-modal'].style.display = 'none'; };
  gctx._admin = true;
  gctx._dist = true;
  gctx._user = 'Carlos Castro';
  gctx.fetch = async (url, opts) => {
    if (opts && opts.method === 'PATCH') {
      patches.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, status: 204, json: async () => ([]) };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return [{
          id: 'reg-1',
          cod: '458532',
          nome: 'BEER BEV',
          vendedor: 'Eduardo Madeira',
          contrato: 'B0026/26',
          contratos: [{
            num: 'B0026/26', inicio: '2026-10', duracao: 48, consumo: 72, unidade: 'Kg',
            gamas: [{ lote: 'X', unidade: 'Kg', consumo: 72 }],
          }],
          docs: { 'B0026/26': { nf: true } },
        }];
      },
    };
  };
  vm.runInContext(extractFn(html, 'guardarEditarContratoRegistado'), gctx);
  gctx.window._ctEditCtx = {
    cod: '458532',
    numOriginal: 'B0026/26',
    vendedor: 'Eduardo Madeira',
    pdv: 'unico',
    cods: ['458532'],
  };
  await gctx.guardarEditarContratoRegistado();
  assert.equal(patches.length, 1, 'um PATCH');
  assert.equal(patches[0].body.contratos[0].num, 'B0099/26');
  assert.equal(patches[0].body.contrato, 'B0099/26');
  assert.ok(patches[0].body.docs['B0099/26'], 'docs renomeados');
  assert.equal(patches[0].body.contratos[0].gamas[0].lote, 'X', 'multi-gama preservado');
  assert.equal(gctx._reloaded, true, 'Registados refresca');
}

testGuardarPatch()
  .then(() => console.log('OK  guardarEditarContratoRegistado faz PATCH do nº (mock fetch)'))
  .catch((e) => {
    console.error('FAIL  guardarEditarContratoRegistado faz PATCH do nº (mock fetch)');
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  });
