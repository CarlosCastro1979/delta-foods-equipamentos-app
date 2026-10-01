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
  'mapasVendasQuadro',
  'vendasQuadroPassaFiltro',
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
  };
  ctx.VENDEDORES_DEFAULT = [
    { cod: 99520010, nome: 'FILIPE NEVES' },
    { cod: 99529999, nome: 'ALGUEM NOVO' },
  ];
  const m = ctx.mapasVendasQuadro();
  assert.equal(m.canalPorNpess[99520010], 'Horeca');
  assert.equal(m.vendedorPorNpess[99520010], 'FILIPE NEVES');
  assert.equal(m.vendedorPorNpess[99529999], undefined);
  assert.equal(m.canalPorNpess[99529999], undefined);
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
    'formatValorQuadroRs', 'preencherSelectsQuadroVendas', 'periodoQuadroSelecionado',
    'htmlValorQuadroClicavel', 'htmlContagemQuadroClicavel', 'filtroQuadroActivoIgual',
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
  assert.ok(htmlOut.includes('class="vq-link"'), 'valor com R$ é clicável');
  assert.ok(htmlOut.includes('R$'), 'texto em reais');
  const buttons = [...htmlOut.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[1].replace(/\u00a0/g, ' ').trim());
  assert.ok(buttons.length >= 1, 'há pelo menos um valor clicável');
  assert.ok(buttons.every(b => !/^R\$\s*0,00$/.test(b)), 'zero não é botão: ' + buttons.join(' | '));
  assert.ok(htmlOut.includes('vq-muted">R$') || htmlOut.includes('vq-muted">R$\u00a0'), 'zero fica texto, sem link');
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

check('processVendasFile actualiza o quadro sem varrer a base', () => {
  const proc = extractFn(html, 'processVendasFile');
  assert.ok(proc.includes('aplicarNovasLinhasAoQuadro(newVendas, hoje, mesesFechados)'));
  assert.ok(proc.includes('linhaVendaParaSupabase'));
  assert.ok(!proc.includes('actualizarQuadroVendas'));
  assert.ok(!proc.includes('getVendas('));
  assert.ok(!proc.includes('fetchVendasCoberturaRows'));
  assert.ok(html.includes('id="pv-tab-vendas"'));
  assert.ok(html.includes("pvShowView('vendas')"));
  assert.ok(html.includes('id="pv-vendas-quadro"'));
  assert.ok(html.includes('por empresa, canal e vendedor'));
  assert.ok(!html.includes('id="dados-vendas-quadro"'));
  assert.ok(!html.includes('onclick="actualizarQuadroVendas()"'));
  assert.ok(html.includes('Por classificar'));
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(sw.includes('v2026-10-01-vendas-quadro'));
});

if (process.exitCode) {
  console.error('\nFalhou.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes do quadro de vendas passaram.');
