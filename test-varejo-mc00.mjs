#!/usr/bin/env node
/**
 * Varejo / Ecommerce (lista SAP) + Dist. retalho:
 *  - Varejo/Ecommerce: sem Novo Registo / Por Registar (clientes SAP já registados)
 *  - lista junta SAP; Editar abre MC00 como no Horeca
 *  - Ecommerce: exclui site (canal 09 / NPess 99520009)
 *  - Dist Massimo e Horeca MC00 inalterados
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

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
  parseInt,
  _canalActivo: null,
  resolveCanalActivoId() { return context._canalActivo; },
  isCanalVarejoActivo() { return context._canalActivo === 'varejo'; },
  isCanalEcommerceActivo() { return context._canalActivo === 'ecommerce'; },
  isCanalListaSapActivo() {
    return context._canalActivo === 'varejo' || context._canalActivo === 'ecommerce';
  },
  getListaClientesActiva() { return context._sap || []; },
  normCod(v) { return String(v || '').trim().replace(/^0+/, '') || '0'; },
};
vm.createContext(context);
for (const name of [
  'canalRegistosTabsState',
  'mergeVarejoSapComoRegistos',
  'mc00NormalizeCanal',
  'mc00GrupoDefaultCanal',
  'clienteEcommerceEhSite',
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

check('Ecommerce Marcio: sem Novo e sem Por Registar, arranque lista', () => {
  const st = context.canalRegistosTabsState('ecommerce');
  assert.equal(st.hideNovo, true);
  assert.equal(st.hidePendentes, true);
  assert.equal(st.hideContratosFalta, true);
  assert.equal(st.startSub, 'lista');
  assert.equal(st.listaLabel, 'Todos os Registos');
});

check('Ecommerce: tab Registo Clientes visível; site 09 fora de sapCanais', () => {
  assert.ok(html.includes('id="tab-registos"'));
  assert.ok(html.includes('Ecommerce: Registo Clientes + MC00 activos'));
  assert.ok(html.includes("function isCanalEcommerceActivo"));
  assert.ok(html.includes("function isCanalListaSapActivo"));
  assert.ok(html.includes("function clienteEcommerceEhSite"));
  // sapCanais ecommerce sem 09
  const m = html.match(/ecommerce:\s*\{[\s\S]*?sapCanais:\s*\[([^\]]+)\]/);
  assert.ok(m, 'sapCanais ecommerce');
  const canais = m[1].replace(/['"\s]/g, '').split(',').filter(Boolean);
  assert.deepEqual(canais, ['01', '03', '13']);
  assert.ok(!canais.includes('09'));
});

check('Ecommerce: clientes site (canal 09 / NPess 99520009) ignorados', () => {
  assert.equal(context.clienteEcommerceEhSite({ canal: '09', npess: 99520001 }), true);
  assert.equal(context.clienteEcommerceEhSite({ canal: '9', npess: 99520001 }), true);
  assert.equal(context.clienteEcommerceEhSite({ canal: '01', npess: 99520009 }), true);
  assert.equal(context.clienteEcommerceEhSite({ canal: '01', npess: 99520001 }), false);
  assert.equal(context.clienteEcommerceEhSite({ canal: '03', npess: 99520005 }), false);
  assert.ok(html.includes("id === 'ecommerce'") && html.includes('clienteEcommerceEhSite'));
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
  assert.ok(adapt.includes('isCanalListaSapActivo'));
  const toM = html.match(/const EMAIL_MC00_TO = '([^']+)'/);
  assert.equal(toM[1], 'condicoes.especiais@gruponabeiro.com');
  const bloco = html.slice(html.indexOf('async function mc00AbrirEmail'));
  const fn = bloco.slice(0, 2800);
  assert.ok(fn.includes('to: EMAIL_MC00_TO'));
  assert.ok(fn.includes('mc00MontarCc'));
  assert.ok(html.includes('function mc00MontarCc'));
  assert.ok(html.includes('function remetenteEhMarcio'));
  assert.ok(html.includes('CC_FIXO_MARCIO'));
  assert.equal((html.match(/async function mc00AbrirEmail/g) || []).length, 1);
});

check('MC00 CC: vendedor em cópia; se for ele a enviar → Carlos', () => {
  const ctx = {
    console,
    String,
    Array,
    Set,
    Object,
    Number,
    EMAIL_MC00_CC_CARLOS: 'carlos.castro@deltafoodsbrasil.com.br',
    outlookMailtoAddrList(input) {
      const raw = Array.isArray(input) ? input : [input];
      const seen = new Set();
      const out = [];
      for (const item of raw) {
        for (const part of String(item == null ? '' : item).split(/[,;]/)) {
          const e = String(part || '').trim();
          if (!e || e.indexOf('@') < 1) continue;
          const k = e.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(e);
        }
      }
      return out;
    },
  };
  vm.createContext(ctx);
  // Dependências de mc00MontarCc / resolveNomeUtilizador
  ctx.UTILIZADOR_EMAILS = {
    'CARLOS CASTRO': 'carlos.castro@deltafoodsbrasil.com.br',
    'MARCIO GORGA': 'marcio.gorga@deltafoodsbrasil.com.br',
    'DIOGO OLIVEIRA': 'diogo.oliveira@deltafoodsbrasil.com.br',
    'MASSIMO BOTTELLO': 'massimo.bottello@deltafoodsbrasil.com.br',
    'EDUARDO MADEIRA': 'eduardo.moreira@deltafoodsbrasil.com.br',
  };
  ctx.VENDEDOR_MAP = { '99520003': 'MASSIMO BOTTELLO', '99520020': 'EDUARDO MADEIRA', '99520008': 'MARCIO GORGA' };
  ctx.NPESS_VENDEDOR_SC = { 99520003: 'MASSIMO BOTTELLO', 99530002: 'MASSIMO BOTTELLO' };
  ctx.EMAIL_MC00_CC_CARLOS = 'carlos.castro@deltafoodsbrasil.com.br';
  for (const name of [
    'normNomeUtilizador', 'resolveNomeUtilizador', 'getEmailUtilizador',
    'emailComercialCliente', 'ccComComercialCliente',
    'remetenteEhUtilizador', 'mc00MontarCc',
  ]) {
    vm.runInContext(extractFn(html, name), ctx);
  }
  // Carlos faz MC00 de cliente do Marcio → Marcio em CC (sem Carlos a auto-copiar)
  assert.deepEqual(
    ctx.mc00MontarCc({ vendedor: 'MARCIO GORGA' }, 'Carlos Castro'),
    ['marcio.gorga@deltafoodsbrasil.com.br']
  );
  // Marcio faz o próprio MC00 → Carlos em CC
  assert.deepEqual(
    ctx.mc00MontarCc({ vendedor: 'MARCIO GORGA' }, 'Marcio Gorga'),
    ['carlos.castro@deltafoodsbrasil.com.br']
  );
  // Carlos faz MC00 de cliente do Diogo → Diogo
  assert.deepEqual(
    ctx.mc00MontarCc({ vendedor: 'DIOGO OLIVEIRA' }, 'Carlos Castro'),
    ['diogo.oliveira@deltafoodsbrasil.com.br']
  );
  // Diogo faz → Carlos
  assert.deepEqual(
    ctx.mc00MontarCc({ vendedor: 'DIOGO OLIVEIRA' }, 'Diogo Oliveira'),
    ['carlos.castro@deltafoodsbrasil.com.br']
  );
  // Massimo faz → Carlos; Carlos faz de Massimo → Massimo
  assert.deepEqual(
    ctx.mc00MontarCc({ vendedor: 'MASSIMO BOTTELLO' }, 'Massimo Bottello'),
    ['carlos.castro@deltafoodsbrasil.com.br']
  );
  assert.deepEqual(
    ctx.mc00MontarCc({ vendedor: 'MASSIMO BOTTELLO' }, 'Carlos Castro'),
    ['massimo.bottello@deltafoodsbrasil.com.br']
  );
  // Formato SAP Dist (era o bug: CC vazio)
  assert.deepEqual(
    ctx.mc00MontarCc({ vendedor: '99520003 - BOTTELLO MASSIMO' }, 'Carlos Castro'),
    ['massimo.bottello@deltafoodsbrasil.com.br']
  );
  assert.equal(
    ctx.resolveNomeUtilizador('99520003 - BOTTELLO MASSIMO'),
    'MASSIMO BOTTELLO'
  );
  assert.deepEqual(
    ctx.ccComComercialCliente([], '99520003 - BOTTELLO MASSIMO', 'Carlos Castro'),
    ['massimo.bottello@deltafoodsbrasil.com.br']
  );
  assert.deepEqual(
    ctx.ccComComercialCliente([], '99520003 - BOTTELLO MASSIMO', 'Massimo Bottello'),
    []
  );
});

check('MC00 export aquace ponte e não descarrega Excel antes do Outlook', () => {
  const fn = extractFn(html, 'mc00Exportar');
  assert.ok(fn.includes('skipDownload: true'));
  assert.ok(fn.includes('outlookFindLiveApi'));
  assert.ok(fn.includes("ok === 'eml'") || fn.includes('ok === "eml"'));
  assert.ok(!fn.includes("toast('✅ MC00 gerado!')"));
});

check('MC00 grupo default: Horeca HORECA; Varejo/Ecommerce RETALHO; 13 DISTRIBUIDORES; 03 OFFICE', () => {
  context._canalActivo = 'horeca';
  assert.equal(context.mc00GrupoDefaultCanal({}), 'HORECA');
  context._canalActivo = 'varejo';
  context._sap = [{ cod: '749355', canal: '01' }];
  assert.equal(context.mc00GrupoDefaultCanal({ cod: '749355' }), 'RETALHO');
  context._sap = [{ cod: '749355', canal: '13' }];
  assert.equal(context.mc00GrupoDefaultCanal({ cod: '749355' }), 'DISTRIBUIDORES');
  context._canalActivo = 'ecommerce';
  context._sap = [{ cod: '800001', canal: '01' }];
  assert.equal(context.mc00GrupoDefaultCanal({ cod: '800001' }), 'RETALHO');
  context._sap = [{ cod: '800002', canal: '03' }];
  assert.equal(context.mc00GrupoDefaultCanal({ cod: '800002' }), 'OFFICE');
  context._sap = [{ cod: '800003', canal: '13' }];
  assert.equal(context.mc00GrupoDefaultCanal({ cod: '800003' }), 'DISTRIBUIDORES');
});

check('Editar lista chama openEditRegistoOuSap (SAP sem id)', () => {
  assert.ok(html.includes('function openEditRegistoOuSap'));
  assert.ok(html.includes('function openEditClienteSap'));
  assert.ok(html.includes('function ensureRegistoVarejoCliente'));
  assert.ok(html.includes("onclick=\"openEditRegistoOuSap('"));
  assert.ok(html.includes('preencherNovo') && html.includes('isCanalListaSapActivo')
    && html.includes('openEditClienteSap'));
});

check('merge SAP Ecommerce usa MARCIO GORGA como vendedor default', () => {
  context._canalActivo = 'ecommerce';
  const out = context.mergeVarejoSapComoRegistos([], [
    { cod: '900001', nome: 'LOJA MARCIO', cep: '01000-000' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].vendedor, 'MARCIO GORGA');
  assert.equal(out[0]._varejoSap, true);
});

check('switchSubTab redirecciona Novo/Por Registar no Varejo via canalRegistosTabsState', () => {
  const fn = extractFn(html, 'switchSubTab');
  assert.ok(fn.includes('canalRegistosTabsState'));
  assert.ok(fn.includes('tabs.hideNovo'));
  assert.ok(fn.includes('tabs.hidePendentes'));
  assert.ok(fn.includes('_distAllowNovoForm'), 'Dist continua a poder abrir o form forçado');
});

check('Cache SW / dfb-build alinhados (premios-equipa)', () => {
  assert.ok(html.includes('v2026-11-23-premios-equipa'));
  assert.ok(sw.includes('v2026-11-23-premios-equipa'));
  assert.ok(/<!--\s*dfb-build:[^>]*premios-equipa[^>]*-->/.test(html.slice(0, 300)));
});

if (process.exitCode) process.exit(process.exitCode);
console.log('Todos os testes Varejo/Ecommerce/MC00 passaram.');
