#!/usr/bin/env node
/** Por Registar Horeca: cloud completa, e cada login vê só o que a regra permite. */
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

const TRES = ['100001', '100002', '100003'];
const SEIS = ['100004', '100005', '100006', '100007', '100008', '100009'];
const NOVE = TRES.concat(SEIS);

function cli(cod, canalApp, vendedor) {
  return { cod, nome: 'Cliente ' + cod, cep: '00000-000', vendedor, canalApp };
}

const localHoreca = [
  ...TRES.map(cod => cli(cod, 'horeca', 'HELCIO')),
  ...Array.from({ length: 200 }, (_, i) => cli('2' + String(i).padStart(5, '0'), 'horeca', 'HELCIO')),
];
const remoteHoreca = NOVE.map((cod, i) => cli(cod, 'horeca', i === 1 ? 'PAULO' : 'HELCIO'));
const localDist = Array.from({ length: 120 }, (_, i) => cli('3' + String(i).padStart(5, '0'), 'distribuidores', 'MASSIMO'));
const remoteDist = [
  cli('300000', 'distribuidores', 'MASSIMO'),
  cli('399999', 'distribuidores', 'EDUARDO'),
];
const localAll = localHoreca.concat(localDist);
const remoteAll = remoteHoreca.concat(remoteDist);

const sessao = { user: '', admin: false, horeca: true };
const ctx = {
  console,
  Array,
  Map,
  Set,
  String,
  Number,
  parseInt,
  isNaN,
  isFinite,
  Date,
  HORECA_VE_TUDO: ['Filipe Neves'],
  ECOMMERCE_VENDEDOR_CODS: new Set(),
  ECOMMERCE_VENDEDOR_NOME: 'MARCIO GORGA',
  isAdmin() { return sessao.admin; },
  isCanalHorecaActivo() { return sessao.horeca; },
  getUtilizadorAtual() { return sessao.user; },
  getVendedoresCanalActivo() {
    return ['HÉLCIO GRÉGIO', 'PAULO FONTES', 'DANIELA SANTOS', 'FILIPE NEVES'];
  },
  getVendedoresMap() {
    return {
      99520002: 'HÉLCIO GRÉGIO',
      99520015: 'HÉLCIO GRÉGIO',
      99520006: 'DANIELA SANTOS',
      99520016: 'DANIELA SANTOS',
      99520007: 'PAULO FONTES',
      99520017: 'PAULO FONTES',
      99520010: 'FILIPE NEVES',
      99520019: 'FILIPE NEVES',
    };
  },
  clientePertenceAoCanal(c, canalId) {
    return !!(c && c.canalApp === canalId);
  },
};
vm.createContext(ctx);
vm.runInContext(
  [
    'normCod',
    'tsListaClientes',
    'fundirListasClientesPorCod',
    'escolherListaPorRegistar',
    'listaPorRegistarDoCanal',
    'normNomeUtilizador',
    'normalizeVendedorCliente',
    'getVendedorScope',
    'filterByUtilizadorActivo',
  ].map(n => extractFn(html, n)).join('\n'),
  ctx
);

function verComo(user, rows, opts) {
  sessao.user = user;
  sessao.admin = !!(opts && opts.admin);
  sessao.horeca = !opts || opts.horeca !== false;
  return ctx.filterByUtilizadorActivo(rows, c => c && c.vendedor);
}

function pendentes(lista, registados) {
  const set = new Set((registados || []).map(ctx.normCod));
  return lista.filter(c => !set.has(ctx.normCod(c.cod)));
}

check('Horeca com cache de 3 usa a cloud e fica com os 9, incluindo outro vendedor', () => {
  const lista = ctx.listaPorRegistarDoCanal(localAll, remoteAll, 'horeca', { remoteNewer: false });
  const regs = localHoreca.map(c => c.cod).filter(cod => !TRES.includes(cod));
  const pend = pendentes(lista, regs);
  assert.equal(pend.length, 9);
  NOVE.forEach(cod => assert.ok(pend.some(c => ctx.normCod(c.cod) === cod), cod));
  assert.ok(pend.some(c => c.vendedor === 'PAULO'));
  assert.ok(pend.some(c => c.vendedor === 'HELCIO'));
  assert.ok(!pend.some(c => c.canalApp === 'distribuidores'));
});

