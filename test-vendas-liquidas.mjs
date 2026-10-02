#!/usr/bin/env node
/**
 * Vendas líquidas e linhas do P&L (Power BI).
 * Fixture mínimo: várias colunas numéricas; o agregado usa só «Vendas líquidas».
 * 99520001 → Delta / Lojas online; 99530005 → Q Brasil / Distribuidores de retalho.
 * 99520018 não cai em «Varejo».
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

function extractConstArray(src, name) {
  const marker = `const ${name} = `;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('const em falta: ' + name);
  const arrStart = src.indexOf('[', start);
  let depth = 0;
  for (let i = arrStart; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') {
      depth--;
      if (depth === 0) return src.slice(arrStart, i + 1);
    }
  }
  throw new Error('array não fechou: ' + name);
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
vm.runInContext('var VENDEDORES_DEFAULT = ' + extractConstArray(html, 'VENDEDORES_DEFAULT') + ';', ctx);

for (const name of [
  'npessEmpresaGn',
  'vendasYmFromISO',
  'parseValorVendaSap',
  'indiceColunaValorVenda',
  'indiceColunaVolumeVenda',
  'indiceColunaNpessVenda',
  'npessDeCelulaExcel',
  'dimensoesVendaQuadro',
  'npessDaLinhaVendaQuadro',
  'chaveCelulaQuadro',
  'linhasPlVendasQuadro',
  'mapasVendasQuadro',
  'quadroVendasVazio',
  'quadroVendasClone',
  'somarValorQuadro',
  'vendasISODateOnly',
  'maxDataVendaISO',
  'agregarVendasQuadro',
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
  'quadroJaCorrigidoPeloExcel',
  'decidirActualizarQuadroVendas',
  'vendaMesQuadroSubstituivel',
  'vendaLinhaEntraValorHistorico',
  'classificarLinhasCargaVendas',
  'totalQuadroAno',
  'substituirValorMesesFechadosNoQuadro',
]) {
  vm.runInContext(extractFn(html, name), ctx);
}

const HEADERS = [
  'Emissor da ordem',
  'Data',
  'Peso líq.',
  'Quantidade',
  'Valor bruto',
  'Valor unitário',
  'Imposto',
  'Valor',
  'Montante',
  'Vendas líquidas',
];

/** Folha mínima: Set/2026, várias colunas numéricas, NPess do P&L. */
const FOLHA = [
  HEADERS,
  ['100 LOJA', '2026-09-10', 12.5, 3, 5000, 100, 800, 4200, 4100, 756879, 99520001],
  ['200 SELLER', '2026-09-11', 1.2, 1, 900, 9, 50, 800, 700, 209574, 99520008],
  ['300 QB', '2026-09-12', 4, 2, 300000, 20, 1000, 250000, 240000, 246644, 99530005],
  ['400 MOD', '2026-09-13', 8, 5, 80000, 15, 400, 70000, 69000, 69663, 99520018],
  ['500 ??', '2026-09-14', 0.1, 1, 10, 1, 1, 9, 8, 0, 99529999],
];

function linhasDoFixture() {
  const iValor = ctx.indiceColunaValorVenda(HEADERS);
  const iData = HEADERS.indexOf('Data');
  const iNpess = HEADERS.length;
  return FOLHA.slice(1).map(r => ({
    data: r[iData],
    valor: ctx.parseValorVendaSap(r[iValor]),
    npess: r[iNpess],
    tipo: 'OUTRO',
    cod: String(r[0]).split(' ')[0],
  }));
}

function celula(quadro, ym, empresa, canal, vendedor) {
  const mes = quadro.meses[ym];
  if (!mes) return null;
  return mes.celulas[empresa + '\t' + canal + '\t' + vendedor] || null;
}

check('a coluna lida é Vendas líquidas, não peso, bruto, quantidade nem a primeira numérica', () => {
  assert.equal(ctx.indiceColunaValorVenda(HEADERS), HEADERS.indexOf('Vendas líquidas'));
  assert.equal(ctx.indiceColunaValorVenda(['Peso líq.', 'Quantidade', 'Valor bruto', 'Valor unitário', 'Imposto', 'Valor', 'Montante']), -1);
  assert.equal(ctx.indiceColunaValorVenda(['Valor líquido', 'Vendas líquidas']), 1, 'prefere a que diz vendas líquidas');
  assert.equal(ctx.indiceColunaValorVenda(['Data', 'Peso líquido', 'Vlr. líquido']), 2);
  assert.equal(ctx.indiceColunaValorVenda(['Valor líquido unitário', 'Venda líquida']), 1);
  assert.equal(ctx.indiceColunaValorVenda(['Data', 'Peso líq.', 'Vendas líq.', 'Valor bruto']), 2, 'texto curto do SAP');
  assert.equal(ctx.indiceColunaValorVenda(['Data', 'Val. líquido']), 1);
  assert.equal(ctx.indiceColunaValorVenda(['Vendas\nlíquidas']), 0, 'quebra de linha dentro da célula');
  assert.equal(ctx.indiceColunaValorVenda(['Data', 'Peso líq.', 'QtFaturada', 'VendasBrut', 'Desc.Com.', 'Valor Boni', 'Fatur.', 'Fatur.']), 6, 'Fatur. exacto; não quantidade, bruto nem a 2.ª coluna BRL à frente');
  assert.equal(ctx.indiceColunaValorVenda(['QtFaturada', 'VendasBrut', 'Peso líq.', 'Valor Boni', 'Montante']), -1);
  assert.equal(ctx.indiceColunaValorVenda(['Vendas líquidas', 'Fatur.']), 0, 'vendas líquidas ganha a Fatur.');
  assert.equal(ctx.indiceColunaNpessVenda(['Data', 'Número pessoal']), 1);
  assert.equal(ctx.indiceColunaNpessVenda(['Núm. pessoal', 'Vendas líq.']), 0);
  assert.equal(ctx.indiceColunaNpessVenda(['Emissor da ordem', 'Representante de vendas', 'Equipe de vendas']), 1);
  assert.equal(ctx.indiceColunaNpessVenda(['Representante']), -1, 'só o cabeçalho completo');
  const REAL = ['Organização vendas', 'Canal distribuição', 'Emissor da ordem', 'Doc.faturamento', 'Escritório de vendas', 'Equipe de vendas', 'Material', 'Representante de vendas', 'Hierarq.produtos', 'Data', 'Fatur.', 'Fatur.', 'QtFaturada', 'QtFaturada', 'VendasBrut', 'VendasBrut', 'Desc.Com.', 'Desc.Com.', 'Valor Boni', 'Valor Boni', 'Qtd Bonifi', 'Qtd Bonifi', 'Valor Doaç', 'Valor Doaç', 'Qtd Doação', 'Qtd Doação', 'Peso líq.', 'Peso líq.'];
  assert.equal(ctx.indiceColunaValorVenda(REAL), 10);
  assert.equal(ctx.indiceColunaNpessVenda(REAL), 7);
  assert.equal(ctx.indiceColunaVolumeVenda(REAL), 12, 'QtFaturada, a primeira, não a unidade');
  assert.notEqual(ctx.indiceColunaVolumeVenda(REAL), 10, 'Fatur. não é volume');
  assert.equal(ctx.indiceColunaVolumeVenda(['Fatur.', 'Peso líq.', 'Qtd Bonifi', 'Qtd Doação']), -1);
  assert.equal(ctx.indiceColunaVolumeVenda(['QtFaturada', 'QtFaturada']), 0);
  const fn = extractFn(html, 'indiceColunaValorVenda');
  assert.ok(fn.includes('vendas líquidas') || fn.includes('vendas liquidas') || fn.includes('liquidas'));
  assert.ok(fn.includes('peso'));
  assert.ok(fn.includes('bruto'));
  assert.ok(!fn.includes('netwr'));
  assert.ok(!fn.includes('kzwi1'));
});

