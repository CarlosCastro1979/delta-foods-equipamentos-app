#!/usr/bin/env node
/** Contratos: PDV único vs PDV Multi, agrupamento e Registar a partir de Por Registar. */
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

const context = {
  console,
  String,
  Array,
  Set,
  normCod(v) { return String(v || '').trim().replace(/^0+/, '') || '0'; },
};
vm.createContext(context);
for (const name of [
  'normNumContrato',
  'isNumContratoPlaceholder',
  'numsContratoIguais',
  'numContratoDaLinha',
  'contratoLinhaTemAnexo',
  'scoreLinhaContrato',
  'contratoPdvNormCods',
  'contratoPdvTipo',
  'contratoPdvCods',
  'contratoPdvChave',
  'contratoPdvPrincipalCod',
  'contratoHtmlCodCliente',
  'escolherMelhorLinhaContrato',
  'colapsarContratosArray',
  'validarDataContrato',
  'validarContratos',
]) {
  vm.runInContext(extractFn(html, name), context);
}

check('chave PDV Multi agrupa os mesmos códigos independentemente da ordem e do principal', () => {
  const c1 = { pdv: 'multi', num: 'B0902/26', cods: ['442779', '748174'], principal: '442779' };
  const c2 = { pdv: 'multi', num: 'B0902/26', cods: ['748174', '442779'], principal: '748174' };
  assert.equal(
    context.contratoPdvChave(c1, { cod: '442779' }),
    context.contratoPdvChave(c2, { cod: '748174' })
  );
  assert.ok(context.contratoPdvChave(c1, { cod: '442779' }).startsWith('M|'));
});

check('PDV único: o mesmo nº em clientes diferentes não colapsa', () => {
  const c = { num: 'B0902/26', pdv: 'unico' };
  const k1 = context.contratoPdvChave(c, { cod: '100' });
  const k2 = context.contratoPdvChave(c, { cod: '200' });
  assert.notEqual(k1, k2);
  assert.ok(k1.startsWith('U|'));
  assert.ok(k2.startsWith('U|'));
});

check('contratoHtmlCodCliente mostra PDV Multi e as casas extra', () => {
  const h = context.contratoHtmlCodCliente({
    pdv: 'multi',
    cods: ['442779', '748174'],
    nome: 'Café Central',
    nomes: ['Café Central', 'Café Anexo'],
  });
  assert.ok(h.codHtml.includes('442779'));
  assert.ok(h.codHtml.includes('748174'));
  assert.ok(h.codHtml.includes('PDV Multi'));
  assert.ok(h.nomeHtml.includes('+1 casa'));
  assert.ok(h.titleNome.includes('Café Anexo'));
});

check('PDV único no HTML do código não leva badge Multi', () => {
  const h = context.contratoHtmlCodCliente({ pdv: 'unico', cod: '100', nome: 'Loja' });
  assert.ok(!h.codHtml.includes('PDV Multi'));
  assert.equal(h.codHtml.includes('100'), true);
});

check('colapsar não perde pdv/cods Multi', () => {
  const r = { cod: '442779', contrato: 'B0902/26' };
  const out = context.colapsarContratosArray([
    { inicio: '2026-08', consumo: '500', duracao: '36', unidade: 'Capsulas' },
    { num: 'B0902/26', pdv: 'multi', cods: ['442779', '748174'], inicio: '2026-08', consumo: 500, duracao: 36, unidade: 'Capsulas' },
  ], r);
  assert.equal(out.list.length, 1);
  assert.equal(out.list[0].pdv, 'multi');
  assert.ok(out.list[0].cods.includes('748174'));
  assert.ok(out.list[0].cods.includes('442779'));
});

check('validarContratos exige 2+ códigos no PDV Multi', () => {
  const err = context.validarContratos([{ inicio: '2026-08', pdv: 'multi', cods: ['442779'] }]);
  assert.ok(err && /PDV Multi/i.test(err));
  assert.equal(context.validarContratos([{ inicio: '2026-08', pdv: 'multi', cods: ['442779', '748174'] }]), null);
});

