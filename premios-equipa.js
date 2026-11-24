/**
 * Prémios Equipa de Vendas — Área Financeira (ao lado de Comissão de RC).
 * Racional: Excel «Apuramento Mensal Prémios_2026».
 * - Mensal: % (vendas÷obj) ≥ 100% → valor fixo por pessoa
 * - Hélcio / Daniela: se faturação ≥ 55k → (fat − 55k) × 2,3%
 * - Trimestre: se meta trim ≥ 100% → prémio trim + recuperação (tecto 3×mensal − já pago)
 * Sem DOM na parte de cálculo (browser + Node).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  var g = root || (typeof globalThis !== 'undefined' ? globalThis : this);
  if (!g) return;
  Object.keys(api).forEach(function (k) { g[k] = api[k]; });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var PREMIOS_LIMIAR_COMISSAO = 55000;
  var PREMIOS_TAXA_COMISSAO = 0.023;
  var PREMIOS_MESES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];

  /**
   * Pacotes 2026 (folha Premios por pessoa / Premios Equipa Vendas).
   * scope = chave para agregar vendas/objectivo no quadro.
   */
  var PREMIOS_EQUIPA_PESSOAS = [
    { id: 'marcio', nome: 'Marcio Gorga', mensal: 500, trim: 1000, comissao: false, scope: 'marcio' },
    { id: 'massimo', nome: 'Massimo Bottello', mensal: 3000, trim: 3000, comissao: false, scope: 'massimo' },
    { id: 'eduardo', nome: 'Eduardo Madeira', mensal: 3000, trim: 3000, comissao: false, scope: 'eduardo' },
    { id: 'diogo', nome: 'Diogo Oliveira', mensal: 3000, trim: 3000, comissao: false, scope: 'diogo' },
    { id: 'filipe', nome: 'Filipe Neves', mensal: 3000, trim: 3000, comissao: false, scope: 'filipe_equipa' },
    { id: 'helcio', nome: 'Hélcio Grégio', mensal: 1300, trim: 1600, comissao: true, scope: 'helcio' },
    { id: 'daniela', nome: 'Daniela Santos', mensal: 1300, trim: 1600, comissao: true, scope: 'daniela' },
    { id: 'paulo', nome: 'Paulo Fontes', mensal: 1650, trim: 2050, comissao: false, scope: 'paulo' },
  ];

  var _peMes = null;
  var _peAno = null;
  var _peGen = 0;
  var _peFiltroId = '';
  var _peVista = 'mensal'; // mensal | scorecard
  var _peSeries = null;
  var _peModelo = null;
  var _peScore = null;

  function premiosTectoTrim(mensal) {
    return (Number(mensal) || 0) * 3;
  }

  /** Cumprimento vendas/obj (1 = 100%); null se sem objectivo. */
  function premiosPctCumprimento(vendas, obj) {
    if (obj == null || !Number.isFinite(+obj) || +obj <= 0) return null;
    var v = Number.isFinite(+vendas) ? +vendas : 0;
    return v / (+obj);
  }

  /**
   * Variação vs objectivo (Excel / menu Vendas): (vendas − obj) / obj.
   * Ex.: −0.03 → «−3%» (abaixo); +0.186 → «+18,6%» (acima).
   */
  function premiosVarObjPct(vendas, obj) {
    if (obj == null || !Number.isFinite(+obj) || +obj <= 0) return null;
    var v = Number.isFinite(+vendas) ? +vendas : 0;
    return (v - (+obj)) / (+obj);
  }

  function premiosAtingiuMeta(pct) {
    return pct != null && Number.isFinite(+pct) && +pct >= 1;
  }

  /** Prémio mensal: vendas ≥ obj (var ≥ 0) → valor; senão 0. */
  function premiosValorMensal(pct, valorMensal) {
    if (!premiosAtingiuMeta(pct)) return 0;
    return Number(valorMensal) || 0;
  }

  /**
   * Comissão Hélcio/Daniela: max(0, faturação − 55.000) × 2,3%.
   * Exige faturação ≥ 55.000 (limiar inclusive para começar a contar o excedente).
   */
  function premiosComissaoExcedente(faturacao, limiar, taxa) {
    var lim = limiar == null ? PREMIOS_LIMIAR_COMISSAO : +limiar;
    var tx = taxa == null ? PREMIOS_TAXA_COMISSAO : +taxa;
    var fat = Number(faturacao);
    if (!Number.isFinite(fat) || fat < lim) return 0;
    return (fat - lim) * tx;
  }

  /**
   * Recuperação trimestral: se fechou o trim, tecto − soma dos 3 prémios mensais.
   * tecto = 3 × mensal. Só prémios (não comissão).
   */
  function premiosRecuperacaoTrim(atingiuTrim, premiosMensais, tecto) {
    if (!atingiuTrim) return 0;
    var pago = 0;
    var lista = Array.isArray(premiosMensais) ? premiosMensais : [];
    for (var i = 0; i < lista.length; i++) pago += Number(lista[i]) || 0;
    var tec = Number(tecto) || 0;
    var rec = tec - pago;
    return rec > 0 ? rec : 0;
  }

  function premiosValorTrim(atingiuTrim, valorTrim) {
    if (!atingiuTrim) return 0;
    return Number(valorTrim) || 0;
  }

  /**
   * Calcula um mês + contexto de trimestre para uma pessoa.
   * mesesSerie: array de 1..12 com { vendas, obj } (índice 0 = Jan).
   * mesIdx: 0–11 do mês seleccionado.
   */
  function premiosCalcularPessoaMes(cfg, mesesSerie, mesIdx) {
    var pessoa = cfg || {};
    var serie = Array.isArray(mesesSerie) ? mesesSerie : [];
    var mi = mesIdx | 0;
    var cell = serie[mi] || {};
    var vendas = cell.vendas;
    var obj = cell.obj;
    var temVendas = !!cell.temVendas;
    var pct = premiosPctCumprimento(vendas, obj);
    var varPct = premiosVarObjPct(vendas, obj);
    var premio = premiosValorMensal(pct, pessoa.mensal);
    var comissao = pessoa.comissao ? premiosComissaoExcedente(vendas) : 0;
    var totalMes = premio + comissao;

    var trimIdx = Math.floor(mi / 3); // 0..3
    var m0 = trimIdx * 3;
    var mesesTrim = [serie[m0] || {}, serie[m0 + 1] || {}, serie[m0 + 2] || {}];
    var vendasTrim = 0;
    var objTrim = 0;
    var temObjTrim = false;
    var temVendTrim = false;
    var premiosMensaisTrim = [];
    for (var i = 0; i < 3; i++) {
      var c = mesesTrim[i];
      if (c.temVendas) {
        temVendTrim = true;
        vendasTrim += Number(c.vendas) || 0;
      }
      if (c.obj != null && Number.isFinite(+c.obj) && +c.obj > 0) {
        temObjTrim = true;
        objTrim += +c.obj;
      }
      var pctI = premiosPctCumprimento(c.vendas, c.obj);
      premiosMensaisTrim.push(premiosValorMensal(pctI, pessoa.mensal));
    }
    var pctTrim = temObjTrim ? premiosPctCumprimento(vendasTrim, objTrim) : null;
    var varPctTrim = temObjTrim ? premiosVarObjPct(vendasTrim, objTrim) : null;
    var atingiuTrim = premiosAtingiuMeta(pctTrim);
    var tecto = premiosTectoTrim(pessoa.mensal);
    var premioTrim = premiosValorTrim(atingiuTrim, pessoa.trim);
    var recuperacao = premiosRecuperacaoTrim(atingiuTrim, premiosMensaisTrim, tecto);
    var ehFechoTrim = (mi % 3) === 2;
    var totalFecho = ehFechoTrim ? (premioTrim + recuperacao + totalMes) : null;

    return {
      id: pessoa.id,
      nome: pessoa.nome,
      mensalCfg: pessoa.mensal,
      trimCfg: pessoa.trim,
      comissaoCfg: !!pessoa.comissao,
      mesIdx: mi,
      vendas: temVendas ? (Number(vendas) || 0) : null,
      temVendas: temVendas,
      obj: obj != null && Number.isFinite(+obj) ? +obj : null,
      pct: pct,
      varPct: varPct,
      atingiu: premiosAtingiuMeta(pct),
      premio: premio,
      comissao: comissao,
      totalMes: totalMes,
      trimIdx: trimIdx,
      vendasTrim: temVendTrim ? vendasTrim : null,
      objTrim: temObjTrim ? objTrim : null,
      pctTrim: pctTrim,
      varPctTrim: varPctTrim,
      atingiuTrim: atingiuTrim,
      tecto: tecto,
      premioTrim: premioTrim,
      recuperacao: recuperacao,
      premiosMensaisTrim: premiosMensaisTrim,
      ehFechoTrim: ehFechoTrim,
      totalFecho: totalFecho,
    };
  }

  function premiosCalcularQuadro(pessoasCfg, seriesPorId, mesIdx) {
    var lista = Array.isArray(pessoasCfg) ? pessoasCfg : PREMIOS_EQUIPA_PESSOAS;
    var out = [];
    var totPremio = 0;
    var totComissao = 0;
    var totMes = 0;
    var totRec = 0;
    var totTrim = 0;
    var nAtingiu = 0;
    for (var i = 0; i < lista.length; i++) {
      var cfg = lista[i];
      var serie = (seriesPorId && seriesPorId[cfg.id]) || [];
      var row = premiosCalcularPessoaMes(cfg, serie, mesIdx);
      out.push(row);
      totPremio += row.premio;
      totComissao += row.comissao;
      totMes += row.totalMes;
      if (row.ehFechoTrim) {
        totRec += row.recuperacao;
        totTrim += row.premioTrim;
      }
      if (row.atingiu) nAtingiu++;
    }
    return {
      mesIdx: mesIdx | 0,
      linhas: out,
      totais: {
        premio: totPremio,
        comissao: totComissao,
        totalMes: totMes,
        recuperacao: totRec,
        premioTrim: totTrim,
        nAtingiu: nAtingiu,
        n: out.length,
      },
    };
  }

  // ── Agregação vendas/objectivo a partir do quadro ──────────────

  function peHost() {
    return (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  }

  /** YYYY-MM → mês 1–12 (periodoComparacaoQuadro usa 1–12, NÃO 0–11). */
  function premiosYmParaMesAno(ym) {
    var s = String(ym || '');
    var y = parseInt(s.slice(0, 4), 10);
    var m = parseInt(s.slice(5, 7), 10);
    return { ano: y, mes: m };
  }

  function peSomarCanal(quadro, ym, empresa, canal, nomes, cods) {
    var h = peHost();
    var ma = premiosYmParaMesAno(ym);
    // periodoComparacaoQuadro(mes, ano) espera mês 1–12 (igual ao menu Vendas).
    var periodo = (typeof h.periodoComparacaoQuadro === 'function' && ma.mes >= 1 && ma.mes <= 12)
      ? h.periodoComparacaoQuadro(ma.mes, ma.ano)
      : { ym: ym, ymsSel: [ym] };
    var nomeMap = null;
    if (nomes && nomes.length) {
      nomeMap = {};
      for (var i = 0; i < nomes.length; i++) nomeMap[nomes[i]] = 1;
    }
    var met = (typeof h.metricasMenuCanal === 'function')
      ? h.metricasMenuCanal(quadro, periodo, empresa, canal, nomeMap, cods || null)
      : { n: 0, nTem: false };
    var obj = null;
    if (typeof h.objetivoPessoasNosMeses === 'function' && nomes && nomes.length) {
      obj = h.objetivoPessoasNosMeses(empresa, canal, nomes, [ym]);
    } else if (typeof h.objetivoCanalMes === 'function' && (!nomes || !nomes.length)) {
      obj = h.objetivoCanalMes(empresa, canal, ym);
    }
    return { vendas: met.n, temVendas: !!met.nTem, obj: obj };
  }

  function peMergeParts(parts) {
    var vendas = 0;
    var temVendas = false;
    var obj = 0;
    var temObj = false;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      if (p.temVendas) { temVendas = true; vendas += Number(p.vendas) || 0; }
      if (p.obj != null && Number.isFinite(+p.obj)) { temObj = true; obj += +p.obj; }
    }
    return { vendas: temVendas ? vendas : 0, temVendas: temVendas, obj: temObj ? obj : null };
  }

  function peCodsHoreca(canal, nomes) {
    var h = peHost();
    var cods = {};
    if (typeof h.codsDoNomeHoreca !== 'function') return cods;
    var lista = Array.isArray(nomes) ? nomes : [nomes];
    for (var i = 0; i < lista.length; i++) {
      var c = h.codsDoNomeHoreca(canal, lista[i]) || {};
      var keys = Object.keys(c);
      for (var k = 0; k < keys.length; k++) cods[keys[k]] = 1;
    }
    return cods;
  }

  function peEquipaFilipe() {
    var h = peHost();
    if (typeof h.expandirVendedoresEscolha === 'function') {
      return h.expandirVendedoresEscolha(['Filipe Neves']);
    }
    return ['Filipe Neves', 'Daniela Santos', 'Paulo Fontes', 'Hélcio Grégio'];
  }

  /**
   * Vendas + objectivo de uma pessoa num mês (YYYY-MM), a partir do vendas_quadro.
   */
  function premiosVendasObjScope(quadro, ym, scope) {
    var h = peHost();
    var DFB = 'Delta Foods Brasil';
    var QB = 'Q Brasil';
    var parts = [];

    if (scope === 'marcio') {
      parts.push(peSomarCanal(quadro, ym, DFB, 'Lojas online', ['Marcio Gorga']));
      parts.push(peSomarCanal(quadro, ym, DFB, 'Site próprio', ['Marcio Gorga']));
      parts.push(peSomarCanal(quadro, ym, DFB, 'Institucional', ['Marcio Gorga']));
      parts.push(peSomarCanal(quadro, ym, QB, 'Restauração', ['Marcio Gorga']));
      return peMergeParts(parts);
    }
    if (scope === 'massimo') {
      var eqM = (typeof h.expandirVendedoresEscolha === 'function')
        ? h.expandirVendedoresEscolha(['Massimo Bottello'])
        : ['Massimo Bottello', 'Eduardo Madeira'];
      parts.push(peSomarCanal(quadro, ym, DFB, 'Distribuidores regionais', eqM));
      parts.push(peSomarCanal(quadro, ym, QB, 'Distribuidores regionais', eqM));
      // Objectivo Massimo = canal inteiro (não somar Eduardo)
      var o1 = typeof h.objetivoCanalMes === 'function' ? h.objetivoCanalMes(DFB, 'Distribuidores regionais', ym) : null;
      var o2 = typeof h.objetivoCanalMes === 'function' ? h.objetivoCanalMes(QB, 'Distribuidores regionais', ym) : null;
      var merged = peMergeParts(parts);
      var obj = 0;
      var temObj = false;
      if (o1 != null) { obj += +o1; temObj = true; }
      if (o2 != null) { obj += +o2; temObj = true; }
      merged.obj = temObj ? obj : null;
      return merged;
    }
    if (scope === 'eduardo') {
      return peSomarCanal(quadro, ym, DFB, 'Distribuidores regionais', ['Eduardo Madeira']);
    }
    if (scope === 'diogo') {
      parts.push(peSomarCanal(quadro, ym, DFB, 'Retalho moderno', ['Diogo Oliveira']));
      parts.push(peSomarCanal(quadro, ym, DFB, 'Distribuidores de retalho', ['Diogo Oliveira']));
      parts.push(peSomarCanal(quadro, ym, QB, 'Retalho moderno', ['Diogo Oliveira']));
      parts.push(peSomarCanal(quadro, ym, QB, 'Distribuidores de retalho', ['Diogo Oliveira']));
      return peMergeParts(parts);
    }
    if (scope === 'filipe_equipa') {
      var eq = peEquipaFilipe();
      var canaisH = ['Restauração', 'Institucional'];
      for (var i = 0; i < canaisH.length; i++) {
        var canal = canaisH[i];
        var cods = peCodsHoreca(canal, eq);
        var met = peSomarCanal(quadro, ym, DFB, canal, eq, cods);
        // Objectivo Filipe ele+equipa = canal Horeca completo
        if (typeof h.objetivoCanalHorecaMenu === 'function') {
          met.obj = h.objetivoCanalHorecaMenu(DFB, canal, ym);
        }
        parts.push(met);
      }
      return peMergeParts(parts);
    }
    if (scope === 'helcio' || scope === 'daniela' || scope === 'paulo') {
      var nome = scope === 'helcio' ? 'Hélcio Grégio'
        : (scope === 'daniela' ? 'Daniela Santos' : 'Paulo Fontes');
      var canais = ['Restauração', 'Institucional'];
      for (var j = 0; j < canais.length; j++) {
        var c2 = canais[j];
        var cods2 = peCodsHoreca(c2, [nome]);
        var met2 = peSomarCanal(quadro, ym, DFB, c2, [nome], cods2);
        if (typeof h.objetivoVendedorHorecaMenu === 'function') {
          met2.obj = h.objetivoVendedorHorecaMenu(DFB, c2, nome, ym);
        }
        parts.push(met2);
      }
      return peMergeParts(parts);
    }
    return { vendas: 0, temVendas: false, obj: null };
  }

  function premiosSerieAno(quadro, ano, pessoaCfg) {
    var serie = [];
    for (var m = 1; m <= 12; m++) {
      var ym = String(ano) + '-' + String(m).padStart(2, '0');
      var cell = premiosVendasObjScope(quadro, ym, pessoaCfg.scope);
      serie.push(cell);
    }
    return serie;
  }

  function premiosMontarSeries(quadro, ano) {
    var map = {};
    for (var i = 0; i < PREMIOS_EQUIPA_PESSOAS.length; i++) {
      var p = PREMIOS_EQUIPA_PESSOAS[i];
      map[p.id] = premiosSerieAno(quadro, ano, p);
    }
    return map;
  }

  /** Tecto anual de prémios (12×mensal + 4×trim). Comissão não entra. */
  function premiosTectoAnual(cfg) {
    return (Number(cfg.mensal) || 0) * 12 + (Number(cfg.trim) || 0) * 4;
  }

  /** Tecto de prémios de Jan até mesIdx (0–11), inclusive. */
  function premiosTectoAteMes(cfg, mesIdx) {
    var mi = mesIdx | 0;
    if (mi < 0) return 0;
    if (mi > 11) mi = 11;
    var nMes = mi + 1;
    var nTrim = 0;
    for (var m = 2; m <= mi; m += 3) nTrim++;
    return (Number(cfg.mensal) || 0) * nMes + (Number(cfg.trim) || 0) * nTrim;
  }

  /** Prémios ganhos (mensal + trim + recuperação; sem comissão) até mesIdx. */
  function premiosGanhosAteMes(cfg, serie, mesIdx) {
    var ganho = 0;
    var mi = mesIdx | 0;
    for (var m = 0; m <= mi; m++) {
      var row = premiosCalcularPessoaMes(cfg, serie, m);
      ganho += Number(row.premio) || 0;
      if (row.ehFechoTrim) {
        ganho += Number(row.premioTrim) || 0;
        ganho += Number(row.recuperacao) || 0;
      }
    }
    return ganho;
  }

  /** % prémio do mês: só o mensal ÷ valor mensal (0 ou 100%). */
  function premiosScoreMesPct(cfg, serie, mesIdx) {
    var row = premiosCalcularPessoaMes(cfg, serie, mesIdx);
    var tec = Number(cfg.mensal) || 0;
    if (tec <= 0) return null;
    return (Number(row.premio) || 0) / tec;
  }

  /**
   * Scorecard anual: só % — prémios ganhos ÷ tecto possível (comissões fora).
   * Colunas Jan…Dez + Acum. até ao mês seleccionado.
   */
  function premiosCalcularScorecard(pessoasCfg, seriesPorId, ateMesIdx) {
    var lista = Array.isArray(pessoasCfg) ? pessoasCfg : PREMIOS_EQUIPA_PESSOAS;
    var ate = ateMesIdx == null ? 11 : (ateMesIdx | 0);
    if (ate < 0) ate = 0;
    if (ate > 11) ate = 11;
    var out = [];
    for (var i = 0; i < lista.length; i++) {
      var cfg = lista[i];
      var serie = (seriesPorId && seriesPorId[cfg.id]) || [];
      var mesesPct = [];
      for (var m = 0; m < 12; m++) {
        mesesPct.push(m <= ate ? premiosScoreMesPct(cfg, serie, m) : null);
      }
      var ganhos = premiosGanhosAteMes(cfg, serie, ate);
      var tecto = premiosTectoAteMes(cfg, ate);
      var acumPct = tecto > 0 ? ganhos / tecto : null;
      out.push({
        id: cfg.id,
        nome: cfg.nome,
        mesesPct: mesesPct,
        ganhos: ganhos,
        tecto: tecto,
        acumPct: acumPct,
        tectoAno: premiosTectoAnual(cfg),
      });
    }
    out.sort(function (a, b) {
      var va = a.acumPct == null ? -1 : a.acumPct;
      var vb = b.acumPct == null ? -1 : b.acumPct;
      return vb - va;
    });
    return { ateMesIdx: ate, linhas: out };
  }

  // ── UI ────────────────────────────────────────────────────────

  function peEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function peRs(n) {
    if (n == null || !Number.isFinite(+n)) return '—';
    return (+n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /** Formata variação vs obj: «+18,6%» / «−3%» (não base 100). */
  function peFmtVarObj(varPct) {
    if (varPct == null || !Number.isFinite(+varPct)) return '—';
    var p = (+varPct) * 100;
    var abs = Math.abs(p).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    if (p > 0) return '+' + abs + '%';
    if (p < 0) return '−' + abs + '%';
    return '0%';
  }

  /** Aceita cumprimento (vendas/obj) ou já a variação; mostra sempre vs objectivo. */
  function pePct(cumprimentoOuVar, jaEVar) {
    if (cumprimentoOuVar == null || !Number.isFinite(+cumprimentoOuVar)) return '—';
    var v = jaEVar ? +cumprimentoOuVar : (+cumprimentoOuVar - 1);
    return peFmtVarObj(v);
  }

  function peFillMesAno() {
    var mesEl = document.getElementById('pe-mes');
    var anoEl = document.getElementById('pe-ano');
    if (!mesEl || !anoEl) return;
    var now = new Date();
    if (_peMes == null) _peMes = now.getMonth();
    if (_peAno == null) _peAno = now.getFullYear();
    if (!mesEl.options.length) {
      for (var i = 0; i < 12; i++) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = PREMIOS_MESES[i];
        mesEl.appendChild(o);
      }
    }
    if (!anoEl.options.length) {
      for (var y = now.getFullYear(); y >= 2025; y--) {
        var oy = document.createElement('option');
        oy.value = String(y);
        oy.textContent = String(y);
        anoEl.appendChild(oy);
      }
    }
    mesEl.value = String(_peMes);
    anoEl.value = String(_peAno);
  }

  function peResumoHtml(modelo) {
    var t = modelo.totais;
    var filtro = _peFiltroId;
    function cell(id, label, valor, clicavel) {
      var ok = clicavel && valor != null && valor !== 0;
      var cls = ok ? ' style="cursor:pointer;text-decoration:underline;"' : '';
      var onclick = ok ? ' onclick="premiosEquipaFiltrarResumo(\'' + peEsc(id) + '\')"' : '';
      return '<div class="pe-sum-cell"' + cls + onclick + '>'
        + '<div style="font-size:11px;color:var(--muted);">' + peEsc(label) + '</div>'
        + '<div style="font-size:16px;font-weight:600;">' + valor + '</div></div>';
    }
    var atingTxt = t.nAtingiu + ' / ' + t.n;
    var html = '<div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:14px;">'
      + cell('atingiu', 'Atingiram meta', atingTxt, true)
      + cell('premio', 'Prémios mês', peRs(t.premio), true)
      + cell('comissao', 'Comissões 2,3%', peRs(t.comissao), true)
      + cell('total', 'Total a pagar', peRs(t.totalMes), false);
    if (modelo.linhas[0] && modelo.linhas[0].ehFechoTrim) {
      html += cell('trim', 'Prémio trim.', peRs(t.premioTrim), true)
        + cell('rec', 'Recuperação', peRs(t.recuperacao), true);
    }
    html += '</div>';
    if (filtro) {
      html += '<div class="vq-banner" style="margin-bottom:10px;"><span>Filtro resumo: <strong>'
        + peEsc(filtro) + '</strong></span>'
        + '<button type="button" class="btn btn-secondary btn-sm" onclick="premiosEquipaFiltrarResumo(\'\')">Limpar</button></div>';
    }
    return html;
  }

  function peLinhaPassaFiltro(row) {
    var f = _peFiltroId;
    if (!f) return true;
    if (f === 'atingiu') return !!row.atingiu;
    if (f === 'premio') return row.premio > 0;
    if (f === 'comissao') return row.comissao > 0;
    if (f === 'trim') return row.premioTrim > 0;
    if (f === 'rec') return row.recuperacao > 0;
    return true;
  }

  function peFmtScorePct(pct) {
    if (pct == null || !Number.isFinite(+pct)) return '—';
    return ((+pct) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '%';
  }

  function peTabelaHtml(modelo) {
    var fecho = modelo.linhas[0] && modelo.linhas[0].ehFechoTrim;
    // Sempre «Total a Pagar»: no mês normal = prémio+comissões; no fecho trim = totalFecho.
    var head = '<tr style="background:var(--bg-secondary);">'
      + '<th style="text-align:left;padding:8px 10px;">Vendedor</th>'
      + '<th style="text-align:right;padding:8px 10px;">Vendas</th>'
      + '<th style="text-align:right;padding:8px 10px;">Objectivo</th>'
      + '<th style="text-align:right;padding:8px 10px;">Var. obj. %</th>'
      + '<th style="text-align:right;padding:8px 10px;">Prémio</th>'
      + '<th style="text-align:right;padding:8px 10px;">Comissão</th>';
    if (fecho) {
      head += '<th style="text-align:right;padding:8px 10px;">Var. trim. %</th>'
        + '<th style="text-align:right;padding:8px 10px;">Prémio trim.</th>'
        + '<th style="text-align:right;padding:8px 10px;">Recuperação</th>';
    }
    head += '<th style="text-align:right;padding:8px 10px;">Total a Pagar</th></tr>';
    var body = '';
    var linhas = modelo.linhas.filter(peLinhaPassaFiltro);
    for (var i = 0; i < linhas.length; i++) {
      var r = linhas[i];
      var pctCls = r.atingiu ? 'color:#166534;font-weight:600;' : (r.varPct != null ? 'color:#b45309;' : '');
      body += '<tr style="border-bottom:1px solid var(--border);">'
        + '<td style="padding:8px 10px;">' + peEsc(r.nome)
        + (r.comissaoCfg ? ' <span style="font-size:11px;color:var(--muted);">(+2,3%)</span>' : '')
        + (r.id === 'filipe' ? ' <span style="font-size:11px;color:var(--muted);">ele+equipa</span>' : '')
        + '</td>'
        + '<td style="padding:8px 10px;text-align:right;">' + (r.temVendas ? peRs(r.vendas) : '—') + '</td>'
        + '<td style="padding:8px 10px;text-align:right;">' + peRs(r.obj) + '</td>'
        + '<td style="padding:8px 10px;text-align:right;' + pctCls + '">' + peFmtVarObj(r.varPct) + '</td>'
        + '<td style="padding:8px 10px;text-align:right;font-weight:600;">' + peRs(r.premio) + '</td>'
        + '<td style="padding:8px 10px;text-align:right;">' + (r.comissaoCfg ? peRs(r.comissao) : '—') + '</td>';
      if (fecho) {
        var trimCls = r.atingiuTrim ? 'color:#166534;font-weight:600;' : (r.varPctTrim != null ? 'color:#b45309;' : '');
        body += '<td style="padding:8px 10px;text-align:right;' + trimCls + '">' + peFmtVarObj(r.varPctTrim) + '</td>'
          + '<td style="padding:8px 10px;text-align:right;">' + peRs(r.premioTrim) + '</td>'
          + '<td style="padding:8px 10px;text-align:right;">' + peRs(r.recuperacao) + '</td>'
          + '<td style="padding:8px 10px;text-align:right;font-weight:700;">' + peRs(r.totalFecho) + '</td>';
      } else {
        body += '<td style="padding:8px 10px;text-align:right;font-weight:700;">' + peRs(r.totalMes) + '</td>';
      }
      body += '</tr>';
    }
    var nCols = fecho ? 10 : 7;
    if (!linhas.length) {
      body = '<tr><td colspan="' + nCols + '" style="padding:24px;text-align:center;color:var(--muted);">Nenhuma linha neste filtro.</td></tr>';
    }
    return '<div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">'
      + '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function peScorecardTabelaHtml(score, opts) {
    var o = opts || {};
    var email = !!o.email;
    var td = email
      ? 'border:1px solid #d1d5db;padding:6px 8px;font-family:Calibri,Arial,sans-serif;font-size:12px;'
      : 'padding:8px 6px;';
    var th = email
      ? td + 'background:#c8102e;color:#ffffff;font-weight:700;'
      : 'background:var(--bg-secondary);padding:8px 6px;';
    var head = '<tr' + (email ? '' : ' style="background:var(--bg-secondary);"') + '>'
      + '<th style="' + (email ? th + 'text-align:left;' : th + 'text-align:left;position:sticky;left:0;background:var(--bg-secondary);') + '">Vendedor</th>';
    for (var m = 0; m < 12; m++) {
      head += '<th style="' + th + 'text-align:right;">' + peEsc(PREMIOS_MESES[m].slice(0, 3)) + '</th>';
    }
    head += '<th style="' + th + 'text-align:right;font-weight:700;">Acum.</th></tr>';
    var body = '';
    for (var i = 0; i < score.linhas.length; i++) {
      var r = score.linhas[i];
      body += '<tr' + (email ? '' : ' style="border-bottom:1px solid var(--border);"') + '>'
        + '<td style="' + td + (email ? 'text-align:left;' : 'position:sticky;left:0;background:var(--bg);font-weight:600;') + '">' + peEsc(r.nome) + '</td>';
      for (var j = 0; j < 12; j++) {
        var p = r.mesesPct[j];
        var cls = '';
        if (p != null) cls = p >= 1 ? 'color:#166534;font-weight:600;' : (p > 0 ? 'color:#166534;' : 'color:#b45309;');
        body += '<td style="' + td + 'text-align:right;' + cls + '">' + peFmtScorePct(p) + '</td>';
      }
      var aCls = r.acumPct != null && r.acumPct >= 0.5 ? 'color:#166534;font-weight:700;' : 'font-weight:700;';
      body += '<td style="' + td + 'text-align:right;' + aCls + '">' + peFmtScorePct(r.acumPct) + '</td></tr>';
    }
    var tableStyle = email
      ? 'border-collapse:collapse;border:1px solid #c8102e;margin:0;'
      : 'width:100%;border-collapse:collapse;font-size:12px;';
    return '<table cellpadding="0" cellspacing="0" style="' + tableStyle + '">'
      + '<thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }

  function peScorecardHtml(score) {
    var ate = score.ateMesIdx | 0;
    var mesAte = PREMIOS_MESES[ate] || '';
    return '<p style="font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.45;">'
      + '% de prémios ganhos ÷ tecto possível (só prémios — comissões 2,3% fora). '
      + 'Acumulado até <strong>' + peEsc(mesAte) + '</strong>. Ordenado pelo acumulado.</p>'
      + '<div style="overflow:auto;">' + peScorecardTabelaHtml(score, { email: false }) + '</div>';
  }

  function peSaudacao(agora) {
    var d = agora || new Date();
    return d.getHours() < 12 ? 'Bom dia' : 'Boa tarde';
  }

  function peMontarEmail(opts) {
    var o = opts || {};
    var modelo = o.modelo || { linhas: [], totais: {} };
    var mesIdx = o.mesIdx | 0;
    var ano = o.ano | 0;
    var mesNome = PREMIOS_MESES[mesIdx] || '';
    var saudacao = peSaudacao(o.agora);
    var remetente = String(o.remetente || '').trim();
    var frase = 'segue abaixo a apuração do prémio referente ao mês ' + mesNome
      + ' para a devida contabilização e pagamento.';
    var fecho = modelo.linhas[0] && modelo.linhas[0].ehFechoTrim;
    var td = 'border:1px solid #d1d5db;padding:6px 10px;font-family:Calibri,Arial,sans-serif;font-size:12px;';
    var th = td + 'background:#c8102e;color:#ffffff;font-weight:700;';
    var cols = ['Vendedor', 'Vendas', 'Objectivo', 'Var. obj. %', 'Prémio', 'Comissão'];
    if (fecho) cols = cols.concat(['Var. trim. %', 'Prémio trim.', 'Recuperação']);
    cols.push('Total a Pagar');
    var textIdx = { 0: 1, 3: 1 };
    if (fecho) textIdx[6] = 1;
    var head = cols.map(function (c, i) {
      return '<th style="' + th + 'text-align:' + (i === 0 ? 'left' : 'right') + ';">' + peEsc(c) + '</th>';
    }).join('');
    var body = '';
    var aoaHead = cols.slice();
    var aoaRows = [aoaHead];
    for (var i = 0; i < modelo.linhas.length; i++) {
      var r = modelo.linhas[i];
      var vals = [
        r.nome + (r.id === 'filipe' ? ' (ele+equipa)' : ''),
        r.temVendas ? r.vendas : null,
        r.obj,
        peFmtVarObj(r.varPct),
        r.premio,
        r.comissaoCfg ? r.comissao : null,
      ];
      if (fecho) {
        vals.push(peFmtVarObj(r.varPctTrim), r.premioTrim, r.recuperacao, r.totalFecho);
      } else {
        vals.push(r.totalMes);
      }
      aoaRows.push(vals.map(function (v, idx) {
        if (textIdx[idx]) return v == null ? '' : String(v);
        return v == null || !Number.isFinite(+v) ? '' : +v;
      }));
      body += '<tr>';
      for (var c = 0; c < vals.length; c++) {
        var align = c === 0 ? 'left' : 'right';
        var txt;
        if (textIdx[c]) txt = peEsc(vals[c] == null ? '—' : vals[c]);
        else if (vals[c] == null || !Number.isFinite(+vals[c])) txt = '—';
        else txt = peEsc(peRs(vals[c]));
        body += '<td style="' + td + 'text-align:' + align + ';">' + txt + '</td>';
      }
      body += '</tr>';
    }
    var tot = modelo.totais || {};
    var totPagar = fecho
      ? (tot.totalMes || 0) + (tot.premioTrim || 0) + (tot.recuperacao || 0)
      : (tot.totalMes || 0);
    var totVals = ['Total', '', '', '', tot.premio, tot.comissao];
    if (fecho) totVals = totVals.concat(['', tot.premioTrim, tot.recuperacao]);
    totVals.push(totPagar);
    aoaRows.push(totVals.map(function (v, idx) {
      if (textIdx[idx] || idx === 0) return v == null ? '' : String(v);
      return v == null || !Number.isFinite(+v) ? '' : +v;
    }));
    body += '<tr style="font-weight:700;background:#f3f4f6;">';
    for (var t = 0; t < totVals.length; t++) {
      var ta = t === 0 ? 'left' : 'right';
      var tv = totVals[t];
      var tt = (textIdx[t] || t === 0 || tv === '') ? peEsc(tv === '' ? '' : String(tv))
        : peEsc(peRs(tv));
      body += '<td style="' + td + 'text-align:' + ta + ';">' + tt + '</td>';
    }
    body += '</tr>';
    var tabela = '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #c8102e;margin:12px 0;">'
      + '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
      + '<body style="font-family:Calibri,Arial,sans-serif;font-size:14px;color:#111827;line-height:1.45;">'
      + '<div>' + peEsc(saudacao) + ',</div>'
      + '<div style="margin-top:12px;">' + peEsc(frase) + '</div>'
      + tabela
      + '<div style="margin-top:12px;">Obrigado,'
      + (remetente ? '<br>' + peEsc(remetente) : '')
      + '</div></body></html>';
    var texto = [saudacao + ',', '', frase, '', 'Obrigado,', remetente].filter(Boolean).join('\n');
    var mm = String(mesIdx + 1).padStart(2, '0');
    return {
      to: '',
      cc: '',
      subject: 'Prémios Equipa de Vendas — ' + mesNome + ' ' + ano,
      html: html,
      texto: texto,
      filename: 'Premios_Equipa_' + ano + '-' + mm + '.xlsx',
      folhas: [{
        name: 'Apuramento',
        tipos: cols.map(function (_, idx) {
          if (textIdx[idx]) return 'text';
          return 'rs';
        }),
        cols: cols.map(function (_, idx) { return { wch: idx === 0 ? 28 : 14 }; }),
        rows: aoaRows,
      }],
    };
  }

  function peBlobXlsx(folhas) {
    var XLSX = (typeof window !== 'undefined' && window.XLSX) ? window.XLSX : null;
    if (!XLSX || !XLSX.utils) throw new Error('Excel indisponível');
    var wb = XLSX.utils.book_new();
    var lista = folhas || [];
    for (var i = 0; i < lista.length; i++) {
      var f = lista[i];
      var ws = XLSX.utils.aoa_to_sheet(f.rows || []);
      if (f.cols) ws['!cols'] = f.cols;
      if (f.tipos && ws['!ref']) {
        var range = XLSX.utils.decode_range(ws['!ref']);
        for (var R = range.s.r + 1; R <= range.e.r; R++) {
          for (var C = range.s.c; C <= range.e.c && C < f.tipos.length; C++) {
            if (f.tipos[C] !== 'rs') continue;
            var addr = XLSX.utils.encode_cell({ r: R, c: C });
            var cell = ws[addr];
            if (!cell || typeof cell.v !== 'number') continue;
            cell.z = '"R$"#,##0.00';
          }
        }
      }
      if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };
      XLSX.utils.book_append_sheet(wb, ws, f.name || ('Folha' + (i + 1)));
    }
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function peScorecardFolha(score, ano) {
    var head = ['Vendedor'].concat(PREMIOS_MESES.map(function (n) { return n.slice(0, 3); })).concat(['Acum. %']);
    var rows = [head];
    for (var i = 0; i < score.linhas.length; i++) {
      var r = score.linhas[i];
      var line = [r.nome];
      for (var m = 0; m < 12; m++) {
        var p = r.mesesPct[m];
        line.push(p == null ? '' : Math.round(p * 100) / 100);
      }
      line.push(r.acumPct == null ? '' : Math.round(r.acumPct * 1000) / 1000);
      rows.push(line);
    }
    return {
      name: 'Scorecard ' + ano,
      tipos: head.map(function (_, i) { return i === 0 ? 'text' : 'pct'; }),
      cols: head.map(function (_, i) { return { wch: i === 0 ? 22 : 8 }; }),
      rows: rows,
    };
  }

  async function premiosEquipaExportarEmail() {
    var btn = typeof document !== 'undefined' ? document.getElementById('pe-btn-email') : null;
    if (btn) btn.disabled = true;
    try {
      if (!_peModelo || !_peSeries) {
        if (typeof toast === 'function') toast('Aguarda o quadro carregar.', 'warn');
        return;
      }
      var remetente = typeof getUtilizadorAtual === 'function' ? String(getUtilizadorAtual() || '').trim() : '';
      var email;
      var folhas;
      if (_peVista === 'scorecard' && _peScore) {
        // Scorecard: só a tabela (sem saudação / fecho).
        email = {
          to: '',
          cc: '',
          subject: 'Scorecard Prémios Equipa — ' + _peAno,
          html: '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
            + '<body style="font-family:Calibri,Arial,sans-serif;font-size:14px;color:#111827;">'
            + peScorecardTabelaHtml(_peScore, { email: true })
            + '</body></html>',
          texto: '',
          filename: 'Premios_Scorecard_' + _peAno + '.xlsx',
        };
        folhas = [peScorecardFolha(_peScore, _peAno)];
      } else {
        email = peMontarEmail({
          modelo: _peModelo,
          mesIdx: _peMes,
          ano: _peAno,
          remetente: remetente,
          agora: new Date(),
        });
        folhas = email.folhas.slice();
      }
      if (typeof toast === 'function') toast('A gerar Excel…');
      if (typeof ensureXLSX === 'function') await ensureXLSX();
      var blob = peBlobXlsx(folhas);
      // Idêntico à Comissão de RC: outlookAbrirRascunho global (ponte serve.ps1).
      if (typeof outlookAbrirRascunho !== 'function') {
        if (typeof triggerBlobDownload === 'function') triggerBlobDownload(blob, email.filename);
        if (typeof toast === 'function') toast('Excel descarregado. O Outlook não está disponível neste ecrã.', 'warn');
        return;
      }
      await outlookAbrirRascunho({
        to: email.to,
        cc: email.cc,
        subject: email.subject,
        html: email.html,
        attachments: [{
          blob: blob,
          filename: email.filename,
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }],
        draftName: email.filename.replace(/\.xlsx$/i, '') + '.eml',
        toastMsg: '📧 Outlook aberto com a tabela no corpo e o Excel em anexo.',
        mailtoFallback: {
          body: email.texto,
          toastMsg: '📧 Outlook a abrir. Anexa o Excel descarregado ao email.',
        },
        ccExact: true,
      });
    } catch (e) {
      console.error('premiosEquipaExportarEmail', e);
      if (typeof toast === 'function') toast('Erro ao exportar: ' + (e && e.message ? e.message : e), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function showPremiosEquipaSub(sub) {
    _peVista = sub === 'scorecard' ? 'scorecard' : 'mensal';
    var mesWrap = document.getElementById('pe-mes-wrap');
    if (mesWrap) mesWrap.style.display = '';
    document.getElementById('pe-sub-mensal')?.classList.toggle('active', _peVista === 'mensal');
    document.getElementById('pe-sub-score')?.classList.toggle('active', _peVista === 'scorecard');
    var lead = document.getElementById('pe-lead');
    if (lead) {
      lead.textContent = _peVista === 'scorecard'
        ? '% de prémios ganhos face ao tecto possível (mensal + trim.). Comissões 2,3% não entram. Útil para ranking nas áreas comerciais.'
        : 'Apuramento automático (vendas ÷ objectivo). Meta ≥ 100%. Hélcio e Daniela: 2,3% acima de R$ 55.000. Trimestre: prémio + recuperação.';
    }
    renderPremiosEquipa();
  }

  async function renderPremiosEquipa() {
    var host = document.getElementById('pe-host');
    if (!host) return;
    peFillMesAno();
    var mesEl = document.getElementById('pe-mes');
    var anoEl = document.getElementById('pe-ano');
    _peMes = mesEl ? parseInt(mesEl.value, 10) : 0;
    _peAno = anoEl ? parseInt(anoEl.value, 10) : new Date().getFullYear();
    var gen = ++_peGen;
    host.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:12px 0;">A calcular prémios…</div>';

    var h = peHost();
    var quadro = null;
    try {
      if (typeof h.lerVendasQuadroPersistida === 'function') {
        quadro = await h.lerVendasQuadroPersistida();
      }
    } catch (e) {
      console.warn('premios lerVendasQuadro', e);
    }
    if (gen !== _peGen) return;

    if (!quadro || !quadro.meses) {
      host.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:24px 0;text-align:center;">'
        + 'Sem quadro de vendas. Carrega o Excel SAP em <strong>Dados → Vendas</strong> e publica o quadro.</div>';
      return;
    }

    var series = premiosMontarSeries(quadro, _peAno);
    _peSeries = series;
    _peModelo = premiosCalcularQuadro(PREMIOS_EQUIPA_PESSOAS, series, _peMes);
    _peScore = premiosCalcularScorecard(PREMIOS_EQUIPA_PESSOAS, series, _peMes);

    if (_peVista === 'scorecard') {
      host.innerHTML = peScorecardHtml(_peScore);
      return;
    }

    var mesNome = PREMIOS_MESES[_peMes] || '';
    var lead = '<p style="font-size:12px;color:var(--muted);margin:0 0 12px;line-height:1.45;">'
      + peEsc(mesNome) + ' ' + peEsc(_peAno)
      + ' — meta mensal ≥ 100%. Hélcio e Daniela: comissão 2,3% sobre o excedente acima de R$ 55.000. '
      + 'No fecho do trimestre (Mar/Jun/Set/Dez), prémio trim. + recuperação do que falhou nos meses.</p>';

    host.innerHTML = lead + peResumoHtml(_peModelo) + peTabelaHtml(_peModelo);
  }

  function premiosEquipaFiltrarResumo(id) {
    _peFiltroId = id || '';
    renderPremiosEquipa();
  }

  function premiosEquipaOnPeriodoChange() {
    var mesEl = document.getElementById('pe-mes');
    var anoEl = document.getElementById('pe-ano');
    if (mesEl) _peMes = parseInt(mesEl.value, 10);
    if (anoEl) _peAno = parseInt(anoEl.value, 10);
    _peFiltroId = '';
    renderPremiosEquipa();
  }

  return {
    PREMIOS_LIMIAR_COMISSAO: PREMIOS_LIMIAR_COMISSAO,
    PREMIOS_TAXA_COMISSAO: PREMIOS_TAXA_COMISSAO,
    PREMIOS_EQUIPA_PESSOAS: PREMIOS_EQUIPA_PESSOAS,
    PREMIOS_MESES: PREMIOS_MESES,
    premiosTectoTrim: premiosTectoTrim,
    premiosTectoAnual: premiosTectoAnual,
    premiosTectoAteMes: premiosTectoAteMes,
    premiosGanhosAteMes: premiosGanhosAteMes,
    premiosPctCumprimento: premiosPctCumprimento,
    premiosVarObjPct: premiosVarObjPct,
    premiosYmParaMesAno: premiosYmParaMesAno,
    peFmtVarObj: peFmtVarObj,
    peFmtScorePct: peFmtScorePct,
    premiosAtingiuMeta: premiosAtingiuMeta,
    premiosValorMensal: premiosValorMensal,
    premiosComissaoExcedente: premiosComissaoExcedente,
    premiosRecuperacaoTrim: premiosRecuperacaoTrim,
    premiosValorTrim: premiosValorTrim,
    premiosCalcularPessoaMes: premiosCalcularPessoaMes,
    premiosCalcularQuadro: premiosCalcularQuadro,
    premiosCalcularScorecard: premiosCalcularScorecard,
    premiosVendasObjScope: premiosVendasObjScope,
    premiosSerieAno: premiosSerieAno,
    premiosMontarSeries: premiosMontarSeries,
    peMontarEmail: peMontarEmail,
    renderPremiosEquipa: renderPremiosEquipa,
    showPremiosEquipaSub: showPremiosEquipaSub,
    premiosEquipaFiltrarResumo: premiosEquipaFiltrarResumo,
    premiosEquipaOnPeriodoChange: premiosEquipaOnPeriodoChange,
    premiosEquipaExportarEmail: premiosEquipaExportarEmail,
  };
});