check('o agregado usa só a coluna Vendas líquidas', () => {
  const iLiq = ctx.indiceColunaValorVenda(HEADERS);
  const iBruto = HEADERS.indexOf('Valor bruto');
  const iPeso = HEADERS.indexOf('Peso líq.');
  const iQtd = HEADERS.indexOf('Quantidade');
  const mapas = ctx.mapasVendasQuadro();
  const rows = linhasDoFixture();
  const somaLiq = rows.reduce((s, r) => ctx.somarValorQuadro(s, r.valor), 0);
  const somaBruto = FOLHA.slice(1).reduce((s, r) => s + r[iBruto], 0);
  const somaPeso = FOLHA.slice(1).reduce((s, r) => s + r[iPeso], 0);
  assert.notEqual(somaLiq, somaBruto);
  assert.notEqual(somaLiq, somaPeso);
  assert.equal(rows[0].valor, 756879);
  assert.notEqual(rows[0].valor, FOLHA[1][iQtd]);
  assert.equal(iLiq, HEADERS.indexOf('Vendas líquidas'));

  const q = ctx.agregarVendasQuadro(rows, { mapas });
  const lojas = celula(q, '2026-09', 'Delta Foods Brasil', 'Lojas online', 'MARCIO GORGA');
  assert.ok(lojas, '99520001 e 99520008 somam em Lojas online / Marcio');
  assert.equal(lojas.valor, 756879 + 209574);
  assert.equal(lojas.linhas, 2);
  const qb = celula(q, '2026-09', 'Q Brasil', 'Distribuidores de retalho', 'DIOGO OLIVEIRA');
  assert.ok(qb);
  assert.equal(qb.valor, 246644);
  const retalho = celula(q, '2026-09', 'Delta Foods Brasil', 'Retalho moderno', 'DIOGO OLIVEIRA');
  assert.ok(retalho);
  assert.equal(retalho.valor, 69663);
  assert.equal(celula(q, '2026-09', 'Delta Foods Brasil', 'Varejo e Distr. Varejo', 'DIOGO OLIVEIRA'), null);
  assert.equal(celula(q, '2026-09', 'Delta Foods Brasil', 'Varejo', 'DIOGO OLIVEIRA'), null);
  const por = celula(q, '2026-09', 'Delta Foods Brasil', 'Por classificar', 'Por classificar');
  assert.ok(por, 'NPess desconhecido fica visível em Por classificar');
  assert.equal(por.linhas, 1);
  const total = Object.values(q.meses['2026-09'].celulas).reduce((s, c) => ctx.somarValorQuadro(s, c.valor), 0);
  assert.equal(total, somaLiq);
  assert.notEqual(total, somaBruto);
});

