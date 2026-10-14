#!/usr/bin/env node
/**
 * Orçamento 2027 · Volume.
 * Orç Valor é o antigo submenu Canais. Volume tem cinco famílias.
 * As cinco famílias somam a coluna AA (Peso líq.) tal como está. Sem ÷ 0,005 e sem M+U+Y.
 * 99520099 não entra. O filtro de canal muda os números. Total = YTD + previsão.
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
  'VOL27_FAMILIAS',
  'VOL27_SEED_AA',
  'VOL27_ROTULOS',
  'VOL27_DEBOUNCE_MS',
  'VOL27_CLOUD_PATH',
  'VOL27_LS_KEY',
  'ORC27_CLOUD_PATH',
];
for (const name of consts) vm.runInContext(extractConst(html, name), ctx);

const fns = [
  'normalizeVendaCod',
  'npessEmpresaGn',
  'npessDeCelulaExcel',
  'npessVendaIgnorado',
  'codClienteLojasOnlineBr',
  'codClienteLojasOnlineAmazon',
  'dimensoesVendaQuadro',
  'linhasPlVendasQuadro',
  'mapasVendasQuadro',
  'pvNormVendMapa',
  'pvCodNaCelulaVenda',
  'pvLadoInstitucionalCelula',
  'ymLinhaPerdas',
  'pvTsMs',
  'pvParseNumInput',
  'orc27Yms',
  'orc27PeriodoN1',
  'orc27PeriodoYtd',
  'orc27TemNumero',
  'orc27LinhasBase',
  'orc27VarPct',
  'orc27Pct27',
  'orc27PickCampo',
  'orc27EntradaPronta',
  'orc27FmtPct',
  'orc27Esc',
  'vol27Round',
  'vol27NormTexto',
  'vol27TemToken',
  'vol27FamiliaNoTexto',
  'vol27FamiliaDeCampos',
  'vol27FamiliaDeTipoGuardado',
  'vol27FamiliaDaLinha',
  'vol27EhLitro',
  'vol27EhUnidade',
  'vol27EhKg',
  'vol27EhGrama',
  'vol27PesoKg',
  'vol27NumeroColuna',
  'vol27Medida',
  'indiceColunaVolumeVenda',
  'indiceColunaPesoLiqVenda',
  'indiceColunaQtdBonifiVenda',
  'indiceColunaQtdDoacaoVenda',
  'vol27DiaISO',
  'vol27ChaveCopia',
  'vol27SemCopiaDeData',
  'vol27IdsFolha',
  'vol27CanalIdDeLinha',
  'vol27MesVazio',
  'vol27AgregarLinhas',
  'vol27FundirMeses',
  'vol27CanaisDoFiltro',
  'vol27FiltroFolha',
  'vol27Somar',
  'vol27Total2026',
  'vol27Chave',
  'vol27ChaveValida',
  'vol27ManualValor',
  'vol27ManualSoma',
  'vol27Montar',
  'vol27ResumoFora',
  'vol27FmtPlano',
  'vol27FmtInput',
  'vol27FmtQtd',
  'vol27NotaFora',
  'vol27OpcoesFiltro',
  'vol27CelulaManualHtml',
  'vol27RenderHtml',
  'vol27AplicarEdicao',
  'vol27MergeCelulas',
];
for (const name of fns) vm.runInContext(extractFn(html, name), ctx);

function fam(ag, ym, canal, familia) {
  const mes = ag.meses[ym];
  if (!mes) return 0;
  if (!canal) return Number((mes.semCanal && mes.semCanal[familia]) || 0);
  return Number((mes.canais[canal] && mes.canais[canal][familia]) || 0);
}

check('submenu Orç Valor e cinco linhas de Volume, com cache novo', () => {
  assert.ok(html.includes('id="orc27-sub-valor"'));
  assert.ok(html.includes('>Orç Valor</button>'));
  assert.ok(html.includes('id="orc27-sub-volume"'));
  assert.ok(html.includes('>Volume</button>'));
  assert.ok(!html.includes('id="orc27-sub-canais"'));
  assert.ok(!html.includes(">Canais</button>"));
  const nomes = vm.runInContext('VOL27_FAMILIAS.map(f => f.nome)', ctx);
  assert.deepEqual(nomes, [
    'Grão (Kg)',
    'Café Moído (Kg)',
    'Cápsulas (Kg)',
    'Máquina (Un)',
    'Vinho (Kg)',
  ]);
  assert.equal(vm.runInContext('VOL27_DEBOUNCE_MS', ctx), 1000);
  assert.equal(vm.runInContext('VOL27_CLOUD_PATH', ctx), 'previsao/orcamento_2027_volume.json');
  assert.ok(!String(vm.runInContext('VOL27_CLOUD_PATH', ctx)).includes('mapas_v3'));
  assert.equal(vm.runInContext('ORC27_CLOUD_PATH', ctx), 'previsao/orcamento_2027_canais.json');
  assert.ok(sw.includes('v2026-10-14-volume-maquinas'));
  assert.ok(html.includes('v2026-10-14-volume-maquinas'));
  assert.ok(!extractFn(html, 'vol27Medida').includes('0.005'));
  assert.ok(extractFn(html, 'vol27Medida').includes('qtdBonifi'));
  assert.ok(extractFn(html, 'vol27Medida').includes('qtdDoacao'));
  assert.ok(extractFn(html, 'vol27Agendar').includes('VOL27_DEBOUNCE_MS'));
  assert.ok(extractFn(html, 'vol27Flush').includes('clearTimeout(_vol27Timer)'));
  assert.ok(!extractFn(html, 'vol27Flush').includes('pvSaveData'));
  assert.ok(html.includes('vol27SubstituirJanela(linhasJanela'));
  assert.ok(extractFn(html, 'vol27Preparar').includes('vol27ConstruirDeVendasCloud'));
  assert.ok(extractFn(html, 'vol27Preparar').includes("fonte === 'vendas-cloud'"));
  assert.ok(extractFn(html, 'vol27NotaFora').includes('repete linhas'));
  assert.ok(extractFn(html, 'vol27LinhasCloudParaAgregar').includes('vol27SemCopiaDeData'));
  assert.ok(!extractFn(html, 'vol27SubstituirJanela').includes('vol27SemCopiaDeData'));
});

check('cápsulas e moído são AA; máquina é M+U+Y e não AA', () => {
  const cap = ctx.vol27Medida({ tipo: 'CAPSULAS', peso: 10, qty: Math.round(10 / 0.0055), volume: 4, qtdBonifi: 1, qtdDoacao: 1 });
  assert.equal(cap.familia, 'capsulas');
  perto(cap.medida, 10);
  assert.notEqual(cap.medida, 10 / 0.005);
  assert.notEqual(cap.medida, Math.round(10 / 0.0055));
  assert.notEqual(cap.medida, 6);

  const grao = ctx.vol27Medida({ tipo: 'GRÃO', peso: 12.5 });
  assert.equal(grao.familia, 'grao');
  perto(grao.medida, 12.5);

  const moido = ctx.vol27Medida({ hierarq: 'CAFÉ MOÍDO 250g', peso: 2.5, tipo: 'OUTRO', volume: -32, qtdBonifi: 1, qtdDoacao: 3 });
  assert.equal(moido.familia, 'moido');
  perto(moido.medida, 2.5);
  assert.notEqual(moido.medida, -28);
  const moidoAa = ctx.vol27Medida({ hierarq: 'MOÍDOS', peso: 100, aa: 5.071, volume: 1, qtdBonifi: 2 });
  assert.equal(moidoAa.familia, 'moido');
  perto(moidoAa.medida, 5.071);
  assert.notEqual(moidoAa.medida, 100 / 0.005);
  assert.notEqual(moidoAa.medida, 100);
  const capAa = ctx.vol27Medida({ hierarq: 'CÁPSULAS', tipo: 'CAPSULAS', peso: 10, aa: 40, volume: 8 });
  assert.equal(capAa.familia, 'capsulas');
  perto(capAa.medida, 40);
  assert.notEqual(capAa.medida, 10 / 0.005);
  assert.notEqual(capAa.medida, 10);

  const ambos = ctx.vol27Medida({ hierarq: 'CÁPSULAS DE GRÃO', peso: 1, tipo: 'GRÃO' });
  assert.equal(ambos.familia, 'capsulas');
  perto(ambos.medida, 1);
  assert.notEqual(ctx.vol27FamiliaNoTexto('CÁPSULAS DE GRÃO'), 'grao');

  const maq = ctx.vol27Medida({
    hierarq: 'MÁQUINA DE CAFÉ EM GRÃO',
    peso: 40,
    volume: 2,
    qtdBonifi: 1,
    qtdDoacao: 4,
    unidadeQty: 'UN',
  });
  assert.equal(maq.familia, 'maquina');
  perto(maq.medida, 7);
  assert.notEqual(maq.medida, 40);
  const maqSoPeso = ctx.vol27Medida({ hierarq: 'MÁQUINAS', peso: 40 });
  assert.equal(maqSoPeso.familia, 'maquina');
  assert.equal(maqSoPeso.medida, null);

  const REAL = ['Organização vendas', 'Canal distribuição', 'Emissor da ordem', 'Doc.faturamento', 'Escritório de vendas', 'Equipe de vendas', 'Material', 'Representante de vendas', 'Hierarq.produtos', 'Data', 'Fatur.', 'Fatur.', 'QtFaturada', 'QtFaturada', 'VendasBrut', 'VendasBrut', 'Desc.Com.', 'Desc.Com.', 'Valor Boni', 'Valor Boni', 'Qtd Bonifi', 'Qtd Bonifi', 'Valor Doaç', 'Valor Doaç', 'Qtd Doação', 'Qtd Doação', 'Peso líq.', 'Peso líq.'];
  assert.equal(ctx.indiceColunaVolumeVenda(REAL), 12, 'M = QtFaturada');
  assert.equal(ctx.indiceColunaQtdBonifiVenda(REAL), 20, 'U = Qtd Bonifi');
  assert.equal(ctx.indiceColunaQtdDoacaoVenda(REAL), 24, 'Y = Qtd Doação');
  assert.equal(ctx.indiceColunaPesoLiqVenda(REAL), 26, 'AA = Peso líq.');
  assert.equal(REAL[12], 'QtFaturada');
  assert.equal(REAL[20], 'Qtd Bonifi');
  assert.equal(REAL[24], 'Qtd Doação');
  assert.equal(REAL[26], 'Peso líq.');

  assert.equal(ctx.vol27FamiliaNoTexto('ESMGNB050000400001 MF'), 'maquina');
  const mf = ctx.vol27Medida({ hierarq: 'ESMGNB050000400001 MF', peso: 8, volume: 1, qtdBonifi: 0, qtdDoacao: 0 });
  assert.equal(mf.familia, 'maquina');
  perto(mf.medida, 1);
  assert.notEqual(mf.medida, 8);
  assert.equal(ctx.vol27FamiliaNoTexto('ENCAPSULADO'), '');
  assert.equal(ctx.vol27FamiliaNoTexto('MOINHO'), '');
  assert.equal(ctx.vol27FamiliaNoTexto('GRAOSTE'), '');
  assert.equal(ctx.vol27FamiliaNoTexto('VINICOLA'), '');
  assert.equal(ctx.vol27FamiliaNoTexto('AMAZONAS'), '');
  assert.equal(ctx.vol27Medida({ hierarq: 'ENCAPSULADO', peso: 4, tipo: 'CAPSULAS' }).familia, '');
  assert.equal(ctx.vol27Medida({ tipo: 'OUTRO', peso: 9 }).familia, '');
});

check('vinho é a coluna AA sem conversão; 99520099 e o filtro de canal', () => {
  const vinhoAa = ctx.vol27Medida({ hierarq: 'VINHO', peso: 12, unidadePeso: 'KG', volume: 6, unidadeQty: 'L' });
  assert.equal(vinhoAa.familia, 'vinho');
  perto(vinhoAa.medida, 12);
  assert.notEqual(vinhoAa.medida, 6);
  const semAa = ctx.vol27Medida({ hierarq: 'VINHO TINTO', volume: 6, unidadeQty: 'L' });
  assert.equal(semAa.familia, 'vinho');
  assert.equal(semAa.medida, null);

  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520099, cod: '1' }), '');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520001 }), 'dfb_lojas');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520002 }), 'dfb_rest');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520011 }), 'dfb_inst_balcao');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520019 }), 'dfb_inst_horeca');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99530001 }), 'qb_ret_mod');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520009, cod: '100' }), 'dfb_site');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520009, cod: 'BR00002' }), 'dfb_lojas');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520009, cod: '418893', nome: 'CLIENTE' }), 'dfb_lojas');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520009, nome: 'AMAZONAS CAFE LTDA' }), 'dfb_site');

  const ag = ctx.vol27AgregarLinhas([
    { data: '2025-01-15', tipo: 'GRÃO', peso: 100, npess: 99520099, vendedor: '99520099 - QBRASIL' },
    { data: '2025-01-15', tipo: 'GRÃO', peso: 8, npess: 99520001 },
    { data: '2025-02-01', tipo: 'CAPSULAS', peso: 10, npess: 99520001 },
    { data: '2025-02-02', hierarq: 'CAFÉ MOÍDO', peso: 2.5, tipo: 'OUTRO', npess: 99520002 },
    { data: '2025-03-01', hierarq: 'CÁPSULAS DE GRÃO', peso: 1, tipo: 'GRÃO', npess: 99520001 },
    { data: '2025-04-01', hierarq: 'MÁQUINAS', peso: 40, volume: 2, qtdBonifi: 1, qtdDoacao: 0, unidadeQty: 'UN', npess: 99520018 },
    { data: '2025-05-01', hierarq: 'VINHO', peso: 12, unidadePeso: 'KG', volume: 12, unidadeQty: 'KG', npess: 99520001 },
    { data: '2025-05-02', hierarq: 'VINHO', peso: 9, volume: 6, unidadeQty: 'L', npess: 99530003 },
    { data: '2025-06-01', tipo: 'OUTRO', peso: 9, npess: 99520001 },
    { data: '2025-06-02', hierarq: 'ENCAPSULADO', peso: 4, tipo: 'CAPSULAS', npess: 99520001 },
    { data: '2026-09-10', tipo: 'GRÃO', peso: 3, npess: 99520001 },
    { data: '2026-10-10', tipo: 'GRÃO', peso: 999, npess: 99520001 },
    { data: '2025-07-01', tipo: 'GRÃO', peso: 1.5, npess: 99530001 },
  ]);
  assert.equal(ag.ignoradas, 1);
  perto(fam(ag, '2025-01', 'dfb_lojas', 'grao'), 8);
  assert.equal(fam(ag, '2025-01', 'dfb_lojas', 'capsulas'), 0);
  perto(fam(ag, '2025-02', 'dfb_lojas', 'capsulas'), 10);
  perto(fam(ag, '2025-02', 'dfb_rest', 'moido'), 2.5);
  assert.equal(fam(ag, '2025-02', 'dfb_rest', 'grao'), 0);
  perto(fam(ag, '2025-03', 'dfb_lojas', 'capsulas'), 1);
  assert.equal(fam(ag, '2025-03', 'dfb_lojas', 'grao'), 0);
  perto(fam(ag, '2025-04', 'dfb_ret_mod', 'maquina'), 3);
  assert.equal(fam(ag, '2025-04', 'dfb_ret_mod', 'grao'), 0);
  perto(fam(ag, '2025-05', 'dfb_lojas', 'vinho'), 12);
  assert.equal(ag.meses['2025-05'].fora.vinhoSemLitro, 0);
  perto(fam(ag, '2025-05', 'qb_rest', 'vinho'), 9);
  assert.equal(fam(ag, '2025-06', 'dfb_lojas', 'grao'), 0);
  perto(ag.meses['2025-06'].fora.kg, 13);
  perto(fam(ag, '2026-09', 'dfb_lojas', 'grao'), 3);
  perto(fam(ag, '2026-10', 'dfb_lojas', 'grao'), 999);
  perto(fam(ag, '2025-07', 'qb_ret_mod', 'grao'), 1.5);

  const doc = { celulas: { 'dfb_lojas|grao': { prevOutDez: 5, orcamento: 20 } } };
  const lojas = ctx.vol27Montar(ag, doc, 'dfb_lojas');
  const g = lojas.find(r => r.id === 'grao');
  perto(g.n1, 8);
  perto(g.ytd, 3);
  assert.equal(g.prevOutDez, 5);
  perto(g.total2026, 8);
  perto(g.varPct, (8 - 8) / 8 * 100);
  perto(g.pct27, (20 - 8) / 8 * 100);
  assert.notEqual(g.ytd, 3 + 999);

  const todos = ctx.vol27Montar(ag, doc, 'todos');
  const gt = todos.find(r => r.id === 'grao');
  perto(gt.n1, 8 + 1.5);
  assert.equal(todos.length, 5);
  assert.ok(!todos.some(r => r.id === 'total'));

  const dfb = ctx.vol27Montar(ag, doc, 'dfb');
  const gd = dfb.find(r => r.id === 'grao');
  perto(gd.n1, 8);
  assert.equal(gd.editavel, false);
  const qb = ctx.vol27Montar(ag, doc, 'qb');
  perto(qb.find(r => r.id === 'grao').n1, 1.5);
  assert.equal(qb.find(r => r.id === 'grao').editavel, false);
  assert.equal(g.editavel, true);

  const soPrev = ctx.vol27Total2026(null, false, 30);
  assert.equal(soPrev.tem, true);
  perto(soPrev.valor, 30);
  const vazio = ctx.vol27Total2026(null, false, null);
  assert.equal(vazio.tem, false);
  const ytdSo = ctx.vol27Total2026(3, true, null);
  perto(ytdSo.valor, 3);

  const vistaTodos = ctx.vol27RenderHtml(true, ag, doc, 'todos');
  assert.ok(vistaTodos.includes('Grão (Kg)'));
  assert.ok(vistaTodos.includes('Café Moído (Kg)'));
  assert.ok(vistaTodos.includes('Cápsulas (Kg)'));
  assert.ok(vistaTodos.includes('Máquina (Un)'));
  assert.ok(vistaTodos.includes('Vinho (Kg)'));
  assert.ok(!vistaTodos.includes('data-vol-campo'));
  assert.ok(vistaTodos.includes('Todos os canais'));
  const vistaLojas = ctx.vol27RenderHtml(true, ag, doc, 'dfb_lojas');
  assert.ok(vistaLojas.includes('data-vol-fam="grao" data-vol-campo="prevOutDez"'));
  assert.ok(vistaLojas.includes('data-vol-fam="moido" data-vol-campo="orcamento"'));
  assert.ok(!vistaLojas.includes('data-vol-fam="total"'));
  const vistaEmp = ctx.vol27RenderHtml(true, ag, doc, 'dfb');
  assert.ok(!vistaEmp.includes('data-vol-campo'));
});

check('cópia ISO e dd.mm.aaaa não soma duas vezes; moído não é grão; o grão do fixture fica no kg certo', () => {
  const brutas = [
    { id: 1, cod: '404215', data: '2026-01-15', tipo: 'GRÃO', peso: 10, qty: 10 },
    { id: 2, cod: '404215', data: '15.01.2026', tipo: 'GRÃO', peso: 10, qty: 10 },
    { id: 1, cod: '404215', data: '2026-01-15', tipo: 'GRÃO', peso: 10, qty: 10 },
    { id: 3, cod: '404215', data: '2026-01-15', tipo: 'GRÃO', peso: 4, qty: 4 },
    { id: 4, cod: '404215', data: '2026-02-02', hierarq: 'CAFÉ MOÍDO', tipo: 'OUTRO', peso: 7, qty: 0 },
    { id: 5, cod: '404215', data: '2026-03-01', tipo: 'GRÃO', peso: 150, qty: 150 },
    { id: 6, cod: '404215', data: '2026-03-01', tipo: 'GRÃO', peso: 150, qty: 150 },
    { id: 7, cod: '404215', data: '2026-04-01', tipo: 'GRÃO', peso: 20, qty: 20 },
    { id: 8, cod: '404215', data: '2026-04-02', tipo: 'GRÃO', peso: -5, qty: -5 },
    { id: 9, cod: '1', data: '2026-05-01', hierarq: 'CÁPSULAS DE GRÃO', tipo: 'GRÃO', peso: 1, npess: 99520003 },
  ];
  const linhas = ctx.vol27SemCopiaDeData(brutas);
  assert.equal(linhas.length, 8);
  assert.equal(ctx.vol27DiaISO('15.01.2026'), '2026-01-15');
  assert.equal(ctx.vol27DiaISO('2026-01-15'), '2026-01-15');
  const comCanal = linhas.map(r => Object.assign({ npess: 99520003 }, r));
  const ag = ctx.vol27AgregarLinhas(comCanal);
  perto(fam(ag, '2026-01', 'dfb_dist_reg', 'grao'), 14);
  perto(fam(ag, '2026-02', 'dfb_dist_reg', 'moido'), 7);
  assert.equal(fam(ag, '2026-02', 'dfb_dist_reg', 'grao'), 0);
  perto(fam(ag, '2026-03', 'dfb_dist_reg', 'grao'), 300);
  perto(fam(ag, '2026-04', 'dfb_dist_reg', 'grao'), 15);
  assert.equal(fam(ag, '2026-05', 'dfb_dist_reg', 'grao'), 0);
  perto(fam(ag, '2026-05', 'dfb_dist_reg', 'capsulas'), 1);
  const ytd = ctx.vol27Somar(ag, ctx.orc27PeriodoYtd(), ['dfb_dist_reg'], 'grao', false);
  perto(ytd.valor, 329);
  assert.notEqual(ytd.valor, 329 + 10);
});

check('previsão vazia fica vazia; um clear não dispara duas vezes; empresa não se edita', () => {
  let doc = { celulas: {} };
  let r = ctx.vol27AplicarEdicao(doc, 'dfb_lojas', 'grao', 'prevOutDez', null, '2026-10-14T01:00:00.000Z');
  assert.equal(r.changed, false);
  r = ctx.vol27AplicarEdicao(doc, 'dfb_lojas', 'grao', 'orcamento', 40, '2026-10-14T01:00:00.000Z');
  assert.equal(r.changed, true);
  doc = r.doc;
  r = ctx.vol27AplicarEdicao(doc, 'dfb_lojas', 'grao', 'prevOutDez', 5, '2026-10-14T01:00:00.000Z');
  doc = r.doc;
  assert.equal(doc.celulas['dfb_lojas|grao'].prevOutDez, 5);
  assert.equal(doc.celulas['dfb_lojas|grao'].orcamento, 40);
  r = ctx.vol27AplicarEdicao(doc, 'dfb_lojas', 'grao', 'prevOutDez', null, '2026-10-14T02:00:00.000Z');
  assert.equal(r.changed, true);
  assert.equal(r.doc.celulas['dfb_lojas|grao'].prevOutDez, null);
  assert.equal(r.doc.celulas['dfb_lojas|grao'].orcamento, 40);
  const ts = r.doc.celulas['dfb_lojas|grao'].cellTs.prevOutDez;
  doc = r.doc;
  r = ctx.vol27AplicarEdicao(doc, 'dfb_lojas', 'grao', 'prevOutDez', null, '2026-10-14T03:00:00.000Z');
  assert.equal(r.changed, false);
  assert.equal(doc.celulas['dfb_lojas|grao'].cellTs.prevOutDez, ts);
  r = ctx.vol27AplicarEdicao(doc, 'dfb', 'grao', 'orcamento', 9, '2026-10-14T04:00:00.000Z');
  assert.equal(r.changed, false);
  r = ctx.vol27AplicarEdicao(doc, 'total', 'grao', 'orcamento', 9, '2026-10-14T04:00:00.000Z');
  assert.equal(r.changed, false);
  assert.equal(ctx.orc27EntradaPronta('').valor, null);
  assert.equal(ctx.orc27EntradaPronta('-').ok, false);

  const base = { meses: { '2025-01': { canais: { dfb_lojas: { grao: 1 } } } }, fonte: 'vendas-cloud' };
  const excel = { meses: { '2026-09': { canais: { dfb_lojas: { moido: 4 } } } } };
  const fundido = ctx.vol27FundirMeses(base, excel, ['2026-09']);
  perto(fundido.meses['2025-01'].canais.dfb_lojas.grao, 1);
  perto(fundido.meses['2026-09'].canais.dfb_lojas.moido, 4);
});

if (process.exitCode) {
  console.error('test-orcamento-2027-volume: falhou');
  process.exit(process.exitCode);
}
console.log('test-orcamento-2027-volume: ok');
