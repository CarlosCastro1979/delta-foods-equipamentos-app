#!/usr/bin/env node
/** Unicidade: uma combinação código cliente + nº de contrato. */
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

const context = {
  console,
  window: { _contratosAllRows: [] },
  normCod(v) { return String(v || '').trim().replace(/^0+/, '') || '0'; },
};
vm.createContext(context);
for (const name of [
  'normNumContrato',
  'isNumContratoPlaceholder',
  'numsContratoDoRegisto',
  'numsContratoIguais',
  'numContratoDaLinha',
  'contratoLinhaTemAnexo',
  'scoreLinhaContrato',
  'escolherMelhorLinhaContrato',
  'colapsarContratosArray',
  'clienteJaTemNumero',
  'marcarContratoParSeNovo',
  'msgContratoJaCriado',
  'encontrarContratoNasLinhas',
  'contratoPdvNormCods',
  'contratoPdvTipo',
  'contratoPdvCods',
  'contratoPdvChave',
  'indiceContratosPdvMulti',
  'contratoDupGrupoKey',
  'contratoDupClientesNoMesmoPdvMulti',
  'contratoDupEhAlerta',
  'fonteRegistosComContratos',
  'resolverContratosDuplicados',
  'detectarNumerosContratoDuplicados',
  'htmlBannerContratosDuplicados',
]) {
  vm.runInContext(extractFn(html, name), context);
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

check('normaliza espaços e maiúsculas', () => {
  assert.equal(context.normNumContrato('b0029 / 25'), 'B0029/25');
});

check('SEM_COMODATO não conta', () => {
  assert.equal(context.isNumContratoPlaceholder('SEM_COMODATO'), true);
  assert.equal(context.isNumContratoPlaceholder('B0029/25'), false);
});

check('recolhe nº do campo, Horeca e Dist', () => {
  const nums = context.numsContratoDoRegisto({
    contrato: 'A001, B002',
    contratos: [{ num: 'A001' }, { num: 'C003' }],
    dist_contratos: [{ numero: 'D004' }],
  });
  assert.deepEqual(nums.map(n => context.normNumContrato(n)).sort(), ['A001', 'B002', 'C003', 'D004']);
});

const rows = [
  { id: '1', cod: '100', nome: 'Cliente A', contrato: 'B0029/25' },
  { id: '2', cod: '200', nome: 'Cliente B', contratos: [{ num: 'b0029 / 25' }] },
  { id: '3', cod: '300', nome: 'Cliente C', contrato: 'X111' },
];

check('mesmo número noutro cliente NÃO bloqueia (cadeia)', () => {
  const hit = context.encontrarContratoNasLinhas('B0029/25', rows, { cod: '300' });
  assert.equal(hit, null);
});

check('mesmo número no mesmo cliente bloqueia', () => {
  const hit = context.encontrarContratoNasLinhas('B0029/25', rows, { cod: '100' });
  assert.ok(hit);
  assert.equal(hit.cod, '100');
});

check('sem código de cliente não compara com outros', () => {
  const hit = context.encontrarContratoNasLinhas('B0029/25', rows);
  assert.equal(hit, null);
});

check('editar o mesmo cliente (exceptId) não dispara', () => {
  const hit = context.encontrarContratoNasLinhas('X111', rows, { exceptId: '3', cod: '300' });
  assert.equal(hit, null);
});

check('mensagem diz que este cliente já tem o nº', () => {
  const msg = context.msgContratoJaCriado('B0029/25', { cod: '100', nome: 'Cliente A' });
  assert.ok(/já tem o contrato/i.test(msg));
  assert.ok(msg.includes('B0029/25'));
  assert.ok(msg.includes('100'));
});

check('detecta números partilhados entre clientes', () => {
  const dups = context.detectarNumerosContratoDuplicados(rows);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].key, 'B0029/25');
  assert.equal(dups[0].clientes.length, 2);
});

check('PDV único com o mesmo nº em dois códigos continua no alerta', () => {
  const dups = context.detectarNumerosContratoDuplicados([
    { cod: '100', nome: 'A', contratos: [{ num: '007/2022', pdv: 'unico' }] },
    { cod: '200', nome: 'B', contratos: [{ num: '007/2022', pdv: 'unico' }] },
  ]);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].key, '007/2022');
  assert.equal(dups[0].clientes.length, 2);
  assert.ok(context.contratoDupEhAlerta(dups[0]));
});

check('PDV Multi 031/2022 nos códigos juntos NÃO entra no alerta de duplicados', () => {
  const ct = { num: '031/2022', pdv: 'multi', cods: ['794161', '792643'] };
  const dups = context.detectarNumerosContratoDuplicados([
    { cod: '794161', nome: 'PADARIA CRUZEIRO DO SUL LTDA', contratos: [ct], contrato: '031/2022' },
    { cod: '792643', nome: 'CASA 2', contratos: [{ num: '031/2022', pdv: 'multi', cods: ['792643', '794161'] }], contrato: '031/2022' },
  ]);
  assert.equal(dups.find(d => context.numsContratoIguais(d.key, '031/2022')), undefined);
  assert.equal(dups.length, 0);
  const html = context.htmlBannerContratosDuplicados(dups);
  assert.equal(html, '');
  assert.ok(!html.includes('031/2022'));
});