check('Por Registar tem botão Registar e o modal com os IDs', () => {
  const render = extractFn(html, 'renderContratosPorRegistar');
  assert.ok(render.includes('Registar'));
  assert.ok(render.includes('abrirRegistarContrato'));
  assert.ok(!render.includes('pr-pdv-'));
  assert.ok(!/>PDV<\/th>/.test(render));
  assert.ok(!render.includes('value="unico"'));
  assert.ok(!render.includes('value="multi"'));
  const abrir = extractFn(html, 'abrirRegistarContrato');
  assert.ok(abrir.includes("unico.checked = true"));
  assert.ok(abrir.includes("multi.checked = false"));
  assert.ok(!abrir.includes('pr-pdv-'));
  [
    'ct-registar-modal',
    'ct-reg-cod',
    'ct-reg-nome',
    'ct-reg-equips',
    'ct-reg-num',
    'ct-reg-inicio',
    'ct-reg-duracao',
    'ct-reg-consumo',
    'ct-reg-unidade',
    'ct-reg-pdv-unico',
    'ct-reg-pdv-multi',
    'ct-reg-multi-box',
    'ct-reg-cod-search',
    'ct-reg-cods-list',
    'ct-reg-cod-extra',
    'ct-reg-status',
    'ct-reg-guardar',
  ].forEach(id => {
    assert.ok(html.includes('id="' + id + '"'), 'falta id=' + id);
  });
  assert.ok(html.includes('function guardarRegistarContrato'));
  assert.ok(html.includes('function propagarContratosPdvMulti'));
  assert.ok(render.includes('data-pr-vend'));
  assert.ok(render.includes('limparFiltroContratosPorRegistar'));
  assert.ok(render.includes('Limpar filtro'));
});

check('filterByCanalActivo não aplica escopo de vendedor', () => {
  const ctx = vm.createContext({
    resolveCanalActivoId: () => 'horeca',
    CANAIS_APP: { horeca: { id: 'horeca' } },
    vendedorPertenceAoCanalActivo: (v) => v === 'DANIELA SANTOS' || v === 'CHRISTIAN',
    filterByUtilizadorActivo: (rows) => rows.filter(r => r.vendedor === 'DANIELA SANTOS'),
    getVendedorScope: () => 'DANIELA SANTOS',
  });
  vm.runInContext(extractFn(html, 'filterByCanalActivo'), ctx);
  const out = ctx.filterByCanalActivo([
    { cod: '1', vendedor: 'DANIELA SANTOS' },
    { cod: '2', vendedor: 'CHRISTIAN' },
    { cod: '3', vendedor: 'MASSIMO' },
  ]);
  assert.equal(out.length, 2);
  assert.ok(out.some(r => r.cod === '2'));
  assert.ok(!out.some(r => r.cod === '3'));
});

check('ctRegClientesDoCanal lista o canal inteiro e mostra vendedor', () => {
  const ctx = {
    console,
    String,
    Array,
    Set,
    allData: [
      { cod: '100', nome: 'Loja A', vendedor: 'DANIELA SANTOS' },
      { cod: '200', nome: 'Loja B', vendedor: 'CHRISTIAN' },
      { cod: '300', nome: 'Loja C', vendedor: 'MASSIMO' },
    ],
    window: {},
    getRegistosCache: () => null,
    filterByCanalActivo(rows) {
      return rows.filter(r => r.vendedor === 'DANIELA SANTOS' || r.vendedor === 'CHRISTIAN');
    },
    vendedorPertenceAoCanalActivo(v) {
      return v === 'DANIELA SANTOS' || v === 'CHRISTIAN';
    },
    getVendedorScope: () => 'DANIELA SANTOS',
    filterByUtilizadorActivo: (rows) => rows.filter(r => r.vendedor === 'DANIELA SANTOS'),
    normCod(v) { return String(v || '').trim().replace(/^0+/, '') || '0'; },
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(html, 'ctRegFonteRegistosCanal'), ctx);
  vm.runInContext(extractFn(html, 'ctRegClientesDoCanal'), ctx);
  const list = ctx.ctRegClientesDoCanal();
  assert.equal(list.length, 2);
  assert.ok(list.some(r => r.cod === '200' && r.vendedor === 'CHRISTIAN' && r.nome === 'Loja B'));
  assert.ok(!list.some(r => r.cod === '300'));
});

