#!/usr/bin/env node
/**
 * Excel dos três submenus do Orçamento 2027.
 * Números reais, R$ ou quantidade, percentagem Excel, cabeçalho a negrito.
 * Vazio manual fica em branco. Sazonalidade respeita os canais visíveis.
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const CACHE = 'v2026-10-15-sazonalidade-totais';

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
  const start = src.indexOf(`const ${name} =`);
  if (start < 0) throw new Error('Const em falta: ' + name);
  let i = src.indexOf('=', start) + 1;
  while (src[i] === ' ' || src[i] === '\n') i++;
  const open = src[i];
  const close = open === '{' ? '}' : (open === '[' ? ']' : '');
  if (!close) {
    const end = src.indexOf(';', i);
    return src.slice(start, end + 1);
  }
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close) {
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

function perto(a, b, msg) {
  assert.ok(Math.abs(Number(a) - Number(b)) < 0.02, (msg || '') + ' ' + a + ' vs ' + b);
}

function folhaExcelFalsa() {
  const cells = new Map();
  const merges = [];
  const cols = {};
  const rows = {};
  const ws = {
    merges,
    views: null,
    getCell(r, c) {
      const k = r + ',' + c;
      if (!cells.has(k)) cells.set(k, {});
      return cells.get(k);
    },
    mergeCells(r1, c1, r2, c2) { merges.push([r1, c1, r2, c2]); },
    getColumn(c) {
      if (!cols[c]) cols[c] = {};
      return cols[c];
    },
    getRow(r) {
      if (!rows[r]) rows[r] = {};
      return rows[r];
    },
    cells,
    cols,
  };
  return ws;
}

function valorCelula(cell) {
  if (!cell || cell.value == null || cell.value === '') return null;
  if (typeof cell.value === 'number') return cell.value;
  if (typeof cell.value === 'object' && cell.value && typeof cell.value.result === 'number') return cell.value.result;
  return cell.value;
}

const ctx = {
  console, Math, Number, String, Date, Object, Array, JSON, parseInt, isNaN,
};
vm.createContext(ctx);

const consts = [
  'PV_SEED_AGOSTO_2026',
  'PV_MAPA_CANAL_VENDA',
  'PV_INST_BALCAO_CODS',
  'PV_INST_HORECA_CODS',
  'PV_INST_BALCAO_NOMES',
  'PV_INST_HORECA_NOMES',
  'ORC27_EXCEL_RS',
  'ORC27_EXCEL_PCT',
  'ORC27_EXCEL_QTD',
  'ORC27_EXCEL_CABECAS',
  'SAZ27_MESES',
  'VOL27_FAMILIAS',
  'VOL27_ROTULOS',
];
for (const name of consts) vm.runInContext(extractConst(html, name), ctx);

const fns = [
  'pvNormVendMapa',
  'pvCodNaCelulaVenda',
  'pvLadoInstitucionalCelula',
  'pvCentavosMapa',
  'pvMapaPadLeft',
  'pvTsMs',
  'npessDeCelulaExcel',
  'npessVendaIgnorado',
  'orc27Yms',
  'orc27PeriodoN1',
  'orc27PeriodoYtd',
  'orc27TemNumero',
  'orc27LinhasBase',
  'orc27IdFolha',
  'orc27CelulaDevolucao',
  'orc27SomarFaturYm',
  'orc27SomarPeriodo',
  'orc27Total2026',
  'orc27VarPct',
  'orc27Pct27',
  'orc27FecharLinha',
  'orc27SomaTem',
  'orc27SomaManual',
  'orc27FilhosDe',
  'orc27AplicarSomas',
  'orc27ValorManual',
  'orc27Montar',
  'orc27ColExcel',
  'orc27ExcelBorda',
  'orc27ExcelLinha',
  'orc27ExcelColuna',
  'orc27PintarTitulo',
  'orc27PintarCabeca',
  'orc27PintarTexto',
  'orc27PintarNumero',
  'orc27PintarVazio',
  'orc27ExcelCongelar',
  'orc27ExcelLarguras',
  'orc27FormulaSoma',
  'orc27ExcelRazao',
  'orc27EscreverCabecas',
  'orc27ValorExcelDeLinha',
  'orc27FilhosExcel',
  'orc27EscreverDinheiro',
  'orc27EscreverTotal2026',
  'orc27EscreverPercentagens',
  'escreverFolhaOrc27Valor',
  'orc27CanalUnicoVolume',
  'orc27NomeCanalVolume',
  'orc27NomeFicheiroVolume',
  'escreverFolhaOrc27Volume',
  'saz27MesManual',
  'saz27ValorMesExcel',
  'escreverFolhaOrc27Sazonalidade',
  'vol27Round',
  'vol27IdsFolha',
  'vol27CanaisDoFiltro',
  'vol27FiltroFolha',
  'vol27FiltroTodos',
  'vol27Somar',
  'vol27Total2026',
  'vol27Chave',
  'vol27ManualValor',
  'vol27ManualSoma',
  'vol27Montar',
  'orc27SubNavHtml',
];
for (const name of fns) vm.runInContext(extractFn(html, name), ctx);

function cel(empresa, canal, valor, extra) {
  return Object.assign({ empresa, canal, valor, vendedor: 'X', npess: 1 }, extra || {});
}

const quadro = { meses: {} };
function add(ym, key, cell) {
  if (!quadro.meses[ym]) quadro.meses[ym] = { celulas: {} };
  quadro.meses[ym].celulas[key] = cell;
}
add('2025-01', 'lojas', cel('Delta Foods Brasil', 'Lojas online', 1000, { npess: 99520001 }));
add('2025-12', 'lojas', cel('Delta Foods Brasil', 'Lojas online', 250, { npess: 99520001 }));
add('2026-03', 'lojas', cel('Delta Foods Brasil', 'Lojas online', 80, { npess: 99520001 }));
add('2026-09', 'lojas', cel('Delta Foods Brasil', 'Lojas online', 20, { npess: 99520001 }));
add('2026-10', 'lojas', cel('Delta Foods Brasil', 'Lojas online', 99999, { npess: 99520001 }));
add('2025-02', 'rest', cel('Delta Foods Brasil', 'Restauração', 40, { npess: 99520002 }));

const manual = {
  dfb_lojas: { prevOutDez: 20, orcamento: null },
  dfb_rest: { prevOutDez: null, orcamento: 50 },
  qb_rest: { prevOutDez: 1, orcamento: 0 },
};

check('Orç Valor: cabeçalhos, R$ numérico, vazio em branco, soma da empresa e total a negrito', () => {
  const linhas = ctx.orc27Montar(quadro, manual);
  const byId = {};
  linhas.forEach(r => { byId[r.id] = r; });
  const ws = folhaExcelFalsa();
  const meta = ctx.escreverFolhaOrc27Valor(ws, linhas);

  assert.equal(meta.filename, 'Orcamento_2027_valor.xlsx');
  assert.equal(meta.sheetName, 'Orç Valor');
  assert.deepEqual(meta.headers, [
    'Empresa',
    'Total N-1 até Dez',
    'YTD 2026 até Set',
    'Previsão Out a Dez',
    'Total 2026',
    'Var % vs 2025',
    '% 27 vs fecho 26',
  ].slice(0, 6).concat(['Orçamento 2027', '% 27 vs fecho 26']));
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(c => ws.getCell(2, c).value), meta.headers);
  for (let c = 1; c <= 8; c++) {
    const h = ws.getCell(2, c);
    assert.equal(h.font.bold, true);
    assert.equal(h.fill.pattern, 'solid');
    assert.equal(h.border.top.style, 'thin');
    assert.equal(h.border.bottom.style, 'thin');
    assert.equal(h.border.left.style, 'thin');
    assert.equal(h.border.right.style, 'thin');
  }
  assert.equal(ws.views[0].state, 'frozen');
  assert.equal(ws.views[0].ySplit, 2);
  assert.ok(ws.cols[1].width >= 16);
  assert.ok(ws.cols[2].width >= 12);

  const lojas = meta.linhas.find(r => r.id === 'dfb_lojas');
  const rest = meta.linhas.find(r => r.id === 'dfb_rest');
  const dfb = meta.linhas.find(r => r.id === 'dfb');
  const total = meta.linhas.find(r => r.id === 'total');
  assert.ok(lojas && rest && dfb && total);

  const n1 = ws.getCell(lojas.excelRow, 2);
  assert.equal(typeof n1.value, 'number');
  perto(n1.value, 1250);
  assert.ok(n1.numFmt.includes('R$'));
  assert.ok(n1.numFmt.includes('#,##0.00'));
  assert.equal(n1.border.left.style, 'thin');
  assert.ok(!String(n1.value).includes('R$'));

  const ytd = ws.getCell(lojas.excelRow, 3);
  assert.equal(typeof ytd.value, 'number');
  perto(ytd.value, 100);

  const prev = ws.getCell(lojas.excelRow, 4);
  assert.equal(typeof prev.value, 'number');
  assert.equal(prev.value, 20);
  assert.equal(prev.numFmt, meta.numFmtRs);

  const orcVazio = ws.getCell(lojas.excelRow, 7);
  assert.equal(orcVazio.value, null);
  assert.notEqual(orcVazio.value, 0);

  const pctVazio = ws.getCell(lojas.excelRow, 8);
  assert.equal(pctVazio.value, null);

  const totLojas = ws.getCell(lojas.excelRow, 5);
  assert.equal(typeof totLojas.value.formula, 'string');
  assert.ok(totLojas.value.formula.includes('C' + lojas.excelRow));
  assert.ok(totLojas.value.formula.includes('D' + lojas.excelRow));
  perto(totLojas.value.result, 120);
  assert.equal(totLojas.numFmt, meta.numFmtRs);

  const varLojas = ws.getCell(lojas.excelRow, 6);
  assert.equal(typeof varLojas.value.result, 'number');
  perto(varLojas.value.result, byId.dfb_lojas.varPct / 100);
  assert.ok(varLojas.numFmt.includes('%'));
  assert.ok(!String(varLojas.value.result).includes('%'));

  const prevRest = ws.getCell(rest.excelRow, 4);
  assert.equal(prevRest.value, null);
  const orcRest = ws.getCell(rest.excelRow, 7);
  assert.equal(typeof orcRest.value, 'number');
  assert.equal(orcRest.value, 50);

  const prevDfb = ws.getCell(dfb.excelRow, 4);
  assert.equal(typeof prevDfb.value.formula, 'string');
  assert.ok(prevDfb.value.formula.startsWith('SUM('));
  assert.ok(prevDfb.value.formula.includes('D' + lojas.excelRow));
  assert.ok(!prevDfb.value.formula.includes('D' + dfb.excelRow));
  perto(prevDfb.value.result, byId.dfb.prevOutDez);
  assert.equal(prevDfb.font.bold, true);
  assert.equal(prevDfb.numFmt, meta.numFmtRs);

  assert.equal(ws.getCell(total.excelRow, 1).value, 'Total');
  assert.equal(ws.getCell(total.excelRow, 1).font.bold, true);
  const prevTotal = ws.getCell(total.excelRow, 4);
  assert.ok(prevTotal.value.formula.startsWith('SUM('));
  perto(prevTotal.value.result, byId.total.prevOutDez);
  assert.equal(prevTotal.font.bold, true);

  const zero = ws.getCell(meta.linhas.find(r => r.id === 'qb_rest').excelRow, 7);
  assert.equal(zero.value, 0);
  assert.equal(typeof zero.value, 'number');

  assert.equal(meta.linhas.length, linhas.length);
  assert.deepEqual(meta.linhas.map(r => r.empresa), linhas.map(r => r.empresa));
});

check('Volume: canal escolhido, cinco produtos com unidade, sem somar kg com un e L', () => {
  const ag = { meses: {} };
  function por(ym, canal, fam, qtd) {
    if (!ag.meses[ym]) ag.meses[ym] = { canais: {}, semCanal: {} };
    if (!ag.meses[ym].canais[canal]) ag.meses[ym].canais[canal] = {};
    ag.meses[ym].canais[canal][fam] = qtd;
  }
  por('2025-06', 'dfb_lojas', 'grao', 12.5);
  por('2026-04', 'dfb_lojas', 'grao', 3);
  por('2025-01', 'dfb_lojas', 'moido', 2);
  por('2025-01', 'dfb_lojas', 'capsulas', 100);
  por('2025-01', 'dfb_lojas', 'maquina', 4);
  por('2025-01', 'dfb_lojas', 'vinho', 1.5);
  por('2025-01', 'dfb_rest', 'grao', 99);
  const doc = {
    celulas: {
      'dfb_lojas|grao': { prevOutDez: 1.5, orcamento: null },
      'dfb_lojas|capsulas': { orcamento: 10 },
    },
  };
  const linhas = ctx.vol27Montar(ag, doc, 'dfb_lojas');
  assert.equal(linhas.length, 5);
  const ws = folhaExcelFalsa();
  const meta = ctx.escreverFolhaOrc27Volume(ws, linhas, 'dfb_lojas');

  assert.equal(meta.filename, 'Orcamento_2027_volume_dfb_lojas.xlsx');
  assert.equal(ctx.orc27NomeFicheiroVolume('todos'), 'Orcamento_2027_volume.xlsx');
  assert.equal(ctx.orc27NomeFicheiroVolume([]), 'Orcamento_2027_volume.xlsx');
  assert.equal(ctx.orc27NomeFicheiroVolume(['dfb_lojas']), 'Orcamento_2027_volume_dfb_lojas.xlsx');
  assert.equal(meta.sheetName, 'Volume');
  assert.equal(meta.canal, 'Delta · Lojas online');
  assert.equal(ws.getCell(1, 1).value, 'Orçamento 2027 — Volume · Delta · Lojas online');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(c => ws.getCell(2, c).value), [
    'Produto',
    'Total N-1 até Dez',
    'YTD 2026 até Set',
    'Previsão Out a Dez',
    'Total 2026',
    'Var % vs 2025',
    'Orçamento 2027',
    '% 27 vs fecho 26',
  ]);
  assert.equal(ws.getCell(2, 1).font.bold, true);
  assert.equal(ws.getCell(2, 1).fill.pattern, 'solid');
  assert.equal(ws.views[0].state, 'frozen');

  assert.deepEqual(meta.linhas.map(r => r.nome), [
    'Grão (Kg)',
    'Café Moído (Kg)',
    'Cápsulas (Un)',
    'Máquina (Un)',
    'Vinho (L)',
  ]);
  assert.deepEqual(meta.linhas.map(r => r.unidade), ['kg', 'kg', 'un', 'un', 'l']);
  assert.equal(meta.linhas.length, 5);
  for (const linha of meta.linhas) {
    assert.notEqual(ws.getCell(linha.excelRow, 1).value, 'Total');
  }
  const textos = [];
  for (const cell of ws.cells.values()) {
    if (cell.value === 'Total') textos.push(cell.value);
  }
  assert.equal(textos.length, 0);

  const grao = meta.linhas[0];
  const n1 = ws.getCell(grao.excelRow, 2);
  assert.equal(typeof n1.value, 'number');
  perto(n1.value, 12.5);
  assert.equal(n1.numFmt, meta.numFmtQtd);
  assert.ok(!n1.numFmt.includes('R$'));
  perto(ws.getCell(grao.excelRow, 3).value, 3);
  assert.equal(ws.getCell(grao.excelRow, 4).value, 1.5);
  const tot = ws.getCell(grao.excelRow, 5);
  perto(tot.value.result, 4.5);
  assert.equal(typeof tot.value.result, 'number');
  assert.equal(ws.getCell(grao.excelRow, 7).value, null);

  const caps = meta.linhas[2];
  assert.equal(typeof ws.getCell(caps.excelRow, 2).value, 'number');
  perto(ws.getCell(caps.excelRow, 2).value, 100);
  assert.equal(ws.getCell(caps.excelRow, 4).value, null);
  assert.equal(ws.getCell(caps.excelRow, 7).value, 10);
  assert.equal(ws.getCell(caps.excelRow, 7).numFmt, meta.numFmtQtd);

  const moido = meta.linhas[1];
  assert.equal(typeof ws.getCell(moido.excelRow, 2).value, 'number');
  assert.equal(ws.getCell(meta.linhas[3].excelRow, 2).value, 4);
  perto(ws.getCell(meta.linhas[4].excelRow, 2).value, 1.5);
  assert.ok(String(ws.getCell(meta.linhas[4].excelRow, 1).value).includes('(L)'));
});

check('Volume: vários canais saem numa folha com a soma de cada produto', () => {
  const ag = { meses: {} };
  function por(ym, canal, fam, qtd) {
    if (!ag.meses[ym]) ag.meses[ym] = { canais: {}, semCanal: {} };
    if (!ag.meses[ym].canais[canal]) ag.meses[ym].canais[canal] = {};
    ag.meses[ym].canais[canal][fam] = qtd;
  }
  por('2025-01', 'dfb_lojas', 'grao', 10);
  por('2025-01', 'dfb_rest', 'grao', 4);
  por('2025-01', 'dfb_lojas', 'capsulas', 3);
  por('2025-01', 'dfb_rest', 'moido', 8);
  por('2025-01', 'qb_rest', 'vinho', 100);
  const doc = {
    celulas: {
      'dfb_lojas|grao': { prevOutDez: 1, orcamento: 2 },
      'dfb_rest|grao': { prevOutDez: 3, orcamento: 5 },
    },
  };
  const linhas = ctx.vol27Montar(ag, doc, ['dfb_rest', 'dfb_lojas']);
  assert.equal(linhas.length, 5);
  assert.equal(linhas.find(r => r.id === 'grao').editavel, false);
  perto(linhas.find(r => r.id === 'grao').n1, 14);
  assert.equal(linhas.find(r => r.id === 'grao').prevOutDez, 4);
  assert.equal(linhas.find(r => r.id === 'grao').orcamento, 7);
  perto(linhas.find(r => r.id === 'moido').n1, 8);
  perto(linhas.find(r => r.id === 'capsulas').n1, 3);
  assert.equal(linhas.find(r => r.id === 'vinho').n1Tem, false);

  const ws = folhaExcelFalsa();
  const meta = ctx.escreverFolhaOrc27Volume(ws, linhas, ['dfb_lojas', 'dfb_rest']);
  assert.equal(meta.filename, 'Orcamento_2027_volume.xlsx');
  assert.equal(meta.sheetName, 'Volume');
  assert.equal(meta.canal, 'Vários canais');
  assert.equal(ws.getCell(1, 1).value, 'Orçamento 2027 — Volume · Vários canais');
  assert.equal(meta.linhas.length, 5);
  assert.deepEqual(meta.linhas.map(r => r.nome), [
    'Grão (Kg)', 'Café Moído (Kg)', 'Cápsulas (Un)', 'Máquina (Un)', 'Vinho (L)',
  ]);
  const grao = meta.linhas[0];
  perto(ws.getCell(grao.excelRow, 2).value, 14);
  assert.equal(ws.getCell(grao.excelRow, 4).value, 4);
  assert.equal(ws.getCell(grao.excelRow, 7).value, 7);
  perto(ws.getCell(meta.linhas[1].excelRow, 2).value, 8);
  perto(ws.getCell(meta.linhas[2].excelRow, 2).value, 3);
  assert.equal(ws.getCell(meta.linhas[4].excelRow, 2).value, null);
  assert.equal(ctx.orc27NomeFicheiroVolume(['dfb_lojas', 'dfb_rest']), 'Orcamento_2027_volume.xlsx');
  assert.equal(ctx.orc27NomeFicheiroVolume(['dfb_lojas']), 'Orcamento_2027_volume_dfb_lojas.xlsx');
});

check('Sazonalidade: 2026 e 2027, meses numéricos, vazio em branco, total SUM, só canais visíveis', () => {
  const lojas = {
    id: 'dfb_lojas',
    empresa: 'LOJAS ONLINE',
    tipo: 'canal',
    parent: 'dfb',
    m2026: [10, 20, 30, 40, 50, 60, 70, 80, 90, 0, 15, 25],
    m2027: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 34],
    tem2027: true,
    totalSaz2026: 490,
    totalSaz2027: 100,
    dif2026: 5,
    dif2026Tem: true,
    dif2027: 0,
    q4: {
      out: { vazio: true, soma: 0, valor: null },
      nov: { vazio: false, soma: 15, valor: 15 },
      dez: { vazio: false, soma: 25, valor: 25 },
    },
  };
  const rest = {
    id: 'dfb_rest',
    empresa: 'RESTAURAÇÃO',
    tipo: 'canal',
    parent: 'dfb',
    m2026: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    m2027: [null, null, null, null, null, null, null, null, null, null, null, null],
    tem2027: false,
    totalSaz2026: 12,
    totalSaz2027: null,
    dif2026: null,
    dif2026Tem: false,
    dif2027: null,
    q4: {
      out: { vazio: false, soma: 1, valor: 1 },
      nov: { vazio: false, soma: 1, valor: 1 },
      dez: { vazio: false, soma: 1, valor: 1 },
    },
  };
  const dfb = {
    id: 'dfb',
    empresa: 'DELTA FOODS BRASIL',
    tipo: 'grupo',
    m2026: [11, 21, 31, 41, 51, 61, 71, 81, 91, 1, 16, 26],
    m2027: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 34],
    tem2027: true,
    totalSaz2026: 502,
    totalSaz2027: 100,
    dif2026: 5,
    dif2026Tem: true,
    dif2027: 0,
    q4: null,
  };
  const visiveis = [dfb, lojas, rest];
  const ws = folhaExcelFalsa();
  const meta = ctx.escreverFolhaOrc27Sazonalidade(ws, visiveis);

  assert.equal(meta.filename, 'Orcamento_2027_sazonalidade.xlsx');
  assert.equal(meta.sheetName, 'Sazonalidade');
  assert.deepEqual(meta.headers.slice(0, 2), ['Empresa', 'Ano']);
  assert.deepEqual(meta.headers.slice(2, 14), ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']);
  assert.deepEqual(meta.headers.slice(14), ['Total', 'Dif']);
  assert.deepEqual([1, 2, 3, 14, 15, 16].map(c => ws.getCell(2, c).value), ['Empresa', 'Ano', 'Jan', 'Dez', 'Total', 'Dif']);
  for (const c of [1, 2, 3, 15, 16]) {
    assert.equal(ws.getCell(2, c).font.bold, true);
    assert.equal(ws.getCell(2, c).fill.pattern, 'solid');
    assert.equal(ws.getCell(2, c).border.bottom.style, 'thin');
  }
  assert.equal(ws.views[0].state, 'frozen');
  assert.equal(ws.views[0].ySplit, 2);

  assert.deepEqual(meta.linhas.map(r => r.id), ['dfb', 'dfb_lojas', 'dfb_rest']);
  const linha = meta.linhas.find(r => r.id === 'dfb_lojas');
  assert.equal(ws.getCell(linha.row2026, 1).value, 'LOJAS ONLINE');
  assert.equal(ws.getCell(linha.row2026, 2).value, '2026');
  assert.equal(ws.getCell(linha.row2027, 2).value, '2027');
  assert.equal(typeof ws.getCell(linha.row2026, 3).value, 'number');
  assert.equal(ws.getCell(linha.row2026, 3).value, 10);
  assert.ok(ws.getCell(linha.row2026, 3).numFmt.includes('R$'));
  assert.equal(ws.getCell(linha.row2026, 12).value, null);
  assert.notEqual(ws.getCell(linha.row2026, 12).value, 0);
  assert.equal(ws.getCell(linha.row2026, 13).value, 15);
  assert.equal(ws.getCell(linha.row2026, 14).value, 25);

  const tot2026 = ws.getCell(linha.row2026, 15);
  assert.equal(tot2026.value.formula, 'SUM(C' + linha.row2026 + ':N' + linha.row2026 + ')');
  assert.equal(typeof tot2026.value.result, 'number');
  assert.equal(tot2026.value.result, 490);
  assert.equal(tot2026.numFmt, meta.numFmtRs);
  assert.equal(ws.getCell(linha.row2026, 16).value, 5);

  assert.equal(typeof ws.getCell(linha.row2027, 3).value, 'number');
  assert.equal(ws.getCell(linha.row2027, 3).value, 1);
  assert.equal(ws.getCell(linha.row2027, 14).value, 34);
  const tot2027 = ws.getCell(linha.row2027, 15);
  assert.equal(tot2027.value.formula, 'SUM(C' + linha.row2027 + ':N' + linha.row2027 + ')');
  assert.equal(tot2027.value.result, 100);
  assert.equal(ws.getCell(linha.row2027, 16).value, 0);

  const sem = meta.linhas.find(r => r.id === 'dfb_rest');
  assert.equal(ws.getCell(sem.row2026, 2).value, '2026');
  assert.equal(ws.getCell(sem.row2027, 2).value, '2027');
  assert.equal(typeof ws.getCell(sem.row2026, 3).value, 'number');
  assert.equal(ws.getCell(sem.row2027, 3).value, null);
  assert.equal(ws.getCell(sem.row2027, 14).value, null);
  assert.equal(ws.getCell(sem.row2027, 15).value, null);
  assert.notEqual(ws.getCell(sem.row2027, 15).value, 0);

  const empresa = meta.linhas.find(r => r.id === 'dfb');
  assert.equal(ws.getCell(empresa.row2026, 1).font.bold, true);
  assert.equal(typeof ws.getCell(empresa.row2026, 3).value, 'number');
  assert.equal(ws.getCell(empresa.row2026, 3).value, 11);
  assert.equal(ws.getCell(empresa.row2027, 2).value, '2027');
  assert.ok(ws.merges.some(m => m[0] === empresa.row2026 && m[2] === empresa.row2027));
});

check('o botão Exportar para Excel está nos três submenus e não abre o Outlook', () => {
  for (const sub of ['valor', 'volume', 'sazonalidade']) {
    const nav = ctx.orc27SubNavHtml(sub);
    assert.ok(nav.includes('id="orc27-btn-excel"'), sub);
    assert.ok(nav.includes('>Exportar para Excel<'), sub);
    assert.ok(nav.includes('btn btn-primary btn-sm'), sub);
    assert.ok(nav.includes('orc27ExportarExcel()'), sub);
    assert.ok(!nav.includes('display:none'), sub);
    assert.ok(nav.includes('id="orc27-sub-' + (sub === 'valor' ? 'valor' : sub) + '"'), sub);
  }
  assert.ok(html.includes('id="orc27-btn-excel"'));
  assert.ok(extractFn(html, 'orc27RenderHtml').includes('orc27SubNavHtml'));
  assert.ok(extractFn(html, 'vol27RenderHtml').includes('orc27SubNavHtml'));
  assert.ok(extractFn(html, 'saz27RenderHtml').includes('orc27SubNavHtml'));
  assert.ok(extractFn(html, 'saz27RenderHtml').includes('saz27FiltroHtml'));
  const fn = extractFn(html, 'orc27ExportarExcel');
  assert.ok(fn.includes('prosEnsureExcelJS'));
  assert.ok(fn.includes('triggerBlobDownload'));
  assert.ok(fn.includes("addWorksheet('Orç Valor'"));
  assert.ok(fn.includes("addWorksheet('Volume'"));
  assert.ok(fn.includes("addWorksheet('Sazonalidade'"));
  assert.ok(fn.includes('escreverFolhaOrc27Valor'));
  assert.ok(fn.includes('escreverFolhaOrc27Volume'));
  assert.ok(fn.includes('escreverFolhaOrc27Sazonalidade'));
  assert.ok(fn.includes('saz27LinhasNoEcra'));
  assert.ok(fn.includes('Orcamento_2027_valor.xlsx') || extractFn(html, 'escreverFolhaOrc27Valor').includes('Orcamento_2027_valor.xlsx'));
  assert.ok(!fn.includes('outlookAbrirRascunho'));
  assert.ok(!fn.includes('outlookOpenMailto'));
  assert.ok(!fn.includes('comissaoRcExportarEmail'));
  assert.ok(sw.includes(CACHE));
  assert.ok(html.includes(CACHE));
  assert.ok(!sw.includes('v2026-10-15-orcamento-sazonalidade'));
  assert.ok(!html.includes('v2026-10-15-orcamento-excel'));
  assert.ok(!sw.includes('v2026-10-15-orcamento-excel'));
});

if (process.exitCode) {
  console.error('test-orcamento-excel: falhou');
  process.exit(process.exitCode);
}
console.log('test-orcamento-excel: ok');
