/**
 * Validades — stock DFB disponível (dep. 0011 / cl. 00) com validade de hoje até 4 meses
 * (Validade curta) ou até 8 meses (Validade menos de 8 meses), confrontado com o SAP dep. 0011 por EAN + lote.
 * Fonte única: a app «Análises Stock SAP x Unilog» grava logistica_stock (id DFB) e logistica_occ_params
 * no mesmo Supabase. A regra é a das abas «Produtos validade curta para escoar» e «Menos de 8 meses»
 * (Alertas Ação urgente) dessa app — alterar lá implica alterar aqui.
 * Sem DOM na parte de cálculo: o mesmo ficheiro corre no browser e no Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  var g = root || (typeof globalThis !== 'undefined' ? globalThis : this);
  if (!g) return;
  Object.keys(api).forEach(function (k) { g[k] = api[k]; });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var VLD_SUPA_BASE = 'https://qnscwppgljobelplgbkp.supabase.co/rest/v1';
  var VLD_COMPANY = 'DFB';
  var VLD_SAP_CENTRO = 'DFSP';
  var VLD_CACHE_MS = 10 * 60 * 1000;
  var VLD_UI_LS_KEY = 'dfb_validades_ui';

  var VLD_JANELAS = {
    curta: { id: 'curta', meses: 4, titulo: 'Validade curta', sheet: 'Validade Curta', file: 'validade_curta_escoar' },
    '8m': { id: '8m', meses: 8, titulo: 'Validade menos de 8 meses', sheet: 'Menos de 8 meses', file: 'menos_de_8_meses' },
  };

  var VLD_DEPOT_MAP = {
    '8': { classes: ['07'], label: '0008 — B2C' },
    '11': { classes: ['00'], label: '0011 — Disponível' },
    '99': { classes: ['104'], label: '0099 — Vencidos' },
    '22': { classes: ['96'], label: '0022 — Quarentena' },
    '44': { classes: ['A1', 'A2', 'FI', 'SI'], label: '0044 — Avarias' },
    'MUIM': { classes: ['00'], label: 'MUIM — Equipamento Profissional', catOnly: 'Equipamento Profissional' },
  };
  var VLD_DKS = Object.keys(VLD_DEPOT_MAP);
  var VLD_DISPONIVEL_DK = '11';
  var VLD_UNI_CLASSE_EXCL = ['93', 'Total', ''];
  var VLD_UNI_CLASSE_ALIASES = {
    'FALTA DE INVENTARIO': 'FI', 'FALTA DE INVENTÁRIO': 'FI', 'FALTA INVENTARIO': 'FI', 'FALTA INVENTÁRIO': 'FI',
    'SOBRA DE INVENTARIO': 'SI', 'SOBRA DE INVENTÁRIO': 'SI', 'SOBRA INVENTARIO': 'SI', 'SOBRA INVENTÁRIO': 'SI',
    'FALTA NO RECEBIMENTO': 'FR', 'FALTA DE RECEBIMENTO': 'FR', 'FALTA RECEBIMENTO': 'FR',
    'SOBRA NO RECEBIMENTO': 'SR', 'SOBRA DE RECEBIMENTO': 'SR', 'SOBRA RECEBIMENTO': 'SR',
  };
  var VLD_MUIM_CAT = 'Equipamento Profissional';
  var VLD_CAIXAS_PAPELAO_CAT = 'Caixas de Papelão';
  var VLD_CAIXAS_PAPELAO_SUBCAT = 'CX Papelao';
  var VLD_INSUMOS_CAT = 'Insumos';
  var VLD_MAQUINA_DOM_CAT = 'Máquinas Domésticas';
  var VLD_VINHO_CAT = 'Vinho';
  /** EAN11 → Material SAP quando o extracto SAP não traz o EAN (cópia da app de stock). */
  var VLD_EAN_SAP_MATERIAL_OVERRIDES = {
    '5601082008578': '310301',
    '5601082036137': '7801553',
    '5609060007995': '012960',
    '5609060015723': '230340',
    '5609060034977': '023418',
    '5609060098351': '018341',
  };

  // ── Normalização (igual à app de stock) ──
  function vldNQty(v) {
    if (v === null || v === undefined || v === '') return 0;
    var n = parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  function vldNLote(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v));
    var s = String(v).trim();
    if (s === '' || s === 'nan' || s === 'None') return '';
    if (/^\d+\.0+$/.test(s)) return s.replace(/\.0+$/, '');
    return s;
  }
  function vldSapDepotKey(v) {
    var n = Math.round(vldNQty(v || 0));
    return Number.isFinite(n) && n > 0 ? String(n) : String(v == null ? '' : v).trim();
  }
  function vldNormSapCentro(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function vldFiltrarSap(rows) {
    return (rows || []).filter(function (r) {
      var dk = vldSapDepotKey(r.deposito);
      if (!dk || dk === 'MUIM' || !Object.prototype.hasOwnProperty.call(VLD_DEPOT_MAP, dk)) return false;
      return vldNormSapCentro(r.centro || r.Centro || '') === VLD_SAP_CENTRO;
    });
  }
  function vldNormUniClasse(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s || VLD_UNI_CLASSE_EXCL.indexOf(s) >= 0) return null;
    var up = s.toUpperCase();
    return VLD_UNI_CLASSE_ALIASES[up] || up;
  }
  function vldFiltrarUni(rows) {
    var classes = new Set();
    VLD_DKS.forEach(function (dk) { VLD_DEPOT_MAP[dk].classes.forEach(function (c) { classes.add(c); }); });
    var out = [];
    (rows || []).forEach(function (r) {
      var classe = vldNormUniClasse(r.classe);
      if (!classe || !classes.has(classe)) return;
      out.push(classe === r.classe ? r : Object.assign({}, r, { classe: classe }));
    });
    return out;
  }

  // ── Categorias e exclusões ──
  function vldNormCatLabel(s) {
    return String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  }
  function vldAutoCat(desc) {
    if (!desc) return { cat: '', subcat: '' };
    var d = String(desc).toUpperCase();
    if (/\bPAPEL[ÃA]O\b|\bCAIXA[S]?\s+DE\s+PAPEL|\bCX\.?\s*PAPEL|\bCAIXA\s+VAZIA\b|\bCX\.?\s*CART[ÃA]O\b|\bCAIXA\s+(N\.?\s*)?\d+\b|\bCAIXA\s+(QUICK|MQ|TUBO|VINHO)\b/i.test(d)) return { cat: VLD_INSUMOS_CAT, subcat: VLD_CAIXAS_PAPELAO_SUBCAT };
    var capsSub = function () {
      return d.includes('100CAP') || d.includes('100 CAP') ? 'Caps 100' : (d.includes('40CAP') || d.includes('40 CAP') || d.includes('XL40') ? 'Caps 40' : 'Caps 10');
    };
    if (/\bDELTA\s*Q\b/.test(d) || /\bDELTAQ\b/.test(d)) return { cat: 'Café em Cápsulas', subcat: capsSub() };
    if (/\d+\s*CAP\b|\bCAP\s*\d+|COFFEE\s+\d+\s*CAP|\bCAPSULAS\b|\bCÁPSULAS\b|\bCAPS\b/.test(d)) return { cat: 'Café em Cápsulas', subcat: capsSub() };
    var graoSub = (d.includes('KG') || d.includes(' KG')) ? '1 Kg' : '500g';
    if (/\bBELLISSIMO\b/.test(d)) return { cat: 'Café em Grão', subcat: graoSub };
    if (/\bGR\s+KG\b|\bCOFFEE\s+GR\b|\bGR\b.*\bCOFFEE\b|\bCOFFEE\b.*\bGR\b/.test(d)) return { cat: 'Café em Grão', subcat: graoSub };
    if (/\bGRAO\b|\bGRÃO\b/.test(d)) return { cat: 'Café em Grão', subcat: graoSub };
    if (/\bMOIDO\b/.test(d) || /\bMOÍDO\b/.test(d)) return { cat: 'Café Moído', subcat: '' };
    if (d.startsWith('VRA') || d.includes('CATRAIO')) return { cat: 'Vinho', subcat: '' };
    if (d.includes('MINI MILKQOOL')) return { cat: VLD_MAQUINA_DOM_CAT, subcat: 'Mini Milkqool' };
    if (d.includes('MILKQOOL') && d.includes('EVOLUTION')) return { cat: VLD_MAQUINA_DOM_CAT, subcat: 'Milkqool Evolution' };
    if (d.includes('MILKQOOL')) return { cat: VLD_MAQUINA_DOM_CAT, subcat: 'Milkqool' };
    if (d.includes('MINIQOOL')) return { cat: VLD_MAQUINA_DOM_CAT, subcat: 'Miniqool' };
    if (d.includes('QUICK')) return { cat: VLD_MAQUINA_DOM_CAT, subcat: 'Quick' };
    if (d.includes('EVOLUTION')) return { cat: VLD_MAQUINA_DOM_CAT, subcat: 'Evolution' };
    if (d.includes('ICONIQ')) return { cat: VLD_MAQUINA_DOM_CAT, subcat: 'Iconiq' };
    if (d.includes('QUORUM')) return { cat: 'Máquinas Profissionais', subcat: 'Quorum' };
    return { cat: '', subcat: '' };
  }
  function vldIsCaixasPapelaoCat(cat) {
    var n = vldNormCatLabel(cat);
    if (!n) return false;
    if (n === vldNormCatLabel(VLD_CAIXAS_PAPELAO_CAT) || n === 'caixas de papelao' || n === 'caixa de papelao') return true;
    if (n === 'cx papelao' || n === 'cx. papelao' || n.startsWith('cx papel')) return true;
    if (n === 'cx quick' || n === 'cx. quick' || n === 'caixa quick') return true;
    if (/\bpapel/.test(n) && /\b(caixa|caixas|cx)\b/.test(n)) return true;
    return false;
  }
  function vldIsInsumosCat(cat) {
    var n = vldNormCatLabel(cat);
    if (!n) return false;
    if (n === vldNormCatLabel(VLD_INSUMOS_CAT) || n === 'insumo') return true;
    return vldIsCaixasPapelaoCat(cat);
  }
  function vldIsCaixasPapelaoDesc(desc) {
    if (!desc) return false;
    var d = String(desc).toUpperCase().normalize('NFD').replace(/\p{M}/gu, '');
    if (/\bCAIXA\s+VAZIA\b/.test(d)) return true;
    if (/\bPAPELAO\b|\bCAIXA[S]?\s+DE\s+PAPEL|\bCX\.?\s*PAPEL/.test(d)) return true;
    if (/\bCX\.?\s*CARTAO\b|\bCAIXA\s+CARTAO\b/.test(d)) return true;
    if (/\bCAIXA\s+(N\.?\s*)?\d+\b/.test(d)) return true;
    if (/\bCAIXA\s+(QUICK|MQ|TUBO|VINHO|6\s+TUBOS|15|24|32)\b/.test(d)) return true;
    var cat = vldAutoCat(desc).cat;
    return vldIsInsumosCat(cat) || cat === VLD_CAIXAS_PAPELAO_CAT;
  }

  /** Contexto de cálculo: dados + índices (occParams.find devolve o primeiro por ordem de categoria). */
  function vldCriarContexto(sapData, uniData, occParams) {
    var ctx = { sapData: sapData || [], uniData: uniData || [], occParams: occParams || [] };
    ctx.occByEan = new Map();
    ctx.occParams.forEach(function (p) { if (p && !ctx.occByEan.has(p.ean)) ctx.occByEan.set(p.ean, p); });
    ctx.param = function (ean) { return ctx.occByEan.get(ean); };
    ctx.isInsumo = function (ean, desc) {
      var param = ctx.param(ean);
      if (vldIsInsumosCat(param && param.cat) || vldIsCaixasPapelaoCat(param && param.cat) || vldIsCaixasPapelaoCat(param && param.subcat)) return true;
      if (vldIsCaixasPapelaoDesc(desc)) return true;
      if (param && param.descricao && vldIsCaixasPapelaoDesc(param.descricao)) return true;
      return false;
    };
    var exclCats = new Set([VLD_MUIM_CAT, VLD_CAIXAS_PAPELAO_CAT, VLD_INSUMOS_CAT]);
    var excl = new Set();
    ctx.occParams.forEach(function (p) {
      if (!p || !p.ean) return;
      if (exclCats.has(p.cat) || vldIsInsumosCat(p.cat) || vldIsCaixasPapelaoCat(p.cat) || vldIsCaixasPapelaoCat(p.subcat) || ctx.isInsumo(p.ean, p.descricao || p.desc || '')) excl.add(p.ean);
    });
    ctx.sapData.forEach(function (r) { if (r.EAN_norm && ctx.isInsumo(r.EAN_norm, r.desc)) excl.add(r.EAN_norm); });
    ctx.uniData.forEach(function (r) { if (r.EAN_norm && ctx.isInsumo(r.EAN_norm, r.produto)) excl.add(r.EAN_norm); });
    ctx.exclEans = excl;
    ctx.isExcluidoDifStock = function (ean, dk, desc) {
      if (dk === 'MUIM') return true;
      var param = ctx.param(ean);
      if (param && param.cat === VLD_MUIM_CAT) return true;
      if (ctx.isInsumo(ean, desc)) return true;
      return excl.has(ean);
    };
    ctx.isMaquinaDomestica = function (ean, desc) {
      var param = ctx.param(ean);
      if (param && param.cat === VLD_MAQUINA_DOM_CAT) return true;
      if (desc && vldAutoCat(desc).cat === VLD_MAQUINA_DOM_CAT) return true;
      return false;
    };
    ctx.isVinho = function (ean, desc, cat) {
      var param = ctx.param(ean);
      var c = cat || (param && param.cat) || (desc ? vldAutoCat(desc).cat : '');
      return c === VLD_VINHO_CAT;
    };
    var sapCodes = {};
    var precos = {};
    ctx.sapData.forEach(function (r) {
      if (r.EAN_norm && r.material) {
        if (!sapCodes[r.EAN_norm]) sapCodes[r.EAN_norm] = new Set();
        sapCodes[r.EAN_norm].add(r.material);
      }
      var p = Number(r.preco);
      if (r.EAN_norm && Number.isFinite(p) && p > 0 && (!precos[r.EAN_norm] || p > precos[r.EAN_norm])) precos[r.EAN_norm] = p;
    });
    Object.keys(VLD_EAN_SAP_MATERIAL_OVERRIDES).forEach(function (ean) {
      if (!sapCodes[ean]) sapCodes[ean] = new Set();
      if (!sapCodes[ean].size) sapCodes[ean].add(String(VLD_EAN_SAP_MATERIAL_OVERRIDES[ean]));
    });
    ctx.sapCode = function (ean) {
      if (!ean) return '';
      var s = sapCodes[ean];
      if (s && s.size) return Array.from(s).join(' / ');
      var m = VLD_EAN_SAP_MATERIAL_OVERRIDES[String(ean).trim()];
      return m ? String(m) : '';
    };
    ctx.precoMap = precos;
    return ctx;
  }

  // ── Validade ──
  function vldIsExplicitValidadeSentinel(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'number') return v === 0;
    var s = String(v).trim();
    if (!s || s === '—' || s === '0000-00-00') return false;
    var sl = s.toLowerCase().replace(/\s/g, '');
    if (sl === '0' || sl === '00.0000' || sl === '00.00.0000' || sl === '00/00/0000' || sl === '00/00/00' || sl === '00-00-0000' || sl === '00-00-00') return true;
    return /^(0+\.){2}0+$/.test(sl) || /^0+\/0+\/0+$/.test(sl) || /^0+-0+-0+$/.test(sl);
  }
  function vldIsValidadeSentinel(v) {
    if (v === null || v === undefined) return true;
    if (vldIsExplicitValidadeSentinel(v)) return true;
    var s = String(v).trim();
    return !s || s === '—' || s === '0000-00-00';
  }
  function vldSerialParaData(serial) {
    if (!(serial >= 1 && serial < 1000000)) return null;
    var g = typeof globalThis !== 'undefined' ? globalThis : {};
    if (g.XLSX && g.XLSX.SSF) {
      var dc = g.XLSX.SSF.parse_date_code(serial);
      if (dc && dc.y >= 1990 && dc.y <= 2100) { var dx = new Date(dc.y, dc.m - 1, dc.d); dx.setHours(0, 0, 0, 0); return dx; }
      return null;
    }
    var d = new Date(1899, 11, 30 + Math.floor(serial));
    d.setHours(0, 0, 0, 0);
    return d.getFullYear() >= 1990 && d.getFullYear() <= 2100 ? d : null;
  }
  function vldParseValidadeDate(v) {
    if (v === null || v === undefined || v === '' || v === '—' || v === '0000-00-00') return null;
    if (v instanceof Date && !isNaN(v.getTime())) { var d0 = new Date(v.getFullYear(), v.getMonth(), v.getDate()); d0.setHours(0, 0, 0, 0); return d0; }
    if (typeof v === 'number' && !isNaN(v)) {
      if (v === 0 || vldIsValidadeSentinel(v)) return null;
      return vldSerialParaData(v);
    }
    if (vldIsValidadeSentinel(v)) return null;
    var s = String(v).trim();
    var dotParts = s.split('.');
    if (dotParts.length === 2) {
      var mo2 = parseInt(dotParts[0], 10), yr2 = parseInt(dotParts[1], 10);
      if (yr2 >= 1990 && yr2 <= 2100 && mo2 >= 1 && mo2 <= 12) { var d2 = new Date(yr2, mo2, 0); d2.setHours(0, 0, 0, 0); return d2; }
    }
    if (dotParts.length === 3) {
      var dd3 = parseInt(dotParts[0], 10), mo3 = parseInt(dotParts[1], 10), yr3 = parseInt(dotParts[2], 10);
      if (yr3 >= 1990 && yr3 <= 2100 && mo3 >= 1 && mo3 <= 12 && dd3 >= 1 && dd3 <= 31) {
        var d3 = new Date(yr3, mo3 - 1, dd3);
        if (!isNaN(d3.getTime()) && d3.getFullYear() === yr3 && d3.getMonth() === mo3 - 1 && d3.getDate() === dd3) { d3.setHours(0, 0, 0, 0); return d3; }
      }
    }
    var p = s.split('/');
    if (p.length >= 3) {
      var yr = parseInt(String(p[2]).trim(), 10), mo = parseInt(p[1], 10), dd = parseInt(p[0], 10);
      if (yr >= 1990 && yr <= 2100 && mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) {
        var d4 = new Date(yr, mo - 1, dd);
        if (!isNaN(d4.getTime())) { d4.setHours(0, 0, 0, 0); return d4; }
      }
    }
    var m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/) || s.match(/^(\d{2})-(\d{2})-(\d{4})$/) || s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      var yrm = m[1].length === 4 ? parseInt(m[1], 10) : parseInt(m[3], 10);
      var mom = parseInt(m[2], 10);
      var ddm = m[1].length === 4 ? parseInt(m[3], 10) : parseInt(m[1], 10);
      if (yrm >= 1990 && yrm <= 2100 && mom >= 1 && mom <= 12 && ddm >= 1 && ddm <= 31) {
        var d5 = new Date(yrm, mom - 1, ddm);
        if (!isNaN(d5.getTime())) { d5.setHours(0, 0, 0, 0); return d5; }
      }
    }
    var serial = parseFloat(s.replace(',', '.'));
    if (!isNaN(serial) && serial >= 1 && serial < 1000000) {
      var d6 = vldSerialParaData(serial);
      if (d6) return d6;
    }
    var d7 = new Date(s);
    if (!isNaN(d7.getTime())) { d7.setHours(0, 0, 0, 0); return d7; }
    return null;
  }
  function vldUniRowValidadeFields(r) {
    var vals = [r.validadeLote, r.validadeHeader, r.validade].filter(function (v) { return v !== null && v !== undefined && String(v).trim() !== ''; });
    return Array.from(new Set(vals));
  }
  function vldPickUniRowValidade(r) {
    var fields = vldUniRowValidadeFields(r);
    for (var i = 0; i < fields.length; i++) if (vldParseValidadeDate(fields[i])) return fields[i];
    for (var j = 0; j < fields.length; j++) {
      var v = fields[j];
      if (vldIsExplicitValidadeSentinel(v)) return (typeof v === 'number' && v === 0) ? '0' : String(v).trim();
    }
    return fields[0] || '';
  }
  function vldLimite(hoje, meses) {
    var d = new Date(hoje);
    d.setMonth(d.getMonth() + meses);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function vldEstadoLinha(qtSap, qtUni) {
    if (qtUni === 0 && qtSap > 0) return 'Só SAP';
    if (qtSap === 0 && qtUni > 0) return 'Só Unilog';
    if (qtSap > 0 && qtUni > 0 && qtSap !== qtUni) return 'Dif. qtd';
    return 'OK';
  }

  /** Igual a computeValidJanela da app de stock. */
  function vldComputarJanela(ctx, meses, hojeOpt) {
    var out = [];
    var today = hojeOpt ? new Date(hojeOpt) : new Date();
    today.setHours(0, 0, 0, 0);
    var limit = vldLimite(today, meses);
    var dk = VLD_DISPONIVEL_DK;
    var sapQt = {};
    ctx.sapData.forEach(function (r) {
      if (r.deposito !== dk || ctx.exclEans.has(r.EAN_norm)) return;
      var k = r.EAN_norm + '|' + r.Lote_norm;
      sapQt[k] = (sapQt[k] || 0) + r.qt;
    });
    var stats = { analizadas: ctx.uniData.length, disponivel: 0, comValidade: 0, curta: 0, validadeNaoParseada: 0, vencida: 0, validadeLonga: 0, equipProf: 0, maquinaDom: 0, vinho: 0, validadeIgnorada: 0, semLote: 0, semEan: 0, qtZero: 0, faltaInventario: 0, foraDisponivel: 0, soUnilog: 0, comDiff: 0 };
    var dm = {};
    ctx.sapData.forEach(function (r) { if (r.EAN_norm && r.desc) dm[r.EAN_norm] = r.desc; });
    var depLabel = (VLD_DEPOT_MAP[dk].label.split('—')[1] || '').trim() || dk;
    var byKey = {};
    ctx.uniData.forEach(function (r) {
      var rdk = r.classe === '00' ? VLD_DKS.find(function (k) { return VLD_DEPOT_MAP[k].classes.indexOf(r.classe) >= 0; }) : null;
      if (rdk !== dk) { stats.foraDisponivel++; return; }
      stats.disponivel++;
      if (!r.EAN_norm) { stats.semEan++; return; }
      if (!r.Lote_norm) { stats.semLote++; return; }
      if (r.qt <= 0) { stats.qtZero++; return; }
      if (String(r.classe == null ? '' : r.classe).trim().toUpperCase() === 'FI') { stats.faltaInventario++; return; }
      var desc = r.produto || dm[r.EAN_norm] || '';
      var param = ctx.param(r.EAN_norm);
      var cat = (param && param.cat) || vldAutoCat(desc).cat || '';
      var validadeStr = vldPickUniRowValidade(r);
      if (ctx.isMaquinaDomestica(r.EAN_norm, desc)) { stats.maquinaDom++; return; }
      if (ctx.isVinho(r.EAN_norm, desc, cat)) { stats.vinho++; return; }
      if (vldIsValidadeSentinel(validadeStr)) { stats.validadeIgnorada++; return; }
      var validadeDate = vldParseValidadeDate(validadeStr);
      if (validadeDate) stats.comValidade++;
      else if ((validadeStr || '').trim()) stats.validadeNaoParseada++;
      if (!validadeDate) return;
      if (validadeDate <= today) { stats.vencida++; return; }
      if (validadeDate >= limit) { stats.validadeLonga++; return; }
      if (ctx.isExcluidoDifStock(r.EAN_norm, dk, desc)) { stats.equipProf++; return; }
      stats.curta++;
      var key = r.EAN_norm + '|' + vldNLote(r.Lote_norm);
      var diasRestantes = Math.floor((validadeDate - today) / (1000 * 86400));
      if (!byKey[key]) {
        byKey[key] = {
          EAN_norm: r.EAN_norm, produto: desc, Lote_norm: r.Lote_norm, qt_uni: r.qt,
          validade: validadeStr || '', validadeDate: validadeDate, diasRestantes: diasRestantes,
          dk: dk, depLabel: depLabel, classe: r.classe, depClasseActual: depLabel + ' / Cl.' + r.classe,
          cat: cat, sapCode: ctx.sapCode(r.EAN_norm),
        };
      } else {
        var g = byKey[key];
        g.qt_uni += r.qt;
        if (validadeDate < g.validadeDate) {
          g.validade = validadeStr || '';
          g.validadeDate = validadeDate;
          g.diasRestantes = diasRestantes;
        }
      }
    });
    Object.keys(byKey).forEach(function (k) {
      var g = byKey[k];
      var qtSap = sapQt[g.EAN_norm + '|' + g.Lote_norm] || 0;
      var diff = qtSap - g.qt_uni;
      if (qtSap === 0 && g.qt_uni > 0) stats.soUnilog++;
      if (diff !== 0) stats.comDiff++;
      out.push(Object.assign({}, g, { qt_sap: qtSap, diff: diff, _estado: vldEstadoLinha(qtSap, g.qt_uni) }));
    });
    out.sort(function (a, b) { return a.diasRestantes - b.diasRestantes || a.EAN_norm.localeCompare(b.EAN_norm); });
    return { data: out, stats: stats, limite: limit };
  }

  /** Valor SAP (preço SAP × qtd SAP) e Valor Unilog @ preço SAP — como os KPIs da app de stock. */
  function vldValores(ctx, rows) {
    var sap = 0, wms = 0, temPreco = false;
    rows.forEach(function (r) {
      var p = ctx.precoMap[r.EAN_norm] || 0;
      if (p > 0) temPreco = true;
      if (r.qt_sap > 0) sap += r.qt_sap * p;
      wms += (Number(r.qt_uni) || 0) * p;
    });
    return { sap: sap, wms: wms, temPreco: temPreco || sap > 0 };
  }

  /** Linha logistica_stock (sap_data/unilog_data em JSON) + occParams → contexto pronto. */
  function vldPrepararDeLinhaStock(linha, occParams) {
    var parse = function (v) {
      if (Array.isArray(v)) return v;
      if (!v) return [];
      try { var x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch (_) { return []; }
    };
    var sap = vldFiltrarSap(parse(linha && linha.sap_data));
    var uni = vldFiltrarUni(parse(linha && linha.unilog_data));
    var ctx = vldCriarContexto(sap, uni, occParams || []);
    ctx.uploadedAt = (linha && linha.uploaded_at) || null;
    return ctx;
  }

  // ── Leitura Supabase (só leitura; a carga dos ficheiros é feita na app de stock) ──
  var _vldCtx = null;
  var _vldCtxEm = 0;
  var _vldPromise = null;
  var _vldErro = '';

  function vldSupaKey() {
    if (typeof SUPA_KEY !== 'undefined') return SUPA_KEY;
    return '';
  }
  async function vldFetchJson(url) {
    var key = vldSupaKey();
    var res = await fetch(url, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  async function vldCarregarDados(force) {
    if (!force && _vldCtx && (Date.now() - _vldCtxEm) < VLD_CACHE_MS) return _vldCtx;
    if (_vldPromise) return _vldPromise;
    _vldPromise = (async function () {
      try {
        var res = await Promise.all([
          vldFetchJson(VLD_SUPA_BASE + '/logistica_stock?select=uploaded_at,sap_data,unilog_data&id=eq.' + VLD_COMPANY),
          vldFetchJson(VLD_SUPA_BASE + '/logistica_occ_params?select=*&order=cat.asc'),
        ]);
        var linha = Array.isArray(res[0]) ? res[0][0] : null;
        if (!linha) throw new Error('Sem stock DFB guardado na app de stock.');
        _vldCtx = vldPrepararDeLinhaStock(linha, Array.isArray(res[1]) ? res[1] : []);
        _vldCtxEm = Date.now();
        _vldErro = '';
        return _vldCtx;
      } catch (e) {
        _vldErro = (e && e.message) ? e.message : String(e);
        throw e;
      } finally {
        _vldPromise = null;
      }
    })();
    return _vldPromise;
  }

  // ── Estado da vista (filtros com autosave local) ──
  var _vldUi = null;
  var _vldUiTimer = null;
  function vldUiDefault() { return { sub: 'curta', estado: '', cat: '', busca: '' }; }
  function vldUiLer() {
    if (_vldUi) return _vldUi;
    _vldUi = {};
    try {
      var raw = typeof localStorage !== 'undefined' ? localStorage.getItem(VLD_UI_LS_KEY) : null;
      var obj = raw ? JSON.parse(raw) : null;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) _vldUi = obj;
    } catch (_) {}
    return _vldUi;
  }
  function vldUiDoHost(hostKey) {
    var all = vldUiLer();
    if (!all[hostKey] || typeof all[hostKey] !== 'object') all[hostKey] = vldUiDefault();
    var st = all[hostKey];
    if (!VLD_JANELAS[st.sub]) st.sub = 'curta';
    return st;
  }
  function vldUiGuardarJa() {
    if (_vldUiTimer) { clearTimeout(_vldUiTimer); _vldUiTimer = null; }
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(VLD_UI_LS_KEY, JSON.stringify(vldUiLer())); } catch (_) {}
  }
  function vldUiAgendarGuardar() {
    if (_vldUiTimer) clearTimeout(_vldUiTimer);
    _vldUiTimer = setTimeout(vldUiGuardarJa, 1000);
  }

  // ── Vista (canal e Previsão de vendas) ──
  var _vldHosts = {};
  var _vldAtivo = {};
  var _vldGen = {};

  function vldEsc(s) {
    if (typeof escHtml === 'function') return escHtml(s == null ? '' : String(s));
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function vldFmtNum(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  }
  function vldFmtBrl(v) {
    if (typeof formatBrl === 'function') return formatBrl(v);
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function vldFmtDataHora(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function vldEstadoBadge(estado) {
    var cores = {
      'Só SAP': 'background:#fff7ed;color:#c2410c;border-color:#fed7aa;',
      'Só Unilog': 'background:#fef2f2;color:#b91c1c;border-color:#fecaca;',
      'Dif. qtd': 'background:#fef2f2;color:#b91c1c;border-color:#fecaca;',
      'OK': 'background:#f0fdf4;color:#15803d;border-color:#bbf7d0;',
    };
    return '<span class="vld-badge" style="' + (cores[estado] || cores.OK) + '">' + vldEsc(estado) + '</span>';
  }

  function vldFiltrarLinhas(rows, st) {
    var q = String(st.busca || '').trim().toLowerCase();
    return rows.filter(function (r) {
      if (st.cat && r.cat !== st.cat) return false;
      if (st.estado === 'only_uni' && !(r.qt_sap === 0 && r.qt_uni > 0)) return false;
      if (st.estado === 'diff' && r.diff === 0) return false;
      if (!q) return true;
      return String(r.EAN_norm).toLowerCase().includes(q)
        || String(r.produto || '').toLowerCase().includes(q)
        || String(r.Lote_norm || '').toLowerCase().includes(q)
        || String(r.sapCode || '').toLowerCase().includes(q);
    });
  }

  function vldJanelasDoContexto(ctx) {
    var hoje = new Date();
    var key = ctx ? (hoje.toDateString()) : '';
    if (ctx && ctx._janelasKey === key && ctx._janelas) return ctx._janelas;
    var out = {};
    Object.keys(VLD_JANELAS).forEach(function (id) { out[id] = vldComputarJanela(ctx, VLD_JANELAS[id].meses, hoje); });
    if (ctx) { ctx._janelas = out; ctx._janelasKey = key; }
    return out;
  }

  function vldHtmlTabela(rows) {
    if (!rows.length) {
      return '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px;border:1px dashed var(--border);border-radius:10px;">✅ Nenhum produto nesta janela de validade para este filtro.</div>';
    }
    var linhas = rows.map(function (r) {
      var diasCor = r.diasRestantes <= 30 ? 'color:#b91c1c;font-weight:700;' : (r.diasRestantes <= 60 ? 'color:#c2410c;font-weight:600;' : '');
      var difCor = r.diff > 0 ? 'color:#15803d;' : (r.diff < 0 ? 'color:#b91c1c;' : '');
      var vTime = r.validadeDate instanceof Date ? r.validadeDate.getTime() : '';
      return '<tr' + (r.diff !== 0 ? ' style="background:#fffbeb;"' : '') + '>'
        + '<td style="padding:8px 10px;font-size:12px;font-family:var(--font-mono);white-space:nowrap;">' + vldEsc(r.sapCode || '—') + '</td>'
        + '<td style="padding:8px 10px;font-size:12px;font-family:var(--font-mono);white-space:nowrap;">' + vldEsc(r.EAN_norm) + '</td>'
        + '<td class="col-nome" style="padding:8px 10px;font-size:12px;font-weight:500;">' + vldEsc(r.produto || '—') + '</td>'
        + '<td style="padding:8px 10px;font-size:12px;">' + vldEsc(r.cat || '—') + '</td>'
        + '<td style="padding:8px 10px;font-size:12px;font-family:var(--font-mono);white-space:nowrap;">' + vldEsc(r.Lote_norm) + '</td>'
        + '<td style="padding:8px 10px;font-size:12px;text-align:right;" data-sort="' + r.qt_uni + '">' + vldFmtNum(r.qt_uni) + '</td>'
        + '<td style="padding:8px 10px;font-size:12px;text-align:right;" data-sort="' + r.qt_sap + '">' + vldFmtNum(r.qt_sap) + '</td>'
        + '<td style="padding:8px 10px;font-size:12px;text-align:right;' + difCor + '" data-sort="' + r.diff + '">' + (r.diff > 0 ? '+' : '') + vldFmtNum(r.diff) + '</td>'
        + '<td style="padding:8px 10px;font-size:12px;">' + vldEstadoBadge(r._estado) + '</td>'
        + '<td style="padding:8px 10px;font-size:12px;white-space:nowrap;" data-sort="' + vTime + '">' + vldEsc(r.validade || '—') + '</td>'
        + '<td style="padding:8px 10px;font-size:12px;text-align:right;' + diasCor + '" data-sort="' + r.diasRestantes + '">' + vldFmtNum(r.diasRestantes) + '</td>'
        + '<td style="padding:8px 10px;font-size:12px;white-space:nowrap;">' + vldEsc(r.depClasseActual) + '</td>'
        + '</tr>';
    }).join('');
    return '<div class="table-wrap"><table class="data-table wide vld-table">'
      + '<thead><tr style="background:var(--surface2);">'
      + '<th>Cód. SAP</th><th>EAN</th><th>Produto</th><th>Categoria</th><th>Lote</th><th>Qtd Unilog</th><th>Qtd SAP</th><th>Dif.</th><th>Estado</th><th>Validade</th><th>Dias</th><th>Dep. / Classe</th>'
      + '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
  }

  function vldHtmlKpi(label, valor, sub, cor) {
    return '<div class="vld-kpi"><div class="vld-kpi-l">' + vldEsc(label) + '</div>'
      + '<div class="vld-kpi-v"' + (cor ? ' style="color:' + cor + ';"' : '') + '>' + valor + '</div>'
      + (sub ? '<div class="vld-kpi-s">' + sub + '</div>' : '') + '</div>';
  }

  function vldPintar(hostKey) {
    var hostId = _vldHosts[hostKey];
    var host = hostId && typeof document !== 'undefined' ? document.getElementById(hostId) : null;
    if (!host) return;
    if (typeof _vldAtivo[hostKey] === 'function' && !_vldAtivo[hostKey]()) return;
    var st = vldUiDoHost(hostKey);
    var ctx = _vldCtx;
    var cfg = VLD_JANELAS[st.sub];
    var canalNome = '';
    if (hostKey === 'canal' && typeof getCanalActivo === 'function') {
      var c = getCanalActivo();
      canalNome = c && c.nome ? c.nome : '';
    }
    var hk = vldEsc(hostKey);
    var tabs = Object.keys(VLD_JANELAS).map(function (id) {
      var j = VLD_JANELAS[id];
      var n = ctx ? vldJanelasDoContexto(ctx)[id].data.length : null;
      return '<button type="button" class="sub-tab' + (st.sub === id ? ' active' : '') + '" data-vld-sub="' + id + '" onclick="vldMudarSub(\'' + hk + '\',\'' + id + '\')">'
        + vldEsc(j.titulo) + (n != null ? ' <span class="vld-count">' + n + '</span>' : '') + '</button>';
    }).join('');
    var head = '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px;">'
      + '<div><div style="font-size:16px;font-weight:700;">Validades' + (canalNome ? ' — ' + vldEsc(canalNome) : '') + '</div>'
      + '<div style="font-size:12px;color:var(--muted);margin-top:2px;">Stock disponível DFB (dep. 0011 / cl. 00) com validade de hoje até ' + cfg.meses + ' meses, confrontado com o SAP dep. 0011 por EAN + lote. '
      + 'O stock é o mesmo para todos os canais. Sem equip. profissional, MUIM, caixas de papelão, vinhos, máquinas domésticas, validade 00.0000 nem classe FI.</div></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button type="button" class="btn btn-secondary btn-sm" onclick="vldActualizar(\'' + hk + '\')">↻ Actualizar</button>'
      + '<button type="button" class="btn btn-secondary btn-sm" onclick="vldExportarExcel(\'' + hk + '\')"' + (ctx ? '' : ' disabled') + '>⬇ Excel</button>'
      + '</div></div>'
      + '<div class="sub-nav" style="margin-bottom:12px;">' + tabs + '</div>';
    if (!ctx) {
      var msg = _vldErro
        ? '<div style="color:var(--danger);font-size:13px;padding:12px 0;">Erro ao ler o stock: ' + vldEsc(_vldErro) + '</div>'
        : '<div style="color:var(--muted);font-size:13px;padding:12px 0;">A ler o stock guardado pela app de stock…</div>';
      host.innerHTML = head + msg;
      return;
    }
    var jan = vldJanelasDoContexto(ctx)[st.sub];
    var todas = jan.data;
    var rows = vldFiltrarLinhas(todas, st);
    var s = jan.stats || {};
    var totalUni = rows.reduce(function (a, r) { return a + r.qt_uni; }, 0);
    var totalSap = rows.reduce(function (a, r) { return a + r.qt_sap; }, 0);
    var eans = new Set(rows.map(function (r) { return r.EAN_norm; })).size;
    var soUni = rows.filter(function (r) { return r.qt_sap === 0 && r.qt_uni > 0; }).length;
    var comDiff = rows.filter(function (r) { return r.diff !== 0; }).length;
    var extra = [];
    if (s.vencida) extra.push(vldFmtNum(s.vencida) + ' já vencidos (excl.)');
    if (s.validadeLonga) extra.push(vldFmtNum(s.validadeLonga) + ' validade ≥' + cfg.meses + 'm (excl.)');
    if (s.equipProf) extra.push(vldFmtNum(s.equipProf) + ' equip. prof. / cx. papelão');
    if (s.faltaInventario) extra.push(vldFmtNum(s.faltaInventario) + ' classe FI');
    if (s.validadeIgnorada) extra.push(vldFmtNum(s.validadeIgnorada) + ' validade 00.0000 ignorada');
    var val = vldValores(ctx, rows);
    var kpis = '<div class="vld-kpis">'
      + vldHtmlKpi('Linhas', vldFmtNum(rows.length), vldFmtNum(s.disponivel || 0) + ' linhas no dep. 0011 / cl. 00' + (extra.length ? ' · ' + extra.join(' · ') : ''), '#b91c1c')
      + vldHtmlKpi('EANs', vldFmtNum(eans), '', '#1e40af')
      + vldHtmlKpi('Só Unilog', vldFmtNum(soUni), 'sem stock SAP dep. 0011', '#b91c1c')
      + vldHtmlKpi('Com diferença', vldFmtNum(comDiff), '', '#c2410c')
      + vldHtmlKpi('Qtd Unilog', vldFmtNum(totalUni), '', '#c2410c')
      + vldHtmlKpi('Qtd SAP', vldFmtNum(totalSap), '', '')
      + (val.temPreco
        ? vldHtmlKpi('Valor SAP', vldFmtBrl(val.sap), 'preço SAP × qtd SAP', '#1e40af')
          + vldHtmlKpi('Valor Unilog @ preço SAP', vldFmtBrl(val.wms), 'preço SAP × qtd Unilog', '#1e40af')
        : '')
      + '</div>';
    var cats = Array.from(new Set(todas.map(function (r) { return r.cat; }).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'pt'); });
    if (st.cat && cats.indexOf(st.cat) < 0) cats.push(st.cat);
    var pill = function (val2, label, n) {
      return '<button type="button" class="vld-pill' + (st.estado === val2 ? ' active' : '') + '" onclick="vldMudarEstado(\'' + hk + '\',\'' + val2 + '\')">'
        + vldEsc(label) + ' <span style="opacity:.75;font-size:11px;">' + vldFmtNum(n) + '</span></button>';
    };
    var filtros = '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0;">'
      + '<input type="search" class="form-input" id="vld-busca-' + hk + '" placeholder="Pesquisar EAN, cód. SAP, produto ou lote" value="' + vldEsc(st.busca || '') + '" oninput="vldMudarBusca(\'' + hk + '\',this.value)" style="height:36px;width:auto;min-width:240px;max-width:360px;flex:1;padding:6px 10px;font-size:13px;">'
      + '<select class="form-input" onchange="vldMudarCat(\'' + hk + '\',this.value)" style="height:36px;width:auto;min-width:180px;padding:6px 8px;font-size:13px;">'
      + '<option value="">Todas as categorias</option>'
      + cats.map(function (c2) { return '<option value="' + vldEsc(c2) + '"' + (st.cat === c2 ? ' selected' : '') + '>' + vldEsc(c2) + '</option>'; }).join('')
      + '</select>'
      + pill('', 'Todos', todas.length)
      + pill('only_uni', 'Só Unilog', todas.filter(function (r) { return r.qt_sap === 0 && r.qt_uni > 0; }).length)
      + pill('diff', 'Com diferença', todas.filter(function (r) { return r.diff !== 0; }).length)
      + '</div>';
    var fonte = '<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Fonte: app Análises Stock SAP x Unilog · stock processado em <strong>' + vldEsc(vldFmtDataHora(ctx.uploadedAt))
      + '</strong> · validade até ' + vldEsc(jan.limite.toLocaleDateString('pt-BR')) + ' (exclusive)</div>';
    var ativo = document.activeElement;
    var buscaFocada = ativo && ativo.id === 'vld-busca-' + hostKey;
    var caret = buscaFocada ? ativo.selectionStart : null;
    host.innerHTML = head + fonte + kpis + filtros + vldHtmlTabela(rows);
    if (buscaFocada) {
      var inp = document.getElementById('vld-busca-' + hostKey);
      if (inp) { inp.focus(); try { inp.setSelectionRange(caret, caret); } catch (_) {} }
    }
    var tbl = host.querySelector('table.vld-table');
    if (tbl && typeof enableTableSort === 'function') enableTableSort(tbl);
  }

  /**
   * Monta a vista Validades num host (hostKey: 'canal' ou 'pv').
   * opts.ativo: o host é partilhado (pv-canal-panels) — sem isto, uma leitura lenta pinta por cima de outra vista.
   */
  async function vldMontarVista(hostKey, hostId, opts) {
    _vldHosts[hostKey] = hostId;
    if (opts && typeof opts.ativo === 'function') _vldAtivo[hostKey] = opts.ativo;
    var gen = (_vldGen[hostKey] = (_vldGen[hostKey] || 0) + 1);
    vldPintar(hostKey);
    try {
      await vldCarregarDados(!!(opts && opts.force));
    } catch (e) {
      console.warn('vldCarregarDados', e);
    }
    if (gen !== _vldGen[hostKey]) return;
    vldPintar(hostKey);
  }

  function vldMudarSub(hostKey, sub) {
    if (!VLD_JANELAS[sub]) return;
    vldUiDoHost(hostKey).sub = sub;
    vldUiGuardarJa();
    vldPintar(hostKey);
  }
  function vldMudarEstado(hostKey, estado) {
    vldUiDoHost(hostKey).estado = estado === 'only_uni' || estado === 'diff' ? estado : '';
    vldUiGuardarJa();
    vldPintar(hostKey);
  }
  function vldMudarCat(hostKey, cat) {
    vldUiDoHost(hostKey).cat = String(cat || '');
    vldUiGuardarJa();
    vldPintar(hostKey);
  }
  function vldMudarBusca(hostKey, txt) {
    vldUiDoHost(hostKey).busca = String(txt || '');
    vldUiAgendarGuardar();
    vldPintar(hostKey);
  }
  function vldActualizar(hostKey) {
    _vldErro = '';
    _vldCtx = null;
    return vldMontarVista(hostKey, _vldHosts[hostKey], { force: true, ativo: _vldAtivo[hostKey] });
  }

  async function vldExportarExcel(hostKey) {
    if (!_vldCtx) { if (typeof toast === 'function') toast('Sem dados de stock.', 'error'); return; }
    var st = vldUiDoHost(hostKey);
    var cfg = VLD_JANELAS[st.sub];
    var rows = vldFiltrarLinhas(vldJanelasDoContexto(_vldCtx)[st.sub].data, st);
    if (!rows.length) { if (typeof toast === 'function') toast('Sem linhas para exportar.', 'warn'); return; }
    try {
      if (typeof ensureXLSX === 'function') await ensureXLSX();
      var aoa = [['Categoria', 'Cod_SAP', 'EAN', 'Descricao', 'Lote', 'Qtd_Unilog', 'Qtd_SAP', 'Diferenca', 'Estado', 'Validade', 'Dias_Restantes', 'Deposito_Classe']];
      rows.forEach(function (r) {
        aoa.push([r.cat || '', r.sapCode || '', r.EAN_norm, r.produto || '', r.Lote_norm, r.qt_uni, r.qt_sap, r.diff, r._estado, r.validade, r.diasRestantes, r.depClasseActual]);
      });
      var nome = cfg.file + '_' + VLD_COMPANY + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';
      writeXlsxDownload(aoa, cfg.sheet, nome, [{ wch: 18 }, { wch: 12 }, { wch: 15 }, { wch: 40 }, { wch: 14 }, { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 12 }, { wch: 9 }, { wch: 20 }]);
      if (typeof toast === 'function') toast('⬇ Excel exportado.');
    } catch (e) {
      console.error('vldExportarExcel', e);
      if (typeof toast === 'function') toast('Erro ao exportar: ' + (e && e.message ? e.message : e), 'error');
    }
  }

  return {
    VLD_JANELAS: VLD_JANELAS,
    VLD_UI_LS_KEY: VLD_UI_LS_KEY,
    vldAutoCat: vldAutoCat,
    vldParseValidadeDate: vldParseValidadeDate,
    vldCriarContexto: vldCriarContexto,
    vldPrepararDeLinhaStock: vldPrepararDeLinhaStock,
    vldComputarJanela: vldComputarJanela,
    vldValores: vldValores,
    vldFiltrarLinhas: vldFiltrarLinhas,
    vldCarregarDados: vldCarregarDados,
    vldMontarVista: vldMontarVista,
    vldMudarSub: vldMudarSub,
    vldMudarEstado: vldMudarEstado,
    vldMudarCat: vldMudarCat,
    vldMudarBusca: vldMudarBusca,
    vldActualizar: vldActualizar,
    vldExportarExcel: vldExportarExcel,
    vldUiGuardarJa: vldUiGuardarJa,
  };
});
