#!/usr/bin/env node
/**
 * Orçamento 2027 · Volume.
 * Orç Valor é o antigo submenu Canais. Volume tem cinco famílias.
 * Cápsulas = coluna AA / 0,005. Grão, moído e vinho = AA sem conversão. Máquina = M+U+Y.
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

const volStore = new Map();
const ctx = {
  console, Math, Number, String, Date, Object, Array, JSON, parseInt, isNaN,
  localStorage: {
    getItem(k) { return volStore.has(k) ? volStore.get(k) : null; },
    setItem(k, v) { volStore.set(k, String(v)); },
    removeItem(k) { volStore.delete(k); },
  },
};
vm.createContext(ctx);

const consts = [
  'PV_SEED_AGOSTO_2026',
  'PV_MAPA_CANAL_VENDA',
  'PV_INST_BALCAO_CODS',
  'PV_INST_HORECA_CODS',
  'PV_INST_BALCAO_NOMES',
  'PV_INST_HORECA_NOMES',
  'VOL27_CAPSULA_KG',
  'VOL27_PRECO_MESES',
  'VOL27_PRECO_ROTULO',
  'VOL27_FAMILIAS',
  'VOL27_ROTULOS',
  'VOL27_DEBOUNCE_MS',
  'VOL27_CLOUD_PATH',
  'VOL27_LS_KEY',
  'VOL27_FILTRO_LS',
  'ORC27_CLOUD_PATH',
];
for (const name of consts) vm.runInContext(extractConst(html, name), ctx);

const fns = [
  'normalizeVendaCod',
  'npessEmpresaGn',
  'npessDeCelulaExcel',
  'npessVendaIgnorado',
  'codClienteVendaIgnorado',
  'codClienteLojasOnlineBr',
  'codClienteLojasOnlineAmazon',
  'codClienteDistRetalho',
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
  'orc27IdFolha',
  'orc27ValorManual',
  'orc27VarPct',
  'orc27Pct27',
  'orc27PickCampo',
  'orc27EntradaPronta',
  'orc27FmtPct',
  'orc27FmtRs',
  'orc27Esc',
  'orc27CanalUnicoVolume',
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
  'vol27PrecoCelulaEntra',
  'vol27AcumularPreco',
  'vol27RotuloPreco',
  'vol27PrecoMedio',
  'vol27Simulacao',
  'vol27OrcValorDoCanal',
  'vol27Centavos',
  'vol27SomaSimulacao',
  'vol27OrcValorSelecao',
  'vol27TextoComparacao',
  'vol27RodapeHtml',
  'vol27CanalIgual441908',
  'vol27AgregadoSemCliente441908',
  'vol27AgregadoComClientesDistRetalho',
  'vol27FundirMeses',
  'vol27CanaisDoFiltro',
  'vol27FiltroFolha',
  'vol27FiltroTodos',
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
  'vol27TemMesHistorico',
  'vol27NotaFora',
  'vol27OpcoesFiltro',
  'vol27NomesCanal',
  'vol27NomeEmpresa',
  'vol27CurtoEmpresa',
  'vol27FolhasEmpresa',
  'vol27GruposFiltro',
  'vol27FiltroValido',
  'vol27LerFiltro',
  'vol27FiltroActual',
  'vol27EscolhaDe',
  'vol27GravarFiltro',
  'vol27Repintar',
  'vol27OnFiltroCanal',
  'vol27TirarCanal',
  'vol27LimparFiltro',
  'vol27RotuloChip',
  'vol27FiltroHtml',
  'vol27CanalEscrita',
  'vol27CanalDoEl',
  'orc27SubNavHtml',
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
    'Cápsulas (Un)',
    'Máquina (Un)',
    'Vinho (L)',
  ]);
  assert.equal(vm.runInContext('VOL27_CAPSULA_KG', ctx), 0.005);
  assert.equal(vm.runInContext('VOL27_DEBOUNCE_MS', ctx), 1000);
  assert.equal(vm.runInContext('VOL27_CLOUD_PATH', ctx), 'previsao/orcamento_2027_volume.json');
  assert.ok(!String(vm.runInContext('VOL27_CLOUD_PATH', ctx)).includes('mapas_v3'));
  assert.equal(vm.runInContext('ORC27_CLOUD_PATH', ctx), 'previsao/orcamento_2027_canais.json');
  assert.ok(sw.includes('v2026-10-22-pwa-instalar'));
  assert.ok(!sw.includes('v2026-10-16-ignorar-441908'));
  assert.ok(!sw.includes('v2026-10-14-volume-formulas'));
  assert.ok(html.includes('v2026-10-22-pwa-instalar'));
  assert.ok(!html.includes('v2026-10-16-ignorar-441908'));
  assert.ok(!html.includes('v2026-10-14-volume-formulas'));
  assert.ok(extractFn(html, 'vol27Medida').includes('/ VOL27_CAPSULA_KG'));
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

check('cápsulas = AA/0,005; grão e moído ficam em AA; máquina é M+U+Y e não AA', () => {
  const cap = ctx.vol27Medida({ tipo: 'CAPSULAS', peso: 10, qty: Math.round(10 / 0.0055), volume: 4, qtdBonifi: 1, qtdDoacao: 1 });
  assert.equal(cap.familia, 'capsulas');
  perto(cap.medida, 10 / 0.005);
  assert.notEqual(cap.medida, 10);
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
  perto(capAa.medida, 8000);
  assert.equal(capAa.medida, 40 / 0.005);
  assert.notEqual(capAa.medida, 40);
  assert.notEqual(capAa.medida, 10);
  assert.notEqual(capAa.medida, 8);

  const ambos = ctx.vol27Medida({ hierarq: 'CÁPSULAS DE GRÃO', peso: 1, tipo: 'GRÃO' });
  assert.equal(ambos.familia, 'capsulas');
  perto(ambos.medida, 1 / 0.005);
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
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520005, cod: '441908' }), '');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99530002, cod: '0441908' }), '');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520005, cod: '430787' }), 'dfb_inst_balcao');
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
  perto(fam(ag, '2025-02', 'dfb_lojas', 'capsulas'), 10 / 0.005);
  perto(fam(ag, '2025-02', 'dfb_rest', 'moido'), 2.5);
  assert.equal(fam(ag, '2025-02', 'dfb_rest', 'grao'), 0);
  perto(fam(ag, '2025-03', 'dfb_lojas', 'capsulas'), 1 / 0.005);
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
  assert.ok(vistaTodos.includes('Cápsulas (Un)'));
  assert.ok(vistaTodos.includes('Máquina (Un)'));
  assert.ok(vistaTodos.includes('Vinho (L)'));
  assert.ok(!vistaTodos.includes('data-vol-campo'));
  assert.ok(vistaTodos.includes('Todos os canais'));
  const vistaLojas = ctx.vol27RenderHtml(true, ag, doc, 'dfb_lojas');
  assert.ok(vistaLojas.includes('data-vol-fam="grao" data-vol-campo="prevOutDez"'));
  assert.ok(vistaLojas.includes('data-vol-fam="moido" data-vol-campo="orcamento"'));
  assert.ok(!vistaLojas.includes('data-vol-fam="total"'));
  const vistaEmp = ctx.vol27RenderHtml(true, ag, doc, 'dfb');
  assert.ok(!vistaEmp.includes('data-vol-campo'));
});

check('cliente 441908 sai do volume na DFB e na Q Brasil; outro cliente no mesmo vendedor fica', () => {
  const ag = ctx.vol27AgregarLinhas([
    { data: '2026-10-09', tipo: 'GRÃO', peso: 11.5, npess: 99520005, cod: '441908' },
    { data: '2026-10-09', tipo: 'CAPSULAS', peso: 23.925, npess: 99530002, cod: '0441908' },
    { data: '2026-10-09', hierarq: 'CAFÉ MOÍDO', peso: 4, tipo: 'OUTRO', npess: 99520005, cod: '430787' },
    { data: '2026-10-09', tipo: 'GRÃO', peso: 2, npess: 99530002, cod: 200 },
    { data: '2026-03-26', tipo: 'OUTRO', peso: 0.75, npess: 99520011, cod: 441908 },
  ]);
  assert.equal(ag.ignoradas, 3);
  assert.equal(ag.meses['2026-10'].canais.dfb_inst_balcao.grao, undefined);
  perto(fam(ag, '2026-10', 'dfb_inst_balcao', 'moido'), 4);
  perto(fam(ag, '2026-10', 'qb_dist_reg', 'grao'), 2);
  assert.equal(ag.meses['2026-03'], undefined);
  const gravado = {
    meses: {
      '2026-10': {
        canais: {
          dfb_inst_balcao: { grao: 16.5, moido: 0.5, vinho: 19.5, maquina: 3, capsulas: 5445 },
          qb_dist_reg: { moido: 4, maquina: 15, capsulas: 2112 },
          dfb_lojas: { grao: 100 },
        },
      },
    },
  };
  const limpo = ctx.vol27AgregadoSemCliente441908(gravado);
  assert.equal(limpo.meses['2026-10'].canais.dfb_inst_balcao, undefined);
  assert.equal(limpo.meses['2026-10'].canais.qb_dist_reg, undefined);
  assert.equal(limpo.meses['2026-10'].canais.dfb_lojas.grao, 100);
  const outra = ctx.vol27AgregadoSemCliente441908(limpo);
  assert.equal(outra.meses['2026-10'].canais.dfb_lojas.grao, 100);
  assert.equal(outra.meses['2026-10'].canais.dfb_inst_balcao, undefined);
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
  perto(fam(ag, '2026-05', 'dfb_dist_reg', 'capsulas'), 1 / 0.005);
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

check('seed do Excel: AA, cápsulas ÷ 0,005, máquina M+U+Y, YTD só até Set', () => {
  const seedCtx = {};
  vm.createContext(seedCtx);
  vm.runInContext(fs.readFileSync(path.join(root, 'vendas-volume-familias.js'), 'utf8'), seedCtx);
  const seed = seedCtx.VOL27_SEED_EXCEL;
  assert.equal(seed.fonte, 'excel-aa');
  assert.equal(seed.excelAa, '2026-10-16-preco');
  assert.equal(seed.ultimaData, '2026-09-30');
  assert.ok(seed.meses['2025-01'] && seed.meses['2026-09']);
  assert.ok(!seed.meses['2026-10']);
  assert.equal(seed.precos.rotulo, 'Ago–Out');
  assert.deepEqual(seed.precos.meses, ['2026-08', '2026-09', '2026-10']);
  assert.equal(seed.precos.porMes['2026-10'].qb_dist_reg, undefined);
  const ytd = ctx.orc27PeriodoYtd();
  assert.equal(ytd[0], '2026-01');
  assert.equal(ytd[ytd.length - 1], '2026-09');
  assert.ok(ytd.indexOf('2026-10') < 0);
  const dist = ['dfb_dist_reg', 'qb_dist_reg'];
  const n1 = ctx.orc27PeriodoN1();
  const somar = (periodo, fam, canais) => ctx.vol27Somar(seed, periodo, canais, fam, false);
  perto(somar(n1, 'moido', dist).valor, 6107.009);
  perto(somar(ytd, 'moido', dist).valor, 3326.89);
  perto(somar(n1, 'grao', dist).valor, 106338.5);
  perto(somar(ytd, 'grao', dist).valor, 61534.5);
  perto(somar(n1, 'capsulas', dist).valor, 1810787);
  perto(somar(ytd, 'capsulas', dist).valor, 969575);
  perto(somar(n1, 'maquina', dist).valor, 3649);
  perto(somar(ytd, 'maquina', dist).valor, 2449);
  perto(somar(n1, 'vinho', dist).valor, 4832.25);
  perto(somar(ytd, 'vinho', dist).valor, 2854.5);
  assert.equal(somar(n1, 'moido', ['dfb_dist_reg']).valor, somar(n1, 'moido', dist).valor);
  assert.equal(somar(n1, 'moido', ['qb_dist_reg']).tem, false);
  assert.equal(somar(ytd, 'moido', ['qb_dist_reg']).tem, false);
  assert.ok(html.includes('vendas-volume-familias.js'));
  assert.ok(extractFn(html, 'vol27Medida').includes('qtdBonifi'));
  assert.ok(extractFn(html, 'vol27Preparar').includes('vol27SeedExcelAa'));
  assert.ok(extractFn(html, 'vol27Preparar').includes('vol27ConstruirDeVendasCloud'));
  const vista = ctx.vol27RenderHtml(false, seed, { celulas: {} }, 'dfb_dist_reg');
  assert.ok(vista.includes('6.107'));
  assert.ok(vista.includes('3.326,9'));
  assert.ok(vista.includes('1.810.787'));
  assert.ok(vista.includes('969.575'));
  assert.ok(vista.includes('Ficheiro até 30/09/2026'));
  assert.equal((vista.match(/data-vol-fam=/g) || []).length, 5);
  assert.ok(vista.includes('data-vol-rodape="total"'));
  assert.ok(vista.includes('>Total</td>'));
  const rodapeSeed = vista.slice(vista.indexOf('data-vol-rodape="total"'));
  assert.ok(rodapeSeed.includes('class="vol27-rodape-vazio"'));
  assert.ok(!rodapeSeed.split('vol27-total-sim')[0].includes('6.107'));
});

check('filtro multi-canal: dois canais somam o produto, um edita, vários não, Limpar mostra todos e a escolha fica no browser', () => {
  const ag = ctx.vol27AgregarLinhas([
    { data: '2025-01-15', tipo: 'GRÃO', peso: 8, npess: 99520001 },
    { data: '2025-01-20', tipo: 'GRÃO', peso: 1.5, npess: 99530001 },
    { data: '2025-02-01', tipo: 'CAPSULAS', peso: 10, npess: 99520002 },
    { data: '2026-03-01', tipo: 'GRÃO', peso: 3, npess: 99520001 },
  ]);
  const doc = {
    version: 1,
    celulas: {
      'dfb_lojas|grao': { prevOutDez: 5, orcamento: 20 },
      'qb_ret_mod|grao': { prevOutDez: 2, orcamento: 4 },
      'dfb_rest|capsulas': { prevOutDez: 7, orcamento: 9 },
    },
  };
  ctx._vol27Doc = doc;
  const antes = JSON.stringify(doc);

  const dois = ctx.vol27Montar(ag, doc, ['qb_ret_mod', 'dfb_lojas']);
  assert.equal(dois.length, 5);
  assert.ok(!dois.some(r => r.id === 'total'));
  const g = dois.find(r => r.id === 'grao');
  perto(g.n1, 9.5);
  perto(g.ytd, 3);
  assert.equal(g.prevOutDez, 7);
  assert.equal(g.orcamento, 24);
  assert.equal(g.editavel, false);
  const capDois = dois.find(r => r.id === 'capsulas');
  assert.equal(capDois.n1Tem, false);
  assert.equal(capDois.prevOutDez, null);
  assert.equal(JSON.stringify(doc), antes);

  const um = ctx.vol27Montar(ag, doc, ['dfb_lojas']);
  assert.equal(um.find(r => r.id === 'grao').editavel, true);
  perto(um.find(r => r.id === 'grao').n1, 8);
  assert.equal(um.find(r => r.id === 'grao').prevOutDez, 5);
  assert.equal(um.find(r => r.id === 'grao').orcamento, 20);

  const vistaUm = ctx.vol27RenderHtml(true, ag, doc, ['dfb_lojas']);
  assert.ok(vistaUm.includes('id="vol27-filtro"'));
  assert.ok(vistaUm.includes('>Canal</label>'));
  assert.ok(vistaUm.includes('id="vol27-filtro-limpar"'));
  assert.ok(vistaUm.includes('>Limpar</button>'));
  assert.ok(vistaUm.includes('>Delta Foods Brasil</legend>'));
  assert.ok(vistaUm.includes('>Q Brasil</legend>'));
  assert.ok(vistaUm.includes('Lojas online'));
  assert.ok(vistaUm.includes('Distribuidores regionais'));
  assert.ok(vistaUm.includes('Restauração'));
  assert.ok(vistaUm.includes('Distribuidores de retalho'));
  assert.ok(vistaUm.includes('Retalho moderno'));
  assert.ok(vistaUm.includes('Site próprio'));
  assert.ok(vistaUm.includes('Institucional Balcão'));
  assert.ok(vistaUm.includes('Institucional Horeca'));
  assert.ok(vistaUm.includes('A mostrar:'));
  assert.ok(vistaUm.includes('Delta · Lojas online'));
  assert.ok(vistaUm.includes('um só canal'));
  assert.ok(vistaUm.includes('data-vol-canal="dfb_lojas" checked'));
  assert.ok(!vistaUm.includes('data-vol-canal="dfb_rest" checked'));
  assert.ok(vistaUm.includes('data-vol-fam="grao" data-vol-campo="prevOutDez"'));
  assert.ok(vistaUm.includes('class="form-input vol27-input"'));
  assert.equal(JSON.stringify(doc), antes);

  const vistaVarios = ctx.vol27RenderHtml(true, ag, doc, ['dfb_lojas', 'qb_ret_mod']);
  assert.ok(!vistaVarios.includes('data-vol-campo'));
  assert.ok(!vistaVarios.includes('vol27-input'));
  assert.ok(vistaVarios.includes('data-vol-canal="dfb_lojas" checked'));
  assert.ok(vistaVarios.includes('data-vol-canal="qb_ret_mod" checked'));
  assert.ok(!vistaVarios.includes('data-vol-canal="dfb_rest" checked'));
  assert.ok(vistaVarios.includes('9,5'));
  assert.equal((vistaVarios.match(/data-vol-fam=/g) || []).length, 5);
  assert.equal(vistaVarios.split('<tr ').length - 1, 7);
  assert.ok(vistaVarios.includes('data-vol-rodape="total"'));
  assert.ok(vistaVarios.includes('data-vol-rodape="mapa"'));
  assert.ok(vistaVarios.includes('>Orç. 2027 no mapa de valor</td>'));
  const cmpVazio = vistaVarios.split('id="vol27-compara"')[1] || '';
  assert.ok(cmpVazio.slice(0, 90).includes('display:none'));
  assert.equal(JSON.stringify(doc), antes);

  const chave = vm.runInContext('VOL27_FILTRO_LS', ctx);
  assert.equal(chave, 'dfb_orcamento_2027_volume_filtro_v1');
  assert.notEqual(chave, 'dfb_orcamento_2027_sazonalidade_filtro_v1');
  assert.notEqual(chave, vm.runInContext('VOL27_LS_KEY', ctx));
  assert.ok(!extractFn(html, 'vol27EnviarCorpo').includes('VOL27_FILTRO_LS'));
  assert.ok(!extractFn(html, 'vol27Flush').includes('VOL27_FILTRO_LS'));
  assert.ok(!extractFn(html, 'vol27GravarFiltro').includes('VOL27_LS_KEY'));
  assert.ok(!extractFn(html, 'vol27GravarFiltro').includes('_vol27Dirty'));
  assert.ok(!extractFn(html, 'vol27GravarFiltro').includes('_vol27Doc'));

  ctx._vol27Filtro = null;
  ctx.vol27GravarFiltro(['qb_ret_mod', 'dfb_lojas']);
  assert.deepEqual(ctx._vol27Filtro, ['dfb_lojas', 'qb_ret_mod']);
  assert.equal(JSON.stringify(ctx._vol27Doc), antes);
  ctx._vol27Filtro = null;
  assert.deepEqual(ctx.vol27LerFiltro(), ['dfb_lojas', 'qb_ret_mod']);
  assert.deepEqual(ctx.vol27FiltroActual(), ['dfb_lojas', 'qb_ret_mod']);
  assert.deepEqual(JSON.parse(volStore.get(chave)), ['dfb_lojas', 'qb_ret_mod']);
  assert.equal(volStore.has('dfb_orcamento_2027_sazonalidade_filtro_v1'), false);

  ctx.vol27LimparFiltro();
  assert.deepEqual(ctx._vol27Filtro, []);
  assert.equal(volStore.has(chave), false);
  const limpo = ctx.vol27RenderHtml(true, ag, doc, []);
  assert.ok(limpo.includes('Todos os canais'));
  assert.ok(!limpo.includes('data-vol-campo'));
  assert.ok(!limpo.includes('vol27-input'));
  assert.ok(!limpo.includes('data-vol-canal="dfb_lojas" checked'));
  assert.ok(limpo.includes('>Q Brasil</legend>'));
  const todas = ctx.vol27Montar(ag, doc, []);
  assert.equal(todas.length, 5);
  perto(todas.find(r => r.id === 'grao').n1, 9.5);
  assert.equal(todas.find(r => r.id === 'grao').editavel, false);
  assert.equal(todas.find(r => r.id === 'grao').prevOutDez, 7);
  assert.equal(todas.find(r => r.id === 'capsulas').prevOutDez, 7);
  perto(todas.find(r => r.id === 'capsulas').n1, 10 / 0.005);
  assert.equal(JSON.stringify(doc), antes);
});

check('preço médio Ago–Out = Fatur. ÷ volume; mês com volume 0 sai; simulação = volume 2027 × preço; sem preço fica —; 441908 não entra na faturação', () => {
  assert.deepEqual(vm.runInContext('VOL27_PRECO_MESES', ctx), ['2026-08', '2026-09', '2026-10']);
  assert.equal(vm.runInContext('VOL27_PRECO_ROTULO', ctx), 'Ago–Out');
  const acum = ctx.vol27AcumularPreco([
    { data: '2026-08-02', hierarq: 'CAFÉ EM GRÃO', peso: 10, fatur: 100, npess: 99520001, cod: '100' },
    { data: '02.08.2026', hierarq: 'CAFÉ EM GRÃO', peso: 10, fatur: 100, npess: 99520001, cod: '100' },
    { data: '2026-08-03', hierarq: 'CAFÉ EM GRÃO', peso: 4, fatur: 80, npess: 99520001, cod: '441908' },
    { data: '2026-08-03', hierarq: 'CAFÉ EM GRÃO', peso: 1, fatur: 999, npess: 99520099, cod: '200' },
    { data: '2026-09-01', hierarq: 'CAFÉ EM GRÃO', peso: 0, fatur: 50, npess: 99520001, cod: '100' },
    { data: '2026-10-04', hierarq: 'CAFÉ EM GRÃO', peso: 5, fatur: 40, npess: 99520001, cod: '100' },
    { data: '2026-08-01', hierarq: 'CAFÉ EM GRÃO', peso: 2, fatur: 30, npess: 99520002, cod: '300' },
  ]);
  const graoAgo = acum.porMes['2026-08'].dfb_lojas.grao;
  perto(graoAgo.f, 100);
  perto(graoAgo.v, 10);
  assert.ok(!acum.porMes['2026-08'].dfb_lojas || acum.porMes['2026-08'].dfb_lojas.grao.f !== 180);
  const set = acum.porMes['2026-09'].dfb_lojas.grao;
  perto(set.f, 50);
  assert.equal(set.v, 0);
  assert.equal(ctx.vol27PrecoCelulaEntra(set), false);
  const ag = { meses: {}, precos: acum };
  const preco = ctx.vol27PrecoMedio(ag, 'dfb_lojas', 'grao');
  assert.equal(preco.tem, true);
  perto(preco.fatur, 140);
  perto(preco.volume, 15);
  perto(preco.preco, 140 / 15);
  assert.notEqual(preco.fatur, 140 + 80);
  assert.notEqual(preco.fatur, 140 + 50);
  const doc = { celulas: { 'dfb_lojas|grao': { orcamento: 3 } } };
  const linhas = ctx.vol27Montar(ag, doc, 'dfb_lojas');
  const g = linhas.find(r => r.id === 'grao');
  perto(g.preco, 140 / 15);
  perto(g.simulacao, 3 * (140 / 15));
  assert.equal(g.simulacaoTem, true);
  const moido = linhas.find(r => r.id === 'moido');
  assert.equal(moido.precoTem, false);
  assert.equal(moido.preco, null);
  assert.equal(moido.simulacao, null);
  assert.equal(ctx.vol27Simulacao(null, 10), null);
  assert.equal(ctx.vol27Simulacao(4, null), null);
  assert.equal(ctx.vol27Simulacao(0, 10), 0);
  const vista = ctx.vol27RenderHtml(false, ag, doc, 'dfb_lojas');
  assert.ok(vista.includes('Preço médio Ago–Out'));
  assert.ok(vista.includes('Simulação valor 27'));
  assert.ok(vista.includes('vol27-preco'));
  assert.ok(vista.includes('vol27-sim'));
  assert.ok(vista.includes('>R$'));
  const semPreco = vista.split('data-vol-fam="moido"')[1] || '';
  assert.ok(semPreco.includes('—'));
  assert.equal(g.simulacao2026, null);
  assert.equal(g.simulacao2026Tem, false);
  ctx._orc27Doc = { canais: { dfb_lojas: { orcamento: 12823215, prevOutDez: 900000 } } };
  const somaLojas = ctx.vol27SomaSimulacao(linhas);
  assert.equal(somaLojas.tem, true);
  perto(somaLojas.valor, 3 * (140 / 15));
  assert.equal(ctx.vol27OrcValorSelecao('dfb_lojas').valor, 12823215);
  assert.equal(ctx.vol27OrcValorSelecao('dfb_lojas', 'prevOutDez').valor, 900000);
  const vistaCanal = ctx.vol27RenderHtml(false, ag, doc, 'dfb_lojas');
  assert.ok(vistaCanal.includes('Simulação valor 2026'));
  assert.ok(vistaCanal.includes('data-vol-rodape="total"'));
  assert.ok(vistaCanal.includes('data-vol-rodape="mapa"'));
  assert.ok(vistaCanal.includes('>Total</td>'));
  assert.ok(vistaCanal.includes('>Orç. 2027 no mapa de valor</td>'));
  assert.ok(vistaCanal.includes('id="vol27-total-sim"'));
  assert.ok(vistaCanal.includes('id="vol27-total-sim26"'));
  assert.ok(vistaCanal.includes('id="vol27-orc-mapa"'));
  assert.ok(vistaCanal.includes('id="vol27-mapa-prev"'));
  assert.ok(vistaCanal.includes('id="vol27-compara"'));
  assert.ok(vistaCanal.includes('Diferença:'));
  assert.ok(html.includes('id="vol27-compara"'));
  assert.ok(html.includes('function vol27TextoComparacao'));
  const cmp = ctx.vol27TextoComparacao(linhas, 'dfb_lojas');
  assert.ok(cmp.startsWith('Diferença:'));
  const varios = ctx.vol27RenderHtml(false, ag, doc, ['dfb_lojas', 'dfb_rest']);
  assert.ok(varios.includes('id="vol27-compara"'));
  assert.ok(varios.includes('Diferença:'));
  assert.ok(varios.includes('>Orç. 2027 no mapa de valor</td>'));
  const dois = ctx.vol27PrecoMedio(ag, ['dfb_lojas', 'dfb_rest'], 'grao');
  perto(dois.fatur, 170);
  perto(dois.volume, 17);
  perto(dois.preco, 170 / 17);

  const seedCtx = {};
  vm.createContext(seedCtx);
  vm.runInContext(fs.readFileSync(path.join(root, 'vendas-volume-familias.js'), 'utf8'), seedCtx);
  const seed = seedCtx.VOL27_SEED_EXCEL;
  const lojas = ctx.vol27PrecoMedio(seed, 'dfb_lojas', 'grao');
  perto(lojas.fatur, 297686.13);
  perto(lojas.volume, 3030);
  perto(lojas.preco, 297686.13 / 3030);
  const outMoido = seed.precos.porMes['2026-10'].dfb_dist_ret.moido;
  assert.equal(outMoido.v, 0);
  perto(outMoido.f, -32721.73);
  const dist = ctx.vol27PrecoMedio(seed, 'dfb_dist_ret', 'moido');
  perto(dist.fatur, 208505.09 + 28723.49);
  assert.ok(Math.abs(dist.fatur - (208505.09 + 28723.49 - 32721.73)) > 1);
  assert.equal(ctx.vol27PrecoMedio(seed, 'qb_dist_reg', 'grao').tem, false);
  assert.equal(ctx.vol27PrecoMedio(seed, 'dfb_inst_horeca', 'moido').tem, false);
});

check('simulação 2026 = previsão × preço; total soma só os R$; mapa de valor é a previsão e o orçamento do canal; sem rodapé', () => {
  const ag = {
    meses: {},
    precos: {
      meses: ['2026-08'],
      rotulo: 'Ago–Out',
      porMes: {
        '2026-08': {
          dfb_lojas: {
            grao: { f: 100, v: 10 },
            moido: { f: 40, v: 8 },
            capsulas: { f: 30, v: 6 },
            maquina: { f: 9, v: 0 },
            vinho: { f: 50, v: 5 },
          },
          dfb_rest: {
            grao: { f: 10, v: 2 },
            capsulas: { f: 6, v: 3 },
          },
        },
      },
    },
  };
  function por(ym, canal, fam, qtd) {
    if (!ag.meses[ym]) ag.meses[ym] = { canais: {}, semCanal: {} };
    if (!ag.meses[ym].canais[canal]) ag.meses[ym].canais[canal] = {};
    ag.meses[ym].canais[canal][fam] = qtd;
  }
  por('2025-01', 'dfb_lojas', 'grao', 12);
  por('2026-04', 'dfb_lojas', 'grao', 100);
  por('2025-01', 'dfb_lojas', 'moido', 4);
  por('2025-01', 'dfb_rest', 'grao', 7);
  const doc = {
    celulas: {
      'dfb_lojas|grao': { prevOutDez: 4, orcamento: 2 },
      'dfb_lojas|moido': { prevOutDez: 1, orcamento: 3 },
      'dfb_lojas|capsulas': { orcamento: 4 },
      'dfb_lojas|maquina': { prevOutDez: 8, orcamento: 5 },
      'dfb_lojas|vinho': { prevOutDez: 0, orcamento: 6 },
      'dfb_rest|grao': { prevOutDez: 3, orcamento: 1 },
      'dfb_rest|capsulas': { orcamento: 2 },
    },
  };
  ctx._orc27Doc = {
    canais: {
      dfb_lojas: { prevOutDez: 500000, orcamento: 12823215 },
      dfb_rest: { prevOutDez: 200.45, orcamento: 1000.55 },
      qb_rest: { prevOutDez: 3, orcamento: 20 },
    },
  };
  const linhas = ctx.vol27Montar(ag, doc, 'dfb_lojas');
  assert.equal(linhas.length, 5);
  const sim27 = { grao: 20, moido: 15, capsulas: 20, maquina: null, vinho: 60 };
  const sim26 = { grao: 40, moido: 5, capsulas: null, maquina: null, vinho: 0 };
  let soma27Manual = 0;
  let soma26Manual = 0;
  linhas.forEach(function (row) {
    if (sim27[row.id] == null) assert.equal(row.simulacaoTem, false);
    else {
      perto(row.simulacao, sim27[row.id]);
      soma27Manual += sim27[row.id];
    }
    if (sim26[row.id] == null) assert.equal(row.simulacao2026Tem, false);
    else {
      perto(row.simulacao2026, sim26[row.id]);
      soma26Manual += sim26[row.id];
    }
  });
  const grao = linhas.find(r => r.id === 'grao');
  perto(grao.total2026, 104);
  assert.notEqual(grao.simulacao2026, grao.total2026 * grao.preco);
  perto(grao.simulacao2026, grao.prevOutDez * grao.preco);
  assert.equal(soma27Manual, 115);
  assert.equal(soma26Manual, 45);
  const soma = ctx.vol27SomaSimulacao(linhas);
  const somaPrev = ctx.vol27SomaSimulacao(linhas, 'simulacao2026', 'simulacao2026Tem');
  assert.equal(soma.tem, true);
  perto(soma.valor, 115);
  perto(somaPrev.valor, 45);
  assert.equal(ctx.vol27OrcValorSelecao('dfb_lojas').valor, 12823215);
  assert.equal(ctx.vol27OrcValorSelecao('dfb_lojas', 'prevOutDez').valor, 500000);
  assert.equal(ctx.vol27OrcValorSelecao(['dfb_lojas']).valor, 12823215);
  perto(ctx.vol27OrcValorSelecao(['dfb_lojas', 'dfb_rest']).valor, 12824215.55);
  perto(ctx.vol27OrcValorSelecao(['dfb_lojas', 'dfb_rest'], 'prevOutDez').valor, 500200.45);
  perto(ctx.vol27OrcValorSelecao([]).valor, 12824235.55);
  perto(ctx.vol27OrcValorSelecao([], 'prevOutDez').valor, 500203.45);
  perto(ctx.vol27OrcValorSelecao('todos', 'prevOutDez').valor, 500203.45);

  function celulasDaLinha(html, rodape) {
    const i = html.indexOf('data-vol-rodape="' + rodape + '"');
    assert.ok(i >= 0, rodape);
    const fim = html.indexOf('</tr>', i);
    const trecho = html.slice(i, fim);
    return trecho.split('<td').slice(1);
  }
  function volumeVazio(celulas) {
    assert.equal(celulas.length, 11);
    [1, 2, 3, 5, 6, 7, 8, 9].forEach(function (k) {
      const inner = celulas[k].slice(celulas[k].indexOf('>') + 1);
      assert.ok(inner.startsWith('</td>'), k + ' ' + inner.slice(0, 40));
    });
  }

  const um = ctx.vol27RenderHtml(false, ag, doc, 'dfb_lojas');
  const total = celulasDaLinha(um, 'total');
  const mapa = celulasDaLinha(um, 'mapa');
  volumeVazio(total);
  volumeVazio(mapa);
  assert.ok(total[0].includes('>Total</td>'));
  assert.ok(mapa[0].includes('>Orç. 2027 no mapa de valor</td>'));
  assert.ok(total[4].includes(ctx.orc27FmtRs(45, true)));
  assert.ok(total[10].includes(ctx.orc27FmtRs(115, true)));
  assert.ok(mapa[4].includes(ctx.orc27FmtRs(500000, true)));
  assert.ok(mapa[10].includes(ctx.orc27FmtRs(12823215, true)));
  assert.ok(um.includes('id="vol27-compara"'));
  assert.ok(um.includes('Diferença:'));
  assert.ok(ctx.vol27TextoComparacao(linhas, 'dfb_lojas').startsWith('Diferença:'));
  perto(grao.n1, 12);
  assert.ok(!total[1].includes('12'));
  assert.ok(!total[5].includes('104'));

  const doisHtml = ctx.vol27RenderHtml(false, ag, doc, ['dfb_lojas', 'dfb_rest']);
  const mapaDois = celulasDaLinha(doisHtml, 'mapa');
  const totalDois = celulasDaLinha(doisHtml, 'total');
  volumeVazio(totalDois);
  volumeVazio(mapaDois);
  assert.ok(mapaDois[4].includes(ctx.orc27FmtRs(500200.45, true)));
  assert.ok(mapaDois[10].includes(ctx.orc27FmtRs(12824215.55, true)));
  const linhasDois = ctx.vol27Montar(ag, doc, ['dfb_lojas', 'dfb_rest']);
  const somaDois = ctx.vol27SomaSimulacao(linhasDois);
  const soma26Dois = ctx.vol27SomaSimulacao(linhasDois, 'simulacao2026', 'simulacao2026Tem');
  assert.ok(totalDois[10].includes(ctx.orc27FmtRs(somaDois.valor, true)));
  assert.ok(totalDois[4].includes(ctx.orc27FmtRs(soma26Dois.valor, true)));
  perto(linhasDois.find(r => r.id === 'grao').n1, 19);
  assert.ok(totalDois[1].startsWith(' class="vol27-rodape-vazio"'));
  assert.ok(doisHtml.includes('Diferença:'));

  const todosHtml = ctx.vol27RenderHtml(false, ag, doc, []);
  const mapaTodos = celulasDaLinha(todosHtml, 'mapa');
  volumeVazio(celulasDaLinha(todosHtml, 'total'));
  volumeVazio(mapaTodos);
  assert.ok(mapaTodos[4].includes(ctx.orc27FmtRs(500203.45, true)));
  assert.ok(mapaTodos[10].includes(ctx.orc27FmtRs(12824235.55, true)));
  assert.ok(todosHtml.includes('Diferença:'));
});

check('410730 e 423557: volume de Retalho moderno passa para Distribuidores de retalho', () => {
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520018, cod: '410730' }), 'dfb_dist_ret');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520018, cod: '423557' }), 'dfb_dist_ret');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520018, cod: '0410730' }), 'dfb_dist_ret');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520018, cod: '411550' }), 'dfb_ret_mod');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520004, cod: '410730' }), 'dfb_dist_ret');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520009, cod: 'BR00002' }), 'dfb_lojas');
  assert.equal(ctx.vol27CanalIdDeLinha({ npess: 99520005, cod: '441908' }), '');
  assert.ok(extractFn(html, 'vol27Preparar').includes('vol27AgregadoComClientesDistRetalho'));

  const ag = ctx.vol27AgregarLinhas([
    { data: '2025-01-15', hierarq: 'GRAO', peso: 4.5, npess: 99520018, cod: '423557' },
    { data: '2025-01-16', hierarq: 'GRAO', peso: 3, npess: 99520018, cod: '411550' },
  ]);
  perto(fam(ag, '2025-01', 'dfb_dist_ret', 'grao'), 4.5);
  perto(fam(ag, '2025-01', 'dfb_ret_mod', 'grao'), 3);

  const seedCtx = {};
  vm.createContext(seedCtx);
  vm.runInContext(fs.readFileSync(path.join(root, 'vendas-volume-familias.js'), 'utf8'), seedCtx);
  const seed = seedCtx.VOL27_SEED_EXCEL;
  assert.deepEqual(seed.meses['2025-01'].canais.dfb_ret_mod, {
    vinho: 27, grao: 3, maquina: 3, capsulas: 91036, moido: -28,
  });
  assert.deepEqual(seed.meses['2025-01'].canais.dfb_dist_ret, {
    capsulas: 100408, grao: 4.5, maquina: 623, vinho: 67.5,
  });
  assert.deepEqual(seed.meses['2025-02'].canais.dfb_ret_mod, {
    moido: 56, vinho: 229.5, capsulas: 86031, grao: 21.5,
  });
  assert.equal(seed.meses['2025-02'].canais.dfb_ret_mod.maquina, undefined);
  assert.deepEqual(seed.meses['2025-02'].canais.dfb_dist_ret, {
    grao: 120, capsulas: 26312, maquina: 288, moido: -8,
  });
  assert.equal(seed.meses['2025-02'].canais.dfb_lojas.grao, 243);
  assert.deepEqual(seed.meses['2025-03'].canais.dfb_ret_mod, {
    moido: 1250, capsulas: 26994, grao: 732.5, maquina: 2,
  });
  assert.equal(seed.precos.porMes['2026-10'].dfb_ret_mod.moido.f, 16999.56);
  assert.equal(seed.precos.porMes['2026-10'].dfb_ret_mod.moido.v, 304);
  assert.ok(!seed.meses['2026-10']);

  const antigo = {
    meses: {
      '2025-01': { canais: {
        dfb_ret_mod: { vinho: 94.5, grao: 7.5, maquina: 626, capsulas: 191444, moido: -28 },
        dfb_lojas: { grao: 1 },
      } },
      '2025-02': { canais: {
        dfb_ret_mod: { moido: 48, vinho: 229.5, capsulas: 86031, grao: 66.5, maquina: 230 },
        dfb_dist_ret: { grao: 75, capsulas: 26312, maquina: 58 },
        dfb_lojas: { grao: 9 },
      } },
      '2026-10': { canais: { dfb_ret_mod: { moido: 304 } } },
    },
  };
  const limpo = ctx.vol27AgregadoComClientesDistRetalho(antigo);
  assert.deepEqual(limpo.meses['2025-01'].canais.dfb_ret_mod, seed.meses['2025-01'].canais.dfb_ret_mod);
  assert.deepEqual(limpo.meses['2025-01'].canais.dfb_dist_ret, seed.meses['2025-01'].canais.dfb_dist_ret);
  assert.deepEqual(limpo.meses['2025-02'].canais.dfb_ret_mod, seed.meses['2025-02'].canais.dfb_ret_mod);
  assert.deepEqual(limpo.meses['2025-02'].canais.dfb_dist_ret, seed.meses['2025-02'].canais.dfb_dist_ret);
  assert.equal(limpo.meses['2025-01'].canais.dfb_lojas.grao, 1);
  assert.equal(limpo.meses['2025-02'].canais.dfb_lojas.grao, 9);
  assert.equal(limpo.meses['2026-10'].canais.dfb_ret_mod.moido, 304);
  const segunda = ctx.vol27AgregadoComClientesDistRetalho(limpo);
  assert.equal(segunda, limpo);
});

if (process.exitCode) {
  console.error('test-orcamento-2027-volume: falhou');
  process.exit(process.exitCode);
}
console.log('test-orcamento-2027-volume: ok');
