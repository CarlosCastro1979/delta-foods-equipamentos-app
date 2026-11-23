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

  function peTabelaHtml(modelo) {
    var fecho = modelo.linhas[0] && modelo.linhas[0].ehFechoTrim;
    var head = '<tr style="background:var(--bg-secondary);">'
      + '<th style="text-align:left;padding:8px 10px;">Vendedor</th>'
      + '<th style="text-align:right;padding:8px 10px;">Vendas</th>'
      + '<th style="text-align:right;padding:8px 10px;">Objectivo</th>'
      + '<th style="text-align:right;padding:8px 10px;">Var. obj. %</th>'
      + '<th style="text-align:right;padding:8px 10px;">Prémio</th>'
      + '<th style="text-align:right;padding:8px 10px;">Comissão</th>'
      + '<th style="text-align:right;padding:8px 10px;">Total mês</th>';
    if (fecho) {
      head += '<th style="text-align:right;padding:8px 10px;">Prémio trim.</th>'
        + '<th style="text-align:right;padding:8px 10px;">Recuperação</th>'
        + '<th style="text-align:right;padding:8px 10px;">Total fecho</th>';
    }
    head += '</tr>';
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
        + '<td style="padding:8px 10px;text-align:right;">' + (r.comissaoCfg ? peRs(r.comissao) : '—') + '</td>'
        + '<td style="padding:8px 10px;text-align:right;font-weight:700;">' + peRs(r.totalMes) + '</td>';
      if (fecho) {
        body += '<td style="padding:8px 10px;text-align:right;">' + peRs(r.premioTrim) + '</td>'
          + '<td style="padding:8px 10px;text-align:right;">' + peRs(r.recuperacao) + '</td>'
          + '<td style="padding:8px 10px;text-align:right;font-weight:700;">' + peRs(r.totalFecho) + '</td>';
      }
      body += '</tr>';
    }
    if (!linhas.length) {
      body = '<tr><td colspan="' + (fecho ? 10 : 7) + '" style="padding:24px;text-align:center;color:var(--muted);">Nenhuma linha neste filtro.</td></tr>';
    }
    return '<div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">'
      + '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
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
    var modelo = premiosCalcularQuadro(PREMIOS_EQUIPA_PESSOAS, series, _peMes);
    var mesNome = PREMIOS_MESES[_peMes] || '';
    var lead = '<p style="font-size:12px;color:var(--muted);margin:0 0 12px;line-height:1.45;">'
      + peEsc(mesNome) + ' ' + peEsc(_peAno)
      + ' — meta mensal ≥ 100%. Hélcio e Daniela: comissão 2,3% sobre o excedente acima de R$ 55.000. '
      + 'No fecho do trimestre (Mar/Jun/Set/Dez), prémio trim. + recuperação do que falhou nos meses.</p>';

    host.innerHTML = lead + peResumoHtml(modelo) + peTabelaHtml(modelo);
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
    premiosPctCumprimento: premiosPctCumprimento,
    premiosVarObjPct: premiosVarObjPct,
    premiosYmParaMesAno: premiosYmParaMesAno,
    peFmtVarObj: peFmtVarObj,
    premiosAtingiuMeta: premiosAtingiuMeta,
    premiosValorMensal: premiosValorMensal,
    premiosComissaoExcedente: premiosComissaoExcedente,
    premiosRecuperacaoTrim: premiosRecuperacaoTrim,
    premiosValorTrim: premiosValorTrim,
    premiosCalcularPessoaMes: premiosCalcularPessoaMes,
    premiosCalcularQuadro: premiosCalcularQuadro,
    premiosVendasObjScope: premiosVendasObjScope,
    premiosSerieAno: premiosSerieAno,
    premiosMontarSeries: premiosMontarSeries,
    renderPremiosEquipa: renderPremiosEquipa,
    premiosEquipaFiltrarResumo: premiosEquipaFiltrarResumo,
    premiosEquipaOnPeriodoChange: premiosEquipaOnPeriodoChange,
  };
});