check('cache local mais antigo e maior não esconde os 6 que só estão na cloud', () => {
  const lista = ctx.listaPorRegistarDoCanal(localAll, remoteAll, 'horeca', { remoteNewer: true });
  assert.equal(pendentes(lista, []).filter(c => NOVE.includes(c.cod)).length, 9);
  assert.equal(lista.length, remoteHoreca.length);
});

check('Distribuidores não é substituído por um recorte pequeno da cloud', () => {
  const antigo = ctx.listaPorRegistarDoCanal(localAll, remoteAll, 'distribuidores', { remoteNewer: false });
  assert.equal(antigo.length, localDist.length);
  assert.ok(!antigo.some(c => c.cod === '399999'));
  const recente = ctx.listaPorRegistarDoCanal(localAll, remoteAll, 'distribuidores', { remoteNewer: true });
  assert.ok(recente.length >= localDist.length);
  assert.ok(recente.some(c => c.cod === '399999'));
  assert.ok(recente.some(c => c.cod === '300000'));
  assert.ok(!recente.some(c => c.canalApp === 'horeca'));
});

check('sem cloud, Horeca fica no cache local', () => {
  const lista = ctx.listaPorRegistarDoCanal(localAll, [], 'horeca', { remoteNewer: false });
  assert.equal(lista.length, localHoreca.length);
  assert.equal(pendentes(lista, localHoreca.map(c => c.cod).filter(c => !TRES.includes(c))).length, 3);
});

check('timestamp ISO não parte a comparação com a cloud', () => {
  const iso = ctx.tsListaClientes('2026-10-02T12:36:13.338Z');
  const antigo = ctx.tsListaClientes(iso - 1000);
  assert.ok(iso > antigo);
  assert.equal(ctx.tsListaClientes(''), 0);
  assert.equal(ctx.tsListaClientes(NaN), 0);
});

check('fusão da lista truncada acrescenta códigos e não apaga os outros', () => {
  const base = localAll.slice();
  const extra = remoteHoreca.concat([cli('399999', 'distribuidores', 'EDUARDO')]);
  const merged = ctx.fundirListasClientesPorCod(base, extra);
  NOVE.forEach(cod => assert.ok(merged.some(c => c.cod === cod)));
  assert.ok(merged.some(c => c.cod === '200000'));
  assert.ok(merged.some(c => c.cod === '399999'));
  assert.ok(merged.length > base.length);
});

check('Ecommerce e Varejo não passam a usar a regra curta do Horeca', () => {
  const localVar = Array.from({ length: 100 }, (_, i) => cli('4' + String(i).padStart(5, '0'), 'varejo', 'DIOGO'));
  const remoteVar = [cli('400000', 'varejo', 'DIOGO'), cli('499999', 'varejo', 'DIOGO')];
  const varejo = ctx.listaPorRegistarDoCanal(localVar, remoteVar, 'varejo', { remoteNewer: false });
  assert.equal(varejo.length, localVar.length);
  assert.ok(!varejo.some(c => c.cod === '499999'));
  const localEco = Array.from({ length: 90 }, (_, i) => cli('5' + String(i).padStart(5, '0'), 'ecommerce', 'MARCIO'));
  const remoteEco = [cli('599999', 'ecommerce', 'MARCIO')];
  const eco = ctx.listaPorRegistarDoCanal(localEco, remoteEco, 'ecommerce', { remoteNewer: false });
  assert.equal(eco.length, localEco.length);
  assert.ok(!eco.some(c => c.cod === '599999'));
});

