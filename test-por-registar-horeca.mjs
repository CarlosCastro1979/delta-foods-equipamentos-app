#!/usr/bin/env node
/** Por Registar Horeca: a equipa vê a cloud do canal, não um cache de 3 nem só o próprio vendedor. */
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

const ctx = {
  console,
  Array,
  Map,
  Set,
  String,
  Number,
  isFinite,
  Date,
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
  ].map(n => extractFn(html, n)).join('\n'),
  ctx
);

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

check('Por Registar não filtra pelo vendedor da sessão', () => {
  const load = extractFn(html, 'loadPendentes');
  const render = extractFn(html, 'renderPendentes');
  assert.ok(load.includes('listaPorRegistarDoCanal'));
  assert.ok(!load.includes('getListaClientesActiva'));
  assert.ok(!load.includes('filterByUtilizadorActivo'));
  assert.ok(load.includes('ignoreScope: true'));
  assert.ok(!render.includes('filterByUtilizadorActivo'));
  assert.ok(!render.includes('resolveVendFilt'));
  assert.ok(!render.includes('getVendedorScope'));
  const sync = extractFn(html, 'sincronizarListaClientes');
  assert.ok(sync.includes('fundirListasClientesPorCod'));
  assert.ok(sync.includes('_ultimaListaClientesRemota'));
  assert.ok(!sync.includes('mantém local; republica via carga SAP'));
});

check('service worker sobe para por-registar-horeca', () => {
  assert.ok(sw.includes('v2026-10-02-por-registar-horeca'));
  assert.ok(html.includes('v2026-10-02-por-registar-horeca'));
  assert.ok(!sw.includes('v2026-10-02-catalogo-mc00'));
  assert.ok(!html.includes('v2026-10-02-catalogo-mc00'));
});

if (process.exitCode) process.exit(process.exitCode);
console.log('test-por-registar-horeca: ok');
