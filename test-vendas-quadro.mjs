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
};
vm.createContext(ctx);

const fns = [
  'npessEmpresaGn',
  'vendasYmFromISO',
  'normalizeVendaCod',
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
  'agregarVendasQuadro',
  'somarQuadrosVendas',
  'aplicarCargaAoQuadro',
  'completarQuadroDesdeBase',
  'totalQuadroAno',
  'linhasPlVendasQuadro',
  'mapasVendasQuadro',
  'vendasQuadroPassaFiltro',
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
});

function totalMes(quadro, ym) {
  const mes = quadro.meses[ym];
  if (!mes) return 0;
  return Object.values(mes.celulas || {}).reduce((s, c) => ctx.somarValorQuadro(s, c.valor), 0);
}

check('ficheiro 2025–2026 fechado preenche R$ sem gravar linhas nem duplicar', () => {
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
  assert.equal(partes.inserir.length, 1, 'só o dia de hoje entra na tabela');
  assert.equal(partes.inserir[0].data, HOJE);
  assert.ok(partes.valorHistorico.every(r => r.data !== HOJE && !r.data.startsWith('2024')));
  assert.equal(partes.valorHistorico.length, 4, 'Jan/2025 e Set/2026 vão só para o R$');
  assert.ok(!partes.inserir.some(r => r.data.startsWith('2025') || r.data.startsWith('2026-09') || r.data.startsWith('2024')));

  let q = ctx.substituirValorMesesFechadosNoQuadro(base, partes.valorHistorico, optHist);
  q = ctx.aplicarCargaAoQuadro(q, partes.inserir, optHist);
  const jan = celula(q, '2025-01', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES');
  assert.equal(jan.valor, 350, 'R$ de Jan/2025 igual ao ficheiro, não soma ao que já havia');
  assert.equal(jan.linhas, 120, 'contagem de linhas já guardada não muda');
  const diogo = celula(q, '2025-01', 'Q Brasil', 'Varejo e Distr. Varejo', 'DIOGO OLIVEIRA');
  assert.equal(diogo, null, 'célula que o ficheiro não traz sai do mês — não fica a R$ 0');
  assert.equal(totalMes(q, '2025-01'), 350);
  const set = celula(q, '2026-09', 'Delta Foods Brasil', 'Distribuidores', 'MASSIMO BOTTELLO');
  assert.equal(set.valor, 100);
  assert.equal(set.linhas, 40);
  assert.equal(totalMes(q, '2026-09'), 100);
  const fev = celula(q, '2025-02', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES');
  assert.equal(fev.valor, 80, 'mês que o ficheiro não traz fica');
  assert.equal(fev.linhas, 10);
  assert.equal(q.meses['2024-03'], undefined, '2024 não cria mês no quadro');
  const out = celula(q, '2026-10', 'Delta Foods Brasil', 'Ecommerce', 'MARCIO GORGA');
  assert.equal(out.valor, 1015, 'hoje soma ao R$ já acumulado');
  assert.equal(out.linhas, 31);

  q = ctx.substituirValorMesesFechadosNoQuadro(q, partes.valorHistorico, optHist);
  q = ctx.aplicarCargaAoQuadro(q, [], optHist);
  assert.equal(totalMes(q, '2025-01'), 350, 'segunda leitura não duplica o R$');
  assert.equal(totalMes(q, '2026-09'), 100);
  assert.equal(celula(q, '2025-01', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES').linhas, 120);
  assert.equal(celula(q, '2026-10', 'Delta Foods Brasil', 'Ecommerce', 'MARCIO GORGA').valor, 1015);
  assert.equal(celula(q, '2026-10', 'Delta Foods Brasil', 'Ecommerce', 'MARCIO GORGA').linhas, 31);
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

check('ficheiro só com o dia de hoje não zera o R$ do mês', () => {
  const fechados = new Set(['2026-09', '2026-10']);
  const base = ctx.quadroVendasVazio();
  base.meses['2026-10'] = {
    celulas: {
      'Delta Foods Brasil\tHoreca\tFILIPE NEVES': {
        empresa: 'Delta Foods Brasil', canal: 'Horeca', vendedor: 'FILIPE NEVES',
        valor: 1000, linhas: 40, linhasComValor: 40,
      },
    },
  };
  const soHoje = [{ cod: '9', data: HOJE, tipo: 'OUTRO', valor: 15, npess: 99520010 }];
  const partes = ctx.classificarLinhasCargaVendas(soHoje, fechados, HOJE);
  assert.equal(partes.valorHistorico.length, 0, 'o dia de hoje não repõe o mês');
  assert.equal(partes.inserir.length, 1);
  const optHoje = { mapas, hoje: HOJE, mesesFechados: fechados };
  let q = ctx.substituirValorMesesFechadosNoQuadro(base, soHoje, optHoje);
  assert.equal(celula(q, '2026-10', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES').valor, 1000);
  q = ctx.aplicarCargaAoQuadro(q, partes.inserir, optHoje);
  const cel = celula(q, '2026-10', 'Delta Foods Brasil', 'Horeca', 'FILIPE NEVES');
  assert.equal(cel.valor, 1015);
  assert.equal(cel.linhas, 41);
  assert.notEqual(cel.valor, 15);

  const outrosDias = [
    { cod: '8', data: '2026-10-02', tipo: 'OUTRO', valor: 400, npess: 99520010 },
    { cod: '9', data: HOJE, tipo: 'OUTRO', valor: 15, npess: 99520010 },
  ];
  const misto = ctx.classificarLinhasCargaVendas(outrosDias, fechados, HOJE);
  assert.equal(misto.valorHistorico.length, 0, 'outros dias do mês de hoje não substituem o mês');
  q = ctx.substituirValorMesesFechadosNoQuadro(base, misto.valorHistorico, optHoje);
  assert.equal(totalMes(q, '2026-10'), 1000);
});

check('processVendasFile actualiza o quadro sem varrer a base', () => {
  const proc = extractFn(html, 'processVendasFile');
  assert.ok(proc.includes('aplicarNovasLinhasAoQuadro(newVendas, hoje, mesesFechados)'));
  assert.ok(proc.includes('substituirValorHistoricoNoQuadro(linhasValorHistorico, hoje, mesesFechados)'));
  assert.ok(proc.includes('vendaDataAntesDe2025'));
  assert.ok(proc.includes('linhaValorQuadroDeExcel'));
  assert.ok(proc.indexOf('vendaDataAntesDe2025') < proc.indexOf('candidatos.push'));
  assert.ok(proc.indexOf('vendaDataCaiEmMesFechado') < proc.indexOf('row[iPeso]'));
  assert.ok(proc.includes('linhaVendaParaSupabase'));
  assert.ok(!proc.includes('actualizarQuadroVendas'));
  assert.ok(!proc.includes('getVendas('));
  assert.ok(!proc.includes('fetchVendasCoberturaRows'));
  assert.ok(html.includes('id="pv-vendas-quadro"'));
  assert.ok(html.includes('id="pv-tab-vendas"'));
  assert.ok(html.includes('onclick="actualizarQuadroVendas()"'));
  assert.ok(!html.includes('id="dados-vendas-quadro"'));
  assert.ok(html.includes('Por classificar'));
  assert.ok(html.includes('O R$ de 2025 e 2026 preenche-se ao carregar o Excel do SAP; as linhas não são gravadas outra vez; antes de 2025 não entra.'));
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(sw.includes('v2026-10-01-vendas-pnl'));
  assert.ok(!sw.includes('v2026-10-01-vendas-rs'));
  assert.ok(!sw.includes('v2026-10-01-vendas-prev'));
  assert.ok(html.includes('v2026-10-01-vendas-pnl'));
  assert.ok(!html.includes('v2026-10-01-vendas-rs'));
  assert.ok(!html.includes('v2026-10-01-vendas-prev'));
});

if (process.exitCode) {
  console.error('\nFalhou.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes do quadro de vendas passaram.');
