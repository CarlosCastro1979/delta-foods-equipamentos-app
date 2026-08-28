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
});

if (process.exitCode) {
  console.error('\nFalhou pelo menos um teste de PDV Multi.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes de PDV Multi passaram.');
