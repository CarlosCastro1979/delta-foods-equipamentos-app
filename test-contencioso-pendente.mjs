#!/usr/bin/env node
/**
 * Contencioso pendente: pedido recém-gravado (ex. DISTRISUL / Dist)
 * continua visível até ser tratado — não some por filtro de canal nem
 * por «não está na lista activa» (Horeca/seed).
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('Função em falta: ' + name);
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('Chaveta não fechou: ' + name);
}

const ls = new Map();
const DISTRISUL = {
  cod: '889001',
  nome: 'DISTRISUL',
  vendedor: 'MASSIMO BOTTELLO',
  npess: 99520003,
  canal: '13',
};
const HORECA_CLI = {
  cod: '748133',
  nome: 'COTOXO',
  vendedor: 'HÉLCIO GRÉGIO',
  npess: 99520002,
  canal: '04',
};
const pedidoDistrisul = {
  cod: DISTRISUL.cod,
  nome: DISTRISUL.nome,
  vendedor: 'MASSIMO BOTTELLO',
  valor_divida: 1500,
  dias_atraso: 200,
  solicitado_por: 'Carlos Castro',
  criado_em: '2026-08-28T12:00:00.000Z',
};

let _listaMem = null;
let _canalActivo = 'horeca';
let _isAdmin = true;
let scMap = new Map();

const CANAIS_APP = {
  horeca: { id: 'horeca', vendedores: ['Hélcio Grégio', 'Paulo Fontes'] },
  distribuidores: { id: 'distribuidores', vendedores: ['Eduardo Moreira', 'Massimo Bottello'] },
  varejo: { id: 'varejo', vendedores: ['Diogo Oliveira'] },
};

const context = {
  console,
  Date,
  Map,
  Set,
  CLIENTES_LS_KEY: 'delta_sap_clientes',
  get _listaClientesMem() { return _listaMem; },
  set _listaClientesMem(v) { _listaMem = v; },
  get _canalActivo() { return _canalActivo; },
  set _canalActivo(v) { _canalActivo = v; },
  get scContenciosoPendentes() { return scMap; },
  set scContenciosoPendentes(v) { scMap = v; },
  CANAIS_APP,
  localStorage: {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => { ls.set(k, String(v)); },
    removeItem: (k) => { ls.delete(k); },
  },
  getAnuladosSet: () => new Set(),
  getListaClientesCompleta: () => (_listaMem && _listaMem.length ? _listaMem : []),
  getListaClientesActiva() {
    const full = this.getListaClientesCompleta();
    const id = this.resolveCanalActivoId();
    if (!id) return full.slice();
    return full.filter(c => this.clientePertenceAoCanal(c, id));
  },
  resolveCanalActivoId: () => _canalActivo,
  isAdmin: () => _isAdmin,
  filterByUtilizadorActivo: (rows) => rows || [],
  clientePertenceAoCanal(cli, canalId) {
    if (!cli) return false;
    if (canalId === 'distribuidores') return Number(cli.npess) === 99520003 || Number(cli.npess) === 99520020;
    if (canalId === 'horeca') return Number(cli.npess) === 99520002 || Number(cli.npess) === 99520006 || Number(cli.npess) === 99520007;
    if (canalId === 'varejo') return Number(cli.npess) === 99520018 || Number(cli.npess) === 99520004;
    return false;
  },
  getCanalIdPorVendedorNome(nome) {
    const nn = context.normNomeUtilizador(nome);
    for (const [id, canal] of Object.entries(CANAIS_APP)) {
      if ((canal.vendedores || []).some(v => context.normNomeUtilizador(v) === nn)) return id;
    }
    return null;
  },
  getVendedoresNomesDoCanal(canalId) {
    const c = CANAIS_APP[canalId];
    return (c && c.vendedores || []).map(n => context.normNomeUtilizador(n));
  },
};

vm.createContext(context);
for (const name of [
  'normCod',
  'normNomeUtilizador',
  'listaSapRealCarregada',
  'codClienteAindaActivo',
  'pedidoContenciosoPertenceAoCanal',
  'getContenciosoPendentesLista',
]) {
  vm.runInContext(extractFn(html, name), context);
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

function reset({ lista = null, canal = 'horeca', admin = true } = {}) {
  _listaMem = lista;
  _canalActivo = canal;
  _isAdmin = admin;
  scMap = new Map();
  ls.clear();
}

check('lista SAP seed/vazia não conta como dump real', () => {
  reset({ lista: null });
  assert.equal(context.listaSapRealCarregada(), false);
});

check('cliente Dist continua activo sem dump SAP (não apagar pedido)', () => {
  reset({ lista: null, canal: 'horeca' });
  assert.equal(context.codClienteAindaActivo(DISTRISUL.cod), true);
});

check('cliente Dist continua activo com dump completo mesmo no canal Horeca', () => {
  reset({ lista: [HORECA_CLI, DISTRISUL], canal: 'horeca' });
  // A lista ACTIVA do Horeca não tem Distrisul — o bug antigo apagava o pedido.
  const activa = context.getListaClientesActiva();
  assert.equal(activa.some(c => context.normCod(c.cod) === context.normCod(DISTRISUL.cod)), false);
  assert.equal(context.codClienteAindaActivo(DISTRISUL.cod), true);
});

check('cliente fora do dump SAP real deixa de estar activo', () => {
  reset({ lista: [HORECA_CLI], canal: 'horeca' });
  assert.equal(context.listaSapRealCarregada(), true);
  assert.equal(context.codClienteAindaActivo(DISTRISUL.cod), false);
});

check('pedido Dist pertence ao canal Dist pelo cliente (não só pelo nome)', () => {
  reset({ lista: [HORECA_CLI, DISTRISUL], canal: 'distribuidores' });
  const pedidoNomeEstranho = { ...pedidoDistrisul, vendedor: 'BOTTELLO' };
  assert.equal(context.pedidoContenciosoPertenceAoCanal(pedidoNomeEstranho, 'distribuidores'), true);
  assert.equal(context.pedidoContenciosoPertenceAoCanal(pedidoNomeEstranho, 'horeca'), false);
});

check('pedido Dist sem cliente na lista: Dist pelo vendedor; desconhecido não some', () => {
  reset({ lista: null, canal: 'distribuidores' });
  assert.equal(context.pedidoContenciosoPertenceAoCanal(pedidoDistrisul, 'distribuidores'), true);
  // Nome canónico Dist → não misturar no Horeca mesmo sem dump SAP
  assert.equal(context.pedidoContenciosoPertenceAoCanal(pedidoDistrisul, 'horeca'), false);
  // Sem vendedor reconhecível e sem cliente → mostrar (não lista vazia)
  assert.equal(context.pedidoContenciosoPertenceAoCanal({ ...pedidoDistrisul, vendedor: '' }, 'distribuidores'), true);
  assert.equal(context.pedidoContenciosoPertenceAoCanal({ ...pedidoDistrisul, vendedor: '' }, 'horeca'), true);
});

check('admin vê pedido Dist recém-gravado em qualquer canal', () => {
  reset({ lista: [HORECA_CLI, DISTRISUL], canal: 'horeca', admin: true });
  scMap.set(context.normCod(pedidoDistrisul.cod), pedidoDistrisul);
  const horeca = context.getContenciosoPendentesLista('');
  assert.equal(horeca.length, 1);
  assert.equal(horeca[0].nome, 'DISTRISUL');
  _canalActivo = 'varejo';
  const varejo = context.getContenciosoPendentesLista('');
  assert.equal(varejo.some(d => d.nome === 'DISTRISUL'), true);
  _canalActivo = 'distribuidores';
  const dist = context.getContenciosoPendentesLista('');
  assert.equal(dist.some(d => d.nome === 'DISTRISUL'), true);
});

check('Área Financeira (todosCanais) inclui Dist independentemente do canal', () => {
  reset({ lista: [HORECA_CLI, DISTRISUL], canal: 'horeca', admin: false });
  scMap.set(context.normCod(pedidoDistrisul.cod), pedidoDistrisul);
  const af = context.getContenciosoPendentesLista('', { todosCanais: true });
  assert.equal(af.length, 1, 'AF deve listar o pedido Dist');
  assert.equal(af[0].nome, 'DISTRISUL');
});

check('não-admin no Dist vê o pedido; no Horeca não mistura', () => {
  reset({ lista: [HORECA_CLI, DISTRISUL], canal: 'distribuidores', admin: false });
  scMap.set(context.normCod(pedidoDistrisul.cod), pedidoDistrisul);
  assert.equal(context.getContenciosoPendentesLista('').length, 1);
  _canalActivo = 'horeca';
  assert.equal(context.getContenciosoPendentesLista('').length, 0);
});

if (process.exitCode) process.exit(process.exitCode);
console.log('Todos os testes Contencioso pendente passaram.');