check('ctRegRenderCods não usa Por Registar nem escopo de vendedor', () => {
  const render = extractFn(html, 'ctRegRenderCods');
  assert.ok(!render.includes('_contratosPorRegistar'));
  assert.ok(!render.includes('filterByUtilizadorActivo'));
  assert.ok(!render.includes('getVendedorScope'));
  assert.ok(!render.includes('filterByCanalActivoVendedor'));
  assert.ok(render.includes('ctRegClientesDoCanal'));
  assert.ok(render.includes('padding:2px 4px'));
  assert.ok(render.includes('font-size:12px'));
  assert.ok(render.includes('r.vendedor'));
  const fonte = extractFn(html, 'ctRegFonteRegistosCanal');
  assert.ok(fonte.includes('allData'));
  assert.ok(fonte.includes('getRegistosCache'));
  assert.ok(!fonte.includes('_contratosPorRegistar'));
  const clientes = extractFn(html, 'ctRegClientesDoCanal');
  assert.ok(clientes.includes('filterByCanalActivo') || clientes.includes('vendedorPertenceAoCanalActivo'));
  assert.ok(!clientes.includes('filterByUtilizadorActivo'));
  assert.ok(!clientes.includes('getVendedorScope'));
});

check('modal PDV Multi compacto com pesquisa e adicionar código', () => {
  const i = html.indexOf('id="ct-reg-multi-box"');
  const j = html.indexOf('id="ct-reg-status"');
  assert.ok(i >= 0 && j > i);
  const modal = html.slice(i, j);
  assert.ok(/max-height:(1[89]\d|20\d|21\d|220)px/.test(modal), modal.match(/max-height:[^;]+/)?.[0]);
  assert.ok(modal.includes('overflow:auto'));
  assert.ok(modal.includes('ct-reg-cod-search'));
  assert.ok(modal.includes('Adicionar código que não está na lista'));
  assert.ok(modal.includes('font-size:12px'));
});

check('guardar PDV Multi filtra só por canal nas casas extra', () => {
  const g = extractFn(html, 'guardarRegistarContrato');
  assert.ok(g.includes('filterByCanalActivo'));
  assert.ok(!g.includes('filterByCanalActivoVendedor'));
  assert.ok(g.includes('isPrincipal'));
  const p = extractFn(html, 'propagarContratosPdvMulti');
  assert.ok(p.includes('filterByCanalActivo'));
  assert.ok(!p.includes('filterByCanalActivoVendedor'));
});

check('ctRegCodEhPrincipal exclui o código da casa principal', () => {
  vm.runInContext(extractFn(html, 'ctRegCodEhPrincipal'), context);
  assert.equal(context.ctRegCodEhPrincipal('442779', '442779'), true);
  assert.equal(context.ctRegCodEhPrincipal('0442779', '442779'), true);
  assert.equal(context.ctRegCodEhPrincipal('748174', '442779'), false);
});

check('ctRegRenderCods exclui o principal e mostra vendedor de outro seller', () => {
  const listEl = { innerHTML: '' };
  const ctx = {
    console,
    String,
    Array,
    Set,
    allData: [
      { cod: '100', nome: 'Loja A', vendedor: 'DANIELA SANTOS' },
      { cod: '200', nome: 'Loja B', vendedor: 'CHRISTIAN' },
    ],
    window: { _ctRegCodsExtra: [], _ctRegCodsSel: [] },
    document: {
      getElementById(id) {
        if (id === 'ct-reg-cods-list') return listEl;
        if (id === 'ct-reg-cod') return { value: '100' };
        if (id === 'ct-reg-cod-search') return { value: '' };
        return null;
      },
    },
    escHtml: (s) => String(s ?? ''),
    filterByCanalActivo: (rows) => rows,
    vendedorPertenceAoCanalActivo: () => true,
    getRegistosCache: () => null,
    normCod(v) { return String(v || '').trim().replace(/^0+/, '') || '0'; },
    ctRegEnsureCanalClientes() {},
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(html, 'ctRegFonteRegistosCanal'), ctx);
  vm.runInContext(extractFn(html, 'ctRegClientesDoCanal'), ctx);
  vm.runInContext(extractFn(html, 'ctRegCodEhPrincipal'), ctx);
  vm.runInContext(extractFn(html, 'ctRegRenderCods'), ctx);
  ctx.ctRegRenderCods();
  assert.ok(listEl.innerHTML.includes('200'));
  assert.ok(listEl.innerHTML.includes('CHRISTIAN'));
  assert.ok(listEl.innerHTML.includes('Loja B'));
  assert.ok(!listEl.innerHTML.includes('Loja A'));
});

if (process.exitCode) {
  console.error('\nFalhou pelo menos um teste de PDV Multi.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes de PDV Multi passaram.');