check('NPess do P&L: Delta Lojas online, Q Brasil dist. retalho, 99520018 não é Varejo', () => {
  const m = ctx.mapasVendasQuadro();
  const loja = ctx.dimensoesVendaQuadro(99520001, m);
  assert.equal(loja.empresa, 'Delta Foods Brasil');
  assert.equal(loja.canal, 'Lojas online');
  assert.equal(loja.vendedor, 'MARCIO GORGA');
  const seller = ctx.dimensoesVendaQuadro(99520008, m);
  assert.equal(seller.empresa, 'Delta Foods Brasil');
  assert.equal(seller.canal, 'Lojas online');
  assert.equal(seller.vendedor, 'MARCIO GORGA');
  const qb = ctx.dimensoesVendaQuadro(99530005, m);
  assert.equal(qb.empresa, 'Q Brasil');
  assert.equal(qb.canal, 'Distribuidores de retalho');
  assert.equal(qb.vendedor, 'DIOGO OLIVEIRA');
  const mod = ctx.dimensoesVendaQuadro(99520018, m);
  assert.equal(mod.empresa, 'Delta Foods Brasil');
  assert.equal(mod.canal, 'Retalho moderno');
  assert.ok(!/varejo/i.test(mod.canal));
  assert.equal(mod.vendedor, 'DIOGO OLIVEIRA');

  const esperado = {
    99520003: ['Delta Foods Brasil', 'Distribuidores regionais', 'MASSIMO BOTTELLO'],
    99520020: ['Delta Foods Brasil', 'Distribuidores regionais', 'EDUARDO MOREIRA'],
    99520002: ['Delta Foods Brasil', 'Restauração', 'HÉLCIO GRÉGIO'],
    99520006: ['Delta Foods Brasil', 'Restauração', 'DANIELA SANTOS'],
    99520007: ['Delta Foods Brasil', 'Restauração', 'PAULO FONTES'],
    99520010: ['Delta Foods Brasil', 'Restauração', 'FILIPE NEVES'],
    99520004: ['Delta Foods Brasil', 'Distribuidores de retalho', 'DIOGO OLIVEIRA'],
    99520009: ['Delta Foods Brasil', 'Site próprio', 'MARCIO GORGA'],
    99520011: ['Delta Foods Brasil', 'Institucional', 'MARCIO GORGA'],
    99520012: ['Delta Foods Brasil', 'Institucional', 'MARCIO GORGA'],
    99520015: ['Delta Foods Brasil', 'Institucional', 'HÉLCIO GRÉGIO'],
    99520016: ['Delta Foods Brasil', 'Institucional', 'DANIELA SANTOS'],
    99520017: ['Delta Foods Brasil', 'Institucional', 'PAULO FONTES'],
    99520019: ['Delta Foods Brasil', 'Institucional', 'FILIPE NEVES'],
    99530001: ['Q Brasil', 'Retalho moderno', 'DIOGO OLIVEIRA'],
    99530003: ['Q Brasil', 'Restauração', 'MARCIO GORGA'],
    99530002: ['Q Brasil', 'Distribuidores regionais', 'Por classificar'],
    99520005: ['Delta Foods Brasil', 'Institucional', 'MARCIO GORGA'],
  };
  for (const [cod, [emp, can, ven]] of Object.entries(esperado)) {
    const d = ctx.dimensoesVendaQuadro(Number(cod), m);
    assert.equal(d.empresa, emp, cod);
    assert.equal(d.canal, can, cod);
    assert.equal(d.vendedor, ven, cod + ' não inventa nome');
  }
  const unk = ctx.dimensoesVendaQuadro(99529999, m);
  assert.equal(unk.empresa, 'Delta Foods Brasil');
  assert.equal(unk.canal, 'Por classificar');
  assert.equal(unk.vendedor, 'Por classificar');
});

check('substituir o mês fechado usa o P&L e a segunda carga não duplica', () => {
  const mapas = ctx.mapasVendasQuadro();
  const fechados = new Set(['2026-09']);
  const hoje = '2026-10-01';
  const base = ctx.quadroVendasVazio();
  base.meses['2026-09'] = {
    celulas: {
      'Delta Foods Brasil\tEcommerce\tMARCIO GORGA': {
        empresa: 'Delta Foods Brasil', canal: 'Ecommerce', vendedor: 'MARCIO GORGA',
        valor: 14016.61, linhas: 98, linhasComValor: 0,
      },
      'Delta Foods Brasil\tVarejo e Distr. Varejo\tDIOGO OLIVEIRA': {
        empresa: 'Delta Foods Brasil', canal: 'Varejo e Distr. Varejo', vendedor: 'DIOGO OLIVEIRA',
        valor: 55312.95, linhas: 38, linhasComValor: 0,
      },
    },
  };
  const linhas = linhasDoFixture();
  let q = ctx.substituirValorMesesFechadosNoQuadro(base, linhas, { mapas, hoje, mesesFechados: fechados });
  assert.equal(celula(q, '2026-09', 'Delta Foods Brasil', 'Ecommerce', 'MARCIO GORGA'), null);
  assert.equal(celula(q, '2026-09', 'Delta Foods Brasil', 'Varejo e Distr. Varejo', 'DIOGO OLIVEIRA'), null);
  const lojas = celula(q, '2026-09', 'Delta Foods Brasil', 'Lojas online', 'MARCIO GORGA');
  assert.equal(lojas.valor, 966453);
  assert.equal(lojas.linhas, 2);
  const total1 = Object.values(q.meses['2026-09'].celulas).reduce((s, c) => ctx.somarValorQuadro(s, c.valor), 0);
  q = ctx.substituirValorMesesFechadosNoQuadro(q, linhas, { mapas, hoje, mesesFechados: fechados });
  const total2 = Object.values(q.meses['2026-09'].celulas).reduce((s, c) => ctx.somarValorQuadro(s, c.valor), 0);
  assert.equal(total2, total1, 'segunda leitura do mesmo Excel não duplica');
  assert.equal(celula(q, '2026-09', 'Delta Foods Brasil', 'Lojas online', 'MARCIO GORGA').valor, 966453);
  assert.equal(celula(q, '2026-09', 'Q Brasil', 'Distribuidores de retalho', 'DIOGO OLIVEIRA').valor, 246644);
});

