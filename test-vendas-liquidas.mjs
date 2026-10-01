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
  'dimensoesVendaQuadro',
  'npessDaLinhaVendaQuadro',
  'chaveCelulaQuadro',
  'linhasPlVendasQuadro',
  'mapasVendasQuadro',
  'quadroVendasVazio',
  'quadroVendasClone',
  'somarValorQuadro',
  'agregarVendasQuadro',
  'vendaDataCaiEmMesFechado',
  'vendaDataEntraNaCarga',
  'vendaDataAntesDe2025',
  'vendaAnoRecebeValorQuadro',
  'vendaLinhaEntraValorHistorico',
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
    99530003: ['Q Brasil', 'Restauração', 'Por classificar'],
    99530002: ['Q Brasil', 'Distribuidores regionais', 'Por classificar'],
    99520005: ['Delta Foods Brasil', 'Institucional', 'Por classificar'],
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

check('o ecrã diz vendas líquidas e o service worker subiu', () => {
  assert.ok(html.includes('Valores = vendas líquidas, como no Power BI.'));
  assert.ok(html.includes('vendas líquidas, como no Power BI'));
  const proc = extractFn(html, 'processVendasFile');
  assert.ok(proc.includes('indiceColunaValorVenda(headers)'));
  assert.ok(proc.includes('substituirValorHistoricoNoQuadro'));
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(sw.includes('v2026-10-01-vendas-liq'));
  assert.ok(html.includes('v2026-10-01-vendas-liq'));
  assert.ok(!sw.includes('v2026-10-01-vendas-rs'));
});

if (process.exitCode) {
  console.error('\nFalhou.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes de vendas líquidas passaram.');
