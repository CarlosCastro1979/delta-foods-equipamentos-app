/**
 * Validades (curta 4 meses / menos de 8 meses) — regra da app Análises Stock SAP x Unilog,
 * menu nos canais e na Previsão de vendas, filtros com autosave local.
 * VLD_LIVE=1 também lê o stock DFB do Supabase e mostra as contagens.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CACHE = 'v2026-10-30-validades';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.ok(sw.includes(CACHE), 'sw.js tem ' + CACHE);
assert.ok(html.includes(CACHE), 'index.html tem ' + CACHE);
assert.ok(html.includes('<script src="validades-stock.js"></script>'), 'script incluído');
assert.ok(html.includes('id="tab-validades-canal" onclick="switchTab(\'validades-canal\')">Validades</button>'), 'tab Validades no menu do canal');
assert.ok(html.includes('id="panel-validades-canal"') && html.includes('id="canal-validades-host"'), 'painel Validades do canal');
assert.ok(/if \(tab === 'validades-canal'[\s\S]{0,120}vldMontarVista\('canal', 'canal-validades-host'/.test(html), 'switchTab monta Validades');
assert.ok(html.includes('id="pv-tab-validades" onclick="pvShowView(\'validades\')">Validades</button>'), 'sub-tab Validades na Previsão');
assert.ok(html.includes("view === 'orcamento' || view === 'validades') ? view : 'mapa'"), 'pvShowView aceita validades');
assert.ok(html.includes("validades: 'pv-tab-validades'"), 'pvShowView activa o botão');
assert.ok(/if \(_pvView === 'validades'\) \{[\s\S]{0,1600}vldMontarVista\('pv', 'pv-canal-panels', \{ ativo: \(\) => _pvView === 'validades' \}\)/.test(html), 'pvRender monta Validades');
assert.ok(html.includes("_pvView !== 'perdas' && _pvView !== 'validades') {"), 'Validades não relê os mapas da previsão');

const vld = require('./validades-stock.js');
assert.equal(vld.VLD_JANELAS.curta.meses, 4);
assert.equal(vld.VLD_JANELAS['8m'].meses, 8);
assert.equal(vld.VLD_JANELAS.curta.titulo, 'Validade curta');
assert.equal(vld.VLD_JANELAS['8m'].titulo, 'Validade menos de 8 meses');

// Datas de validade como a app de stock
const d = (v) => { const x = vld.vldParseValidadeDate(v); return x ? x.toISOString().slice(0, 10) : null; };
const iso = (y, m, dd) => new Date(y, m - 1, dd).toISOString().slice(0, 10);
assert.equal(d('12.01.2027'), iso(2027, 1, 12));
assert.equal(d('03.2027'), iso(2027, 3, 31), 'MM.AAAA = último dia do mês');
assert.equal(d('12/01/2027'), iso(2027, 1, 12));
assert.equal(d('2027-01-12'), iso(2027, 1, 12));
assert.equal(d(46399), iso(2027, 1, 12), 'série Excel');
assert.equal(d('00.0000'), null);
assert.equal(d('00.00.0000'), null);
assert.equal(vld.vldAutoCat('DELTA Q QALIDUS COFFEE 10CAP').cat, 'Café em Cápsulas');
assert.equal(vld.vldAutoCat('CAIXA VAZIA DELTA Q').cat, 'Insumos');
assert.equal(vld.vldAutoCat('VRA TINTO').cat, 'Vinho');

const uni = (ean, lote, qt, validadeLote, extra = {}) => ({ EAN_norm: ean, Lote_norm: lote, qt, classe: '00', validadeLote, produto: extra.produto || 'DELTA Q QALIDUS COFFEE 10CAP', ...extra });
const linha = {
  uploaded_at: '2026-10-30T14:05:25.658+00:00',
  sap_data: JSON.stringify([
    { centro: 'DFSP', deposito: '11', EAN_norm: 'A', material: '7805019', desc: 'DELTA Q QALIDUS COFFEE 10CAP', Lote_norm: 'L1', qt: 12, preco: 10 },
    { centro: 'QBSP', deposito: '11', EAN_norm: 'B', material: '999', desc: 'OUTRA EMPRESA', Lote_norm: 'L2', qt: 7, preco: 10 },
    { centro: 'DFSP', deposito: '33', EAN_norm: 'M', material: '333', desc: 'PEÇA', Lote_norm: 'LM', qt: 5, preco: 1 },
  ]),
  unilog_data: JSON.stringify([
    uni('A', 'L1', 10, '12.01.2027'),
    uni('A', 'L1', 5, '15.01.2027'),
    uni('B', 'L2', 7, '20.05.2027', { produto: 'DELTA CUBA COFFEE MU 250G' }),
    uni('M', 'LM', 3, '03.2027', { produto: 'DELTA PLATINUM COFFEE GR KG' }),
    uni('C', 'LC', 4, '12.01.2027', { produto: 'VRA TINTO 750ML' }),
    uni('D', 'LD', 4, '12.01.2027', { produto: 'MAQ MILKQOOL BRANCA' }),
    uni('E', 'LE', 4, '00.0000'),
    uni('F', 'LF', 4, '12.01.2027', { produto: 'CAIXA VAZIA DELTA Q' }),
    uni('G', 'LG', 4, '12.01.2027', { produto: 'MOINHO PRO' }),
    uni('H', 'LH', 4, '12.01.2027', { classe: '104' }),
    uni('A', 'L3', 4, '01.10.2026'),
    uni('I', 'LI', 4, '30.12.2027'),
    uni('J', '', 4, '12.01.2027'),
    uni('K', 'LK', 4, '12.01.2027', { classe: '93' }),
  ]),
};
const occ = [{ ean: 'G', cat: 'Equipamento Profissional', subcat: '' }];
const ctx = vld.vldPrepararDeLinhaStock(linha, occ);
assert.equal(ctx.sapData.length, 1, 'SAP só centro DFSP e depósitos mapeados');
assert.equal(ctx.uniData.length, 13, 'Unilog sem classe 93');

const hoje = new Date(2026, 9, 30);
const curta = vld.vldComputarJanela(ctx, 4, hoje);
assert.equal(curta.data.length, 1, 'curta: só A/L1');
const a = curta.data[0];
assert.equal(a.EAN_norm, 'A');
assert.equal(a.qt_uni, 15, 'agrupa EAN + lote');
assert.equal(a.validade, '12.01.2027', 'fica a validade mais próxima');
assert.equal(a.diasRestantes, 74);
assert.equal(a.qt_sap, 12);
assert.equal(a.diff, -3);
assert.equal(a._estado, 'Dif. qtd');
assert.equal(a.sapCode, '7805019');
assert.equal(a.depClasseActual, 'Disponível / Cl.00');
assert.equal(curta.stats.vinho, 1);
assert.equal(curta.stats.maquinaDom, 1);
assert.equal(curta.stats.validadeIgnorada, 1);
assert.equal(curta.stats.equipProf, 2, 'caixa de papelão + equip. profissional');
assert.equal(curta.stats.foraDisponivel, 1);
assert.equal(curta.stats.vencida, 1);
assert.equal(curta.stats.semLote, 1);

const oito = vld.vldComputarJanela(ctx, 8, hoje);
assert.deepEqual(oito.data.map(r => r.EAN_norm + '/' + r.Lote_norm), ['A/L1', 'M/LM', 'B/L2'], '8 meses: ordenado por dias');
const b = oito.data.find(r => r.EAN_norm === 'B');
assert.equal(b.qt_sap, 0, 'SAP de outra empresa não conta');
assert.equal(b._estado, 'Só Unilog');
assert.equal(oito.stats.validadeLonga, 1, 'I fora dos 8 meses');

assert.equal(vld.vldFiltrarLinhas(oito.data, { estado: 'only_uni' }).length, 2);
assert.equal(vld.vldFiltrarLinhas(oito.data, { estado: 'diff' }).length, 3);
assert.equal(vld.vldFiltrarLinhas(oito.data, { busca: 'cuba' }).length, 1);
assert.equal(vld.vldFiltrarLinhas(oito.data, { busca: '7805019' }).length, 1);
assert.equal(vld.vldFiltrarLinhas(oito.data, { cat: 'Café em Grão' }).length, 1);

const val = vld.vldValores(ctx, curta.data);
assert.equal(val.sap, 120);
assert.equal(val.wms, 150);

// Filtros: sub-menu grava já; pesquisa grava ~1 s depois da última tecla
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
vld.vldMudarSub('pv', '8m');
assert.equal(JSON.parse(store.get(vld.VLD_UI_LS_KEY)).pv.sub, '8m');
vld.vldMudarBusca('pv', 'cub');
vld.vldMudarBusca('pv', 'cuba');
assert.equal(JSON.parse(store.get(vld.VLD_UI_LS_KEY)).pv.busca, '', 'pesquisa ainda não gravada');
await new Promise(r => setTimeout(r, 1150));
assert.equal(JSON.parse(store.get(vld.VLD_UI_LS_KEY)).pv.busca, 'cuba', 'pesquisa gravada após debounce');
vld.vldMudarEstado('canal', 'diff');
assert.equal(JSON.parse(store.get(vld.VLD_UI_LS_KEY)).canal.estado, 'diff', 'estado por host');

if (process.env.VLD_LIVE === '1') {
  const KEY = (html.match(/const SUPA_KEY = '([^']+)'/) || [])[1];
  globalThis.SUPA_KEY = KEY;
  const live = await vld.vldCarregarDados(true);
  const c4 = vld.vldComputarJanela(live, 4).data.length;
  const c8 = vld.vldComputarJanela(live, 8).data.length;
  console.log(`live DFB (processado ${live.uploadedAt}): validade curta ${c4} linhas · menos de 8 meses ${c8} linhas`);
}

console.log('test-validades-stock: OK');