check('carga Set/2026 apaga Ecommerce 14016, grava Lojas online e a segunda não duplica', () => {
  const mapas = ctx.mapasVendasQuadro();
  const hoje = '2026-10-01';
  const fechados = new Set();
  const base = ctx.quadroVendasVazio();
  base.meses['2026-09'] = {
    celulas: {
      'Delta Foods Brasil\tEcommerce\tMARCIO GORGA': {
        empresa: 'Delta Foods Brasil', canal: 'Ecommerce', vendedor: 'MARCIO GORGA',
        valor: 14016, linhas: 98, linhasComValor: 98,
      },
    },
  };
  base.meses['2026-08'] = {
    celulas: {
      'Delta Foods Brasil\tHoreca\tHÉLCIO GRÉGIO': {
        empresa: 'Delta Foods Brasil', canal: 'Horeca', vendedor: 'HÉLCIO GRÉGIO',
        valor: 7760, linhas: 16, linhasComValor: 16,
      },
    },
  };
  const linhas = [{ data: '2026-09-10', valor: 5000, npess: 99520001, tipo: 'OUTRO', cod: '100' }];
  const partes = ctx.classificarLinhasCargaVendas(linhas, fechados, hoje);
  assert.equal(partes.janela.length, 1, 'Set/2026 entra na correcção do Fatur.');
  assert.equal(partes.valorHistorico.length, 1);
  assert.equal(ctx.vendaMesQuadroSubstituivel('2026-09', fechados, hoje), true);
  assert.equal(ctx.vendaMesQuadroSubstituivel('2026-08', fechados, hoje), false);
  let q = ctx.substituirValorMesesFechadosNoQuadro(base, partes.valorHistorico, { mapas, hoje, mesesFechados: fechados });
  assert.equal(celula(q, '2026-09', 'Delta Foods Brasil', 'Ecommerce', 'MARCIO GORGA'), null);
  const lojas = celula(q, '2026-09', 'Delta Foods Brasil', 'Lojas online', 'MARCIO GORGA');
  assert.ok(lojas, '99520001 fica em Lojas online');
  assert.equal(lojas.valor, 5000);
  assert.notEqual(lojas.valor, 14016);
  assert.notEqual(lojas.valor, 14016 + 5000, 'não soma por cima do valor antigo');
  assert.equal(celula(q, '2026-08', 'Delta Foods Brasil', 'Horeca', 'HÉLCIO GRÉGIO').valor, 7760, 'mês ausente do ficheiro fica');
  const outraVez = ctx.classificarLinhasCargaVendas(linhas, fechados, hoje);
  assert.equal(outraVez.janela.length, 1, 'segunda carga continua a trazer o Fatur. de Setembro');
  q = ctx.substituirValorMesesFechadosNoQuadro(q, outraVez.valorHistorico, { mapas, hoje, mesesFechados: fechados });
  assert.equal(celula(q, '2026-09', 'Delta Foods Brasil', 'Lojas online', 'MARCIO GORGA').valor, 5000, 'segunda carga não duplica');
  assert.equal(celula(q, '2026-09', 'Delta Foods Brasil', 'Ecommerce', 'MARCIO GORGA'), null);
  assert.equal(Object.keys(q.meses['2026-09'].celulas).length, 1);
  assert.equal(q.origem_liquida, true);
});

check('o ecrã avisa quando o agregado ainda tem canais antigos', () => {
  assert.equal(ctx.canalQuadroEAntigo('Ecommerce'), true);
  assert.equal(ctx.canalQuadroEAntigo('Horeca'), true);
  assert.equal(ctx.canalQuadroEAntigo('Varejo e Distr. Varejo'), true);
  assert.equal(ctx.canalQuadroEAntigo('Distribuidores'), true);
  assert.equal(ctx.canalQuadroEAntigo('Distribuidores regionais'), false);
  assert.equal(ctx.canalQuadroEAntigo('Distribuidores de retalho'), false);
  assert.equal(ctx.canalQuadroEAntigo('Lojas online'), false);
  assert.equal(ctx.canalQuadroEAntigo('Restauração'), false);
  const antigo = ctx.quadroVendasVazio();
  antigo.meses['2026-09'] = {
    celulas: {
      'Delta Foods Brasil\tEcommerce\tMARCIO GORGA': {
        empresa: 'Delta Foods Brasil', canal: 'Ecommerce', vendedor: 'MARCIO GORGA',
        valor: 14016, linhas: 98, linhasComValor: 98,
      },
    },
  };
  assert.equal(ctx.quadroTemCanaisAntigos(antigo), true);
  const semValor = ctx.decidirActualizarQuadroVendas({ valor: false }, antigo);
  assert.equal(semValor.acao, 'explicar');
  assert.ok(/coluna de valor/.test(semValor.mensagem));
  assert.ok(/Carregar Vendas/.test(semValor.mensagem));
  const comValor = ctx.decidirActualizarQuadroVendas({ valor: true }, antigo);
  assert.equal(comValor.acao, 'explicar');
  assert.ok(/canais anteriores/.test(comValor.mensagem));
  const corrigido = ctx.quadroVendasVazio();
  corrigido.origem_liquida = true;
  corrigido.meses['2026-09'] = {
    celulas: {
      'Delta Foods Brasil\tLojas online\tMARCIO GORGA': {
        empresa: 'Delta Foods Brasil', canal: 'Lojas online', vendedor: 'MARCIO GORGA',
        valor: 5000, linhas: 2, linhasComValor: 2,
      },
    },
  };
  const manter = ctx.decidirActualizarQuadroVendas({ valor: true }, corrigido);
  assert.equal(manter.acao, 'manter');
  const vazio = ctx.decidirActualizarQuadroVendas({ valor: true }, ctx.quadroVendasVazio());
  assert.equal(vazio.acao, 'reconstruir');

  const els = {};
  function makeEl() {
    return {
      options: [], dataset: { ready: '1' }, value: '', style: {}, innerHTML: '', textContent: '',
      addEventListener() {},
    };
  }
  ctx.document = { getElementById(id) { if (!els[id]) els[id] = makeEl(); return els[id]; } };
  ctx.VENDAS_MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  ctx.VENDAS_COBERTURA_INICIO = { y: 2019, m: 9 };
  ctx.escHtml = (s) => String(s == null ? '' : s);
  ctx.window = ctx.window || {};
  ctx.onClickVendasQuadro = function () {};
  for (const name of [
    'formatValorQuadroRs', 'formatNumeroQuadroPnL', 'formatPctQuadroPnL', 'classeVarPnL',
    'htmlBotaoFiltroQuadro', 'htmlCelulaNumeroPnL', 'htmlCelulaPctPnL',
    'preencherSelectsQuadroVendas', 'periodoQuadroSelecionado',
    'htmlValorQuadroClicavel', 'htmlContagemQuadroClicavel', 'filtroQuadroActivoIgual',
    'vendasQuadroPassaFiltro',
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
    'renderVendasQuadro',
  ]) {
    vm.runInContext(extractFn(html, name), ctx);
  }
  ctx.document.getElementById('vq-mes');
  ctx.document.getElementById('vq-ano');
  els['vq-mes'].value = '9';
  els['vq-ano'].value = '2026';
  els['vq-mes'].dataset.ready = '1';
  ctx.renderVendasQuadro(antigo);
  const out = els['pv-vendas-quadro'].innerHTML;
  assert.ok(out.includes('quadro anterior'), 'avisa que o R$ é o quadro anterior');
  assert.ok(out.includes('Carregar Vendas'));
  assert.ok(out.includes('14016') || out.includes('14.016') || out.includes('14\u00a0016'), 'mostra o valor antigo');
  assert.ok(!out.includes('Valores = vendas líquidas, como no Power BI.'), 'não apresenta o quadro antigo como Power BI');
  assert.ok(/quadro anterior/.test(els['vq-subtitulo'].textContent));
});

