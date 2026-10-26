#!/usr/bin/env node
/**
 * Orçamento 2027 · Canais.
 * N-1 = Fatur. Jan–Dez 2025. YTD = Jan–Set 2026 (Outubro fora).
 * Total 2026, Var % e % 27. Pais somam filhos. 99520099 não entra.
 * Autosave à parte da previsão de fecho do mapa.
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

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

function perto(a, b, msg) {
  assert.ok(Math.abs(Number(a) - Number(b)) < 0.02, (msg || '') + ' ' + a + ' vs ' + b);
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
  'ORC27_LS_KEY',
  'ORC27_CLOUD_PATH',
  'ORC27_DEBOUNCE_MS',
];
for (const name of consts) vm.runInContext(extractConst(html, name), ctx);

const fns = [
  'pvNormVendMapa',
  'pvCodNaCelulaVenda',
  'pvLadoInstitucionalCelula',
  'pvCentavosMapa',
  'pvMapaPadLeft',
  'pvTsMs',
  'pvParseNumInput',
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
  'orc27PickCampo',
  'orc27MergeCanais',
  'orc27LocalPrecisaNuvem',
  'orc27AplicarEdicao',
  'orc27FmtRs',
  'orc27FmtPct',
  'orc27FmtInput',
  'orc27Esc',
  'orc27SubNavHtml',
  'orc27CelulaManualHtml',
  'orc27RenderHtml',
  'orc27EntradaPronta',
];
for (const name of fns) vm.runInContext(extractFn(html, name), ctx);

function cel(empresa, canal, valor, extra) {
  return Object.assign({ empresa, canal, valor, vendedor: 'X', npess: 1 }, extra || {});
}

check('períodos: 2025 inteiro e 2026 só até Setembro', () => {
  const n1 = ctx.orc27PeriodoN1();
  const ytd = ctx.orc27PeriodoYtd();
  assert.equal(n1.length, 12);
  assert.equal(n1[0], '2025-01');
  assert.equal(n1[11], '2025-12');
  assert.equal(ytd.length, 9);
  assert.equal(ytd[0], '2026-01');
  assert.equal(ytd[8], '2026-09');
  assert.ok(!ytd.includes('2026-10'));
  assert.ok(!ytd.includes('2026-12'));
  assert.equal(vm.runInContext('ORC27_DEBOUNCE_MS', ctx), 1000);
});

check('linhas iguais ao mapa, com institucional e Q Brasil regionais, sem Por classificar', () => {
  const base = ctx.orc27LinhasBase();
  const seed = vm.runInContext('PV_SEED_AGOSTO_2026.linhas.map(r => r.id)', ctx);
  assert.deepEqual(base.map(r => r.id), seed);
  assert.ok(seed.includes('dfb_inst'));
  assert.ok(seed.includes('dfb_inst_balcao'));
  assert.ok(seed.includes('dfb_inst_horeca'));
  assert.ok(seed.includes('qb_dist_reg'));
  assert.ok(seed.includes('qb'));
  assert.ok(seed.includes('total'));
  assert.ok(!base.some(r => /classificar/i.test(r.empresa) || /classificar/i.test(r.id)));
  assert.equal(ctx.orc27IdFolha('dfb_lojas'), true);
  assert.equal(ctx.orc27IdFolha('dfb'), false);
  assert.equal(ctx.orc27IdFolha('dfb_inst'), false);
  assert.equal(ctx.orc27IdFolha('total'), false);
});

const quadro = { meses: {} };
function add(ym, key, cell) {
  if (!quadro.meses[ym]) quadro.meses[ym] = { celulas: {} };
  quadro.meses[ym].celulas[key] = cell;
}
add('2025-01', 'lojas', cel('Delta Foods Brasil', 'Lojas online', 1000.10, { npess: 99520001 }));
add('2025-06', 'lojas', cel('Delta Foods Brasil', 'Lojas online', 200, { npess: 99520001 }));
add('2025-12', 'lojas', cel('Delta Foods Brasil', 'Lojas online', 50, { npess: 99520001 }));
add('2025-03', 'dev', cel('Delta Foods Brasil', 'Lojas online', 500, { npess: 99520099, vendedor: '99520099 - QBRASIL' }));
add('2025-09', 'pc', cel('Delta Foods Brasil', 'Por classificar', 146838.16, { npess: 99520099, vendedor: '99520099' }));
add('2025-02', 'rest', cel('Delta Foods Brasil', 'Restauração', 40, { npess: 99520002 }));
add('2025-04', 'bal', cel('Delta Foods Brasil', 'Institucional', 10, { npess: 99520011, vendedor: 'MARCIO GORGA' }));
add('2025-04', 'hor', cel('Delta Foods Brasil', 'Institucional', 5, { npess: 99520019, vendedor: 'FILIPE NEVES' }));
add('2025-01', 'site0', cel('Delta Foods Brasil', 'Site próprio', 0, { npess: 99520009 }));
add('2025-08', 'qbr', cel('Q Brasil', 'Restauração', 7, { npess: 99530003 }));
add('2026-01', 'lojas', cel('Delta Foods Brasil', 'Lojas online', 80, { npess: 99520001 }));
add('2026-09', 'lojas', cel('Delta Foods Brasil', 'Lojas online', 20, { npess: 99520001 }));
add('2026-09', 'dev', cel('Delta Foods Brasil', 'Lojas online', 146838.16, { npess: 99520099, vendedor: '99520099 Q-BRASIL' }));
add('2026-10', 'lojas', cel('Delta Foods Brasil', 'Lojas online', 99999, { npess: 99520001 }));
add('2026-10', 'out', cel('Q Brasil', 'Restauração', 777, { npess: 99530003 }));
add('2026-02', 'bal', cel('Delta Foods Brasil', 'Institucional', 7, { npess: 99520011 }));
add('2026-03', 'hor', cel('Delta Foods Brasil', 'Institucional', 1, { npess: 99520019 }));

const manual = {
  dfb: { prevOutDez: 999999, orcamento: 888888 },
  dfb_inst: { prevOutDez: 777777, orcamento: 666666 },
  dfb_lojas: { prevOutDez: 20, orcamento: null },
  dfb_inst_balcao: { prevOutDez: 3 },
  dfb_inst_horeca: { orcamento: 20 },
  qb_rest: { prevOutDez: 1, orcamento: 0 },
};

check('fórmulas soltas: total, var e percentagem de 27', () => {
  assert.equal(ctx.orc27Total2026(100, true, null).tem, true);
  assert.equal(ctx.orc27Total2026(100, true, null).valor, 100);
  assert.equal(ctx.orc27Total2026(100, true, 25).valor, 125);
  assert.equal(ctx.orc27Total2026(null, false, null).tem, false);
  assert.equal(ctx.orc27Total2026(null, false, 30).valor, 30);
  perto(ctx.orc27VarPct(150, true, 200, true), (150 - 200) / 200 * 100);
  assert.equal(ctx.orc27VarPct(100, true, 0, true), null);
  assert.equal(ctx.orc27VarPct(100, true, 80, false), null);
  assert.equal(ctx.orc27VarPct(100, true, null, false), null);
  assert.equal(ctx.orc27Pct27(null, 150, true), null);
  assert.equal(ctx.orc27Pct27('', 150, true), null);
  assert.equal(ctx.orc27Pct27(180, 0, true), null);
  assert.equal(ctx.orc27Pct27(180, null, false), null);
  perto(ctx.orc27Pct27(180, 150, true), (180 - 150) / 150 * 100);
  perto(ctx.orc27Pct27(0, 150, true), -100);
});

check('quadro: ano 2025, YTD até Set, Outubro intacto, 99520099 de fora', () => {
  const soOut = {
    meses: {
      '2026-10': { celulas: { a: { empresa: 'Delta Foods Brasil', canal: 'Lojas online', valor: 99999, npess: 99520001 } } },
    },
  };
  const s = ctx.orc27SomarPeriodo(soOut, ctx.orc27PeriodoYtd(), 'Delta Foods Brasil', 'Lojas online', '');
  assert.equal(s.tem, false);
  assert.equal(soOut.meses['2026-10'].celulas.a.valor, 99999);

  const linhas = ctx.orc27Montar(quadro, manual);
  assert.equal(quadro.meses['2026-10'].celulas.lojas.valor, 99999);
  assert.equal(quadro.meses['2026-10'].celulas.out.valor, 777);

  const byId = {};
  linhas.forEach(r => { byId[r.id] = r; });
  const lojas = byId.dfb_lojas;
  perto(lojas.n1, 1250.10);
  assert.notEqual(lojas.n1, 1000.10);
  assert.notEqual(lojas.n1, 500);
  perto(lojas.ytd, 100);
  assert.equal(lojas.prevOutDez, 20);
  perto(lojas.total2026, 120);
  perto(lojas.varPct, (120 - 1250.10) / 1250.10 * 100);
  assert.equal(lojas.orcamento, null);
  assert.equal(lojas.pct27, null);
  assert.notEqual(lojas.prevOutDez, 858000);

  const inst = byId.dfb_inst;
  perto(inst.n1, 15);
  perto(inst.ytd, 8);
  assert.equal(inst.prevOutDez, 3);
  assert.equal(inst.orcamento, 20);
  perto(inst.total2026, 11);
  perto(inst.varPct, (11 - 15) / 15 * 100);
  perto(inst.pct27, (20 - 11) / 11 * 100);
  assert.equal(inst.editavel, false);

  const dfb = byId.dfb;
  perto(dfb.n1, 1305.10);
  perto(dfb.ytd, 108);
  assert.equal(dfb.prevOutDez, 23);
  assert.equal(dfb.orcamento, 20);
  perto(dfb.total2026, 131);
  assert.notEqual(dfb.prevOutDez, 999999);
  assert.notEqual(dfb.orcamento, 888888);

  const qb = byId.qb;
  perto(qb.n1, 7);
  assert.equal(qb.ytdTem, false);
  assert.equal(qb.prevOutDez, 1);
  assert.equal(qb.orcamento, 0);
  perto(qb.total2026, 1);
  perto(qb.pct27, -100);

  const total = byId.total;
  perto(total.n1, 1312.10);
  perto(total.ytd, 108);
  assert.equal(total.prevOutDez, 24);
  assert.equal(total.orcamento, 20);
  perto(total.total2026, 132);

  const site = byId.dfb_site;
  assert.equal(site.n1, 0);
  assert.equal(site.n1Tem, true);
  assert.equal(site.varPct, null);

  const rest = byId.dfb_rest;
  perto(rest.n1, 40);
  assert.equal(rest.ytdTem, false);
  assert.equal(rest.prevOutDez, null);
  assert.equal(rest.totalTem, false);
  perto(rest.varPct, -100);
  assert.equal(rest.pct27, null);
});

check('merge não apaga e um clear explícito não dispara duas vezes', () => {
  const cloud = {
    dfb_lojas: {
      prevOutDez: 100,
      orcamento: 50,
      cellTs: { prevOutDez: '2026-10-01T00:00:00.000Z', orcamento: '2026-10-01T00:00:00.000Z' },
    },
    dfb: { prevOutDez: 1, cellTs: { prevOutDez: '2026-10-02T00:00:00.000Z' } },
  };
  const uma = ctx.orc27MergeCanais({}, cloud);
  assert.equal(uma.dfb_lojas.prevOutDez, 100);
  assert.equal(uma.dfb_lojas.orcamento, 50);
  assert.equal(uma.dfb, undefined);
  const duas = ctx.orc27MergeCanais(uma, cloud);
  assert.equal(duas.dfb_lojas.prevOutDez, 100);
  assert.equal(duas.dfb_lojas.orcamento, 50);
  assert.equal(ctx.orc27LocalPrecisaNuvem({}, cloud), false);

  const cleared = {
    dfb_lojas: {
      prevOutDez: null,
      orcamento: 50,
      cellTs: { prevOutDez: '2026-10-14T00:00:00.000Z', orcamento: '2026-10-01T00:00:00.000Z' },
    },
  };
  const depois = ctx.orc27MergeCanais(cleared, cloud);
  assert.equal(depois.dfb_lojas.prevOutDez, null);
  assert.equal(depois.dfb_lojas.orcamento, 50);
  const outra = ctx.orc27MergeCanais(depois, cloud);
  assert.equal(outra.dfb_lojas.prevOutDez, null);
  assert.equal(outra.dfb_lojas.orcamento, 50);
  assert.equal(ctx.orc27LocalPrecisaNuvem(cleared, cloud), true);
  assert.equal(ctx.orc27LocalPrecisaNuvem(depois, depois), false);

  const antigo = {
    dfb_lojas: { prevOutDez: null, cellTs: { prevOutDez: '2026-09-01T00:00:00.000Z' } },
  };
  assert.equal(ctx.orc27MergeCanais(antigo, cloud).dfb_lojas.prevOutDez, 100);

  let doc = { canais: {} };
  let r = ctx.orc27AplicarEdicao(doc, 'dfb_lojas', 'prevOutDez', 100, '2026-10-14T01:00:00.000Z');
  assert.equal(r.changed, true);
  doc = r.doc;
  r = ctx.orc27AplicarEdicao(doc, 'dfb_lojas', 'orcamento', 40, '2026-10-14T01:00:00.000Z');
  doc = r.doc;
  r = ctx.orc27AplicarEdicao(doc, 'dfb_lojas', 'prevOutDez', null, '2026-10-14T02:00:00.000Z');
  assert.equal(r.changed, true);
  assert.equal(r.doc.canais.dfb_lojas.prevOutDez, null);
  assert.equal(r.doc.canais.dfb_lojas.orcamento, 40);
  const ts = r.doc.canais.dfb_lojas.cellTs.prevOutDez;
  doc = r.doc;
  r = ctx.orc27AplicarEdicao(doc, 'dfb_lojas', 'prevOutDez', null, '2026-10-14T03:00:00.000Z');
  assert.equal(r.changed, false);
  assert.equal(doc.canais.dfb_lojas.cellTs.prevOutDez, ts);
  r = ctx.orc27AplicarEdicao(doc, 'dfb', 'prevOutDez', 5, '2026-10-14T04:00:00.000Z');
  assert.equal(r.changed, false);
  assert.equal(r.doc.canais.dfb, undefined);

  assert.equal(ctx.orc27EntradaPronta('').ok, true);
  assert.equal(ctx.orc27EntradaPronta('').valor, null);
  assert.equal(ctx.orc27EntradaPronta('-').ok, false);
  assert.equal(ctx.orc27EntradaPronta('1.250,5').valor, 1250.5);
});

check('ecrã, autosave separado e cache do service worker', () => {
  assert.ok(html.includes("onclick=\"pvShowView('orcamento')\">Orçamento 2027</button>"));
  assert.ok(html.includes('id="orc27-sub-valor"'));
  assert.ok(html.includes('>Orç Valor</button>'));
  assert.ok(html.includes('id="orc27-sub-volume"'));
  assert.ok(html.includes('>Volume</button>'));
  assert.ok(!html.includes('id="orc27-sub-canais"'));
  assert.ok(html.includes('Total N-1 até Dez'));
  assert.ok(html.includes('YTD 2026 até Set'));
  assert.ok(html.includes('Previsão Out a Dez'));
  assert.ok(html.includes('Var % vs 2025'));
  assert.ok(html.includes('Orçamento 2027'));
  assert.ok(html.includes('% 27 vs fecho 26'));
  assert.ok(html.includes("const ORC27_DEBOUNCE_MS = 1000"));
  assert.ok(html.includes("const ORC27_CLOUD_PATH = 'previsao/orcamento_2027_canais.json'"));
  assert.ok(html.includes("const ORC27_LS_KEY = 'dfb_orcamento_2027_canais_v1'"));
  assert.equal(vm.runInContext('ORC27_CLOUD_PATH', ctx), 'previsao/orcamento_2027_canais.json');
  assert.ok(!String(vm.runInContext('ORC27_CLOUD_PATH', ctx)).includes('mapas_v3'));
  assert.ok(!extractFn(html, 'orc27Montar').includes('prevFecho'));
  assert.ok(!extractFn(html, 'orc27Upload').includes('mapas_v3'));
  assert.ok(!extractFn(html, 'orc27Flush').includes('pvSaveData'));
  assert.ok(extractFn(html, 'orc27Agendar').includes('ORC27_DEBOUNCE_MS'));
  assert.ok(extractFn(html, 'orc27Flush').includes('clearTimeout(_orc27Timer)'));
  assert.ok(sw.includes('v2026-10-26-eduardo-cpf'));
  assert.ok(html.includes('v2026-10-26-eduardo-cpf'));

  const linhas = ctx.orc27Montar(quadro, { dfb_lojas: { prevOutDez: null, orcamento: null } });
  const vista = ctx.orc27RenderHtml(true, linhas);
  assert.ok(vista.includes('data-orc-id="dfb_lojas" data-orc-campo="prevOutDez"'));
  assert.ok(vista.includes('data-orc-id="dfb_lojas" data-orc-campo="orcamento"'));
  assert.ok(vista.includes('data-orc-id="qb_dist_reg" data-orc-campo="orcamento"'));
  assert.ok(vista.includes('placeholder="—"'));
  assert.ok(vista.includes('<tr data-orc-id="dfb"'));
  assert.ok(!vista.includes('data-orc-id="dfb" data-orc-campo'));
  assert.ok(!vista.includes('data-orc-id="dfb_inst" data-orc-campo'));
  assert.ok(!vista.includes('data-orc-id="qb" data-orc-campo'));
  assert.ok(!vista.includes('data-orc-id="total" data-orc-campo'));
  const neg = ctx.orc27FmtPct(-25);
  assert.ok(neg.includes('-25,0%'));
  assert.ok(neg.includes('#b91c1c'));
  const pos = ctx.orc27FmtPct(10);
  assert.ok(pos.includes('+10,0%'));
  assert.ok(pos.includes('#15803d'));
  assert.equal(ctx.orc27FmtPct(null), '—');
  assert.equal(ctx.orc27FmtRs(null, false), '—');
  assert.ok(ctx.orc27FmtRs(1000.5, true).includes('1.000,50'));
  assert.equal(ctx.orc27FmtInput(null), '');
  assert.equal(ctx.orc27FmtInput(0), '0');
  const vazio = ctx.orc27FmtRs(-10, true);
  assert.ok(vazio.includes('#b91c1c'));
});

if (process.exitCode) {
  console.error('test-orcamento-2027-canais: falhou');
  process.exit(process.exitCode);
}
console.log('test-orcamento-2027-canais: ok');