check('Filipe vê os pendentes Horeca da cloud; Hélcio só os dele e não o do Paulo', () => {
  const helcioCods = ['100001', '100002', '100003', '100004', '100005', '100006', '100007', '100008'];
  const cloud = helcioCods.map((cod, i) => ({
    cod,
    nome: 'Cliente ' + cod,
    canalApp: 'horeca',
    npess: i === helcioCods.length - 1 ? 99520015 : 99520002,
    vendedor: i === helcioCods.length - 1 ? 'GREGIO HELCIO' : (i % 2 ? 'HÉLCIO GRÉGIO' : 'Hélcio Grégio'),
  })).concat([{
    cod: '457382',
    nome: 'FEITIÇO',
    canalApp: 'horeca',
    npess: 99520007,
    vendedor: 'Paulo Fontes',
  }]);
  const cache3 = helcioCods.slice(0, 3).map(cod => cli(cod, 'horeca', 'Hélcio Grégio'));
  const universo = ctx.listaPorRegistarDoCanal(cache3, cloud, 'horeca', { remoteNewer: false })
    .map(ctx.normalizeVendedorCliente);
  const pend = pendentes(universo, []);
  const doHelcio = pend.filter(c => ctx.normNomeUtilizador(c.vendedor) === ctx.normNomeUtilizador('Hélcio Grégio'));
  const doPaulo = pend.filter(c => ctx.normNomeUtilizador(c.vendedor) === ctx.normNomeUtilizador('Paulo Fontes'));

  assert.ok(doHelcio.length > 3, 'cloud tem mais clientes do Hélcio do que o cache de 3');
  assert.ok(doPaulo.some(c => ctx.normCod(c.cod) === '457382'));
  assert.equal(doHelcio.length + doPaulo.length, pend.length);

  const filipe = verComo('Filipe Neves', pend);
  assert.equal(ctx.getVendedorScope(), null);
  assert.equal(filipe.length, pend.length);
  assert.ok(filipe.some(c => ctx.normCod(c.cod) === '457382'));
  helcioCods.forEach(cod => assert.ok(filipe.some(c => ctx.normCod(c.cod) === cod), cod));

  const carlos = verComo('Carlos Castro', pend, { admin: true });
  assert.equal(ctx.getVendedorScope(), null);
  assert.equal(carlos.length, pend.length);

  const helcio = verComo('Hélcio Grégio', pend);
  assert.equal(ctx.normNomeUtilizador(ctx.getVendedorScope()), ctx.normNomeUtilizador('Hélcio Grégio'));
  assert.deepEqual(helcio.map(c => c.cod).sort(), doHelcio.map(c => c.cod).sort());
  assert.ok(helcio.length > 3);
  assert.ok(!helcio.some(c => ctx.normCod(c.cod) === '457382'));
  assert.ok(helcio.some(c => ctx.normCod(c.cod) === '100008'), 'NPess 99520015 conta como Hélcio');

  const paulo = verComo('Paulo Fontes', pend);
  assert.deepEqual(paulo.map(c => ctx.normCod(c.cod)), ['457382']);

  const nomeTrocado = ctx.normalizeVendedorCliente({
    cod: '457382', nome: 'FEITIÇO', canalApp: 'horeca', npess: 99520007, vendedor: 'Hélcio Grégio',
  });
  assert.equal(ctx.normNomeUtilizador(nomeTrocado.vendedor), 'PAULO FONTES');
  assert.equal(verComo('Hélcio Grégio', [nomeTrocado]).length, 0);
  assert.equal(verComo('Paulo Fontes', [nomeTrocado])[0].cod, '457382');

  verComo('Hélcio Grégio', pend, { horeca: false });
  assert.equal(ctx.getVendedorScope(), null);
});

check('Por Registar aplica o escopo do login em cima da cloud', () => {
  const load = extractFn(html, 'loadPendentes');
  const render = extractFn(html, 'renderPendentes');
  assert.ok(load.includes('listaPorRegistarDoCanal'));
  assert.ok(load.includes('normalizeVendedorCliente'));
  assert.ok(!load.includes('getListaClientesActiva'));
  assert.ok(!load.includes('ignoreScope'));
  assert.ok(render.includes('filterByUtilizadorActivo'));
  assert.ok(render.includes('resolveVendFilt'));
  assert.ok(!html.includes('ignoreScope'));
  const scope = extractFn(html, 'getVendedorScope');
  assert.ok(scope.includes('HORECA_VE_TUDO'));
  assert.ok(!scope.includes('Por Registar não usa'));
  const sync = extractFn(html, 'sincronizarListaClientes');
  assert.ok(sync.includes('fundirListasClientesPorCod'));
  assert.ok(sync.includes('_ultimaListaClientesRemota'));
  assert.ok(!sync.includes('mantém local; republica via carga SAP'));
});

check('service worker sobe para por-registar-helcio', () => {
  assert.ok(sw.includes('v2026-10-02-pdf-cockpit'));
  assert.ok(html.includes('v2026-10-02-pdf-cockpit'));
  assert.ok(!sw.includes('v2026-10-02-por-registar-helcio'));
  assert.ok(!html.includes('v2026-10-02-por-registar-helcio'));
});

if (process.exitCode) process.exit(process.exitCode);
console.log('test-por-registar-horeca: ok');