check('o ecrã diz vendas líquidas e o service worker subiu', () => {
  assert.ok(html.includes('Valores = vendas líquidas, como no Power BI.'));
  assert.ok(html.includes('vendas líquidas, como no Power BI'));
  assert.ok(html.includes('Estes R$ são o quadro anterior'));
  const proc = extractFn(html, 'processVendasFile');
  assert.ok(proc.includes('indiceColunaValorVenda(headers)'));
  assert.ok(proc.includes('indiceColunaNpessVenda(headers)'));
  assert.ok(proc.includes('substituirValorMesesJanelaNoQuadro'));
  assert.ok(proc.includes('iNpessVenda >= 0'));
  const act = extractFn(html, 'actualizarQuadroVendas');
  assert.ok(act.includes('decidirActualizarQuadroVendas'));
  assert.ok(act.indexOf('decidirActualizarQuadroVendas') < act.indexOf('somarQuadrosVendas'));
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(sw.includes('v2026-10-02-vendas-dois-meses'));
  assert.ok(!sw.includes('v2026-10-02-nfe-pdf'));
  assert.ok(!sw.includes('v2026-10-01-vendas-emissor'));
  assert.ok(!sw.includes('v2026-10-01-nfe-filtros'));
  assert.ok(!sw.includes('v2026-10-01-nfe-dados-canal'));
  assert.ok(html.includes('v2026-10-02-vendas-dois-meses'));
  assert.ok(!html.includes('v2026-10-02-nfe-pdf'));
  assert.ok(!html.includes('v2026-10-01-nfe-filtros'));
  assert.ok(!html.includes('v2026-10-01-nfe-dados-canal'));
  assert.ok(!sw.includes('v2026-10-01-vendas-menu-canal'));
  assert.ok(!html.includes('v2026-10-01-vendas-menu-canal'));
  assert.ok(!sw.includes('v2026-10-01-vendas-marco'));
  assert.ok(!html.includes('v2026-10-01-vendas-marco'));
  assert.ok(!sw.includes('v2026-10-01-vendas-ordem'));
  assert.ok(!html.includes('v2026-10-01-vendas-ordem'));
  assert.ok(!sw.includes('v2026-10-01-nfe-zip'));
  assert.ok(!html.includes('v2026-10-01-nfe-zip'));
  assert.ok(!sw.includes('v2026-10-01-mapa-n'));
  assert.ok(!html.includes('v2026-10-01-mapa-n'));
  assert.ok(!sw.includes('v2026-10-01-vendas-liq4'));
  assert.ok(!html.includes('v2026-10-01-vendas-liq4'));
  assert.ok(!sw.includes('v2026-10-01-vendas-liq3'));
  assert.ok(!sw.includes('v2026-10-01-vendas-liq2'));
  assert.ok(!sw.includes('v2026-10-01-vendas-liq —'));
  assert.ok(!sw.includes('v2026-10-01-vendas-rs'));
  const linkCss = html.slice(html.indexOf('.vq-link {'), html.indexOf('.vq-link {') + 420);
  assert.ok(!linkCss.includes('var(--accent)'), 'o número clicável não é vermelho');
  assert.ok(html.includes('.vq-var-pos'));
  assert.ok(html.includes('.vq-var-neg'));
  assert.ok(html.includes('position: sticky'));
});

