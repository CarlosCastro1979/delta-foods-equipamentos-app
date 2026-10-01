#!/usr/bin/env node
/**
 * Mapa mensal: N = Fatur. do agregado vendas_quadro do mês seleccionado.
 * Budget = objectivo gravado. A previsão de fecho manual não é substituída pelo N.
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

function extractConst(src, name) {
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) throw new Error('Const em falta: ' + name);
  let i = src.indexOf('=', start) + 1;
  while (src[i] === ' ' || src[i] === '\n') i++;
  if (src[i] !== '{') {
    const end = src.indexOf(';', i);
    return src.slice(start, end + 1);
  }
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) {
        const end = src[j + 1] === ';' ? j + 2 : j + 1;
        return src.slice(start, end);
      }
    }
  }
  throw new Error('Const não fechou: ' + name);
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
  JSON,
  window: {},
  localStorage: { getItem() { return null; }, setItem() {} },
};
vm.createContext(ctx);

const consts = [
  'PV_INST_BALCAO_CODS',
  'PV_INST_HORECA_CODS',
  'PV_INST_BALCAO_NOMES',
  'PV_INST_HORECA_NOMES',
  'PV_MAPA_CANAL_VENDA',
  'PV_MAPA_LINHA_OBJETIVO',
  'PV_OBJETIVOS_CANAL',
];
for (const name of consts) vm.runInContext(extractConst(html, name), ctx);

const fns = [
  'chaveObjetivoQuadro',
  'objetivoCanalMes',
  'pvFilhosDeGrupo',
  'pvRecalcSomasOn',
  'pvYmDoMapa',
  'pvNormVendMapa',
  'pvCodNaCelulaVenda',
  'pvLadoInstitucionalCelula',
  'pvCentavosMapa',
  'pvMesTemVendas',
  'pvSomarFaturMapa',
  'pvBudgetNumero',
  'pvParticaoInstPreservada',
  'pvAplicarBudgetObjetivo',
  'pvAplicarNVendasNoMapa',
  'pvFixarTotaisNVendas',
  'pvFixarBudgetTotais',
  'pvPrepararLinhasMapa',
];
for (const name of fns) vm.runInContext(extractFn(html, name), ctx);

function linha(id, tipo, parent, extra) {
  return Object.assign({
    id,
    tipo,
    parent: parent || undefined,
    empresa: id,
    n1: null,
    budget: null,
    prevFecho: null,
    n: null,
    myr: null,
  }, extra || {});
}

function mapaSetembro() {
  return [
    linha('dfb', 'grupo', '', { budget: 3317777, prevFecho: 2659830, myr: 3292716, n: null }),
    linha('dfb_lojas', 'canal', 'dfb', { budget: 1256087, prevFecho: 900000, myr: 1014653 }),
    linha('dfb_dist_reg', 'canal', 'dfb', { budget: 1018168, prevFecho: 700000, myr: 910399 }),
    linha('dfb_rest', 'canal', 'dfb', { budget: 337827, prevFecho: 345000, myr: 575158 }),
    linha('dfb_dist_ret', 'canal', 'dfb', { budget: 436848, prevFecho: 442000, myr: 533925 }),
    linha('dfb_ret_mod', 'canal', 'dfb', { budget: 228648, prevFecho: 235000, myr: 186324 }),
    linha('dfb_site', 'canal', 'dfb', { budget: 17709, prevFecho: 11500, myr: 41199 }),
    linha('dfb_inst', 'grupo', 'dfb', { budget: null, prevFecho: 26330, myr: 31058 }),
    linha('dfb_inst_balcao', 'canal', 'dfb_inst', { budget: 10188, prevFecho: 11330, n: 11336, myr: null }),
    linha('dfb_inst_horeca', 'canal', 'dfb_inst', { budget: 12302, prevFecho: 15000, n: 7148, myr: null }),
    linha('qb', 'grupo', '', { budget: 190086, prevFecho: 194100, myr: 168170 }),
    linha('qb_ret_mod', 'canal', 'qb', { budget: 128780, prevFecho: null, myr: 136264 }),
    linha('qb_dist_ret', 'canal', 'qb', { budget: 41152, prevFecho: 178500, myr: null }),
    linha('qb_rest', 'canal', 'qb', { budget: 18491, prevFecho: 15600, myr: 31906 }),
    linha('qb_dist_reg', 'canal', 'qb', { budget: 1662, prevFecho: null, myr: null }),
    linha('total', 'total', '', { budget: 3507862, prevFecho: null, myr: 3460886 }),
  ];
}

function cel(empresa, canal, vendedor, valor, extra) {
  const c = Object.assign({
    empresa, canal, vendedor, valor, linhas: 1, linhasComValor: 1,
  }, extra || {});
  const key = empresa + '\t' + canal + '\t' + vendedor + (extra && extra.npess ? '\t' + extra.npess : '');
  return [key, c];
}

function quadroSetembro() {
  const pares = [
    cel('Delta Foods Brasil', 'Lojas online', 'MARCIO GORGA', 1200000.50),
    cel('Delta Foods Brasil', 'Distribuidores regionais', 'MASSIMO BOTTELLO', 400000),
    cel('Delta Foods Brasil', 'Restauração', 'FILIPE NEVES', 200000),
    cel('Delta Foods Brasil', 'Distribuidores de retalho', 'DIOGO OLIVEIRA', 150000),
    cel('Delta Foods Brasil', 'Retalho moderno', 'DIOGO OLIVEIRA', 100000),
    cel('Delta Foods Brasil', 'Site próprio', 'MARCIO GORGA', 50000),
    cel('Delta Foods Brasil', 'Institucional', 'MARCIO GORGA', 80000.41),
    cel('Delta Foods Brasil', 'Institucional', 'FILIPE NEVES', 20000),
    cel('Delta Foods Brasil', 'Institucional', 'HÉLCIO GRÉGIO', 15000),
    cel('Delta Foods Brasil', 'Institucional', 'DANIELA SANTOS', 10000),
    cel('Delta Foods Brasil', 'Institucional', 'PAULO FONTES', 5077),
    cel('Q Brasil', 'Retalho moderno', 'DIOGO OLIVEIRA', 100000),
    cel('Q Brasil', 'Distribuidores de retalho', 'DIOGO OLIVEIRA', 80000.11),
    cel('Q Brasil', 'Restauração', 'MARCIO GORGA', 60000),
    cel('Q Brasil', 'Distribuidores regionais', 'Por classificar', 3532),
  ];
  const celulas = {};
  pares.forEach(([k, c]) => { celulas[k] = c; });
  return { meses: { '2026-09': { celulas } } };
}

function somaEmpresa(quadro, ym, empresa) {
  const celulas = Object.values(quadro.meses[ym].celulas);
  let s = 0;
  celulas.forEach(c => { if (c.empresa === empresa) s += Number(c.valor); });
  return Math.round((s + Number.EPSILON) * 100) / 100;
}

function porId(linhas) {
  const m = {};
  linhas.forEach(r => { m[r.id] = r; });
  return m;
}

check('Set/2026: N da Delta e da Q Brasil igualam o Fatur. do agregado; a previsão manual fica', () => {
  const quadro = quadroSetembro();
  const delta = somaEmpresa(quadro, '2026-09', 'Delta Foods Brasil');
  const qb = somaEmpresa(quadro, '2026-09', 'Q Brasil');
  assert.equal(delta, 2230077.91);
  assert.equal(qb, 243532.11);
  assert.equal(Math.round((delta + qb) * 100) / 100, 2473610.02);

  const linhas = mapaSetembro();
  const antes = porId(linhas);
  const prevLojas = antes.dfb_lojas.prevFecho;
  const myrLojas = antes.dfb_lojas.myr;
  const prevDelta = antes.dfb.prevFecho;
  ctx.pvPrepararLinhasMapa(linhas, 2026, 8, quadro);
  const d = porId(linhas);

  assert.equal(d.dfb.n, delta, 'N da Delta = soma Fatur. Set/2026 da Delta');
  assert.equal(d.qb.n, qb, 'N da Q Brasil = soma Fatur. Set/2026 da Q Brasil');
  assert.equal(d.total.n, 2473610.02);
  assert.equal(d.dfb.budget, 3317777, 'Budget da Delta mantém 3317777');
  assert.equal(d.qb.budget, 190086);
  assert.equal(d.total.budget, 3507862);
  assert.equal(d.dfb_lojas.prevFecho, prevLojas);
  assert.equal(d.dfb_lojas.prevFecho, 900000);
  assert.notEqual(d.dfb_lojas.n, d.dfb_lojas.prevFecho);
  assert.equal(d.dfb_lojas.myr, myrLojas);
  assert.equal(d.dfb_lojas.n, 1200000.50);
  assert.equal(d.dfb.prevFecho, prevDelta, 'a previsão do grupo não passa a ser o N');
  assert.notEqual(d.dfb.prevFecho, d.dfb.n);
  assert.equal(d.dfb.nLigado, true);
});

check('Institucional: Balcão é o Marcio e Horeca é a equipa; o budget partido fica', () => {
  const quadro = quadroSetembro();
  const linhas = mapaSetembro();
  ctx.pvPrepararLinhasMapa(linhas, 2026, 8, quadro);
  const d = porId(linhas);
  const inst = 80000.41 + 20000 + 15000 + 10000 + 5077;
  assert.equal(d.dfb_inst_balcao.n, 80000.41);
  assert.equal(d.dfb_inst_horeca.n, 50077);
  assert.notEqual(d.dfb_inst_balcao.n, inst);
  assert.notEqual(d.dfb_inst_horeca.n, inst);
  assert.equal(d.dfb_inst.n, Math.round(inst * 100) / 100);
  assert.equal(d.dfb_inst_balcao.budget, 10188);
  assert.equal(d.dfb_inst_horeca.budget, 12302);
  assert.equal(d.dfb_inst.budget, 22490);
  assert.equal(d.dfb_inst_balcao.prevFecho, 11330);
  assert.equal(d.dfb_inst_horeca.prevFecho, 15000);
});

check('99520005 entra no Balcão e não se soma o institucional inteiro nas duas linhas', () => {
  const quadro = {
    meses: {
      '2026-09': {
        celulas: {
          a: { empresa: 'Delta Foods Brasil', canal: 'Institucional', vendedor: 'Por classificar', npess: 99520005, valor: 10 },
          b: { empresa: 'Delta Foods Brasil', canal: 'Institucional', vendedor: 'FILIPE NEVES', valor: 40 },
          c: { empresa: 'Delta Foods Brasil', canal: 'Institucional', vendedor: '99520015 - HELCIO', valor: 5 },
        },
      },
    },
  };
  const linhas = mapaSetembro();
  ctx.pvPrepararLinhasMapa(linhas, 2026, 8, quadro);
  const d = porId(linhas);
  assert.equal(d.dfb_inst_balcao.n, 10);
  assert.equal(d.dfb_inst_horeca.n, 45);
  assert.equal(d.dfb_inst.n, 55);
  assert.equal(d.dfb.n, 55);
});

check('carga nova actualiza o N; não fica a cópia anterior', () => {
  const quadro = quadroSetembro();
  const linhas = mapaSetembro();
  ctx.pvPrepararLinhasMapa(linhas, 2026, 8, quadro);
  const antes = porId(linhas).dfb.n;
  quadro.meses['2026-09'].celulas.extra = {
    empresa: 'Delta Foods Brasil', canal: 'Lojas online', vendedor: 'MARCIO GORGA 2', valor: 100,
  };
  ctx.pvPrepararLinhasMapa(linhas, 2026, 8, quadro);
  const d = porId(linhas);
  assert.equal(d.dfb.n, Math.round((antes + 100) * 100) / 100);
  assert.equal(d.dfb_lojas.n, 1200100.50);
  assert.equal(d.dfb_lojas.prevFecho, 900000);
});

check('mês sem vendas no quadro não apaga a previsão nem inventa N', () => {
  const linhas = mapaSetembro();
  ctx.pvPrepararLinhasMapa(linhas, 2026, 0, { meses: {} });
  const d = porId(linhas);
  assert.equal(d.dfb_inst_balcao.n, 11336);
  assert.equal(d.dfb_lojas.prevFecho, 900000);
  assert.equal(d.dfb.n, null);
  assert.equal(d.dfb_lojas.nLigado, false);
});

check('budget vazio passa a ser o objectivo; a partição que não bate não se inventa', () => {
  const linhas = mapaSetembro().map(r => ({ ...r, budget: r.id === 'dfb_inst_balcao' || r.id === 'dfb_inst_horeca' ? 999 : null }));
  ctx.pvPrepararLinhasMapa(linhas, 2026, 8, { meses: {} });
  const d = porId(linhas);
  assert.equal(d.dfb.budget, 3317777);
  assert.equal(d.dfb_lojas.budget, 1256087);
  assert.equal(d.qb.budget, 190086);
  assert.equal(d.dfb_inst.budget, 22490);
  assert.equal(d.dfb_inst_balcao.budget, null);
  assert.equal(d.dfb_inst_horeca.budget, null);
  assert.equal(d.dfb_lojas.prevFecho, 900000);
});

check('Março oficial entra no mapa quando o budget está vazio', () => {
  const linhas = mapaSetembro().map(r => ({ ...r, budget: null, n: null, prevFecho: r.id === 'dfb_lojas' ? 111 : null }));
  ctx.pvPrepararLinhasMapa(linhas, 2026, 2, { meses: {} });
  const d = porId(linhas);
  assert.equal(d.dfb.budget, 3225965);
  assert.equal(d.qb.budget, 280275);
  assert.equal(d.total.budget, 3506241);
  assert.equal(d.dfb_inst.budget, 11566);
  assert.equal(d.dfb_inst_balcao.budget, null);
  assert.equal(d.dfb_inst_horeca.budget, null);
  assert.equal(d.dfb_lojas.prevFecho, 111);
});

check('mudar de mês mostra o objectivo desse mês', () => {
  const linhas = mapaSetembro();
  ctx.pvPrepararLinhasMapa(linhas, 2026, 9, { meses: {} });
  const out = porId(linhas);
  assert.equal(out.dfb.budget, 3846753);
  assert.equal(out.dfb_lojas.budget, 1269607);
  assert.equal(out.dfb_lojas.prevFecho, 900000);
  ctx.pvPrepararLinhasMapa(linhas, 2026, 8, { meses: {} });
  assert.equal(porId(linhas).dfb.budget, 3317777);
});

check('o quadro de Vendas mantém a ordem das colunas e o mapa não ganha volumes', () => {
  const cab = extractFn(html, 'htmlCabecalhoValorPnL');
  const iN1 = cab.indexOf('N-1');
  const iN = cab.indexOf('>N</th>');
  const iObj = cab.indexOf('Objetivo');
  const iVar = cab.indexOf('Var. obj. %');
  const iVs = cab.indexOf('N vs N-1 %');
  assert.ok(iN1 >= 0 && iN > iN1 && iObj > iN && iVar > iObj && iVs > iVar);
  assert.ok(cab.indexOf('Acum. N-1') > iVs);
  const mapa = extractFn(html, 'pvRenderMapaHtml');
  assert.ok(!mapa.includes('Volumes'));
  assert.ok(!mapa.includes('QtFaturada'));
  assert.ok(html.includes('pvPrepararLinhasMapa'));
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(sw.includes('v2026-10-01-nfe-filtros'));
  assert.ok(!sw.includes('v2026-10-01-nfe-dados-canal'));
  assert.ok(html.includes('v2026-10-01-nfe-filtros'));
  assert.ok(!html.includes('v2026-10-01-nfe-dados-canal'));
  assert.ok(!sw.includes('v2026-10-01-vendas-menu-canal'));
  assert.ok(!html.includes('v2026-10-01-vendas-menu-canal'));
  assert.ok(!sw.includes('v2026-10-01-mapa-n'));
  assert.ok(!html.includes('v2026-10-01-mapa-n'));
});

if (process.exitCode) process.exit(process.exitCode);
console.log('test-mapa-n-vendas: ok');
