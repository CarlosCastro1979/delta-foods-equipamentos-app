#!/usr/bin/env node
/**
 * Varejo / Dist. retalho (Diogo):
 *  - sem Novo Registo / Por Registar (clientes SAP já registados)
 *  - lista junta SAP; Editar abre MC00 como no Horeca
 *  - Dist Massimo e Horeca MC00 inalterados
 */
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
  _canalActivo: null,
  resolveCanalActivoId() { return context._canalActivo; },
  isCanalVarejoActivo() { return context._canalActivo === 'varejo'; },
  getListaClientesActiva() { return context._sap || []; },
  normCod(v) { return String(v || '').trim().replace(/^0+/, '') || '0'; },
};
vm.createContext(context);
for (const name of [
  'canalRegistosTabsState',
  'mergeVarejoSapComoRegistos',
  'mc00NormalizeCanal',
  'mc00GrupoDefaultCanal',
]) {
  vm.runInContext(extractFn(html, name), context);
}

check('Horeca: Novo Registo visível e é o arranque', () => {
  const st = context.canalRegistosTabsState('horeca');
  assert.equal(st.hideNovo, false);
  assert.equal(st.hidePendentes, false);
  assert.equal(st.hideContratosFalta, true);
  assert.equal(st.startSub, 'novo');
  assert.equal(st.listaLabel, 'Todos os Registos');
  assert.equal(st.pendLabel, 'Por Registar');
});

check('Dist Massimo: sem Novo, com Por registar, arranque pendentes', () => {
  const st = context.canalRegistosTabsState('distribuidores');
  assert.equal(st.hideNovo, true);
  assert.equal(st.hidePendentes, false);
  assert.equal(st.hideContratosFalta, false);
  assert.equal(st.startSub, 'pendentes');
  assert.equal(st.listaLabel, 'Registos OK');
  assert.equal(st.pendLabel, 'Por registar');
});

check('Varejo Diogo: sem Novo e sem Por Registar, arranque lista', () => {
  const st = context.canalRegistosTabsState('varejo');
  assert.equal(st.hideNovo, true);
  assert.equal(st.hidePendentes, true);
  assert.equal(st.hideContratosFalta, true);
  assert.equal(st.startSub, 'lista');
  assert.equal(st.listaLabel, 'Todos os Registos');
});

check('Varejo não é Dist (comodato Massimo intacto)', () => {
  assert.ok(html.includes("return id === 'distribuidores'"));
  const distFn = extractFn(html, 'isCanalDistribuidores');
  assert.ok(distFn.includes("id === 'distribuidores'"));
  assert.equal(distFn.includes('varejo'), false);
  const formFn = extractFn(html, 'adaptarFormRegistoCanal');
  assert.ok(formFn.includes('isCanalDistribuidores()'));
  assert.ok(formFn.includes('distApplyComodatoUi'));
  assert.equal(formFn.includes('isCanalVarejoActivo'), false);
});

check('merge SAP: códigos Diogo entram; duplicados com registo não se repetem', () => {
  const regs = [
    { id: 'uuid-1', cod: '749355', nome: 'ESTANCIA JÁ REGISTADA', vendedor: 'DIOGO OLIVEIRA', equipamentos: [] },
  ];
  const sap = [
    { cod: '749355', nome: 'ESTANCIA SUPERMERCADOS LTDA', vendedor: 'DIOGO OLIVEIRA', cep: '18130-500' },
    { cod: '800001', nome: 'NOVO SUPERMERCADO', vendedor: 'DIOGO OLIVEIRA', cep: '01000-000' },
  ];
  const out = context.mergeVarejoSapComoRegistos(regs, sap);
  assert.equal(out.filter(r => context.normCod(r.cod) === '749355').length, 1);
  const novo = out.find(r => context.normCod(r.cod) === '800001');
  assert.ok(novo);
  assert.equal(novo._varejoSap, true);
  assert.equal(novo.id, '');
  assert.equal(novo.nome, 'NOVO SUPERMERCADO');
});

check('MC00 no editar: aba existe; email reutiliza EMAIL_MC00_TO', () => {
  assert.ok(html.includes('id="edit-tab-btn-mc00"'));
  assert.ok(html.includes('id="edit-tab-mc00"'));
  assert.ok(html.includes("onclick=\"editSwitchTab('mc00')\""));
  assert.ok(html.includes('function adaptarEditTabsCanal'));
  const adapt = extractFn(html, 'adaptarEditTabsCanal');
  assert.ok(adapt.includes('isCanalHorecaActivo'));
  assert.ok(adapt.includes('isCanalVarejoActivo'));
  const toM = html.match(/const EMAIL_MC00_TO = '([^']+)'/);
  assert.equal(toM[1], 'condicoes.especiais@gruponabeiro.com');
  const bloco = html.slice(html.indexOf('async function mc00AbrirEmail'));
  const fn = bloco.slice(0, 2500);
  assert.ok(fn.includes('to: EMAIL_MC00_TO'));
  assert.ok(fn.includes('ccString(EMAIL_MC00_CC'));
  assert.equal((html.match(/async function mc00AbrirEmail/g) || []).length, 1);
});

check('MC00 grupo default: Horeca HORECA; Varejo RETALHO; canal 13 DISTRIBUIDORES', () => {
  context._canalActivo = 'horeca';
  assert.equal(context.mc00GrupoDefaultCanal({}), 'HORECA');
  context._canalActivo = 'varejo';
  context._sap = [{ cod: '749355', canal: '01' }];
  assert.equal(context.mc00GrupoDefaultCanal({ cod: '749355' }), 'RETALHO');
  context._sap = [{ cod: '749355', canal: '13' }];
  assert.equal(context.mc00GrupoDefaultCanal({ cod: '749355' }), 'DISTRIBUIDORES');
});

check('Editar lista chama openEditRegistoOuSap (SAP sem id)', () => {
  assert.ok(html.includes('function openEditRegistoOuSap'));
  assert.ok(html.includes('function openEditClienteSap'));
  assert.ok(html.includes('function ensureRegistoVarejoCliente'));
  assert.ok(html.includes("onclick=\"openEditRegistoOuSap('"));
  assert.ok(html.includes('preencherNovo') && html.includes('isCanalVarejoActivo')
    && html.includes('openEditClienteSap'));
});

check('switchSubTab redirecciona Novo/Por Registar no Varejo via canalRegistosTabsState', () => {
  const fn = extractFn(html, 'switchSubTab');
  assert.ok(fn.includes('canalRegistosTabsState'));
  assert.ok(fn.includes('tabs.hideNovo'));
  assert.ok(fn.includes('tabs.hidePendentes'));
  assert.ok(fn.includes('_distAllowNovoForm'), 'Dist continua a poder abrir o form forçado');
});

if (process.exitCode) process.exit(process.exitCode);
console.log('Todos os testes Varejo/MC00 passaram.');
