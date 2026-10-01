#!/usr/bin/env node
/**
 * Carga de vendas: só grava o dia local de hoje.
 * Esse dia entra mesmo que o resumo marque o mês como fechado.
 * Outros dias (resto do mês fechado, meses anteriores, dias 1–29) não se relêem nem se alteram.
 * Regra do mês: statusVendasCoberturaMes === 'ok'
 * (até Jun/2026 com dados = fechado; Jul/2026+ fica aberto no próprio último dia útil
 * e só fecha no dia seguinte, se já houver venda nesse dia).
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFn(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('Função em falta: ' + name);
  if (src.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const paren = src.indexOf('(', start);
  let depth = 0;
  let bodyBrace = -1;
  for (let i = paren; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        bodyBrace = src.indexOf('{', i);
        break;
      }
    }
  }
  if (bodyBrace < 0) throw new Error('Corpo em falta: ' + name);
  depth = 0;
  for (let i = bodyBrace; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
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

const HOJE = '2026-09-30'; // último dia útil de Set/2026 (quarta)

const ctx = {
  console,
  Date,
  Math,
  Number,
  String,
  Object,
  Array,
  Set,
  Map,
  parseInt,
  isNaN,
  window: {},
  HEADERS: { apikey: 'test' },
  SUPA_VENDAS: 'https://example.test/vendas',
  fetchUrls: [],
  fetch: async (url) => {
    ctx.fetchUrls.push(String(url));
    return { ok: true, status: 200, json: async () => [] };
  },
};
ctx.VENDAS_COBERTURA_REGRA_DESDE = '2026-07';
vm.createContext(ctx);

const fns = [
  'isVendasMesRegraNova',
  'vendasHojeISO',
  'vendasISODateOnly',
  'ultimoDiaUtilMes',
  'statusVendasCoberturaMes',
  'isVendasMesFechado',
  'vendasYmFromISO',
  'vendaDataCaiEmMesFechado',
  'vendaDataEntraNaCarga',
  'mesesFechadosFromCobertura',
  'filtrarLinhasVendasMesesAbertos',
  'vendasCoberturaObjToMap',
  'aggregateVendasPorMes',
  'mergeCoberturaVendasMesesAbertos',
  'formatDateISOLocal',
  'parseDateSC',
  'normalizeVendaCod',
  'vendaDedupKey',
  'getVendasDedupKeySet',
];
for (const name of fns) {
  vm.runInContext(extractFn(html, name), ctx);
}

function linha(data, cod, tipo = 'OUTRO') {
  return { cod, data, tipo, qty: 1, peso: 1 };
}

function coberturaInicial() {
  return new Map([
    ['2020-01', { linhas: 6400, clientes: 678, ultima_data: '2020-01-31' }],
    ['2026-06', { linhas: 2100, clientes: 140, ultima_data: '2026-06-30' }],
    ['2026-07', { linhas: 1700, clientes: 120, ultima_data: '2026-07-31' }],
    ['2026-08', { linhas: 501, clientes: 80, ultima_data: '2026-08-31' }],
    ['2026-09', { linhas: 458, clientes: 70, ultima_data: '2026-09-29' }],
  ]);
}

function snap(map, ym) {
  const info = map.get(ym);
  return { linhas: info.linhas, clientes: info.clientes, ultima_data: info.ultima_data };
}

check('regra antiga: Jun/2026 com dados está fechado; sem linhas está em falta', () => {
  assert.equal(ctx.statusVendasCoberturaMes('2026-06', { linhas: 2100, ultima_data: '2026-06-15' }), 'ok');
  assert.equal(ctx.statusVendasCoberturaMes('2019-09', { linhas: 746, clientes: 100 }), 'ok');
  assert.equal(ctx.statusVendasCoberturaMes('2026-06', { linhas: 0 }), 'falta');
  assert.equal(ctx.isVendasMesFechado('2026-06', { linhas: 2100 }, HOJE), true);
  assert.equal(ctx.isVendasMesFechado('2026-06', { linhas: 0 }, HOJE), false);
});

check('Jul/2026+ no próprio último dia útil continua aberto; no dia seguinte fecha', () => {
  assert.equal(ctx.ultimoDiaUtilMes('2026-07'), '2026-07-31');
  assert.equal(ctx.ultimoDiaUtilMes('2026-08'), '2026-08-31');
  assert.equal(ctx.ultimoDiaUtilMes('2026-09'), '2026-09-30');
  assert.equal(ctx.isVendasMesFechado('2026-07', { linhas: 1700, ultima_data: '2026-07-31' }, HOJE), true);
  assert.equal(ctx.isVendasMesFechado('2026-08', { linhas: 501, ultima_data: '2026-08-31' }, HOJE), true);
  assert.equal(ctx.isVendasMesFechado('2026-07', { linhas: 100, ultima_data: '2026-07-20' }, HOJE), false);
  assert.equal(ctx.statusVendasCoberturaMes('2026-09', { linhas: 458, ultima_data: '2026-09-29' }, HOJE), 'pendente');
  assert.equal(ctx.isVendasMesFechado('2026-09', { linhas: 458, ultima_data: '2026-09-29' }, HOJE), false);
  assert.equal(ctx.statusVendasCoberturaMes('2026-09', { linhas: 100, ultima_data: '2026-09-10' }, '2026-09-15'), 'pendente');
  // Venda já gravada no dia 30 não fecha Setembro no próprio dia 30.
  assert.equal(ctx.statusVendasCoberturaMes('2026-09', { linhas: 500, ultima_data: '2026-09-30' }, HOJE), 'pendente');
  assert.equal(ctx.isVendasMesFechado('2026-09', { linhas: 500, ultima_data: '2026-09-30' }, HOJE), false);
  // Dia civil seguinte: aí fecha, se a última venda chegou ao último dia útil.
  assert.equal(ctx.statusVendasCoberturaMes('2026-09', { linhas: 586, ultima_data: '2026-09-30' }, '2026-10-01'), 'ok');
  assert.equal(ctx.isVendasMesFechado('2026-09', { linhas: 586, ultima_data: '2026-09-30' }, '2026-10-01'), true);
  assert.equal(ctx.statusVendasCoberturaMes('2026-09', { linhas: 458, ultima_data: '2026-09-29' }, '2026-10-01'), 'pendente');
});

check('2.ª carga no dia 30 com Setembro fechado no resumo ainda insere linhas novas desse dia', () => {
  const antes = new Map([
    ['2026-06', { linhas: 2100, clientes: 140, ultima_data: '2026-06-30' }],
    ['2026-08', { linhas: 501, clientes: 80, ultima_data: '2026-08-31' }],
    // 1.ª carga do dia 30 já gravou venda em 2026-09-30 (produção antiga dizia «fechado / até 30»)
    ['2026-09', { linhas: 500, clientes: 70, ultima_data: '2026-09-30' }],
  ]);
  const agoAntes = snap(antes, '2026-08');
  const junAntes = snap(antes, '2026-06');
  const setAntes = snap(antes, '2026-09');
  // A regra do último dia útil NÃO fecha Setembro no próprio dia 30.
  assert.equal(ctx.isVendasMesFechado('2026-09', antes.get('2026-09'), HOJE), false);
  const fechadosRegra = ctx.mesesFechadosFromCobertura(antes, HOJE);
  assert.ok(fechadosRegra.has('2026-08'));
  assert.ok(fechadosRegra.has('2026-06'));
  assert.ok(!fechadosRegra.has('2026-09'));
  // O resumo que o Carlos já vê pode continuar a tratar Setembro como fechado.
  const fechados = new Set(fechadosRegra);
  fechados.add('2026-09');

  const ficheiro = [
    linha('2026-08-31', '300'),
    linha('2026-09-15', '400', 'GRÃO'),
    linha('2026-09-29', '500', 'OUTRO'),
    linha('2026-09-30', '500', 'GRÃO'),
    linha('2026-09-30', '501', 'GRÃO'),
    linha('2026-09-30', '502', 'OUTRO'),
  ];
  const filtrado = ctx.filtrarLinhasVendasMesesAbertos(ficheiro, fechados, HOJE);
  assert.equal(filtrado.hoje, HOJE);
  assert.equal(filtrado.ignoradas, 3);
  assert.equal(filtrado.ignoradasOutroDia, 0);
  assert.deepEqual(filtrado.mesesIgnorados, ['2026-08', '2026-09']);
  assert.deepEqual(filtrado.mesesAbertos, ['2026-09']);
  assert.equal(filtrado.lidas, 3);
  assert.ok(filtrado.aceites.every(r => r.data === '2026-09-30'));
  assert.ok(!filtrado.aceites.some(r => r.data === '2026-09-15' || r.data === '2026-08-31'));

  const existentes = new Set([
    ctx.vendaDedupKey('500', '2026-09-30', 'GRÃO'),
  ]);
  const novas = [];
  let jaExistentes = 0;
  for (const row of filtrado.aceites) {
    const key = ctx.vendaDedupKey(row.cod, row.data, row.tipo);
    if (existentes.has(key)) { jaExistentes++; continue; }
    novas.push(row);
  }
  assert.equal(jaExistentes, 1);
  assert.equal(novas.length, 2);
  assert.deepEqual(novas.map(r => r.cod).sort(), ['501', '502']);

  const depois = ctx.mergeCoberturaVendasMesesAbertos(antes, ctx.aggregateVendasPorMes(novas), HOJE);
  assert.deepEqual(snap(depois, '2026-08'), agoAntes);
  assert.deepEqual(snap(depois, '2026-06'), junAntes);
  assert.equal(depois.get('2026-09').linhas, setAntes.linhas + 2);
  assert.equal(depois.get('2026-09').ultima_data, '2026-09-30');
  assert.equal(depois.get('2026-09').clientes, 70);
  assert.deepEqual(snap(antes, '2026-08'), agoAntes);
  assert.deepEqual(snap(antes, '2026-09'), setAntes);
});

check('no próprio dia 30, com o mês aberto pela regra, Setembro 1–29 e Agosto ficam de fora', () => {
  const antes = new Map([
    ['2026-08', { linhas: 501, clientes: 80, ultima_data: '2026-08-31' }],
    ['2026-09', { linhas: 500, clientes: 70, ultima_data: '2026-09-30' }],
  ]);
  const fechados = ctx.mesesFechadosFromCobertura(antes, HOJE);
  assert.ok(!fechados.has('2026-09'));
  const filtrado = ctx.filtrarLinhasVendasMesesAbertos([
    linha('2026-09-15', '400'),
    linha('2026-09-29', '401'),
    linha('2026-08-31', '300'),
    linha('2026-09-30', '501', 'GRÃO'),
  ], fechados, HOJE);
  assert.equal(filtrado.lidas, 1);
  assert.equal(filtrado.aceites[0].data, '2026-09-30');
  assert.equal(filtrado.aceites[0].cod, '501');
  assert.equal(filtrado.ignoradas, 1);
  assert.equal(filtrado.ignoradasOutroDia, 2);
  assert.deepEqual(filtrado.mesesIgnorados, ['2026-08']);
});

check('no dia 1/10 Setembro com venda no dia 30 já está fechado e a carga não o reabre', () => {
  const antes = new Map([
    ['2026-08', { linhas: 501, clientes: 80, ultima_data: '2026-08-31' }],
    ['2026-09', { linhas: 586, clientes: 70, ultima_data: '2026-09-30' }],
  ]);
  const hoje = '2026-10-01';
  const fechados = ctx.mesesFechadosFromCobertura(antes, hoje);
  assert.ok(fechados.has('2026-08'));
  assert.ok(fechados.has('2026-09'));
  const filtrado = ctx.filtrarLinhasVendasMesesAbertos([
    linha('2026-09-30', '900'),
    linha('2026-09-15', '400'),
    linha('2026-08-31', '300'),
    linha('2026-10-01', '901'),
  ], fechados, hoje);
  assert.equal(filtrado.lidas, 1);
  assert.equal(filtrado.aceites[0].data, '2026-10-01');
  assert.ok(filtrado.aceites.every(r => r.data !== '2026-09-30'));
  const soSetembro = ctx.filtrarLinhasVendasMesesAbertos([
    linha('2026-09-30', '900'),
    linha('2026-08-31', '300'),
  ], fechados, hoje);
  assert.equal(soSetembro.lidas, 0);
  assert.equal(soSetembro.ignoradas, 2);
  const depois = ctx.mergeCoberturaVendasMesesAbertos(
    antes,
    ctx.aggregateVendasPorMes([linha('2026-09-30', '900'), linha('2026-08-31', '300')]),
    hoje
  );
  assert.equal(depois.get('2026-09').linhas, 586);
  assert.equal(depois.get('2026-08').linhas, 501);
});

check('ficheiro misto: só o dia de hoje entra; fechados e outros dias ficam iguais', () => {
  const antes = coberturaInicial();
  const fechadosAntes = {
    jan: snap(antes, '2020-01'),
    jun: snap(antes, '2026-06'),
    jul: snap(antes, '2026-07'),
    ago: snap(antes, '2026-08'),
  };
  const ficheiro = [
    linha('2026-06-15', '100'),
    linha('2026-06-16', '101'),
    linha('2026-06-30', '102'),
    linha('2026-07-31', '200'),
    linha('2026-07-10', '201'),
    linha('2026-08-31', '300'),
    linha('2020-01-15', '400'),
    linha('2020-01-16', '401'),
    linha('2026-09-30', '500'),
    linha('2026-09-30', '501'),
    linha('2026-09-29', '500'),
    linha('2020-03-02', '600'),
    linha('2020-03-03', '601'),
  ];
  const fechados = ctx.mesesFechadosFromCobertura(antes, HOJE);
  assert.ok(fechados.has('2026-06') && fechados.has('2026-07') && fechados.has('2026-08') && fechados.has('2020-01'));
  assert.ok(!fechados.has('2026-09'));
  assert.ok(!fechados.has('2020-03'));

  const filtrado = ctx.filtrarLinhasVendasMesesAbertos(ficheiro, fechados, HOJE);
  assert.equal(filtrado.ignoradas, 8);
  assert.equal(filtrado.ignoradasOutroDia, 3);
  assert.equal(filtrado.lidas, 2);
  assert.deepEqual(filtrado.mesesIgnorados, ['2020-01', '2026-06', '2026-07', '2026-08']);
  assert.deepEqual(filtrado.mesesAbertos, ['2026-09']);
  assert.ok(filtrado.aceites.every(r => r.data === HOJE));

  const depois = ctx.mergeCoberturaVendasMesesAbertos(antes, ctx.aggregateVendasPorMes(filtrado.aceites), HOJE);
  assert.deepEqual(snap(depois, '2020-01'), fechadosAntes.jan);
  assert.deepEqual(snap(depois, '2026-06'), fechadosAntes.jun);
  assert.deepEqual(snap(depois, '2026-07'), fechadosAntes.jul);
  assert.deepEqual(snap(depois, '2026-08'), fechadosAntes.ago);
  assert.equal(depois.get('2026-09').linhas, 458 + 2);
  assert.equal(depois.get('2026-09').ultima_data, '2026-09-30');
  assert.equal(depois.get('2026-09').clientes, 70);
  assert.equal(depois.has('2020-03'), false);
  assert.deepEqual(snap(antes, '2026-06'), fechadosAntes.jun);
});

check('agregado de mês fechado não substitui o resumo guardado', () => {
  const antes = coberturaInicial();
  const ataque = ctx.aggregateVendasPorMes([
    linha('2026-06-01', '1'),
    linha('2026-06-02', '2'),
    linha('2026-08-31', '3'),
  ]);
  const depois = ctx.mergeCoberturaVendasMesesAbertos(antes, ataque, HOJE);
  assert.equal(depois.get('2026-06').linhas, 2100);
  assert.equal(depois.get('2026-08').linhas, 501);
  assert.equal(depois.get('2026-09').linhas, 458);
});

check('sem resumo nenhum mês está fechado (primeira carga)', () => {
  const set = ctx.mesesFechadosFromCobertura(null, HOJE);
  assert.equal(set.size, 0);
  const filtrado = ctx.filtrarLinhasVendasMesesAbertos([
    linha('2020-01-01', '1'),
    linha('2026-09-30', '2'),
  ], set, HOJE);
  assert.equal(filtrado.lidas, 1);
  assert.equal(filtrado.ignoradas, 0);
  assert.equal(filtrado.ignoradasOutroDia, 1);
  assert.equal(filtrado.aceites[0].data, HOJE);
});

check('dia que não é hoje não reabre mês em falta nem mês com dados', () => {
  const map = new Map([
    ['2024-05', { linhas: 0, clientes: 0, ultima_data: null }],
    ['2024-06', { linhas: 3800, clientes: 400, ultima_data: '2024-06-28' }],
  ]);
  const fechados = ctx.mesesFechadosFromCobertura(map, HOJE);
  assert.ok(!fechados.has('2024-05'));
  assert.ok(fechados.has('2024-06'));
  const filtrado = ctx.filtrarLinhasVendasMesesAbertos([
    linha('2024-05-02', '9'),
    linha('2024-06-02', '8'),
    linha('2026-09-30', '7'),
  ], fechados, HOJE);
  assert.equal(filtrado.lidas, 1);
  assert.equal(filtrado.ignoradas, 1);
  assert.equal(filtrado.ignoradasOutroDia, 1);
  assert.equal(filtrado.aceites[0].data, HOJE);
});

check('processVendasFile não relê a base, não apaga fechados, não recalcula 500k', () => {
  const proc = extractFn(html, 'processVendasFile');
  const skipAt = proc.indexOf('vendaDataCaiEmMesFechado');
  const pushAt = proc.indexOf('candidatos.push');
  const pesoAt = proc.indexOf('row[iPeso]');
  assert.ok(skipAt > 0 && pushAt > skipAt, 'salto do mês fechado antes de gravar o modelo');
  assert.ok(pesoAt > skipAt, 'peso/tipo só depois de saltar o mês fechado');
  assert.ok(proc.includes('mesesFechadosFromCobertura'));
  assert.ok(proc.includes('vendaDataEntraNaCarga'));
  assert.ok(proc.includes('vendasHojeISO()'));
  assert.ok(proc.includes('mergeCoberturaVendasMesesAbertos(baseMap, agregadoNovos, hoje)'));
  assert.ok(proc.includes('dia: hoje'));
  assert.ok(!proc.includes('meses: mesesAbertosArr'));
  const entraAt = proc.indexOf('vendaDataEntraNaCarga');
  assert.ok(entraAt > 0 && entraAt < pesoAt, 'o dia de hoje é decidido antes de gravar o modelo');
  const hojeFn = extractFn(html, 'vendasHojeISO');
  assert.ok(hojeFn.includes('getFullYear') && hojeFn.includes('getDate'));
  assert.ok(!hojeFn.includes('toISOString'));
  assert.ok(!proc.includes('scSyncHistoricoFromVendas'));
  assert.ok(!proc.includes('loadVendasCobertura(true)'));
  assert.ok(!proc.includes('getVendas('));
  assert.ok(!proc.includes('fetchVendasCoberturaRows'));
  assert.ok(!proc.includes('invalidateVendasCoberturaCache'));
  assert.ok(!proc.includes("method: 'DELETE'"));
  assert.ok(!proc.includes('clearVendas('));
  const clears = proc.split('clearContratosCache()').length - 1;
  assert.equal(clears, 1);
  const dedup = extractFn(html, 'getVendasDedupKeySet');
  assert.ok(dedup.indexOf('data=lt.') > 0);
  assert.ok(dedup.indexOf('if (mesesSet)') < dedup.indexOf('data=lte.'));
});

check('texto da cobertura alinha o carregamento com o dia de hoje', () => {
  assert.ok(html.includes('Ao carregar vendas, só entram linhas do dia local de hoje; os outros dias ficam intactos.'));
  assert.ok(html.includes('só se gravam linhas do <strong>dia de hoje</strong>'));
  assert.ok(html.includes('as linhas de hoje entram na mesma'));
  assert.ok(html.includes('v2026-10-01-nfe-dados-canal'));
  assert.ok(!html.includes('v2026-10-01-vendas-menu-canal'));
  assert.ok(!html.includes('v2026-10-01-vendas-marco'));
  assert.ok(!html.includes('v2026-10-01-vendas-ordem'));
  assert.ok(!html.includes('v2026-10-01-nfe-zip'));
  assert.ok(!html.includes('v2026-10-01-mapa-n'));
  assert.ok(!html.includes('v2026-10-01-vendas-rs'));
  assert.ok(!html.includes('v2026-10-01-vendas-prev'));
  assert.ok(!html.includes('v2026-10-01-vendas-quadro'));
  assert.ok(!html.includes('v2026-10-01-vendas-so-hoje'));
  assert.ok(!html.includes('v2026-10-01-vendas-dia-util'));
  assert.ok(html.includes('Até Jun/2026 = fechado. De Jul/2026 em diante'));
  assert.ok(html.includes('aberto no próprio último dia útil'));
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(sw.includes('v2026-10-01-nfe-dados-canal'));
  assert.ok(!sw.includes('v2026-10-01-vendas-menu-canal'));
  assert.ok(!sw.includes('v2026-10-01-vendas-marco'));
  assert.ok(!sw.includes('v2026-10-01-vendas-ordem'));
  assert.ok(!sw.includes('v2026-10-01-nfe-zip'));
  assert.ok(!sw.includes('v2026-10-01-mapa-n'));
  assert.ok(!sw.includes('v2026-10-01-vendas-rs'));
  assert.ok(!sw.includes('v2026-10-01-vendas-prev'));
  assert.ok(!sw.includes('v2026-10-01-vendas-quadro'));
  assert.ok(!sw.includes('v2026-10-01-vendas-so-hoje'));
  assert.ok(!sw.includes('v2026-10-01-vendas-dia-util'));
  assert.ok(!sw.includes('v2026-09-30-vendas-fechado'));
});

const pending = [];
function checkAsync(title, fn) {
  pending.push(Promise.resolve().then(fn).then(
    () => console.log('OK  ' + title),
    (e) => {
      console.error('FAIL ' + title);
      console.error(e && e.stack ? e.stack : e);
      process.exitCode = 1;
    }
  ));
}

checkAsync('dedup no servidor só pede o dia local de hoje', async () => {
  ctx.fetchUrls = [];
  ctx.window._vendasMemCache = null;
  ctx.fetch = async (url) => {
    ctx.fetchUrls.push(String(url));
    const u = String(url);
    if (u.includes('data=eq.2026-09-30')) {
      return { ok: true, status: 200, json: async () => [{ cod: '500', data: '2026-09-30', tipo: 'GRÃO' }] };
    }
    return { ok: true, status: 200, json: async () => [] };
  };
  const out = await ctx.getVendasDedupKeySet({ dia: '2026-09-30' });
  assert.equal(ctx.fetchUrls.length, 1);
  assert.ok(ctx.fetchUrls[0].includes('data=eq.2026-09-30'));
  assert.ok(!ctx.fetchUrls[0].includes('data=gte.2026-09-01'));
  assert.ok(!ctx.fetchUrls[0].includes('2026-08') && !ctx.fetchUrls[0].includes('2026-09-15'));
  assert.equal(out.count, 1);
  assert.ok(out.keys.has('500|2026-09-30|GRÃO'));

  ctx.window._vendasMemCache = [
    { cod: '1', data: '2026-06-30', tipo: 'OUTRO' },
    { cod: '2', data: '2026-09-15', tipo: 'GRÃO' },
    { cod: '3', data: '2026-09-30', tipo: 'OUTRO' },
  ];
  ctx.fetchUrls = [];
  const mem = await ctx.getVendasDedupKeySet({ dia: '2026-09-30' });
  assert.equal(ctx.fetchUrls.length, 0);
  assert.equal(mem.count, 1);
  assert.ok(mem.keys.has('3|2026-09-30|OUTRO'));
  ctx.window._vendasMemCache = null;
});

await Promise.all(pending);

if (process.exitCode) {
  console.error('\nFalhou pelo menos um teste de meses abertos nas vendas.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes de vendas (só meses abertos) passaram.');