check('PDV Multi + cliente extra fora do grupo continua no alerta', () => {
  const dups = context.detectarNumerosContratoDuplicados([
    { cod: '794161', nome: 'Padaria', contratos: [{ num: '031/2022', pdv: 'multi', cods: ['794161', '792643'] }] },
    { cod: '792643', nome: 'Casa 2', contratos: [{ num: '031/2022', pdv: 'multi', cods: ['794161', '792643'] }] },
    { cod: '111111', nome: 'Outro', contratos: [{ num: '031/2022', pdv: 'unico' }] },
  ]);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].key, '031/2022');
  assert.ok(dups[0].clientes.length >= 2);
  assert.ok(context.contratoDupEhAlerta(dups[0]));
  const html = context.htmlBannerContratosDuplicados(dups);
  assert.ok(html.includes('031/2022'));
});

check('banner ignora PDV Multi puro mesmo se a lista antiga o trouxer', () => {
  const html = context.htmlBannerContratosDuplicados([
    { key: '031/2022', clientes: [{ num: '031/2022', cod: '794161' }, { num: '031/2022', cod: '792643' }], grupos: ['M|031/2022|792643,794161'] },
  ]);
  assert.equal(html, '');
  assert.ok(!html.includes('031/2022'));
});

check('banner some 031/2022 do cabeçalho mesmo com dups de cache sem grupos', () => {
  context.window._contratosAllRows = [{
    cod: '794161',
    contrato: '031/2022',
    pdv: 'multi',
    cods: ['794161', '792643'],
  }];
  const stale = [
    { key: '007/2022', clientes: [{ num: '007/2022', cod: '1' }, { num: '007/2022', cod: '2' }] },
    { key: 'B0047/24', clientes: [{ num: 'B0047/24', cod: '3' }, { num: 'B0047/24', cod: '4' }] },
    { key: 'B0027/24', clientes: [{ num: 'B0027/24', cod: '5' }, { num: 'B0027/24', cod: '6' }] },
    { key: '031/2022', clientes: [{ num: '031/2022', cod: '794161' }, { num: '031/2022', cod: '792643' }] },
  ];
  assert.equal(context.contratoDupEhAlerta(stale[3]), false);
  const html = context.htmlBannerContratosDuplicados(stale);
  assert.ok(html.includes('007/2022'));
  assert.ok(html.includes('B0047/24'));
  assert.ok(html.includes('B0027/24'));
  assert.ok(!html.includes('031/2022'));
  assert.ok(html.includes('3 número'));
  context.window._contratosAllRows = [];
});

check('load/paint do banner recalcula dups e ignora cache IndexedDB antigo', () => {
  const banner = extractFn(html, 'htmlBannerContratosDuplicados');
  const apply = extractFn(html, 'contratosTabApplyPacked');
  const paint = extractFn(html, 'contratosTabPaint');
  assert.ok(banner.includes('resolverContratosDuplicados'));
  assert.ok(apply.includes('resolverContratosDuplicados'));
  assert.ok(paint.includes('resolverContratosDuplicados'));
  assert.ok(html.includes("delta_contratos_tab_v2"));
  assert.ok(!html.includes("delta_contratos_tab_v1"));
});

check('colapsa linhas repetidas no mesmo cliente e fica a que tem nº e anexos', () => {
  const r = {
    contrato: 'B0027/26',
    docs: { 'B0027/26': { nf: '421542/B0027/26/nf.pdf' } },
    contratos: [
      { inicio: '2026-08', consumo: '500', duracao: '36', unidade: 'Capsulas' },
      { inicio: '2026-08', consumo: '500', duracao: '36', unidade: 'Capsulas' },
      { num: 'B0027/26', lote: 'DELTA Q', prazo: 21, inicio: '2026-08', consumo: 500, duracao: 36, unidade: 'Caps' },
    ],
  };
  const out = context.colapsarContratosArray(r.contratos, r);
  assert.equal(out.changed, true);
  assert.equal(out.removed, 2);
  assert.equal(out.list.length, 1);
  assert.equal(out.list[0].num, 'B0027/26');
  assert.equal(out.list[0].lote, 'DELTA Q');
});

check('tabela ignora segunda linha do mesmo código+nº', () => {
  const seen = [];
  assert.equal(context.marcarContratoParSeNovo(seen, '421542', 'B0027/26'), true);
  assert.equal(context.marcarContratoParSeNovo(seen, '421542', 'B0027/26'), false);
  assert.equal(context.marcarContratoParSeNovo(seen, '456320', 'B0027/26'), true);
});

check('menu Contratos com mais de 1 Cliente existe ao lado de Gerar', () => {
  assert.ok(html.includes('id="sub-contratos-multi-cliente"'));
  assert.ok(html.includes('Contratos com mais de 1 Cliente'));
  assert.ok(html.includes("switchSubTab('contratos','multi-cliente')"));
  assert.ok(html.includes('loadContratosMultiCliente'));
  const gerarAt = html.indexOf('id="sub-contratos-gerar"');
  const multiAt = html.indexOf('id="sub-contratos-multi-cliente"');
  const equipAt = html.indexOf('id="sub-contratos-equipamentos"');
  assert.ok(gerarAt > 0 && multiAt > gerarAt && equipAt > multiAt);
});

check('gerar/guardar só bloqueia se o MESMO cliente já tiver o nº', () => {
  assert.ok(html.includes("erroSeContratoJaCriado(numGerar, { cod: codGerar })"));
  assert.ok(html.includes('clienteJaTemNumero'));
  assert.ok(html.includes('contratosLimparDuplicadosMesmoCliente'));
  assert.ok(!html.includes('cada número só pode ter um contrato'));
  assert.ok(!html.includes('actualizar se sim, adicionar se não'));
});

if (process.exitCode) {
  console.error('\nFalhou pelo menos um teste.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes de contrato único passaram.');
