#!/usr/bin/env node
/**
 * Quadro de vendas: soma R$ por empresa × canal × vendedor.
 * Segunda carga do mesmo dia (dedup) não duplica.
 * Mês fechado / outro dia não muda.
 * Linha sem canal conhecido cai em «Por classificar» e não é omitida.
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
  window: {},
  VENDAS_COBERTURA_REGRA_DESDE: '2026-07',
};
vm.createContext(ctx);

const fns = [
  'npessEmpresaGn',
  'vendasYmFromISO',
  'normalizeVendaCod',
  'codEmissorVendaAceite',
  'formatDateISOLocal',
  'parseDateSC',
  'vendaDedupKey',
  'parseValorVendaSap',
  'indiceColunaValorVenda',
  'indiceColunaNpessVenda',
  'npessDeCelulaExcel',
  'linhaValorQuadroDeExcel',
  'dimensoesVendaQuadro',
  'npessDaLinhaVendaQuadro',
  'chaveCelulaQuadro',
  'quadroVendasVazio',
  'quadroVendasClone',
  'somarValorQuadro',
  'vendasISODateOnly',
  'maxDataVendaISO',
  'agregarVendasQuadro',
  'nomeVendedorQuadroMarcio',
  'quadroComMarcioIdentificado',
  'somarQuadrosVendas',
  'aplicarCargaAoQuadro',
  'completarQuadroDesdeBase',
  'totalQuadroAno',
  'linhasPlVendasQuadro',
  'mapasVendasQuadro',
  'vendasQuadroPassaFiltro',
  'vendasYmAnterior',
  'mesesJanelaCargaVendas',
  'vendaDataNaJanelaCarga',
  'vendaDataCaiEmMesFechado',
  'vendaDataEntraNaCarga',
  'vendaDataAntesDe2025',
  'vendaAnoRecebeValorQuadro',
  'canalQuadroEAntigo',
  'mesQuadroTemCanaisAntigos',
  'quadroTemCanaisAntigos',
  'mesQuadroCorrigido',
  'vendaMesQuadroSubstituivel',
  'vendaLinhaEntraValorHistorico',
  'classificarLinhasCargaVendas',
  'substituirValorMesesFechadosNoQuadro',
  'vendasISODateOnly',
  'vendasHojeISO',
  'isVendasMesRegraNova',
  'ultimoDiaUtilMes',
  'statusVendasCoberturaMes',
  'isVendasMesFechado',
  'maxDataVendaISO',
  'fundirLinhasVendaMesmoDia',
  'substituirValorMesAbertoPeloFicheiro',
  'ultimoDiaCivilMesISO',
  'formatDataQuadroPt',
  'diaDeCoberturaQuadro',
  'diaMaxMesQuadro',
  'textoAtualizacaoQuadroMes',
];
for (const name of fns) {
  vm.runInContext(extractFn(html, name), ctx);
}

const mapas = {
  canalPorNpess: {
    99520010: 'Horeca',
    99530001: 'Varejo e Distr. Varejo',
    99520001: 'Ecommerce',
    99520003: 'Distribuidores',
  },
  vendedorPorNpess: {
    99520010: 'FILIPE NEVES',
    99530001: 'DIOGO OLIVEIRA',
    99520001: 'MARCIO GORGA',
    99520003: 'MASSIMO BOTTELLO',
  },
};

const HOJE = '2026-10-01';
const opts = { mapas, npessPorCod: { '100': 99520010 }, hoje: HOJE, mesesFechados: new Set(['2026-06', '2026-09']) };

function celula(quadro, ym, empresa, canal, vendedor) {
  const mes = quadro.meses[ym];
  if (!mes) return null;
  const key = empresa + '\t' + canal + '\t' + vendedor;
  return mes.celulas[key] || null;
}

function linhasNovas(rows, keys) {
  const out = [];
  for (const r of rows) {
    const k = ctx.vendaDedupKey(r.cod, r.data, r.tipo || 'OUTRO');
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(r);
  }
  return out;
}

check('agregado soma valor por empresa, canal e vendedor', () => {
  const rows = [
    { cod: '1', data: HOJE, tipo: 'OUTRO', valor: 10.5, npess: 99520010 },
    { cod: '2', data: HOJE, tipo: 'OUTRO', valor: '1.234,50', npess: 99520010 },
    { cod: '3', data: HOJE, tipo: 'OUTRO', valor: 7, npess: 99530001 },
    { cod: '4', data: HOJE, tipo: 'GRÃO', valor: 3, npess: 99520010 },
  ];
  const q = ctx.agregarVendasQuadro(rows, opts);
  const filipe = celula(q, '2026-10', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES');
  const diogo = celula(q, '2026-10', 'Q Brasil', 'Varejo e Distr. Varejo', 'DIOGO OLIVEIRA');
  assert.ok(filipe, 'célula Filipe / Horeca / DFB');
  assert.equal(filipe.valor, 1248);
  assert.equal(filipe.linhas, 3);
  assert.equal(filipe.linhasComValor, 3);
  assert.ok(diogo, 'célula Diogo / Varejo / Q Brasil');
  assert.equal(diogo.valor, 7);
  assert.equal(diogo.linhas, 1);
  const ano = ctx.totalQuadroAno(q, 2026);
  assert.equal(ano.valor, 1255);
  assert.equal(ano.linhas, 4);
});

check('segunda carga do mesmo dia não duplica', () => {
  const rows = [
    { cod: '1', data: HOJE, tipo: 'OUTRO', valor: 40, npess: 99520010 },
    { cod: '1', data: HOJE, tipo: 'OUTRO', valor: 40, npess: 99520010 },
    { cod: '2', data: HOJE, tipo: 'GRÃO', valor: 10, npess: 99520003 },
  ];
  const keys = new Set();
  const primeira = linhasNovas(rows, keys);
  assert.equal(primeira.length, 2, 'dedup dentro da mesma carga');
  let q = ctx.aplicarCargaAoQuadro(ctx.quadroVendasVazio(), primeira, opts);
  const antes = celula(q, '2026-10', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES');
  assert.equal(antes.valor, 40);
  assert.equal(antes.linhas, 1);
  const segunda = linhasNovas(rows, keys);
  assert.equal(segunda.length, 0, 'o dia já gravado não volta a entrar');
  q = ctx.aplicarCargaAoQuadro(q, segunda, opts);
  const depois = celula(q, '2026-10', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES');
  assert.equal(depois.valor, 40);
  assert.equal(depois.linhas, 1);
  const massimo = celula(q, '2026-10', 'Delta Foods Brasil', 'Distribuidores', 'MASSIMO BOTTELLO');
  assert.equal(massimo.valor, 10);
  assert.equal(massimo.linhas, 1);
});

check('mês fechado não muda', () => {
  const base = ctx.quadroVendasVazio();
  base.meses['2026-06'] = {
    celulas: {
      'Delta Foods Brasil\tHoreca\tFILIPE NEVES': {
        empresa: 'Delta Foods Brasil', canal: 'Horeca', vendedor: 'FILIPE NEVES',
        valor: 1000, linhas: 50, linhasComValor: 50,
      },
    },
  };
  base.meses['2026-09'] = {
    celulas: {
      'Q Brasil\tVarejo e Distr. Varejo\tDIOGO OLIVEIRA': {
        empresa: 'Q Brasil', canal: 'Varejo e Distr. Varejo', vendedor: 'DIOGO OLIVEIRA',
        valor: 200, linhas: 8, linhasComValor: 0,
      },
    },
  };
  const carga = [
    { cod: '9', data: '2026-06-15', tipo: 'OUTRO', valor: 999, npess: 99520010 },
    { cod: '8', data: '2026-09-30', tipo: 'OUTRO', valor: 999, npess: 99530001 },
    { cod: '7', data: HOJE, tipo: 'OUTRO', valor: 15, npess: 99520001 },
  ];
  const q = ctx.aplicarCargaAoQuadro(base, carga, opts);
  const junho = celula(q, '2026-06', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES');
  assert.equal(junho.valor, 1000);
  assert.equal(junho.linhas, 50);
  const set = celula(q, '2026-09', 'Q Brasil', 'Varejo e Distr. Varejo', 'DIOGO OLIVEIRA');
  assert.equal(set.valor, 200);
  assert.equal(set.linhas, 8);
  const hoje = celula(q, '2026-10', 'Delta Foods Brasil', 'Ecommerce', 'MARCIO GORGA');
  assert.ok(hoje);
  assert.equal(hoje.valor, 15);
  assert.equal(hoje.linhas, 1);

  const db = ctx.agregarVendasQuadro([
    { cod: '1', data: '2026-06-10', tipo: 'OUTRO', valor: 5, npess: 99520010 },
    { cod: '2', data: HOJE, tipo: 'OUTRO', valor: 1, npess: 99520010 },
  ], opts);
  const completo = ctx.completarQuadroDesdeBase(q, db, {
    hoje: HOJE,
    mesesFechados: opts.mesesFechados,
    valorNaBase: false,
  });
  const junho2 = celula(completo, '2026-06', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES');
  assert.equal(junho2.valor, 1000, 'completar a base não reescreve mês fechado');
  assert.equal(junho2.linhas, 50);
});

check('linha sem canal cai em Por classificar', () => {
  const rows = [
    { cod: '9', data: HOJE, tipo: 'OUTRO', valor: 12, npess: 111 },
    { cod: '8', data: HOJE, tipo: 'OUTRO', valor: 4 },
    { cod: '100', data: HOJE, tipo: 'OUTRO', valor: 6 },
  ];
  const q = ctx.agregarVendasQuadro(rows, opts);
  const sem = celula(q, '2026-10', 'Por classificar', 'Por classificar', 'Por classificar');
  assert.ok(sem, 'bucket Por classificar existe');
  assert.equal(sem.valor, 16);
  assert.equal(sem.linhas, 2);
  const peloCliente = celula(q, '2026-10', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES');
  assert.ok(peloCliente, 'sem npess na linha usa o mapa do cliente');
  assert.equal(peloCliente.valor, 6);
  const prefixoSemCanal = ctx.dimensoesVendaQuadro(99529999, mapas);
  assert.equal(prefixoSemCanal.empresa, 'Delta Foods Brasil');
  assert.equal(prefixoSemCanal.canal, 'Por classificar');
  assert.equal(prefixoSemCanal.vendedor, 'Por classificar');
  assert.ok(ctx.vendasQuadroPassaFiltro(sem, null));
  assert.equal(ctx.indiceColunaValorVenda(['Data', 'Peso líq.', 'Valor líquido']), 2);
  assert.equal(ctx.indiceColunaValorVenda(['Peso líq.']), -1);
  assert.equal(ctx.parseValorVendaSap('1.234,56'), 1234.56);
});

check('mapasVendasQuadro não inventa vendedores', () => {
  ctx.CANAIS_APP = {
    horeca: { nome: 'Horeca', vendedorCods: [99520010] },
    varejo: { nome: 'Varejo e Distr. Varejo', vendedorCods: [99520018] },
  };
  ctx.VENDEDORES_DEFAULT = [
    { cod: 99520010, nome: 'FILIPE NEVES' },
    { cod: 99520018, nome: 'DIOGO OLIVEIRA' },
    { cod: 99529999, nome: 'ALGUEM NOVO' },
  ];
  const m = ctx.mapasVendasQuadro();
  assert.equal(m.canalPorNpess[99520010], 'Restauração');
  assert.notEqual(m.canalPorNpess[99520010], 'Horeca');
  assert.equal(m.vendedorPorNpess[99520010], 'FILIPE NEVES');
  assert.equal(m.canalPorNpess[99520018], 'Retalho moderno');
  assert.notEqual(m.canalPorNpess[99520018], 'Varejo e Distr. Varejo');
  assert.equal(m.vendedorPorNpess[99529999], undefined);
  assert.equal(m.canalPorNpess[99529999], undefined);
});

check('Nº pessoal do Excel ganha à lista: 99520020 é Delta / Distribuidores regionais', () => {
  assert.equal(ctx.indiceColunaNpessVenda(['Data', 'Vendas líquidas', 'Nº pessoal']), 2);
  assert.equal(ctx.indiceColunaNpessVenda(['Data', 'Vendas líquidas', 'No. pessoal']), 2);
  assert.equal(ctx.indiceColunaNpessVenda(['N.º pessoal', 'Vendas líquidas']), 0);
  assert.equal(ctx.indiceColunaNpessVenda(['NPess', 'Vendas líquidas']), 0);
  assert.equal(ctx.indiceColunaNpessVenda(['Código do vendedor', 'Vendas líquidas']), 0);
  assert.equal(ctx.indiceColunaNpessVenda(['Cod. vendedor']), 0);
  assert.equal(ctx.indiceColunaNpessVenda(['Vendedor', 'Nº pessoal']), 1);
  assert.equal(ctx.indiceColunaNpessVenda(['Vendedor']), 0);
  assert.equal(ctx.indiceColunaNpessVenda(['Nome do vendedor', 'Peso líq.']), -1);
  assert.equal(ctx.npessDeCelulaExcel(99520020), 99520020);
  assert.equal(ctx.npessDeCelulaExcel('99520020 - MOREIRA EDUARDO'), 99520020);
  assert.equal(ctx.npessDeCelulaExcel('EDUARDO MOREIRA'), 0);

  const headers = ['Emissor da ordem', 'Vendas líquidas', 'Nº pessoal'];
  const iValor = ctx.indiceColunaValorVenda(headers);
  const iNpess = ctx.indiceColunaNpessVenda(headers);
  assert.equal(iValor, 1, 'Vendas líquidas é a coluna de R$');
  assert.equal(iNpess, 2);
  const linha = ctx.linhaValorQuadroDeExcel(
    ['427238 CLIENTE X', 1500.5, '99520020'],
    0, iValor, iNpess, HOJE
  );
  assert.equal(linha.npess, 99520020);
  assert.equal(linha.valor, 1500.5);
  assert.equal(linha.cod, '427238');

  ctx.VENDEDORES_DEFAULT = [
    { cod: 99520020, nome: 'EDUARDO MOREIRA' },
    { cod: 99520001, nome: 'MARCIO GORGA' },
  ];
  const mapasExcel = ctx.mapasVendasQuadro();
  const q = ctx.agregarVendasQuadro([linha], {
    mapas: mapasExcel,
    npessPorCod: { '427238': 99520001 },
  });
  const cell = celula(q, '2026-10', 'Delta Foods Brasil', 'Distribuidores regionais', 'EDUARDO MOREIRA');
  assert.ok(cell, 'Excel 99520020 classifica Delta / Distribuidores regionais / EDUARDO MOREIRA');
  assert.equal(cell.valor, 1500.5);
  const pelaLista = celula(q, '2026-10', 'Delta Foods Brasil', 'Lojas online', 'MARCIO GORGA');
  assert.equal(pelaLista, null, 'a lista de clientes não substitui o NPess do Excel');
});

check('números do resumo filtram o detalhe; zero não é clicável', () => {
  const els = {};
  function makeEl() {
    return {
      options: [],
      dataset: {},
      value: '',
      style: {},
      innerHTML: '',
      textContent: '',
      _click: null,
      addEventListener(type, fn) { if (type === 'click') this._click = fn; },
    };
  }
  ctx.document = {
    getElementById(id) {
      if (!els[id]) els[id] = makeEl();
      return els[id];
    },
  };
  ctx.VENDAS_MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  ctx.VENDAS_COBERTURA_INICIO = { y: 2019, m: 9 };
  ctx.escHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  ctx.window = { _vendasQuadro: null, _vqFiltro: null };
  for (const name of [
    'formatValorQuadroRs', 'formatNumeroQuadroPnL', 'formatPctQuadroPnL', 'classeVarPnL',
    'htmlBotaoFiltroQuadro', 'htmlCelulaNumeroPnL', 'htmlCelulaPctPnL',
    'preencherSelectsQuadroVendas', 'periodoQuadroSelecionado',
    'htmlValorQuadroClicavel', 'htmlContagemQuadroClicavel', 'filtroQuadroActivoIgual',
    'ymQuadroAnoAnterior', 'listaYmAcumuladoQuadro', 'periodoComparacaoQuadro',
    'somarQuadroNosMeses', 'variacaoQuadroPct', 'canaisFixosQuadroEmpresa',
    'metricasLinhaQuadro', 'ordenarNomesQuadroPnL', 'linhasResumoQuadroPnL', 'htmlLinhaResumoPnL',
    'chaveObjetivoQuadro', 'objetivoCanalMes', 'objetivoAcumuladoQuadro',
    'htmlCelulaObjetivoPnL', 'htmlCelsObjetivoPnL',
    'variacaoObjetivoPct', 'htmlCabecalhoValorPnL', 'htmlLinhaValorObjetivoPnL',
    'nomeVendedorQuadroMarcio', 'quadroComMarcioIdentificado',
    'menusCanalVendasQuadro', 'canalMenuVendasActivo', 'htmlMenusCanalVendas',
    'volumeEfetivoCelula', 'somarVolumeQuadroNosMeses', 'metricasVolumeLinhaQuadro',
    'vendedoresCanalQuadro', 'htmlLinhaMetricasPnL', 'htmlResumoVolumeQuadro', 'htmlVistaCanalVendas',
    'renderVendasQuadro', 'onClickVendasQuadro', 'limparFiltroVendasQuadro',
  ]) {
    vm.runInContext(extractFn(html, name), ctx);
  }
  const quadro = {
    atualizado_em: '2026-10-01T18:00:00.000Z',
    valor_na_base: false,
    base_completa: true,
    meses: {
      '2026-10': {
        celulas: {
          'Delta Foods Brasil\tHoreca\tFILIPE NEVES': {
            empresa: 'Delta Foods Brasil', canal: 'Horeca', vendedor: 'FILIPE NEVES',
            valor: 100, linhas: 2, linhasComValor: 2,
          },
          'Q Brasil\tVarejo e Distr. Varejo\tDIOGO OLIVEIRA': {
            empresa: 'Q Brasil', canal: 'Varejo e Distr. Varejo', vendedor: 'DIOGO OLIVEIRA',
            valor: 0, linhas: 4, linhasComValor: 0,
          },
        },
      },
    },
  };
  ctx.window._vendasQuadro = quadro;
  ctx.renderVendasQuadro(quadro);
  const htmlOut = els['pv-vendas-quadro'].innerHTML;
  assert.ok(htmlOut.includes('Período') || (els['vq-periodo'].textContent || '').includes('Out'), 'período visível');
  assert.ok(htmlOut.includes('class="vq-link"'), 'valor com número é clicável');
  assert.ok(htmlOut.includes('R$'), 'o cartão do mês continua em reais');
  assert.ok(htmlOut.includes('N-1') && htmlOut.includes('Acum. N'), 'resumo no formato do mês e do acumulado');
  const buttons = [...htmlOut.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[1].replace(/\u00a0/g, ' ').trim());
  assert.ok(buttons.length >= 1, 'há pelo menos um valor clicável');
  assert.ok(buttons.every(b => b !== '0' && b !== '—' && !/^R\$\s*0,00$/.test(b)), 'zero e travessão não são botão: ' + buttons.join(' | '));
  assert.ok(htmlOut.includes('vq-muted">0') || htmlOut.includes('vq-muted">—'), 'zero fica texto, sem link');
  ctx.onClickVendasQuadro({
    target: {
      closest() {
        return {
          getAttribute(name) {
            if (name === 'data-vq-empresa') return 'Delta Foods Brasil';
            if (name === 'data-vq-canal') return 'Horeca';
            return '';
          },
        };
      },
    },
  });
  const filtrado = els['pv-vendas-quadro'].innerHTML;
  assert.ok(filtrado.includes('Filtro:'), 'banner do filtro');
  assert.ok(filtrado.includes('Limpar'), 'botão Limpar');
  assert.ok(filtrado.includes('FILIPE NEVES'));
  assert.ok(!filtrado.includes('DIOGO OLIVEIRA'), 'detalhe fica só no filtro');
  ctx.limparFiltroVendasQuadro();
  const limpo = els['pv-vendas-quadro'].innerHTML;
  assert.ok(!limpo.includes('Filtro:'), 'Limpar tira o banner');
  assert.ok(limpo.includes('DIOGO OLIVEIRA'));
  assert.ok(!limpo.includes('id="vq-canais"'), 'o quadro geral não é um selector de canais');
  assert.ok(limpo.includes('Objetivo'), 'coluna de objectivo');
  assert.ok(!limpo.includes('Volumes'), 'sem bloco de volumes');
  assert.ok(!limpo.includes('>Linhas<'), 'sem coluna Linhas');
  assert.ok(!limpo.includes('QtFaturada'));
});

function extractConstObject(src, name) {
  const marker = `const ${name} = `;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('const em falta: ' + name);
  const objStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = objStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(objStart, i + 1);
    }
  }
  throw new Error('object não fechou: ' + name);
}

check('objectivos de Julho e Março oficial; 99520005 e 99530003 são o Marcio', () => {
  vm.runInContext('var PV_OBJETIVOS_CANAL = ' + extractConstObject(html, 'PV_OBJETIVOS_CANAL') + ';', ctx);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', 'Lojas online', '2026-07'), 1028136);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', '', '2026-07'), 2847193);
  assert.equal(ctx.objetivoCanalMes('Q Brasil', 'Restauração', '2026-07'), 22917);
  assert.equal(ctx.objetivoCanalMes('', '', '2026-07'), 3049124);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', '', '2026-03'), 3225965);
  assert.equal(ctx.objetivoCanalMes('Q Brasil', '', '2026-03'), 280275);
  assert.equal(ctx.objetivoCanalMes('', '', '2026-03'), 3506241);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', 'Lojas online', '2026-03'), 975087);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', 'Distribuidores regionais', '2026-03'), 646114);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', 'Restauração', '2026-03'), 447592);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', 'Distribuidores de retalho', '2026-03'), 693263);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', 'Retalho moderno', '2026-03'), 336303);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', 'Site próprio', '2026-03'), 116041);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', 'Institucional', '2026-03'), 11566);
  assert.equal(ctx.objetivoCanalMes('Q Brasil', 'Retalho moderno', '2026-03'), 189415);
  assert.equal(ctx.objetivoCanalMes('Q Brasil', 'Restauração', '2026-03'), 24499);
  assert.equal(ctx.objetivoCanalMes('Q Brasil', 'Distribuidores regionais', '2026-03'), 1055);
  assert.equal(ctx.objetivoCanalMes('Q Brasil', 'Distribuidores de retalho', '2026-03'), 65306);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', 'Lojas online', '2026-01'), 866445);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', '', '2026-02'), 2506589);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', 'Lojas online', '2026-04'), 1065629);
  assert.equal(ctx.objetivoCanalMes('Q Brasil', '', '2026-04'), 187059);
  assert.equal(ctx.objetivoCanalMes('', '', '2026-01'), 2488269);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', 'Institucional', '2026-10'), 23420);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', 'Lojas online', '2026-12'), 1268936);
  const acumAbr = ctx.objetivoAcumuladoQuadro('Delta Foods Brasil', 'Lojas online', 2026, 4);
  assert.equal(acumAbr, 866445 + 729334 + 975087 + 1065629, 'Abril acumulado inclui Março');
  const acumJul = ctx.objetivoAcumuladoQuadro('Delta Foods Brasil', 'Lojas online', 2026, 7);
  assert.equal(acumJul, 866445 + 729334 + 975087 + 1065629 + 1144116 + 1176881 + 1028136);
  assert.equal(ctx.nomeVendedorQuadroMarcio('Delta Foods Brasil', 'Institucional', 'Por classificar'), 'MARCIO GORGA');
  assert.equal(ctx.nomeVendedorQuadroMarcio('Q Brasil', 'Restauração', 'Por classificar'), 'MARCIO GORGA');
  assert.equal(ctx.nomeVendedorQuadroMarcio('Q Brasil', 'Distribuidores regionais', 'Por classificar'), 'Por classificar');
  assert.equal(ctx.nomeVendedorQuadroMarcio('Delta Foods Brasil', 'Restauração', 'FILIPE NEVES'), 'FILIPE NEVES');
  const base = ctx.quadroVendasVazio();
  base.meses['2026-09'] = { celulas: {
    'Delta Foods Brasil\tInstitucional\tPor classificar': {
      empresa: 'Delta Foods Brasil', canal: 'Institucional', vendedor: 'Por classificar',
      valor: 835.75, linhas: 53, linhasComValor: 53,
    },
    'Delta Foods Brasil\tInstitucional\tMARCIO GORGA': {
      empresa: 'Delta Foods Brasil', canal: 'Institucional', vendedor: 'MARCIO GORGA',
      valor: 100, linhas: 2, linhasComValor: 2,
    },
    'Q Brasil\tRestauração\tPor classificar': {
      empresa: 'Q Brasil', canal: 'Restauração', vendedor: 'Por classificar',
      valor: 20, linhas: 1, linhasComValor: 1,
    },
    'Q Brasil\tDistribuidores regionais\tPor classificar': {
      empresa: 'Q Brasil', canal: 'Distribuidores regionais', vendedor: 'Por classificar',
      valor: 9, linhas: 1, linhasComValor: 1,
    },
  } };
  const n = ctx.quadroComMarcioIdentificado(base);
  assert.equal(celula(n, '2026-09', 'Delta Foods Brasil', 'Institucional', 'MARCIO GORGA').valor, 935.75);
  assert.equal(celula(n, '2026-09', 'Delta Foods Brasil', 'Institucional', 'Por classificar'), null);
  assert.equal(celula(n, '2026-09', 'Q Brasil', 'Restauração', 'MARCIO GORGA').valor, 20);
  assert.equal(celula(n, '2026-09', 'Q Brasil', 'Distribuidores regionais', 'Por classificar').valor, 9);
  ctx.VENDAS_VOLUME_SEED = { '2026-09': { 'Q Brasil\tRestauração\tMARCIO GORGA': 1514 } };
  const vol = ctx.metricasVolumeLinhaQuadro(n, { ym: '2026-09', ymN1: '2025-09', ymsN: ['2026-09'], ymsN1: ['2025-09'] }, { empresa: 'Q Brasil', canal: 'Restauração', vendedor: 'MARCIO GORGA' });
  assert.equal(vol.n, 1514);
  assert.equal(vol.nTem, true);
  const falso = ctx.metricasVolumeLinhaQuadro(n, { ym: '2026-09', ymN1: '', ymsN: ['2026-09'], ymsN1: [] }, { empresa: 'Q Brasil', canal: 'Restauração' });
  assert.notEqual(falso.n, 20, 'volume não é o R$');
  ctx.window._vqCanal = { empresa: 'Delta Foods Brasil', canal: 'Lojas online' };
  ctx.window._vqFiltro = null;
  ctx.renderVendasQuadro(ctx.quadroVendasVazio());
  const canalHtml = ctx.document.getElementById('pv-vendas-quadro').innerHTML;
  assert.ok(canalHtml.includes('Lojas online'));
  assert.ok(canalHtml.includes('Restauração'), 'o quadro geral mantém os outros canais');
  assert.ok(canalHtml.includes('1.269.607') || canalHtml.includes('1269607'), 'objectivo de Outubro continua no quadro geral');
  assert.ok(!canalHtml.includes('Volumes'));
  assert.ok(!canalHtml.includes('>Linhas<'));
  ctx.window._vqCanal = null;
});

function totalMes(quadro, ym) {
  const mes = quadro.meses[ym];
  if (!mes) return 0;
  return Object.values(mes.celulas || {}).reduce((s, c) => ctx.somarValorQuadro(s, c.valor), 0);
}

check('ficheiro com 2024, 2025 e Set/Out só substitui o mês corrente e o anterior', () => {
  const fechados = new Set(['2025-01', '2026-09', '2024-03', '2026-10']);
  const base = ctx.quadroVendasVazio();
  base.meses['2025-01'] = {
    celulas: {
      'Delta Foods Brasil\tHoreca\tFILIPE NEVES': {
        empresa: 'Delta Foods Brasil', canal: 'Horeca', vendedor: 'FILIPE NEVES',
        valor: 999, linhas: 120, linhasComValor: 0,
      },
      'Q Brasil\tVarejo e Distr. Varejo\tDIOGO OLIVEIRA': {
        empresa: 'Q Brasil', canal: 'Varejo e Distr. Varejo', vendedor: 'DIOGO OLIVEIRA',
        valor: 50, linhas: 8, linhasComValor: 0,
      },
    },
  };
  base.meses['2026-09'] = {
    celulas: {
      'Delta Foods Brasil\tDistribuidores\tMASSIMO BOTTELLO': {
        empresa: 'Delta Foods Brasil', canal: 'Distribuidores', vendedor: 'MASSIMO BOTTELLO',
        valor: 0, linhas: 40, linhasComValor: 0,
      },
    },
  };
  base.meses['2025-02'] = {
    celulas: {
      'Delta Foods Brasil\tHoreca\tFILIPE NEVES': {
        empresa: 'Delta Foods Brasil', canal: 'Horeca', vendedor: 'FILIPE NEVES',
        valor: 80, linhas: 10, linhasComValor: 10,
      },
    },
  };
  base.meses['2026-10'] = {
    celulas: {
      'Delta Foods Brasil\tEcommerce\tMARCIO GORGA': {
        empresa: 'Delta Foods Brasil', canal: 'Ecommerce', vendedor: 'MARCIO GORGA',
        valor: 1000, linhas: 30, linhasComValor: 30,
      },
    },
  };
  const ficheiro = [
    { cod: '1', data: '2025-01-10', tipo: 'OUTRO', valor: 200, npess: 99520010 },
    { cod: '2', data: '2025-01-11', tipo: 'OUTRO', valor: 150, npess: 99520010 },
    { cod: '3', data: '2026-09-02', tipo: 'OUTRO', valor: 70, npess: 99520003 },
    { cod: '4', data: '2026-09-03', tipo: 'GRÃO', valor: 30, npess: 99520003 },
    { cod: '5', data: HOJE, tipo: 'OUTRO', valor: 15, npess: 99520001 },
    { cod: '6', data: '2024-03-15', tipo: 'OUTRO', valor: 5000, npess: 99520010 },
  ];
  const optHist = { mapas, npessPorCod: opts.npessPorCod, hoje: HOJE, mesesFechados: fechados };
  const partes = ctx.classificarLinhasCargaVendas(ficheiro, fechados, HOJE);
  assert.equal(partes.ignoradasAntes2025, 1, '2024 ignorado por completo');
  assert.equal(partes.janela.length, 3, 'só Setembro e Outubro entram');
  assert.ok(partes.janela.every(r => r.data.startsWith('2026-09') || r.data === HOJE));
  assert.ok(!partes.janela.some(r => r.data.startsWith('2025') || r.data.startsWith('2024')));
  assert.equal(ctx.vendaMesQuadroSubstituivel('2025-01', fechados, HOJE), false);
  assert.equal(ctx.vendaMesQuadroSubstituivel('2026-08', fechados, HOJE), false);
  assert.equal(ctx.vendaMesQuadroSubstituivel('2026-09', fechados, HOJE), true);
  assert.equal(ctx.vendaMesQuadroSubstituivel('2026-10', fechados, HOJE), true);

  let q = ctx.substituirValorMesesFechadosNoQuadro(base, partes.janela, optHist);
  const jan = celula(q, '2025-01', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES');
  assert.equal(jan.valor, 999, 'Jan/2025 já gravado não é recalculado');
  assert.equal(jan.linhas, 120);
  const diogo = celula(q, '2025-01', 'Q Brasil', 'Varejo e Distr. Varejo', 'DIOGO OLIVEIRA');
  assert.equal(diogo.valor, 50, 'célula de Jan/2025 que o ficheiro trazia fica, porque o mês está fora da janela');
  assert.equal(totalMes(q, '2025-01'), 1049);
  const set = celula(q, '2026-09', 'Delta Foods Brasil', 'Distribuidores', 'MASSIMO BOTTELLO');
  assert.equal(set.valor, 100, 'Setembro passa a ser o Fatur. do ficheiro');
  assert.equal(totalMes(q, '2026-09'), 100);
  const fev = celula(q, '2025-02', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES');
  assert.equal(fev.valor, 80, 'mês que o ficheiro não traz fica');
  assert.equal(fev.linhas, 10);
  assert.equal(q.meses['2024-03'], undefined, '2024 não cria mês no quadro');
  const out = celula(q, '2026-10', 'Delta Foods Brasil', 'Ecommerce', 'MARCIO GORGA');
  assert.equal(out.valor, 15, 'Outubro é substituído pelo Fatur. do ficheiro, não soma ao que já havia');
  assert.notEqual(out.valor, 1015);

  q = ctx.substituirValorMesesFechadosNoQuadro(q, partes.janela, optHist);
  assert.equal(totalMes(q, '2025-01'), 1049, 'segunda leitura não mexe em 2025');
  assert.equal(totalMes(q, '2026-09'), 100, 'segunda leitura não duplica Setembro');
  assert.equal(celula(q, '2026-10', 'Delta Foods Brasil', 'Ecommerce', 'MARCIO GORGA').valor, 15);
});

check('linha de 2024 é ignorada', () => {
  const fechados = new Set(['2024-06', '2025-01']);
  assert.equal(ctx.vendaDataAntesDe2025('2024-06-02'), true);
  assert.equal(ctx.vendaLinhaEntraValorHistorico('2024-06-02', fechados, HOJE), false);
  assert.equal(ctx.vendaAnoRecebeValorQuadro('2024-06-02'), false);
  const partes = ctx.classificarLinhasCargaVendas([
    { cod: '1', data: '2024-06-02', tipo: 'OUTRO', valor: 900, npess: 99520010 },
  ], fechados, HOJE);
  assert.equal(partes.ignoradasAntes2025, 1);
  assert.equal(partes.inserir.length, 0);
  assert.equal(partes.valorHistorico.length, 0);
  const base = ctx.quadroVendasVazio();
  base.meses['2024-06'] = {
    celulas: {
      'Delta Foods Brasil\tHoreca\tFILIPE NEVES': {
        empresa: 'Delta Foods Brasil', canal: 'Horeca', vendedor: 'FILIPE NEVES',
        valor: 10, linhas: 4, linhasComValor: 0,
      },
    },
  };
  const q = ctx.substituirValorMesesFechadosNoQuadro(base, [
    { cod: '1', data: '2024-06-02', tipo: 'OUTRO', valor: 900, npess: 99520010 },
  ], { mapas, hoje: HOJE, mesesFechados: fechados });
  assert.equal(celula(q, '2024-06', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES').valor, 10);
  assert.equal(celula(q, '2024-06', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES').linhas, 4);
});

check('ficheiro com 2019, Setembro e Outubro só corrige esses dois meses e soma a linha repetida', () => {
  const hoje = '2026-10-02';
  const fechados = new Set(['2024-06', '2026-08', '2025-01']);
  const base = ctx.quadroVendasVazio();
  const filipe = {
    empresa: 'Delta Foods Brasil', canal: 'Horeca', vendedor: 'FILIPE NEVES',
    valor: 0, linhas: 1, linhasComValor: 1,
  };
  base.meses['2026-08'] = {
    ultima_data: '2026-08-31',
    celulas: { 'Delta Foods Brasil\tHoreca\tFILIPE NEVES': { ...filipe, valor: 800, linhas: 10 } },
  };
  base.meses['2026-09'] = {
    ultima_data: '2026-09-20',
    celulas: { 'Delta Foods Brasil\tHoreca\tFILIPE NEVES': { ...filipe, valor: 100, linhas: 4 } },
  };
  base.meses['2026-10'] = {
    ultima_data: '2026-10-01',
    celulas: {
      'Delta Foods Brasil\tEcommerce\tMARCIO GORGA': {
        empresa: 'Delta Foods Brasil', canal: 'Ecommerce', vendedor: 'MARCIO GORGA',
        valor: 50, linhas: 2, linhasComValor: 2,
      },
    },
  };
  base.meses['2024-06'] = {
    celulas: { 'Delta Foods Brasil\tHoreca\tFILIPE NEVES': { ...filipe, valor: 10, linhas: 4 } },
  };
  const ficheiro = [
    { cod: '1', data: '2019-09-15', tipo: 'OUTRO', valor: 9999, npess: 99520010 },
    { cod: '1', data: '2024-06-02', tipo: 'OUTRO', valor: 5000, npess: 99520010 },
    { cod: '1', data: '2026-08-31', tipo: 'OUTRO', valor: 12345, npess: 99520010 },
    { cod: '444540', data: '2026-09-10', tipo: 'OUTRO', valor: 200, npess: 99520010 },
    { cod: '444540', data: '2026-09-10', tipo: 'OUTRO', valor: 50, npess: 99520010 },
    { cod: 'BR00002', data: '2026-10-01', tipo: 'GRÃO', valor: -100, npess: 99520001 },
    { cod: 'BR00002', data: '2026-10-01', tipo: 'GRÃO', valor: '57,58-', npess: 99520001 },
  ];
  const partes = ctx.classificarLinhasCargaVendas(ficheiro, fechados, hoje);
  assert.equal(partes.janela.length, 4);
  assert.ok(partes.janela.every(r => r.data.startsWith('2026-09') || r.data.startsWith('2026-10')));
  assert.equal(partes.ignoradasAntes2025, 2);
  assert.equal(partes.ignoradasOutroDia, 1);
  const opt = { mapas, hoje, mesesFechados: fechados };
  const keys = new Set();
  const soDedup = linhasNovas(partes.janela, keys);
  assert.equal(soDedup.length, 2, 'o dedup cliente+data+tipo ficava só com uma linha de cada');
  const qDedup = ctx.substituirValorMesesFechadosNoQuadro(base, soDedup, opt);
  const q = ctx.substituirValorMesesFechadosNoQuadro(base, partes.janela, opt);
  assert.equal(totalMes(q, '2026-09'), 250, 'a segunda linha do mesmo cliente/dia/tipo soma');
  assert.equal(totalMes(qDedup, '2026-09'), 200, 'se o dedup deitasse a linha fora, Setembro ficava curto');
  assert.equal(totalMes(q, '2026-10'), -157.58);
  assert.equal(totalMes(q, '2026-08'), 800, 'Agosto gravado não muda');
  assert.equal(celula(q, '2024-06', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES').valor, 10);
  assert.equal(q.meses['2019-09'], undefined);
  assert.equal(q.meses['2026-09'].ultima_data, '2026-09-10');
  assert.equal(q.meses['2026-10'].ultima_data, '2026-10-01');
  assert.equal(ctx.textoAtualizacaoQuadroMes(q, '2026-09', { hoje }), 'Atualizado até 10/09/2026');
  assert.equal(ctx.textoAtualizacaoQuadroMes(q, '2026-10', { hoje }), 'Atualizado até 01/10/2026');
  const q2 = ctx.substituirValorMesesFechadosNoQuadro(q, partes.janela, opt);
  assert.equal(totalMes(q2, '2026-09'), 250, 'segunda carga não soma por cima');
  assert.equal(totalMes(q2, '2026-10'), -157.58);
  assert.equal(totalMes(q2, '2026-08'), 800);
});

check('processVendasFile actualiza o quadro sem varrer a base', () => {
  const proc = extractFn(html, 'processVendasFile');
  assert.ok(proc.includes('substituirValorMesesJanelaNoQuadro(linhasJanela, hoje)'));
  assert.ok(proc.indexOf('substituirValorMesesJanelaNoQuadro(linhasJanela, hoje)') < proc.indexOf('getVendasDedupKeySet'));
  assert.ok(proc.indexOf('substituirValorMesesJanelaNoQuadro(linhasJanela, hoje)') < proc.indexOf('fundirLinhasVendaMesmoDia(linhasJanela)'));
  assert.ok(proc.includes('fundirLinhasVendaMesmoDia(linhasJanela)'));
  assert.ok(proc.includes('meses: mesesDedup'));
  assert.ok(!proc.includes('aplicarFaturDoDiaAoQuadro'));
  assert.ok(!proc.includes('vendasMesSoTemEsteDia'));
  assert.ok(proc.includes('codEmissorVendaAceite(codRaw)'));
  assert.ok(proc.includes('vendaDataNaJanelaCarga'));
  assert.ok(proc.includes('vendaDataAntesDe2025'));
  assert.ok(proc.indexOf('vendaDataNaJanelaCarga') < proc.indexOf('row[iPeso]'));
  assert.ok(proc.includes('linhaVendaParaSupabase'));
  assert.ok(!proc.includes('actualizarQuadroVendas'));
  assert.ok(!proc.includes('getVendas('));
  assert.ok(!proc.includes('fetchVendasCoberturaRows'));
  assert.ok(html.includes('id="pv-vendas-quadro"'));
  assert.ok(html.includes('id="pv-tab-vendas"'));
  assert.ok(html.includes('onclick="actualizarQuadroVendas()"'));
  assert.ok(!html.includes('id="dados-vendas-quadro"'));
  assert.ok(html.includes('Por classificar'));
  assert.ok(html.includes('A carga só lê e corrige o mês corrente e o mês anterior'));
  assert.ok(!html.includes('desde ~2019'));
  assert.ok(!html.includes('só se gravam linhas do <strong>dia de hoje</strong>'));
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(sw.includes('v2026-10-02-vendas-perdas-mes'));
  assert.ok(!sw.includes('v2026-10-02-nfe-pdf'));
  assert.ok(!sw.includes('v2026-10-01-vendas-emissor'));
  assert.ok(!sw.includes('v2026-10-01-vendas-1out'));
  assert.ok(!html.includes('v2026-10-01-vendas-1out'));
  assert.ok(!sw.includes('v2026-10-01-nfe-filtros'));
  assert.ok(!sw.includes('v2026-10-01-nfe-dados-canal'));
  assert.ok(!sw.includes('v2026-10-01-vendas-menu-canal'));
  assert.ok(!sw.includes('v2026-10-01-nfe-dados-canal'));
  assert.ok(!sw.includes('v2026-10-01-vendas-marco'));
  assert.ok(!sw.includes('v2026-10-01-vendas-ordem'));
  assert.ok(!sw.includes('v2026-10-01-nfe-zip'));
  assert.ok(!sw.includes('v2026-10-01-mapa-n'));
  assert.ok(!sw.includes('v2026-10-01-vendas-rs'));
  assert.ok(!sw.includes('v2026-10-01-vendas-prev'));
  assert.ok(html.includes('v2026-10-02-vendas-perdas-mes'));
  assert.ok(!html.includes('v2026-10-02-nfe-pdf'));
  assert.ok(!html.includes('v2026-10-01-vendas-emissor'));
  assert.ok(!html.includes('v2026-10-01-nfe-filtros'));
  assert.ok(!html.includes('v2026-10-01-nfe-dados-canal'));
  assert.ok(!html.includes('v2026-10-01-vendas-menu-canal'));
  assert.ok(!html.includes('v2026-10-01-nfe-dados-canal'));
  assert.ok(!html.includes('v2026-10-01-vendas-marco'));
  assert.ok(!html.includes('v2026-10-01-vendas-ordem'));
  assert.ok(!html.includes('v2026-10-01-nfe-zip'));
  assert.ok(!html.includes('v2026-10-01-mapa-n'));
  assert.ok(!html.includes('v2026-10-01-vendas-rs'));
  assert.ok(!html.includes('v2026-10-01-vendas-prev'));
});

function extractAssignedArray(src, name) {
  const marker = `const ${name} = `;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('const em falta: ' + name);
  const i0 = src.indexOf('[', start);
  let depth = 0;
  for (let i = i0; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') {
      depth--;
      if (depth === 0) return src.slice(i0, i + 1);
    }
  }
  throw new Error('array não fechou: ' + name);
}

check('menu Vendas de cada canal: só os canais desse menu, vendedor na mesma tabela', () => {
  vm.runInContext('var CANAIS_APP = ' + extractConstObject(html, 'CANAIS_APP') + ';', ctx);
  vm.runInContext('var PV_ACC_CANAL_VENDEDOR = ' + extractConstObject(html, 'PV_ACC_CANAL_VENDEDOR') + ';', ctx);
  vm.runInContext('var VENDEDORES_DEFAULT = ' + extractAssignedArray(html, 'VENDEDORES_DEFAULT') + ';', ctx);
  if (!ctx.PV_OBJETIVOS_CANAL) {
    vm.runInContext('var PV_OBJETIVOS_CANAL = ' + extractConstObject(html, 'PV_OBJETIVOS_CANAL') + ';', ctx);
  }
  if (html.includes('const HORECA_BUDGET_ANUAL_NPESS')) {
    vm.runInContext('var HORECA_BUDGET_ANUAL_NPESS = ' + extractConstObject(html, 'HORECA_BUDGET_ANUAL_NPESS') + ';', ctx);
  }
  const menuFns = [
    'normNomeVendaMenu', 'npessPorMenuApp', 'empresaDeNpessQuadro', 'canalPlDeNpess',
    'canaisVendaDoMenuApp', 'nomesVendedorMenuNoCanal', 'ordenarGruposCanalMenu',
    'variacaoObjectivoQuadro', 'somarQuadroMenuCanal', 'metricasMenuCanal',
    'metricaVaziaQuadro', 'somarMetricasQuadro', 'vendedoresVisiveisMenu', 'mapaUmNomeVenda',
    'linhaMenuVisivel', 'bannerFiltroVendasMenu', 'htmlLinhaVendasMenu', 'htmlQuadroVendasMenuCanal',
  ];
  if (html.includes('function codsDoCanalHoreca(')) {
    menuFns.push(
      'nomePorNpessDefault', 'npessNaCelulaMenu', 'linhasParticaoHoreca', 'pesosPorNomeHoreca',
      'codsDoCanalHoreca', 'codsDoNomeHoreca', 'canonizarNomeVendedorHoreca', 'repartirInteirosProporcao',
      'particaoInstPreservadaMenu', 'linhasMapaInstMes', 'budgetHorecaInstitucionalMes',
      'objetivoCanalHorecaMenu', 'objetivoAcumCanalHorecaMenu', 'objetivoVendedorHorecaMenu',
      'objetivoAcumVendedorHorecaMenu', 'vendedoresMenuHoreca'
    );
  }
  for (const name of menuFns) {
    vm.runInContext(extractFn(html, name), ctx);
  }
  ctx.VENDAS_MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  ctx.escHtml = (s) => String(s == null ? '' : s);

  assert.equal(Math.round(ctx.variacaoObjectivoQuadro(110, true, 100)), 10);
  assert.equal(Math.round(ctx.variacaoObjectivoQuadro(90, true, 100)), -10);
  assert.equal(ctx.variacaoObjectivoQuadro(90, false, 100), null);
  assert.equal(ctx.variacaoObjectivoQuadro(90, true, null), null);
  assert.equal(ctx.variacaoObjectivoQuadro(90, true, 0), null);
  assert.equal(ctx.classeVarPnL(10), 'vq-var-pos');
  assert.equal(ctx.classeVarPnL(-10), 'vq-var-neg');
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', '', '2026-03'), 3225965);
  assert.equal(ctx.objetivoCanalMes('Q Brasil', '', '2026-03'), 280275);
  assert.equal(ctx.objetivoCanalMes('', '', '2026-03'), 3506241);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', 'Restauração', '2026-03'), 447592);

  function chaves(id) {
    return ctx.canaisVendaDoMenuApp(id).map(g => g.empresa + '|' + g.canal);
  }
  const horeca = chaves('horeca');
  assert.ok(horeca.includes('Delta Foods Brasil|Restauração'), horeca.join(', '));
  assert.ok(horeca.includes('Delta Foods Brasil|Institucional'), horeca.join(', '));
  assert.ok(!horeca.some(k => k.includes('Lojas online')), horeca.join(', '));
  assert.ok(!horeca.some(k => k.includes('Distribuidores')), horeca.join(', '));
  assert.ok(!horeca.some(k => k.startsWith('Q Brasil|')), horeca.join(', '));

  const ecom = chaves('ecommerce');
  assert.ok(ecom.includes('Delta Foods Brasil|Lojas online'), ecom.join(', '));
  assert.ok(ecom.includes('Delta Foods Brasil|Site próprio'), ecom.join(', '));
  assert.ok(ecom.includes('Delta Foods Brasil|Institucional'), ecom.join(', '));
  assert.ok(ecom.includes('Q Brasil|Restauração'), ecom.join(', '));
  assert.ok(!ecom.some(k => k.includes('Distribuidores')), ecom.join(', '));
  assert.ok(!ecom.some(k => k.includes('Retalho')), ecom.join(', '));

  const varejo = chaves('varejo');
  assert.ok(varejo.includes('Delta Foods Brasil|Retalho moderno'));
  assert.ok(varejo.includes('Delta Foods Brasil|Distribuidores de retalho'));
  assert.ok(varejo.includes('Q Brasil|Retalho moderno'));
  assert.ok(varejo.includes('Q Brasil|Distribuidores de retalho'));
  assert.ok(!varejo.some(k => k.includes('Restauração')));
  assert.ok(!varejo.some(k => k.includes('Lojas online')));
  assert.ok(!varejo.some(k => k.includes('regionais')));

  const dist = chaves('distribuidores');
  assert.ok(dist.includes('Delta Foods Brasil|Distribuidores regionais'));
  assert.ok(dist.includes('Q Brasil|Distribuidores regionais'));
  assert.ok(!dist.some(k => k.includes('retalho')));
  assert.ok(!dist.some(k => k.includes('Restauração')));

  function cel(empresa, canal, vendedor, valor) {
    return { empresa, canal, vendedor, valor, linhas: valor ? 1 : 0, linhasComValor: valor ? 1 : 0 };
  }
  const quadro = {
    meses: {
      '2026-03': {
        celulas: {
          a: cel('Delta Foods Brasil', 'Restauração', 'FILIPE NEVES', 1000),
          b: cel('Delta Foods Brasil', 'Restauração', 'PAULO FONTES', 0),
          c: cel('Delta Foods Brasil', 'Lojas online', 'MARCIO GORGA', 99999),
          d: cel('Delta Foods Brasil', 'Distribuidores regionais', 'MASSIMO BOTTELLO', 88888),
          e: cel('Delta Foods Brasil', 'Institucional', 'PAULO FONTES', 40),
          f: cel('Delta Foods Brasil', 'Institucional', 'MARCIO GORGA', 70),
        },
      },
      '2025-03': {
        celulas: {
          g: cel('Delta Foods Brasil', 'Restauração', 'FILIPE NEVES', 800),
        },
      },
    },
  };
  const htmlOut = ctx.htmlQuadroVendasMenuCanal(quadro, 3, 2026, 'horeca', null, ctx.escHtml);
  assert.equal((htmlOut.match(/<table/g) || []).length, 1, 'um só quadro');
  assert.ok(htmlOut.includes('FILIPE NEVES'));
  assert.ok(htmlOut.includes('PAULO FONTES'));
  assert.ok(htmlOut.includes('vq-indent-vend'), 'vendedor indentado na mesma tabela');
  assert.ok(htmlOut.includes('Restauração'));
  assert.ok(htmlOut.includes('Institucional'));
  assert.ok(!htmlOut.includes('Lojas online'));
  assert.ok(!htmlOut.includes('Distribuidores'));
  assert.ok(!htmlOut.includes('MARCIO GORGA'));
  assert.ok(!htmlOut.includes('Volumes'));
  assert.ok(!htmlOut.includes('>Linhas<'));
  assert.ok(!/QtFaturada/.test(htmlOut));
  const thead = htmlOut.slice(htmlOut.indexOf('<thead>'), htmlOut.indexOf('</thead>'));
  const cols = ['N-1', 'N', 'Objetivo', 'Var. obj. %', 'N vs N-1 %', 'Acum. N-1', 'Acum. N', 'Acum. objetivo', 'Acum. var. obj. %', 'Acum. vs N-1 %'];
  let pos = -1;
  cols.forEach(c => {
    const i = thead.indexOf('>' + c + '<');
    assert.ok(i > pos, 'coluna ' + c + ' fora de ordem');
    pos = i;
  });
  const objTxt = ctx.formatNumeroQuadroPnL(447592, true);
  assert.ok(htmlOut.includes(objTxt), 'objectivo de Março da Restauração: ' + objTxt);
  const empTxt = ctx.formatNumeroQuadroPnL(3225965, true);
  assert.ok(!htmlOut.includes(empTxt), 'não usa o budget da empresa inteira');
  assert.ok(htmlOut.includes('vq-var-neg'), 'variação negativa a vermelho');
  const buttons = [...htmlOut.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[1].replace(/\u00a0/g, ' ').trim());
  assert.ok(buttons.every(b => b !== '0' && b !== '—' && b !== '0%'), 'zero e travessão não são clicáveis: ' + buttons.join(' | '));
  assert.ok(htmlOut.includes('vq-muted">0') || htmlOut.includes('vq-muted">—'));

  const filtrado = ctx.htmlQuadroVendasMenuCanal(quadro, 3, 2026, 'horeca', {
    empresa: 'Delta Foods Brasil', canal: 'Restauração', vendedor: 'FILIPE NEVES',
  }, ctx.escHtml);
  assert.ok(filtrado.includes('Filtro:'));
  assert.ok(filtrado.includes('Limpar'));
  assert.ok(filtrado.includes('FILIPE NEVES'));
  assert.ok(!filtrado.includes('PAULO FONTES'));
  assert.ok(!filtrado.includes('Lojas online'));

  assert.ok(html.includes('id="tab-vendas-canal"'));
  assert.ok(html.includes("switchTab('vendas-canal')\">Vendas</button>".replace('">', '">')) || html.includes('id="tab-vendas-canal"'));
  assert.ok(html.includes('id="panel-vendas-canal"'));
  assert.ok(html.includes("switchTab('vendas-canal')"));
  const btn = html.slice(html.indexOf('id="tab-vendas-canal"') - 40, html.indexOf('id="tab-vendas-canal"') + 120);
  assert.ok(btn.includes('>Vendas</button>'));
  assert.ok(!btn.includes('tab-horeca-only'));
  assert.ok(!btn.includes('tab-hide-varejo'));
  assert.ok(html.includes("if (tab === 'vendas-canal') initVendasMenuCanal();"));

function tabelasVq(htmlOut) {
  return [...String(htmlOut).matchAll(/<table class="vq-table">([\s\S]*?)<\/table>/g)].map(m => m[1]);
}

function cabecalhosVq(table) {
  const head = table.match(/<thead>[\s\S]*?<\/thead>/);
  if (!head) return [];
  return [...head[0].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

function linhasVq(table) {
  const body = table.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!body) return [];
  return [...body[1].matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)].map(m => ({
    attrs: m[1],
    cells: [...m[2].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)].map(td => ({
      attrs: td[1],
      html: td[2],
      text: td[2].replace(/<[^>]+>/g, '').replace(/\u00a0/g, ' ').trim(),
    })),
  }));
}

const ORDEM_VALOR = ['N-1', 'N', 'Objetivo', 'Var. obj. %', 'N vs N-1 %', 'Acum. N-1', 'Acum. N', 'Acum. objetivo', 'Acum. var. obj. %', 'Acum. vs N-1 %'];

check('Set/2026: Objetivo da Delta fica a seguir a N e os Acum.* só depois das var % do mês', () => {
  vm.runInContext('var PV_OBJETIVOS_CANAL = ' + extractConstObject(html, 'PV_OBJETIVOS_CANAL') + ';', ctx);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', '', '2026-03'), 3225965);
  assert.equal(ctx.objetivoCanalMes('Q Brasil', '', '2026-03'), 280275);
  assert.equal(ctx.objetivoCanalMes('', '', '2026-03'), 3506241);
  assert.equal(ctx.objetivoCanalMes('Delta Foods Brasil', '', '2026-09'), 3317777);

  const abaixo = ctx.variacaoObjetivoPct(2230077.91, true, 3317777);
  assert.equal(ctx.formatPctQuadroPnL(abaixo), '-33%');
  assert.equal(ctx.classeVarPnL(abaixo), 'vq-var-neg');
  const acima = ctx.variacaoObjetivoPct(150, true, 100);
  assert.equal(ctx.formatPctQuadroPnL(acima), '50%');
  assert.equal(ctx.classeVarPnL(acima), 'vq-var-pos');
  assert.equal(ctx.variacaoObjetivoPct(100, true, null), null);
  assert.equal(ctx.variacaoObjetivoPct(100, false, 50), null);
  assert.equal(ctx.variacaoObjetivoPct(10, true, 0), null);
  assert.ok(!ctx.htmlCelulaPctPnL(null, { empresa: 'Delta Foods Brasil' }, false).includes('<button'));
  assert.ok(!ctx.htmlCelulaPctPnL(0, { empresa: 'Delta Foods Brasil' }, false).includes('<button'));

  function cel(empresa, canal, vendedor, valor) {
    return { empresa, canal, vendedor, valor, linhas: 1, linhasComValor: 1 };
  }
  const q = ctx.quadroVendasVazio();
  q.meses['2025-09'] = { celulas: { a: cel('Delta Foods Brasil', 'Lojas online', 'MARCIO GORGA', 1000000) } };
  q.meses['2026-09'] = { celulas: { b: cel('Delta Foods Brasil', 'Lojas online', 'MARCIO GORGA', 2000000) } };

  const mesEl = ctx.document.getElementById('vq-mes');
  const anoEl = ctx.document.getElementById('vq-ano');
  mesEl.value = '9';
  anoEl.value = '2026';
  mesEl.dataset.ready = '1';
  ctx.window._vqCanal = null;
  ctx.window._vqFiltro = null;
  ctx.renderVendasQuadro(q);
  const out = ctx.document.getElementById('pv-vendas-quadro').innerHTML;
  assert.ok(!out.includes('Var Bud'));
  assert.ok(!out.includes('Volumes'), 'sem bloco de volumes');
  assert.ok(!out.includes('>Linhas<'), 'sem coluna Linhas');

  const tabs = tabelasVq(out.split('Detalhe por vendedor')[0]);
  assert.ok(tabs.length >= 1, 'quadro geral tem a tabela de valor');
  const heads = cabecalhosVq(tabs[0]);
  assert.deepEqual(heads, ['Empresa'].concat(ORDEM_VALOR));
  assert.equal(heads.indexOf('Objetivo'), heads.indexOf('N') + 1);
  const fimMes = heads.indexOf('N vs N-1 %');
  heads.forEach((h, i) => {
    if (h.startsWith('Acum.')) assert.ok(i > fimMes, h + ' aparece antes das var % do mês');
  });

  const delta = linhasVq(tabs[0]).find(r => r.cells[0] && r.cells[0].text === 'Delta Foods Brasil');
  assert.ok(delta, 'linha da Delta');
  assert.equal(delta.cells.length, 11);
  assert.equal(delta.cells[3].text, ctx.formatNumeroQuadroPnL(3317777, true), 'Objetivo 3317777 na coluna a seguir a N');
  assert.ok(delta.cells[3].html.includes('<button'), 'objetivo com número é clicável');
  assert.ok(!/vq-var-/.test(delta.cells[3].attrs), 'objetivo não leva cor de variação');
  assert.equal(delta.cells[4].text, '-40%');
  assert.ok(delta.cells[4].attrs.includes('vq-var-neg'));
  const lojas = linhasVq(tabs[0]).find(r => r.cells[0] && r.cells[0].text === 'Lojas online');
  assert.ok(lojas);
  assert.equal(lojas.cells[3].text, ctx.formatNumeroQuadroPnL(1256087, true));
  assert.equal(lojas.cells[4].text, '59%');
  assert.ok(lojas.cells[4].attrs.includes('vq-var-pos'));

  const det = tabelasVq(out.split('Detalhe por vendedor')[1] || '');
  assert.deepEqual(cabecalhosVq(det[0]), ['Vendedor'].concat(ORDEM_VALOR));
  const marcioDet = linhasVq(det[0]).find(r => r.cells[0] && r.cells[0].text.includes('MARCIO GORGA'));
  assert.ok(marcioDet, 'detalhe lista o vendedor');
  assert.equal(marcioDet.cells[3].text, '—');
  assert.ok(!marcioDet.cells[3].html.includes('<button'), 'sem objetivo não é clicável');
  assert.equal(marcioDet.cells[4].text, '—');
  assert.ok(!marcioDet.cells[4].html.includes('<button'));
  assert.ok(out.includes('Restauração'), 'o quadro geral mantém os outros canais');
});

check('a frase usa o dia máximo real do agregado em Set/2026, não uma data fixa', () => {
  ctx.VENDAS_COBERTURA_REGRA_DESDE = '2026-07';
  for (const name of [
    'vendasHojeISO', 'vendasMesActualYM', 'isVendasMesActual', 'isVendasMesRegraNova',
    'ultimoDiaUtilMes', 'statusVendasCoberturaMes', 'isVendasMesFechado',
    'ultimoDiaCivilMesISO', 'formatDataQuadroPt', 'diaDeCoberturaQuadro', 'diaMaxMesQuadro',
    'textoAtualizacaoQuadroMes', 'coberturaParaFraseQuadro', 'fraseAtualizacaoQuadroVisivel',
    'preencherSelectsVendasMenu', 'periodoVendasMenuSelecionado',
    'onClickVendasMenuCanal', 'renderVendasMenuCanal',
  ]) {
    vm.runInContext(extractFn(html, name), ctx);
  }
  assert.ok(html.includes('id="canal-vendas-ate"'), 'frase junto do título do menu do canal');
  assert.ok(html.includes('id="vq-atualizado-ate"'), 'frase junto do título do quadro geral');

  function linha(data, valor) {
    return { cod: '1', data, tipo: 'OUTRO', valor: valor == null ? 10 : valor, npess: 99520010 };
  }
  const hoje = '2026-10-01';
  const datasSet = ['2026-09-02', '2026-09-11', '2026-09-30', '2026-09-18'];
  const maxSet = datasSet.reduce((a, b) => (a > b ? a : b));
  const q = ctx.agregarVendasQuadro(datasSet.map(d => linha(d, 100)), opts);
  assert.equal(q.meses['2026-09'].ultima_data, maxSet, 'o agregado guarda o dia máximo da coluna Data');
  const fraseSet = ctx.textoAtualizacaoQuadroMes(q, '2026-09', { hoje });
  assert.equal(fraseSet, 'Atualizado até ' + ctx.formatDataQuadroPt(maxSet));
  assert.equal(fraseSet, 'Atualizado até 30/09/2026');

  const datasAgo = ['2026-08-03', '2026-08-31', '2026-08-12'];
  const maxAgo = datasAgo.reduce((a, b) => (a > b ? a : b));
  const qAgo = ctx.agregarVendasQuadro(datasAgo.map(d => linha(d)), opts);
  q.meses['2026-08'] = qAgo.meses['2026-08'];
  const fraseAgo = ctx.textoAtualizacaoQuadroMes(q, '2026-08', { hoje });
  assert.equal(fraseAgo, 'Atualizado até ' + ctx.formatDataQuadroPt(maxAgo));
  assert.notEqual(fraseAgo, fraseSet, 'ao mudar o mês a frase acompanha esse mês');

  const datasAberto = ['2026-09-04', '2026-09-18', '2026-09-09'];
  const maxAberto = datasAberto.reduce((a, b) => (a > b ? a : b));
  const qAberto = ctx.agregarVendasQuadro(datasAberto.map(d => linha(d)), opts);
  const fraseAberto = ctx.textoAtualizacaoQuadroMes(qAberto, '2026-09', { hoje });
  assert.equal(qAberto.meses['2026-09'].ultima_data, maxAberto);
  assert.equal(fraseAberto, 'Atualizado até ' + ctx.formatDataQuadroPt(maxAberto));
  assert.ok(!fraseAberto.includes('30/09'), 'mês aberto não mostra o fim do mês se esse dia não entrou');

  const qJun = ctx.agregarVendasQuadro([linha('2026-06-15', 50)], opts);
  assert.equal(qJun.meses['2026-06'].ultima_data, '2026-06-15');
  assert.equal(ctx.textoAtualizacaoQuadroMes(qJun, '2026-06', { hoje }), 'Atualizado até 30/06/2026');

  assert.equal(
    ctx.textoAtualizacaoQuadroMes(ctx.quadroVendasVazio(), '2026-10', { hoje }),
    'sem vendas carregadas neste mês'
  );
  const semDia = { meses: { '2026-09': { celulas: { a: { valor: 10, linhas: 1 } } } } };
  assert.equal(ctx.textoAtualizacaoQuadroMes(semDia, '2026-09', { hoje }), 'sem vendas carregadas neste mês');

  const cob = { meses: { '2026-09': { linhas: 512, clientes: 261, ultima_data: maxSet } } };
  assert.equal(
    ctx.textoAtualizacaoQuadroMes(semDia, '2026-09', { hoje, cobertura: cob }),
    'Atualizado até ' + ctx.formatDataQuadroPt(maxSet)
  );
  assert.equal(
    ctx.textoAtualizacaoQuadroMes(semDia, '2026-09', { hoje, cobertura: { meses: { '2026-09': { linhas: 4, ultima_data: '2026-09-27' } } } }),
    'Atualizado até 27/09/2026'
  );
  const q19 = ctx.agregarVendasQuadro([linha('2026-09-19')], opts);
  assert.equal(ctx.textoAtualizacaoQuadroMes(q19, '2026-09', { hoje, cobertura: cob }), 'Atualizado até 19/09/2026');

  const somado = ctx.somarQuadrosVendas(
    ctx.agregarVendasQuadro([linha('2026-09-10')], opts),
    ctx.agregarVendasQuadro([linha('2026-09-30')], opts)
  );
  assert.equal(somado.meses['2026-09'].ultima_data, '2026-09-30');
  assert.equal(ctx.quadroComMarcioIdentificado(q).meses['2026-09'].ultima_data, maxSet);

  const subst = ctx.substituirValorMesesFechadosNoQuadro(ctx.quadroVendasVazio(), [
    linha('2026-09-01', 1),
    linha('2026-09-30', 2),
    linha('2026-09-14', 3),
  ], { mapas: opts.mapas, hoje, mesesFechados: new Set(['2026-09']) });
  assert.equal(subst.meses['2026-09'].ultima_data, '2026-09-30');

  ctx.window._vendasCoberturaMeta = null;
  ctx.window._vendasCoberturaCache = null;
  ctx.window._vqFiltro = null;
  ctx.window._vqCanal = null;
  const mesEl = ctx.document.getElementById('vq-mes');
  const anoEl = ctx.document.getElementById('vq-ano');
  mesEl.dataset.ready = '1';
  mesEl.value = '9';
  anoEl.value = '2026';
  ctx.renderVendasQuadro(q);
  assert.equal(ctx.document.getElementById('vq-atualizado-ate').textContent, 'Atualizado até 30/09/2026');
  mesEl.value = '8';
  ctx.renderVendasQuadro(q);
  assert.equal(ctx.document.getElementById('vq-atualizado-ate').textContent, 'Atualizado até 31/08/2026');
  mesEl.value = '10';
  ctx.renderVendasQuadro(q);
  assert.equal(ctx.document.getElementById('vq-atualizado-ate').textContent, 'sem vendas carregadas neste mês');
  const geralHtml = ctx.document.getElementById('pv-vendas-quadro').innerHTML;
  assert.ok(!geralHtml.includes('>Linhas<'));
  assert.ok(!geralHtml.includes('Volumes'));

  const cvmM = ctx.document.getElementById('cvm-mes');
  const cvmA = ctx.document.getElementById('cvm-ano');
  cvmM.dataset.ready = '1';
  cvmM.value = '9';
  cvmA.value = '2026';
  ctx.window._cvmFiltro = null;
  ctx.renderVendasMenuCanal(q);
  assert.equal(ctx.document.getElementById('canal-vendas-ate').textContent, 'Atualizado até 30/09/2026');
  ctx.renderVendasMenuCanal(qAberto);
  assert.equal(ctx.document.getElementById('canal-vendas-ate').textContent, 'Atualizado até 18/09/2026');
  cvmM.value = '10';
  ctx.renderVendasMenuCanal(qAberto);
  assert.equal(ctx.document.getElementById('canal-vendas-ate').textContent, 'sem vendas carregadas neste mês');

  ctx.window._vendasCoberturaMeta = cob;
  mesEl.value = '9';
  ctx.renderVendasQuadro(semDia);
  assert.equal(ctx.document.getElementById('vq-atualizado-ate').textContent, 'Atualizado até 30/09/2026');
  ctx.window._vendasCoberturaMeta = null;
});

});

check('Horeca: o NPess do Filipe entra na linha dele e o objectivo reparte o Budget do canal', () => {
  assert.equal(ctx.nomePorNpessDefault(99520002), 'HÉLCIO GRÉGIO');
  assert.equal(ctx.nomePorNpessDefault(99520006), 'DANIELA SANTOS');
  assert.equal(ctx.nomePorNpessDefault(99520007), 'PAULO FONTES');
  assert.equal(ctx.nomePorNpessDefault(99520010), 'FILIPE NEVES');
  assert.equal(ctx.nomePorNpessDefault(99520015), 'HÉLCIO GRÉGIO');
  assert.equal(ctx.nomePorNpessDefault(99520016), 'DANIELA SANTOS');
  assert.equal(ctx.nomePorNpessDefault(99520017), 'PAULO FONTES');
  assert.equal(ctx.nomePorNpessDefault(99520019), 'FILIPE NEVES');
  const soma = (obj) => Object.keys(obj).reduce((s, k) => s + (+obj[k] || 0), 0);
  assert.equal(soma(ctx.HORECA_BUDGET_ANUAL_NPESS['Restauração']), 5403223);
  assert.equal(soma(ctx.HORECA_BUDGET_ANUAL_NPESS['Institucional']), 175277);
  ctx.pvSeedLinhas = function (ano, mes) {
    if (Number(ano) === 2026 && Number(mes) === 8) {
      return [
        { id: 'dfb_inst_balcao', budget: 10188 },
        { id: 'dfb_inst_horeca', budget: 12302 },
      ];
    }
    return [];
  };
  const mapas = ctx.mapasVendasQuadro();
  assert.equal(mapas.canalPorNpess[99520010], 'Restauração');
  assert.equal(mapas.vendedorPorNpess[99520010], 'FILIPE NEVES');
  assert.equal(mapas.canalPorNpess[99520019], 'Institucional');
  assert.equal(mapas.vendedorPorNpess[99520019], 'FILIPE NEVES');
  const q = ctx.agregarVendasQuadro([
    { cod: '1', data: '2026-09-10', tipo: 'OUTRO', valor: 174125, npess: 99520010 },
    { cod: '2', data: '2026-09-11', tipo: 'OUTRO', valor: 50, npess: 99520010 },
    { cod: '3', data: '2026-09-12', tipo: 'OUTRO', valor: 4251, npess: 99520019 },
  ], { mapas });
  q.meses['2026-09'].celulas['Delta Foods Brasil\tRestauração\t99520010'] = {
    empresa: 'Delta Foods Brasil', canal: 'Restauração', vendedor: '99520010',
    valor: 10, linhas: 1, linhasComValor: 1,
  };
  const htmlOut = ctx.htmlQuadroVendasMenuCanal(q, 9, 2026, 'horeca', null, ctx.escHtml);
  const body = htmlOut.match(/<tbody>([\s\S]*?)<\/tbody>/);
  const rows = [...body[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m =>
    [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(td =>
      td[1].replace(/<[^>]+>/g, '').replace(/\u00a0/g, ' ').trim()));
  const num = (txt) => {
    if (!txt || txt === '—') return null;
    const n = Number(String(txt).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const restIdx = rows.findIndex(r => r[0] === 'Restauração');
  const instIdx = rows.findIndex(r => r[0] === 'Institucional');
  const totIdx = rows.findIndex(r => r[0] === 'Total');
  assert.ok(restIdx >= 0 && instIdx > restIdx && totIdx > instIdx, rows.map(r => r[0]).join(' | '));
  const restRows = rows.slice(restIdx, instIdx);
  const instRows = rows.slice(instIdx, totIdx);
  const filipeR = restRows.find(r => r[0] === 'FILIPE NEVES');
  const filipeI = instRows.find(r => r[0] === 'FILIPE NEVES');
  assert.equal(num(filipeR[2]), 174185);
  assert.notEqual(filipeR[3], '—');
  assert.equal(num(filipeI[2]), 4251);
  assert.notEqual(filipeI[3], '—');
  assert.ok(!rows.some(r => r[0] === '99520010'));
  assert.equal(num(restRows[0][3]), 337827);
  assert.equal(restRows.slice(1).reduce((s, r) => s + (num(r[3]) || 0), 0), 337827);
  assert.equal(num(instRows[0][3]), 12302);
  assert.equal(instRows.slice(1).reduce((s, r) => s + (num(r[3]) || 0), 0), 12302);
  assert.ok(!htmlOut.includes(ctx.formatNumeroQuadroPnL(22490, true)));
  assert.ok(!htmlOut.includes(ctx.formatNumeroQuadroPnL(5403223, true)));
  assert.ok(!htmlOut.includes('>Linhas<'));
  const ecom = ctx.htmlQuadroVendasMenuCanal(q, 9, 2026, 'ecommerce', null, ctx.escHtml);
  assert.ok(!ecom.includes('FILIPE NEVES'));
  assert.ok(ecom.includes('Lojas online'));
});

check('emissor alfanumérico entra; Total não', () => {
  assert.equal(ctx.codEmissorVendaAceite('395635'), true);
  assert.equal(ctx.codEmissorVendaAceite('BR00002'), true);
  assert.equal(ctx.codEmissorVendaAceite('br00002'), true);
  assert.equal(ctx.codEmissorVendaAceite('Total'), false);
  assert.equal(ctx.codEmissorVendaAceite(''), false);
  assert.equal(ctx.codEmissorVendaAceite('CLI'), false);
  assert.equal(ctx.normalizeVendaCod('BR00002'), 'BR00002');
  const linha = ctx.linhaValorQuadroDeExcel(
    ['BR00002 CLI GENÉRICO', '500,12', '99520001'],
    0, 1, 2, '2026-10-01', -1
  );
  assert.equal(linha.cod, 'BR00002');
  assert.equal(linha.valor, 500.12);
});

check('Fatur. com sinal à direita do SAP é negativo; Valor Boni não é a coluna', () => {
  assert.equal(ctx.parseValorVendaSap('157.751,58-'), -157751.58);
  assert.equal(ctx.parseValorVendaSap('88.374,96-'), -88374.96);
  assert.equal(ctx.parseValorVendaSap('3.238,76'), 3238.76);
  assert.equal(ctx.parseValorVendaSap(3238.76), 3238.76);
  assert.equal(ctx.parseValorVendaSap(-40921.56), -40921.56);
  const headers = ['Data', 'Valor Boni', 'Valor Doação', 'Fatur.', 'QtFaturada'];
  assert.equal(ctx.indiceColunaValorVenda(headers), 3);
});

check('linhas do mesmo cliente e tipo somam o Fatur. em vez de ficar só a primeira', () => {
  const fundidas = ctx.fundirLinhasVendaMesmoDia([
    { cod: '444540', data: '2026-10-01', tipo: 'GRÃO', valor: -10000, peso: 10, npess: 99520010 },
    { cod: '444540', data: '2026-10-01', tipo: 'GRÃO', valor: '147.751,58-', peso: 5, npess: 99520010 },
    { cod: '444090', data: '2026-10-01', tipo: 'GRÃO', valor: '3.238,76', peso: 40, npess: 99520010 },
  ]);
  assert.equal(fundidas.length, 2);
  const dif = fundidas.find(r => r.cod === '444540');
  assert.equal(dif.valor, -157751.58);
  assert.equal(dif.peso, 15);
  const spi = fundidas.find(r => r.cod === '444090');
  assert.equal(spi.valor, 3238.76);
});

check('repor o dia aberto não mexe em Setembro nem nas linhas/volume já gravados', () => {
  const antes = ctx.quadroVendasVazio();
  antes.meses['2026-09'] = {
    celulas: {
      'Delta Foods Brasil\tHoreca\tFILIPE NEVES': {
        empresa: 'Delta Foods Brasil', canal: 'Horeca', vendedor: 'FILIPE NEVES',
        valor: 332926.37, linhas: 400, linhasComValor: 400, volume: 0, temVolume: false,
      },
    },
    ultima_data: '2026-09-30',
  };
  antes.meses['2026-10'] = {
    celulas: {
      'Delta Foods Brasil\tHoreca\tFILIPE NEVES': {
        empresa: 'Delta Foods Brasil', canal: 'Horeca', vendedor: 'FILIPE NEVES',
        valor: -207.56, linhas: 42, linhasComValor: 42, volume: -1847, temVolume: true,
      },
    },
  };
  const depois = ctx.substituirValorMesAbertoPeloFicheiro(antes, [
    { cod: '444540', data: HOJE, tipo: 'GRÃO', valor: -100000, npess: 99520010 },
    { cod: '444540', data: HOJE, tipo: 'GRÃO', valor: '57.751,58-', npess: 99520010 },
    { cod: '444090', data: HOJE, tipo: 'OUTRO', valor: 3238.76, npess: 99520010 },
  ], opts);
  assert.equal(depois.meses['2026-09'].celulas['Delta Foods Brasil\tHoreca\tFILIPE NEVES'].valor, 332926.37);
  assert.equal(depois.meses['2026-09'].ultima_data, '2026-09-30');
  const out = depois.meses['2026-10'].celulas['Delta Foods Brasil\tHoreca\tFILIPE NEVES'];
  assert.equal(out.valor, -154512.82);
  assert.equal(out.linhas, 42, 'a contagem de linhas já gravada fica');
  assert.equal(out.volume, -1847, 'o volume já gravado fica');
  assert.equal(out.temVolume, true);
  assert.equal(depois.meses['2026-10'].ultima_data, '2026-10-01');
});

check('atualizado até 1 de outubro quando a cobertura tem esse dia', () => {
  const q = ctx.quadroVendasVazio();
  q.meses['2026-10'] = { celulas: { a: { valor: -207.56, linhas: 42 } } };
  const cob = { meses: { '2026-10': { linhas: 42, ultima_data: '2026-10-01' }, '2026-09': { linhas: 512, ultima_data: '2026-09-30' } } };
  assert.equal(
    ctx.textoAtualizacaoQuadroMes(q, '2026-10', { hoje: '2026-10-01', cobertura: cob }),
    'Atualizado até 01/10/2026'
  );
  assert.equal(
    ctx.textoAtualizacaoQuadroMes(q, '2026-09', { hoje: '2026-10-01', cobertura: cob }),
    'Atualizado até 30/09/2026'
  );
  assert.equal(ctx.textoAtualizacaoQuadroMes(ctx.quadroVendasVazio(), '2026-11', { hoje: '2026-10-01' }), 'sem vendas carregadas neste mês');
});

if (process.exitCode) {
  console.error('\nFalhou.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes do quadro de vendas passaram.');
