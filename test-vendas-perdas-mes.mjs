#!/usr/bin/env node
/**
 * Separador Vendas (já não se chama Quadro) e maiores perdas do mês.
 * Top 20 por vendedor, filtro reduz a um, perda = max(0, N-1 − N).
 * Sem N-1 por cliente, a perda é o Fatur. negativo. Não inventa clientes.
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

const store = {};
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
  parseFloat,
  isNaN,
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
  },
  setTimeout,
  clearTimeout,
  window: {},
  _canalPorNpess: null,
  _perdasFiltroUi: null,
  PERDAS_TOP: 20,
  PERDAS_FILTRO_LS: 'delta_vendas_perdas_filtro',
  CANAIS_APP: {
    horeca: {
      nome: 'Horeca',
      vendedores: ['Hélcio Grégio', 'Paulo Fontes', 'Daniela Santos', 'Filipe Neves'],
      vendedorCods: [99520002, 99520006, 99520007, 99520010, 99520015, 99520016, 99520017, 99520019],
    },
    ecommerce: {
      nome: 'Ecommerce',
      vendedores: ['Marcio Gorga'],
      vendedorCods: [99520001],
    },
    varejo: { nome: 'Varejo e Distr. Varejo', vendedores: ['Diogo Oliveira'], vendedorCods: [99520018] },
    distribuidores: { nome: 'Distribuidores', vendedores: ['Eduardo Moreira', 'Massimo Bottello'], vendedorCods: [99520003, 99520020] },
  },
  VENDEDORES_DEFAULT: [
    { cod: 99520002, nome: 'HÉLCIO GRÉGIO' },
    { cod: 99520015, nome: 'HÉLCIO GRÉGIO' },
    { cod: 99520006, nome: 'DANIELA SANTOS' },
    { cod: 99520016, nome: 'DANIELA SANTOS' },
    { cod: 99520007, nome: 'PAULO FONTES' },
    { cod: 99520017, nome: 'PAULO FONTES' },
    { cod: 99520010, nome: 'FILIPE NEVES' },
    { cod: 99520019, nome: 'FILIPE NEVES' },
    { cod: 99520001, nome: 'MARCIO GORGA' },
  ],
};
vm.createContext(ctx);

[
  'npessEmpresaGn',
  'vendasYmFromISO',
  'normalizeVendaCod',
  'parseValorVendaSap',
  'npessDeCelulaExcel',
  'npessDaLinhaVendaQuadro',
  'dimensoesVendaQuadro',
  'linhasPlVendasQuadro',
  'mapasVendasQuadro',
  'normNomeVendaMenu',
  'getCanalIdPorVendedorCod',
  'vendasYmAnterior',
  'mesesJanelaCargaVendas',
  'agregarFaturClienteMes',
  'vendasClienteVazio',
  'substituirClientesMesesJanela',
  'linhasDeMesCliente',
  'mesClienteTem',
  'arredondarRsPerdas',
  'ymLinhaPerdas',
  'nomeExibicaoVendedorPerdas',
  'nomeCanalAppPerdas',
  'ordemVendedoresPerdas',
  'indiceOrdemVendedorPerdas',
  'maioresPerdasMes',
  'textoCriterioPerdas',
  'perdasFiltroBlank',
  'perdasFiltroState',
  'perdasFiltroDe',
  'perdasGravarFiltro',
].forEach(name => vm.runInContext(extractFn(html, name), ctx));

const YM = '2026-09';
const YM1 = '2025-09';
const HORECA = [
  { vendedor: 'Hélcio Grégio', cods: [99520002, 99520015] },
  { vendedor: 'Paulo Fontes', cods: [99520007] },
  { vendedor: 'Daniela Santos', cods: [99520006] },
  { vendedor: 'Filipe Neves', cods: [99520010, 99520019] },
];

function linhasHoreca() {
  const linhas = [];
  HORECA.forEach((v, vi) => {
    for (let i = 1; i <= 25; i++) {
      const npess = v.cods[i % v.cods.length];
      linhas.push({
        cod: 'C' + vi + String(i).padStart(2, '0'),
        data: YM1 + '-10',
        valor: i,
        npess: npess,
        nomeEsperado: 'Cliente ' + vi + '-' + i,
      });
      if (i !== 25) {
        linhas.push({
          cod: 'C' + vi + String(i).padStart(2, '0'),
          data: YM + '-10',
          valor: 0,
          npess: npess,
        });
      }
    }
    linhas.push({
      cod: 'SOBE' + vi,
      data: YM1 + '-02',
      valor: 10,
      npess: v.cods[0],
    });
    linhas.push({
      cod: 'SOBE' + vi,
      data: YM + '-02',
      valor: 40,
      npess: v.cods[0],
    });
  });
  linhas.push({ cod: 'ECOM1', data: YM1 + '-05', valor: 9999, npess: 99520001 });
  return linhas;
}

const nomes = {};
linhasHoreca().forEach(r => {
  if (r.nomeEsperado) nomes[r.cod] = r.nomeEsperado;
});

function calcular(extra) {
  ctx._canalPorNpess = null;
  const o = Object.assign({
    ym: YM,
    ymN1: YM1,
    canalId: 'horeca',
    mapas: ctx.mapasVendasQuadro(),
    temColunaValor: true,
    nomesPorCod: nomes,
    top: 20,
  }, extra || {});
  return ctx.maioresPerdasMes(linhasHoreca(), o);
}

check('o separador deixa de se chamar Quadro', () => {
  assert.ok(html.includes("onclick=\"cvmShowSub('quadro')\">Vendas</button>"));
  assert.ok(!html.includes(">Quadro</button>"));
  assert.ok(html.includes("onclick=\"cvmShowSub('perdas')\">Maiores perdas mês</button>"));
  assert.ok(html.includes("onclick=\"pvShowView('perdas')\">Maiores perdas mês</button>"));
  assert.ok(html.includes('id="tab-vendas-canal"'));
  assert.ok(html.includes('>Notas fiscais</button>'));
  assert.ok(html.includes('99520002'));
  assert.ok(html.includes('99520015'));
  assert.ok(html.includes('99520010'));
  assert.ok(html.includes('99520019'));
  assert.ok(html.includes('const PERDAS_FILTRO_MS = 1000'));
  assert.ok(html.includes("delta_vendas_perdas_filtro"));
  assert.ok(html.includes('HORECA_VE_TUDO'));
});

check('cada vendedor Horeca devolve no máximo 20 e o filtro reduz a um', () => {
  const todos = calcular();
  assert.equal(todos.criterio, 'n1');
  assert.equal(todos.grupos.length, 4);
  const nomesVend = todos.grupos.map(g => g.vendedor);
  assert.deepEqual(nomesVend, ['Hélcio Grégio', 'Paulo Fontes', 'Daniela Santos', 'Filipe Neves']);
  todos.grupos.forEach(g => {
    assert.ok(g.linhas.length <= 20, g.vendedor + ' tem ' + g.linhas.length);
    assert.equal(g.linhas.length, 20);
    for (let i = 1; i < g.linhas.length; i++) {
      assert.ok(g.linhas[i - 1].perda >= g.linhas[i].perda);
    }
    assert.equal(g.linhas[0].perda, 25);
    assert.equal(g.linhas[19].perda, 6);
    assert.equal(g.total, 310);
    assert.ok(!g.linhas.some(r => String(r.cod).startsWith('SOBE')));
    assert.ok(!g.linhas.some(r => r.cod === 'ECOM1'));
    assert.equal(g.linhas[0].n, 0, 'quem não comprou em N entra com N = 0');
    assert.equal(g.linhas[0].n1, 25);
  });
  const helcio = todos.grupos[0];
  const codsHelcio = new Set(helcio.linhas.map(r => r.cod));
  assert.equal(codsHelcio.size, 20);

  const soFilipe = calcular({ vendedor: 'Filipe Neves' });
  assert.equal(soFilipe.grupos.length, 1);
  assert.equal(soFilipe.grupos[0].vendedor, 'Filipe Neves');
  assert.equal(soFilipe.grupos[0].linhas.length, 20);
  assert.ok(soFilipe.vendedores.length === 4);
});

check('no geral entra o Ecommerce e a coluna do canal', () => {
  const geral = calcular({ canalId: '' });
  const marcio = geral.grupos.find(g => g.vendedor === 'Marcio Gorga');
  assert.ok(marcio);
  assert.equal(marcio.linhas.length, 1);
  assert.equal(marcio.linhas[0].cod, 'ECOM1');
  assert.equal(marcio.linhas[0].canal, 'Ecommerce');
  assert.equal(marcio.linhas[0].perda, 9999);
  const horeca = geral.grupos.find(g => g.vendedor === 'Hélcio Grégio');
  assert.equal(horeca.linhas[0].canal, 'Horeca');
});

check('sem N-1 usa o Fatur. negativo e não inventa clientes', () => {
  const linhas = [
    { cod: 'D1', data: YM + '-04', valor: -80, npess: 99520010 },
    { cod: 'D1', data: YM + '-05', valor: 20, npess: 99520010 },
    { cod: 'D2', data: YM + '-04', valor: 50, npess: 99520010 },
    { cod: 'D3', data: YM + '-04', valor: -15, npess: 99520006 },
  ];
  const dev = ctx.maioresPerdasMes(linhas, {
    ym: YM,
    ymN1: YM1,
    canalId: 'horeca',
    mapas: ctx.mapasVendasQuadro(),
    temColunaValor: true,
    nomesPorCod: { D1: 'Devol A', D3: 'Devol B' },
  });
  assert.equal(dev.criterio, 'devolucao');
  assert.ok(ctx.textoCriterioPerdas(dev).includes('devolução'));
  const cods = dev.grupos.flatMap(g => g.linhas.map(r => r.cod));
  assert.deepEqual(cods.sort(), ['D1', 'D3']);
  const d1 = dev.grupos.flatMap(g => g.linhas).find(r => r.cod === 'D1');
  assert.equal(d1.perda, 80);
  const antigo = ctx.maioresPerdasMes([
    { cod: 'N1A', data: '10.09.2025', valor: 100, npess: 99520002 },
    { cod: 'N1A', data: '2026-09-10', valor: 40, npess: 99520015 },
  ], {
    ym: YM, ymN1: YM1, canalId: 'horeca', mapas: ctx.mapasVendasQuadro(), temColunaValor: true,
    nomesPorCod: { N1A: 'Cliente antigo' },
  });
  assert.equal(antigo.criterio, 'n1');
  assert.equal(antigo.grupos.length, 1);
  assert.equal(antigo.grupos[0].vendedor, 'Hélcio Grégio');
  assert.equal(antigo.grupos[0].linhas[0].perda, 60);
  assert.equal(antigo.grupos[0].linhas[0].n1, 100);
  assert.equal(antigo.grupos[0].linhas[0].n, 40);
  assert.equal(d1.n, -60);
  assert.equal(d1.n1Tem, false);
  assert.equal(d1.vendedor, 'Filipe Neves');

  const sem = ctx.maioresPerdasMes([
    { cod: 'X1', data: YM + '-01', valor: null, npess: 99520010 },
  ], {
    ym: YM, ymN1: YM1, canalId: 'horeca', mapas: ctx.mapasVendasQuadro(), temColunaValor: true,
  });
  assert.equal(sem.criterio, 'sem-fatur');
  assert.equal(sem.grupos.length, 0);

  const semCol = ctx.maioresPerdasMes([
    { cod: 'FANTASMA', data: YM + '-01', valor: -999, npess: 99520010 },
  ], {
    ym: YM, ymN1: YM1, canalId: 'horeca', mapas: ctx.mapasVendasQuadro(), temColunaValor: false,
  });
  assert.equal(semCol.grupos.length, 0);
  assert.equal(semCol.motivo, 'coluna');
});

check('a carga grava Fatur. por cliente só no mês corrente e no anterior', () => {
  const antes = {
    meses: {
      '2026-08': { clientes: { '1\t1': { cod: '1', npess: 1, valor: 9, negativo: 0, nome: 'Antigo' } } },
    },
  };
  const linhas = [
    { cod: '010', data: '2026-09-02', valor: 100, npess: 99520002, nome: 'Cliente Alfa' },
    { cod: '010', data: '2026-09-03', valor: -30, npess: 99520002 },
    { cod: '010', data: '2026-09-04', valor: 10, npess: 99520015, nome: 'Cliente Alfa' },
    { cod: '011', data: '2026-08-01', valor: 999, npess: 99520002, nome: 'Fora' },
    { cod: '012', data: '2025-09-01', valor: 50, npess: 99520002, nome: 'Ano' },
  ];
  const out = ctx.substituirClientesMesesJanela(antes, linhas, '2026-10-02');
  assert.equal(out.meses['2026-08'].clientes['1\t1'].valor, 9);
  assert.equal(out.meses['2025-09'], undefined);
  assert.equal(out.meses['2026-10'], undefined);
  const gravado = out.meses['2026-09'].clientes['10\t99520002'];
  assert.equal(gravado.valor, 70);
  assert.equal(gravado.negativo, -30);
  assert.equal(gravado.nome, 'Cliente Alfa');
  assert.equal(out.meses['2026-09'].clientes['10\t99520015'].valor, 10);
  ctx._canalPorNpess = null;
  const modelo = ctx.maioresPerdasMes(ctx.linhasDeMesCliente(out.meses['2026-09'], '2026-09'), {
    ym: '2026-09',
    ymN1: '2025-09',
    canalId: 'horeca',
    mapas: ctx.mapasVendasQuadro(),
    temColunaValor: true,
    nomesPorCod: { '10': 'Cliente Alfa' },
  });
  assert.equal(modelo.criterio, 'devolucao');
  assert.equal(modelo.grupos.length, 1);
  assert.equal(modelo.grupos[0].vendedor, 'Hélcio Grégio');
  assert.equal(modelo.grupos[0].linhas.length, 1);
  assert.equal(modelo.grupos[0].linhas[0].nome, 'Cliente Alfa');
  assert.equal(modelo.grupos[0].linhas[0].perda, 30);
  const proc = extractFn(html, 'processVendasFile');
  assert.ok(proc.includes('substituirClientesMesesJanelaNoStore(linhasJanela, hoje)'));
  assert.ok(proc.indexOf('substituirClientesMesesJanelaNoStore(linhasJanela, hoje)') < proc.indexOf('getVendasDedupKeySet'));
  assert.ok(!proc.includes('getVendas('));
  const aviso = ctx.textoCriterioPerdas({ criterio: 'sem-fatur', motivo: 'por-gravar' });
  assert.ok(aviso.includes('próxima carga'));
  assert.ok(aviso.includes('Não se inventam clientes'));
  assert.ok(!html.includes('>Quadro</button>'));
});

check('NPess diferente entre anos junta o N ao N-1 do mesmo cliente', () => {
  const mapas = ctx.mapasVendasQuadro();
  mapas.vendedorPorNpess[99520003] = 'MASSIMO BOTTELLO';
  mapas.vendedorPorNpess[99520020] = 'EDUARDO MOREIRA';
  mapas.canalPorNpess[99520003] = 'Distribuidores regionais';
  mapas.canalPorNpess[99520020] = 'Distribuidores regionais';
  ctx._canalPorNpess = null;
  const modelo = ctx.maioresPerdasMes([
    { cod: '406016', data: '2025-09-15', valor: 58480.46, npess: 99520003 },
    { cod: '406016', data: '2026-09-15', valor: 46662.60, npess: 99520020 },
    { cod: '790976', data: '2025-09-02', valor: 47275.31, npess: 99520003 },
    { cod: '790976', data: '2026-09-02', valor: 44282.17, npess: 99520020 },
    { cod: '749122', data: '2025-09-02', valor: 31057.68, npess: 99520003 },
    { cod: '749122', data: '2026-09-02', valor: 42688.42, npess: 99520020 },
    { cod: 'PAROU', data: '2025-09-02', valor: 1000, npess: 99520003 },
  ], {
    ym: YM,
    ymN1: YM1,
    canalId: 'distribuidores',
    mapas: mapas,
    temColunaValor: true,
    nomesPorCod: {
      '406016': 'F. J. RIBEIRO CAFÉ-ME',
      '790976': 'Outro que desceu',
      '749122': 'Outro que subiu',
      'PAROU': 'Parou de comprar',
    },
  });
  assert.equal(modelo.criterio, 'n1');
  const linhas = modelo.grupos.flatMap(g => g.linhas);
  const ribeiro = linhas.find(r => r.cod === '406016');
  assert.ok(ribeiro, 'o Ribeiro entra na lista');
  assert.equal(ribeiro.vendedor, 'Eduardo Moreira');
  assert.equal(ribeiro.n1, 58480.46);
  assert.equal(ribeiro.n, 46662.6);
  assert.equal(ribeiro.perda, 11817.86);
  assert.equal(ribeiro.canal, 'Distribuidores');
  const outro = linhas.find(r => r.cod === '790976');
  assert.ok(outro);
  assert.equal(outro.n, 44282.17);
  assert.equal(outro.perda, 2993.14);
  assert.ok(!linhas.some(r => r.cod === '749122'), 'quem comprou mais em N não é perda');
  const parou = linhas.find(r => r.cod === 'PAROU');
  assert.ok(parou);
  assert.equal(parou.vendedor, 'Massimo Bottello');
  assert.equal(parou.n, 0);
  assert.equal(parou.perda, 1000);
  const eduardo = modelo.grupos.find(g => g.vendedor === 'Eduardo Moreira');
  const massimo = modelo.grupos.find(g => g.vendedor === 'Massimo Bottello');
  assert.ok(eduardo.linhas.some(r => r.cod === '406016'));
  assert.ok(!massimo.linhas.some(r => r.cod === '406016'));
  assert.ok(ctx.textoCriterioPerdas(modelo).includes('mesmo que o vendedor tenha mudado'));
});

check('sem compras em N, a linha fica no NPess atual e o R$ não muda', () => {
  const mapas = ctx.mapasVendasQuadro();
  mapas.vendedorPorNpess[99520003] = 'MASSIMO BOTTELLO';
  mapas.vendedorPorNpess[99520020] = 'EDUARDO MOREIRA';
  mapas.canalPorNpess[99520003] = 'Distribuidores regionais';
  mapas.canalPorNpess[99520020] = 'Distribuidores regionais';
  ctx._canalPorNpess = null;
  const modelo = ctx.maioresPerdasMes([
    { cod: '406016', data: '2025-09-15', valor: 58480.46, npess: 99520003 },
  ], {
    ym: YM,
    ymN1: YM1,
    canalId: 'distribuidores',
    mapas: mapas,
    temColunaValor: true,
    nomesPorCod: { '406016': 'F. J. RIBEIRO CAFÉ-ME' },
    npessAtualPorCod: { '406016': 99520020 },
  });
  const ribeiro = modelo.grupos.flatMap(g => g.linhas).find(r => r.cod === '406016');
  assert.ok(ribeiro, 'o Ribeiro entra mesmo sem compras em N');
  assert.equal(ribeiro.vendedor, 'Eduardo Moreira');
  assert.equal(ribeiro.n1, 58480.46);
  assert.equal(ribeiro.n, 0);
  assert.equal(ribeiro.perda, 58480.46);
  assert.ok(!modelo.grupos.some(g => g.vendedor === 'Massimo Bottello' && g.linhas.some(r => r.cod === '406016')));
});

check('o filtro do vendedor grava no localStorage', () => {
  ctx._perdasFiltroUi = null;
  store.delta_vendas_perdas_filtro = JSON.stringify({
    geral: 'Filipe Neves',
    porCanal: { horeca: 'Daniela Santos' },
  });
  assert.equal(ctx.perdasFiltroDe('geral'), 'Filipe Neves');
  assert.equal(ctx.perdasFiltroDe('horeca'), 'Daniela Santos');
  ctx.perdasFiltroState().porCanal.horeca = '';
  ctx.perdasGravarFiltro();
  const saved = JSON.parse(store.delta_vendas_perdas_filtro);
  assert.equal(saved.porCanal.horeca, '');
  assert.equal(saved.geral, 'Filipe Neves');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(sw.includes('v2026-10-02-vendedor-atual'));
  assert.ok(html.includes('v2026-10-02-vendedor-atual'));
});

if (process.exitCode) process.exit(process.exitCode);
console.log('test-vendas-perdas-mes: ok');