check('Set/2026: N-1 é 2025-09, o acumulado soma Jan–Set e um canal sem mês não rebenta', () => {
  function cel(empresa, canal, vendedor, valor) {
    return { empresa, canal, vendedor, valor, linhas: 1, linhasComValor: 1 };
  }
  const q = ctx.quadroVendasVazio();
  q.meses['2025-01'] = { celulas: { a: cel('Delta Foods Brasil', 'Lojas online', 'A', 50) } };
  q.meses['2025-02'] = { celulas: { b: cel('Q Brasil', 'Restauração', 'B', 10) } };
  q.meses['2025-09'] = {
    celulas: {
      c: cel('Delta Foods Brasil', 'Lojas online', 'A', 100),
      d: cel('Delta Foods Brasil', 'Restauração', 'C', 10.5),
    },
  };
  q.meses['2026-01'] = { celulas: { e: cel('Delta Foods Brasil', 'Lojas online', 'A', 40) } };
  q.meses['2026-03'] = { celulas: { f: cel('Delta Foods Brasil', 'Lojas online', 'A', 20) } };
  q.meses['2026-09'] = {
    celulas: {
      g: cel('Delta Foods Brasil', 'Lojas online', 'A', 80),
      h: cel('Delta Foods Brasil', 'Restauração', 'C', 25),
    },
  };
  // 2026-02, 2026-04…08 e o canal Q «Distribuidores regionais» não existem.

  const p = ctx.periodoComparacaoQuadro(9, 2026);
  assert.equal(p.ymN1, '2025-09');
  assert.equal(p.ym, '2026-09');
  assert.deepEqual(p.ymsN, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  assert.deepEqual(p.ymsN1, ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09']);

  const lojas = ctx.metricasLinhaQuadro(q, p, { empresa: 'Delta Foods Brasil', canal: 'Lojas online' });
  assert.equal(lojas.n1, 100, 'N-1 lê só 2025-09');
  assert.equal(lojas.n, 80, 'N é Set/2026, com o mês inteiro');
  assert.equal(lojas.ac, 140, 'Acum. N soma 2026-01..09 e ignora meses em falta');
  assert.equal(lojas.ac1, 150, 'Acum. N-1 soma 2025-01..09');
  assert.equal(Math.round(lojas.varN), -20);
  assert.equal(Math.round(lojas.varAc), -7);

  const reg = ctx.metricasLinhaQuadro(q, p, { empresa: 'Q Brasil', canal: 'Distribuidores regionais' });
  assert.equal(reg.nTem, false);
  assert.equal(reg.n1Tem, false);
  assert.equal(reg.acTem, false);
  assert.equal(reg.ac1Tem, false);
  assert.equal(ctx.variacaoQuadroPct(reg.n, reg.n1, reg.n1Tem), null);
  assert.equal(ctx.formatNumeroQuadroPnL(reg.n, reg.nTem), '—');
  assert.equal(ctx.formatNumeroQuadroPnL(1941989, true), '1.941.989');
  assert.equal(ctx.formatNumeroQuadroPnL(1941989.5, true), '1.941.989,50');
  assert.equal(ctx.formatNumeroQuadroPnL(0, true), '0');
  assert.equal(ctx.formatPctQuadroPnL(-35.6), '-36%');
  assert.equal(ctx.formatPctQuadroPnL(-1308.6), '-1309%');
  assert.equal(ctx.formatPctQuadroPnL(null), '—');

  assert.doesNotThrow(() => ctx.linhasResumoQuadroPnL(null, 9, 2026));
  assert.doesNotThrow(() => ctx.linhasResumoQuadroPnL({ meses: { '2026-09': null, '2025-09': { celulas: null }, '2026-02': undefined } }, 9, 2026));

  const pacote = ctx.linhasResumoQuadroPnL(q, 9, 2026);
  const nomes = pacote.linhas.map(r => (r.tipo === 'canal' ? r.empresa + ' / ' + r.canal : r.empresa));
  const deltaCanais = pacote.linhas.filter(r => r.empresa === 'Delta Foods Brasil' && r.tipo === 'canal').map(r => r.canal);
  const qCanais = pacote.linhas.filter(r => r.empresa === 'Q Brasil' && r.tipo === 'canal').map(r => r.canal);
  assert.deepEqual(deltaCanais, ['Lojas online', 'Distribuidores regionais', 'Restauração', 'Distribuidores de retalho', 'Retalho moderno', 'Institucional', 'Site próprio']);
  assert.deepEqual(qCanais, ['Distribuidores de retalho', 'Retalho moderno', 'Restauração', 'Distribuidores regionais']);
  assert.ok(nomes.indexOf('Delta Foods Brasil') < nomes.indexOf('Q Brasil'));
  assert.equal(nomes[nomes.length - 1], 'Total');
  const regRow = pacote.linhas.find(r => r.empresa === 'Q Brasil' && r.canal === 'Distribuidores regionais');
  assert.ok(regRow, 'Q Brasil / Distribuidores regionais fica na estrutura sem valor');
  assert.equal(regRow.met.nTem, false);

  const rest = ctx.metricasLinhaQuadro(q, p, { empresa: 'Delta Foods Brasil', canal: 'Restauração' });
  assert.ok(rest.varN > 0, 'N acima de N-1 é variação positiva');
  assert.equal(ctx.formatNumeroQuadroPnL(rest.n1, true), '10,50');

  const els = {};
  function makeEl() {
    return { options: [], dataset: { ready: '1' }, value: '', style: {}, innerHTML: '', textContent: '', addEventListener() {} };
  }
  ctx.document = { getElementById(id) { if (!els[id]) els[id] = makeEl(); return els[id]; } };
  ctx.window._vqFiltro = null;
  els['vq-mes'] = makeEl();
  els['vq-ano'] = makeEl();
  els['vq-mes'].value = '9';
  els['vq-ano'].value = '2026';
  els['vq-mes'].dataset.ready = '1';
  ctx.renderVendasQuadro(q);
  const out = els['pv-vendas-quadro'].innerHTML;
  assert.ok(out.includes('>N-1<') || out.includes('>N-1</th>'));
  assert.ok(out.includes('N vs N-1 %'));
  assert.ok(out.includes('Acum. N-1'));
  assert.ok(out.includes('Acum. N'));
  assert.ok(out.includes('Acum. vs N-1 %'));
  assert.ok(out.includes('N-1 = Set/2025'), 'a legenda mostra o histórico de 2025');
  assert.ok(out.includes('Distribuidores regionais'));
  assert.ok(out.includes('vq-muted">—'), 'canal sem N-1 mostra travessão');
  assert.ok(out.includes('vq-var-neg'));
  assert.ok(out.includes('vq-var-pos'));
  assert.ok(out.includes('-20%'));
  assert.ok(out.includes('>Objetivo<'));
  assert.ok(out.includes('Acum. objetivo'));
  assert.ok(!out.includes('Var Bud'));
  assert.ok(!out.includes('Previsão Fecho'));
  const valorTbl = out.split('Detalhe por vendedor')[0];
  assert.ok(!out.includes('Volumes'), 'sem bloco de volumes');
  assert.ok(!out.includes('>Linhas<'), 'sem coluna Linhas');
  assert.ok(valorTbl.indexOf('Delta Foods Brasil') < valorTbl.indexOf('Q Brasil'));
  assert.ok(valorTbl.indexOf('Q Brasil') < valorTbl.lastIndexOf('Distribuidores regionais'));
  assert.ok(valorTbl.lastIndexOf('Distribuidores regionais') < valorTbl.indexOf('>Total<'));
  const buttons = [...out.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[1].replace(/\u00a0/g, ' ').trim());
  assert.ok(buttons.every(b => b !== '0' && b !== '—' && b !== '0%'), 'zero e travessão não são clicáveis: ' + buttons.join(' | '));
  assert.ok(out.includes('class="vq-emp"'), 'linha de empresa');
  assert.ok(out.includes('class="vq-total"'), 'total em linha própria');
  assert.ok(out.includes('vq-indent'), 'canal indentado');
});

check('cabeçalho partido em duas linhas junta «Vendas» + «líquidas»', () => {
  for (const name of [
    'normCelulaCabecalhoVenda', 'pontuarCabecalhoVendasExcel',
    'fundirCabecalhoVendasExcel', 'localizarFolhaVendasExcel',
  ]) vm.runInContext(extractFn(html, name), ctx);
  const aoa = [
    ['Relatório de vendas 2026'],
    ['Hierarq.produtos', 'Emissor da ordem', 'Data', 'Peso líq.', 'Vendas', 'Nº pessoal'],
    ['', '', '', '', 'líquidas', ''],
    ['GRÃO', '1001 LOJA', '15/09/2026', 2, 4321.55, 99520001],
  ];
  const folha = ctx.localizarFolhaVendasExcel(aoa);
  assert.equal(ctx.indiceColunaValorVenda(folha.headers), 4);
  assert.equal(folha.headers[4], 'Vendas líquidas');
  assert.equal(folha.dataRows.length, 1);
  assert.equal(folha.dataRows[0][1], '1001 LOJA');
});

const quadroAntigoSet = () => ({
  atualizado_em: '2026-09-01T12:00:00.000Z',
  valor_na_base: false,
  base_completa: true,
  origem_liquida: false,
  meses: {
    '2026-09': {
      celulas: {
        'Delta Foods Brasil\tEcommerce\tMARCIO GORGA': {
          empresa: 'Delta Foods Brasil', canal: 'Ecommerce', vendedor: 'MARCIO GORGA',
          valor: 96570.64, linhas: 618, linhasComValor: 618,
        },
        'Delta Foods Brasil\tHoreca\tHÉLCIO GRÉGIO': {
          empresa: 'Delta Foods Brasil', canal: 'Horeca', vendedor: 'HÉLCIO GRÉGIO',
          valor: 7760.7, linhas: 331, linhasComValor: 331,
        },
      },
    },
  },
});

function canaisMes(q, ym) {
  const celulas = q && q.meses && q.meses[ym] && q.meses[ym].celulas ? q.meses[ym].celulas : {};
  return Object.values(celulas).map(c => c.canal);
}

async function correrCarga(aoa, opts) {
  const o = opts || {};
  const fetches = [];
  const toasts = [];
  const mem = {};
  let idbValor = o.idbInicial || null;
  const statusEl = { innerHTML: '' };
  ctx.localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem(k, v) { mem[k] = String(v); },
    removeItem(k) { delete mem[k]; },
  };
  ctx.idbGet = async () => idbValor;
  ctx.idbSet = async (_k, v) => { idbValor = v; return true; };
  ctx.HEADERS = { apikey: 'k', Authorization: 'Bearer k' };
  ctx.SUPA_KEY = 'k';
  ctx.LISTA_CLIENTES_SUPA_URL = 'https://example.test/lista_clientes';
  ctx.VENDAS_QUADRO_LS_KEY = 'delta_vendas_quadro_v1';
  ctx.VENDAS_QUADRO_SUPA_ID = 'vendas_quadro';
  ctx.SUPA_VENDAS = 'https://example.test/vendas';
  ctx.VENDAS_MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  ctx.window._vendasQuadro = o.memoriaInicial || null;
  ctx.window._vendasQuadroGravado = null;
  ctx.window._vendasQuadroRemotoErro = '';
  ctx.window.XLSX = {
    read: () => ({ SheetNames: ['Plan1'], Sheets: { Plan1: {} } }),
    utils: { sheet_to_json: () => aoa },
  };
  ctx.document = {
    getElementById(id) {
      if (id === 'dados-vendas-status' || id === 'vendas-status') return statusEl;
      if (id === 'dados-vendas-ultima') return { textContent: '', innerHTML: '' };
      return null;
    },
  };
  ctx.toast = (msg) => { toasts.push(String(msg)); };
  ctx.renderVendasQuadro = () => {};
  ctx.renderUltimaVendasCarga = () => {};
  ctx.lerVendasCoberturaPersistida = async () => null;
  ctx.sessionCacheTouch = () => {};
  ctx.sessionCacheInvalidate = () => {};
  const remoto = o.remoto || quadroAntigoSet();
  ctx.fetch = async (url, req) => {
    const method = (req && req.method) || 'GET';
    fetches.push({ url: String(url), method, body: req && req.body });
    const u = String(url);
    if (method === 'GET' && u.includes('vendas_quadro')) {
      return { ok: true, status: 200, json: async () => [{ data: remoto, atualizado_em: remoto.atualizado_em }], text: async () => '' };
    }
    if (method === 'POST') {
      return { ok: o.postOk !== false, status: o.postOk === false ? 500 : 201, json: async () => [], text: async () => (o.postOk === false ? 'rls' : '') };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => '' };
  };
  if (o.seedLocal) mem[ctx.VENDAS_QUADRO_LS_KEY] = JSON.stringify(remoto);
  const event = {
    target: {
      files: [{ name: o.nome || 'vendas-2026.xlsx', arrayBuffer: async () => new ArrayBuffer(4) }],
      value: 'x',
    },
  };
  await ctx.processVendasFile(event);
  return { fetches, toasts, statusEl, mem, get idb() { return idbValor; } };
}

for (const name of [
  'normalizeVendaCod', 'codEmissorVendaAceite', 'formatDateISOLocal', 'parseDateSC', 'vendasHojeISO',
  'vendasYmAnterior', 'mesesJanelaCargaVendas', 'vendaDataNaJanelaCarga', 'vendaDataAntesDe2025',
  'vendaDedupKey', 'fundirLinhasVendaMesmoDia', 'getVendasDedupKeySet',
  'mesesFechadosFromCobertura', 'linhaValorQuadroDeExcel', 'formatVendasMesLabel',
  'npessPorCodDeLista', 'normalizarQuadroPersistido', 'instanteQuadroVendas',
  'escolherQuadroVendasMaisRecente', 'salvarVendasQuadroPersistida',
  'lerVendasQuadroPersistida', 'substituirValorHistoricoNoQuadro',
  'substituirValorMesesJanelaNoQuadro', 'detectarColunasVendasQuadro', 'linhaVendaParaSupabase',
  'aggregateVendasPorMes', 'vendasCoberturaObjToMap', 'mergeCoberturaVendasMesesAbertos',
  'fixarUltimaDataCoberturaJanela', 'processVendasFile',
]) {
  vm.runInContext(extractFn(html, name), ctx);
}

const asyncChecks = [];
function checkAsync(title, fn) {
  asyncChecks.push(async () => {
    try {
      await fn();
      console.log('OK  ' + title);
    } catch (e) {
      console.error('FAIL ' + title);
      console.error(e && e.stack ? e.stack : e);
      process.exitCode = 1;
    }
  });
}

checkAsync('carga com «Vendas líq.» substitui Set/2026 e o Supabase antigo não volta', async () => {
  const aoa = [
    ['Hierarq.produtos', 'Emissor da ordem', 'Data', 'Peso líq.', 'Quantidade', 'Valor bruto', 'Vendas líq.', 'Nº pessoal'],
    ['GRÃO', '1001 LOJA ONLINE', '15/09/2026', 2.5, 4, 99999, 4321.55, 99520001],
  ];
  const r = await correrCarga(aoa, { seedLocal: true, idbInicial: quadroAntigoSet() });
  const q = ctx.window._vendasQuadro;
  assert.ok(q && q.meses && q.meses['2026-09'], 'a carga gravou Set/2026');
  const canais = canaisMes(q, '2026-09');
  assert.ok(!canais.includes('Ecommerce'), 'Ecommerce saiu: ' + canais.join(','));
  assert.ok(!canais.includes('Horeca'), 'Horeca saiu');
  assert.ok(canais.includes('Lojas online'), '99520001 ficou em Lojas online: ' + canais.join(','));
  const lojas = Object.values(q.meses['2026-09'].celulas).find(c => c.canal === 'Lojas online');
  assert.equal(lojas.valor, 4321.55);
  assert.notEqual(lojas.valor, 96570.64);
  const postsVendas = r.fetches.filter(f => f.method === 'POST' && /\/vendas(\?|$)/.test(f.url));
  assert.equal(postsVendas.length, 1, 'linha nova de Setembro entra na tabela; o Fatur. já substituiu o R$');
  const postQuadro = r.fetches.filter(f => f.method === 'POST' && f.url.includes('lista_clientes'));
  assert.ok(postQuadro.length >= 1, 'a carga grava o quadro no mesmo sítio que a vista lê');

  // O Supabase e o IndexedDB devolvem o quadro antigo. A versão que a carga gravou fica.
  ctx.window._vendasQuadro = null;
  ctx.localStorage.removeItem(ctx.VENDAS_QUADRO_LS_KEY);
  ctx.idbGet = async () => quadroAntigoSet();
  const lido = await ctx.lerVendasQuadroPersistida();
  const canais2 = canaisMes(lido, '2026-09');
  assert.ok(canais2.includes('Lojas online'), 'versão da carga fica mesmo com o Supabase a devolver Ecommerce');
  assert.ok(!canais2.includes('Ecommerce'));
  assert.equal(Object.values(lido.meses['2026-09'].celulas).find(c => c.canal === 'Lojas online').valor, 4321.55);

  // Recarregar a página: sem memória, o localStorage da carga ganha ao remoto antigo.
  const gravadoJson = JSON.stringify(ctx.window._vendasQuadroGravado);
  ctx.window._vendasQuadro = null;
  ctx.window._vendasQuadroGravado = null;
  ctx.localStorage.setItem(ctx.VENDAS_QUADRO_LS_KEY, gravadoJson);
  ctx.idbGet = async () => quadroAntigoSet();
  const depoisDeRefresh = await ctx.lerVendasQuadroPersistida();
  const canais3 = canaisMes(depoisDeRefresh, '2026-09');
  assert.ok(canais3.includes('Lojas online'));
  assert.ok(!canais3.includes('Ecommerce'));
});

checkAsync('sem coluna de valor a carga mostra os cabeçalhos e não deixa os R$ 96 mil em silêncio', async () => {
  const aoa = [
    ['Hierarq.produtos', 'Emissor da ordem', 'Data', 'Peso líq.', 'Quantidade', 'Valor bruto', 'Montante', 'Nº pessoal'],
    ['GRÃO', '1001 LOJA', '15/09/2026', 2, 1, 8000, 7000, 99520001],
  ];
  const inicial = quadroAntigoSet();
  const r = await correrCarga(aoa, { memoriaInicial: inicial, seedLocal: true });
  const texto = r.toasts.join('\n') + '\n' + r.statusEl.innerHTML;
  assert.ok(/coluna de vendas líquidas não encontrada/i.test(texto), texto);
  assert.ok(texto.includes('Cabeçalhos vistos'), texto);
  assert.ok(texto.includes('Valor bruto'), texto);
  assert.ok(texto.includes('Montante'), texto);
  assert.ok(!/substituídos pelo Excel/.test(r.statusEl.innerHTML));
  const posts = r.fetches.filter(f => f.method === 'POST' && f.url.includes('lista_clientes'));
  assert.equal(posts.length, 0, 'não grava o quadro antigo outra vez');
  const canais = canaisMes(ctx.window._vendasQuadro, '2026-09');
  assert.ok(canais.includes('Ecommerce'), 'sem coluna, o mês antigo não é apagado à toa');
});

for (const run of asyncChecks) await run();

if (process.exitCode) {
  console.error('\nFalhou.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes de vendas líquidas passaram.');
