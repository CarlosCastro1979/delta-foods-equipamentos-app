/**
 * Comissão de RC — 4% da faturação mensal (Fatur.) dos clientes de cada RC.
 * O mapa vem de lista_clientes id=comissao_rc, com seed local se a cloud falhar.
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

  var COMISSAO_RC_TAXA = 0.04;
  var COMISSAO_RC_SUPA_ID = 'comissao_rc';
  /** NPess do vendedor Diogo Oliveira. Qualquer um destes, ou um nome com «Diogo», fica de fora. */
  var COMISSAO_RC_NPESS_DIOGO = {
    99520004: 1,
    99520018: 1,
    99530001: 1,
    99530005: 1,
  };

  var _crFiltro = '';
  var _crMapa = null;
  var _crMes = null;
  var _crGen = 0;
  var _crDeepLinkUsado = false;

  function normCodRc(cod) {
    var s = String(cod == null ? '' : cod).trim();
    if (!s) return '';
    return s.replace(/^0+/, '') || s;
  }

  function normNomeRc(nome) {
    return String(nome == null ? '' : nome).replace(/\s+/g, ' ').trim();
  }

  function pessoaEhDiogo(nome, npess) {
    if (/diogo/i.test(normNomeRc(nome))) return true;
    var n = parseInt(npess, 10);
    return !!(n && COMISSAO_RC_NPESS_DIOGO[n]);
  }

  function ordenarRcs(rcs) {
    return rcs.slice().sort(function (a, b) {
      return normNomeRc(a.nome).localeCompare(normNomeRc(b.nome), 'pt');
    });
  }

  /**
   * Aceita { rcs: [{ nome, npess, clientes: [{ cod, nome }] }] }
   * ou { atribuicoes: [{ pessoa, npess, cod, nome }] }.
   * Linhas de Diogo saem. Códigos repetidos no mesmo RC ficam uma vez.
   */
  function normalizarMapaComissaoRc(raw) {
    var rcs = [];
    var porNome = {};
    function garantir(nome, npess) {
      var chave = normNomeRc(nome);
      if (!chave || pessoaEhDiogo(chave, npess)) return null;
      var k = chave.toUpperCase();
      if (!porNome[k]) {
        porNome[k] = { nome: chave, clientes: [], _cods: {} };
        rcs.push(porNome[k]);
      }
      return porNome[k];
    }
    function acrescentar(rc, cod, nomeCli) {
      var c = normCodRc(cod);
      if (!rc || !c || rc._cods[c]) return;
      rc._cods[c] = 1;
      rc.clientes.push({ cod: c, nome: normNomeRc(nomeCli) });
    }
    var src = raw && typeof raw === 'object' ? raw : {};
    var listaRc = Array.isArray(src.rcs) ? src.rcs : [];
    for (var i = 0; i < listaRc.length; i++) {
      var rc = listaRc[i];
      if (!rc) continue;
      var alvo = garantir(rc.nome || rc.pessoa, rc.npess);
      var cls = Array.isArray(rc.clientes) ? rc.clientes : [];
      for (var j = 0; j < cls.length; j++) {
        var cli = cls[j] || {};
        acrescentar(alvo, cli.cod != null ? cli.cod : cli, cli.nome);
      }
    }
    var linhas = Array.isArray(src.atribuicoes) ? src.atribuicoes : (Array.isArray(raw) ? raw : []);
    for (var a = 0; a < linhas.length; a++) {
      var linha = linhas[a];
      if (!linha) continue;
      var pessoa = linha.pessoa || linha.rc || linha.vendedor || linha.nomeRc;
      var bucket = garantir(pessoa, linha.npess);
      acrescentar(bucket, linha.cod, linha.nome || linha.nomeCliente);
    }
    var limpos = [];
    for (var r = 0; r < rcs.length; r++) {
      var item = rcs[r];
      item.clientes.sort(function (x, y) {
        return normNomeRc(x.nome).localeCompare(normNomeRc(y.nome), 'pt') || x.cod.localeCompare(y.cod);
      });
      limpos.push({ nome: item.nome, clientes: item.clientes });
    }
    return {
      taxa: COMISSAO_RC_TAXA,
      rcs: ordenarRcs(limpos),
    };
  }

  function mapaDeLinhasComissaoRc(linhas) {
    return normalizarMapaComissaoRc({ atribuicoes: linhas || [] });
  }

  function clientesDoMesRc(mes) {
    if (!mes || typeof mes !== 'object') return {};
    if (mes.clientes && typeof mes.clientes === 'object') return mes.clientes;
    return {};
  }

  /** Soma o Fatur. de um código no mês (várias linhas NPess do mesmo código entram todas). */
  function faturCodNoMes(mes, cod) {
    var alvo = normCodRc(cod);
    var clientes = clientesDoMesRc(mes);
    var chaves = Object.keys(clientes);
    var cents = 0;
    var tem = false;
    var nome = '';
    for (var i = 0; i < chaves.length; i++) {
      var c = clientes[chaves[i]];
      if (!c) continue;
      if (normCodRc(c.cod) !== alvo) continue;
      var v = Number(c.valor);
      if (!Number.isFinite(v)) continue;
      cents += Math.round(v * 100);
      tem = true;
      if (!nome && c.nome) nome = normNomeRc(c.nome);
    }
    return { valor: cents / 100, tem: tem, nome: nome };
  }

/** 4% da faturação, em reais (cêntimo). */
function comissaoDeFaturacao(faturacao) {
  var f = Number(faturacao);
  if (!Number.isFinite(f)) f = 0;
  return Math.round(f * COMISSAO_RC_TAXA * 100) / 100;
}

  /**
   * Resumo do mês. Clientes do mapa sem Fatur. ficam a 0 (não aumentam a comissão).
   * Fatur. negativo reduz a soma. Um código que não está no RC não entra.
   */
  function calcularComissaoRc(mapa, mes) {
    var base = normalizarMapaComissaoRc(mapa);
    var linhas = [];
    var totalFatCents = 0;
    var totalComCents = 0;
    for (var i = 0; i < base.rcs.length; i++) {
      var rc = base.rcs[i];
      var clientes = [];
      var fatCents = 0;
      for (var j = 0; j < rc.clientes.length; j++) {
        var cli = rc.clientes[j];
        var fat = faturCodNoMes(mes, cli.cod);
        var valor = fat.tem ? fat.valor : 0;
        fatCents += Math.round(valor * 100);
        clientes.push({
          cod: cli.cod,
          nome: fat.nome || cli.nome || '',
          faturacao: valor,
          comissao: comissaoDeFaturacao(valor),
          tem: fat.tem,
        });
      }
      clientes.sort(function (a, b) {
        if (b.faturacao !== a.faturacao) return b.faturacao - a.faturacao;
        return normNomeRc(a.nome).localeCompare(normNomeRc(b.nome), 'pt') || a.cod.localeCompare(b.cod);
      });
      var faturacao = fatCents / 100;
      var comissao = comissaoDeFaturacao(faturacao);
      totalFatCents += fatCents;
      totalComCents += Math.round(comissao * 100);
      linhas.push({
        nome: rc.nome,
        nClientes: clientes.length,
        faturacao: faturacao,
        comissao: comissao,
        clientes: clientes,
      });
    }
    linhas.sort(function (a, b) {
      if (b.faturacao !== a.faturacao) return b.faturacao - a.faturacao;
      return a.nome.localeCompare(b.nome, 'pt');
    });
    var totalFat = totalFatCents / 100;
    return {
      taxa: COMISSAO_RC_TAXA,
      linhas: linhas,
      total: {
        nClientes: linhas.reduce(function (s, r) { return s + r.nClientes; }, 0),
        faturacao: totalFat,
        comissao: totalComCents / 100,
      },
    };
  }

  function ultimoYmComFaturCliente(store) {
    var meses = (store && store.meses) || {};
    var keys = Object.keys(meses).filter(function (ym) { return /^\d{4}-\d{2}$/.test(ym); }).sort();
    for (var i = keys.length - 1; i >= 0; i--) {
      var clientes = (meses[keys[i]] && meses[keys[i]].clientes) || {};
      var ck = Object.keys(clientes);
      for (var j = 0; j < ck.length; j++) {
        var v = Number(clientes[ck[j]] && clientes[ck[j]].valor) || 0;
        if (v !== 0) return keys[i];
      }
    }
    return '';
  }

  function seedMapaComissaoRc() {
    var seed = typeof COMISSAO_RC_MAPA_SEED !== 'undefined' ? COMISSAO_RC_MAPA_SEED : null;
    return normalizarMapaComissaoRc(seed);
  }

  function crEsc(s) {
    if (typeof escHtml === 'function') return escHtml(s);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function crRs(n) {
    if (typeof formatValorQuadroRs === 'function') return formatValorQuadroRs(n, true);
    var v = Number(n) || 0;
    try {
      return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    } catch (e) {
      return 'R$ ' + v.toFixed(2);
    }
  }

  function crPeriodo() {
    var mesEl = document.getElementById('cr-mes');
    var anoEl = document.getElementById('cr-ano');
    var now = new Date();
    var mes = parseInt(mesEl && mesEl.value, 10) || (now.getMonth() + 1);
    var ano = parseInt(anoEl && anoEl.value, 10) || now.getFullYear();
    return { mes: mes, ano: ano, ym: ano + '-' + String(mes).padStart(2, '0') };
  }

  function preencherSelectsComissaoRc() {
    var mesEl = document.getElementById('cr-mes');
    var anoEl = document.getElementById('cr-ano');
    if (!mesEl || !anoEl) return;
    var abrev = (typeof VENDAS_MES_ABREV !== 'undefined' && VENDAS_MES_ABREV) ||
      ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    if (!mesEl.options.length) {
      var mesHoje = new Date().getMonth() + 1;
      var html = '';
      for (var i = 0; i < abrev.length; i++) {
        var marca = (i + 1) === mesHoje ? ' · actual' : '';
        html += '<option value="' + (i + 1) + '">' + abrev[i] + marca + '</option>';
      }
      mesEl.innerHTML = html;
    }
    if (!anoEl.options.length) {
      var ini = (typeof VENDAS_COBERTURA_INICIO !== 'undefined' && VENDAS_COBERTURA_INICIO && VENDAS_COBERTURA_INICIO.y) || 2019;
      var nowY = new Date().getFullYear();
      var anos = '';
      for (var y = ini; y <= nowY; y++) anos += '<option value="' + y + '">' + y + '</option>';
      anoEl.innerHTML = anos;
    }
    if (!mesEl.dataset.ready) {
      var now = new Date();
      mesEl.value = String(now.getMonth() + 1);
      anoEl.value = String(now.getFullYear());
      mesEl.dataset.ready = '1';
    }
  }

  async function lerMapaComissaoRc() {
    var seed = seedMapaComissaoRc();
    var url = typeof LISTA_CLIENTES_SUPA_URL !== 'undefined'
      ? LISTA_CLIENTES_SUPA_URL
      : 'https://qnscwppgljobelplgbkp.supabase.co/rest/v1/lista_clientes';
    var key = typeof SUPA_KEY !== 'undefined' ? SUPA_KEY : '';
    if (!key || typeof fetch !== 'function') return seed;
    try {
      var res = await fetch(url + '?id=eq.' + COMISSAO_RC_SUPA_ID + '&select=data', {
        headers: { apikey: key, Authorization: 'Bearer ' + key },
      });
      if (!res.ok) return seed;
      var rows = await res.json();
      var data = rows && rows[0] && rows[0].data;
      var remoto = normalizarMapaComissaoRc(data);
      if (remoto.rcs.length) return remoto;
    } catch (e) {
      console.warn('lerMapaComissaoRc:', e && e.message ? e.message : e);
    }
    return seed;
  }

  function crNomeMes(ym) {
    var abrev = (typeof VENDAS_MES_ABREV !== 'undefined' && VENDAS_MES_ABREV) || [];
    var p = String(ym || '').split('-');
    var m = parseInt(p[1], 10);
    var nome = abrev[m - 1] || p[1] || '';
    return nome && p[0] ? (nome + '/' + p[0]) : ym;
  }

  function crBotaoNome(nome, n, activo) {
    if (!(n > 0)) return crEsc(nome);
    var on = activo ? ' vq-on' : '';
    return '<button type="button" class="vq-link' + on + '" onclick="crFiltrar(\'' +
      encodeURIComponent(nome) + '\')">' + crEsc(nome) + '</button>';
  }

  function crBotaoContagem(n, nome) {
    if (!(n > 0)) return '<span class="vq-muted">' + (n === 0 ? '0' : '—') + '</span>';
    return '<button type="button" class="vq-link" onclick="crFiltrar(\'' +
      encodeURIComponent(nome) + '\')">' + n + '</button>';
  }

  function pintarComissaoRc(store) {
    var host = document.getElementById('cr-host');
    if (!host || !_crMapa) return;
    var periodo = crPeriodo();
    var mes = store && store.meses ? store.meses[periodo.ym] : null;
    _crMes = mes || { clientes: {} };
    var modelo = calcularComissaoRc(_crMapa, _crMes);
    var filtro = _crFiltro;
    var linhaFiltro = null;
    if (filtro) {
      for (var i = 0; i < modelo.linhas.length; i++) {
        if (modelo.linhas[i].nome === filtro) linhaFiltro = modelo.linhas[i];
      }
      if (!linhaFiltro) filtro = '';
    }
    var ultimo = ultimoYmComFaturCliente(store);
    var aviso = '';
    if (modelo.total.faturacao === 0 && ultimo && ultimo !== periodo.ym) {
      aviso = '<div class="vcob-note">Este mês não tem Fatur. nestes clientes. Último mês com movimento na base: <strong>' +
        crEsc(crNomeMes(ultimo)) + '</strong>.</div>';
    }
    var banner = '';
    if (filtro && linhaFiltro) {
      banner = '<div class="vq-banner"><span>Filtro: RC: ' + crEsc(filtro) +
        '</span><button type="button" class="btn btn-secondary btn-sm" onclick="crLimparFiltro()">Limpar</button></div>';
    }
    var body = '';
    for (var r = 0; r < modelo.linhas.length; r++) {
      var row = modelo.linhas[r];
      var on = filtro === row.nome;
      var clsFat = row.faturacao < 0 ? ' vq-var-neg' : '';
      var clsCom = row.comissao < 0 ? ' vq-var-neg' : '';
      body += '<tr class="' + (on ? 'vq-emp' : 'vq-vend') + '">' +
        '<td>' + crBotaoNome(row.nome, row.nClientes, on) + '</td>' +
        '<td class="vq-num">' + crBotaoContagem(row.nClientes, row.nome) + '</td>' +
        '<td class="vq-num' + clsFat + '">' + crEsc(crRs(row.faturacao)) + '</td>' +
        '<td class="vq-num' + clsCom + '">' + crEsc(crRs(row.comissao)) + '</td>' +
        '</tr>';
    }
    if (!modelo.linhas.length) {
      body = '<tr><td colspan="4" class="vq-muted" style="padding:16px;">Sem RC no mapa (Diogo fica de fora).</td></tr>';
    }
    var tot = modelo.total;
    var totalCount = tot.nClientes > 0
      ? '<button type="button" class="vq-link" onclick="crLimparFiltro()" title="Mostrar todos os clientes">' + tot.nClientes + '</button>'
      : '<span class="vq-muted">0</span>';
    var detalhe = '';
    var listaDet = [];
    if (filtro && linhaFiltro) {
      listaDet = linhaFiltro.clientes.map(function (c) {
        return { rc: linhaFiltro.nome, cod: c.cod, nome: c.nome, faturacao: c.faturacao, comissao: c.comissao };
      });
    } else {
      for (var d = 0; d < modelo.linhas.length; d++) {
        var ln = modelo.linhas[d];
        for (var c = 0; c < ln.clientes.length; c++) {
          var cli = ln.clientes[c];
          listaDet.push({ rc: ln.nome, cod: cli.cod, nome: cli.nome, faturacao: cli.faturacao, comissao: cli.comissao });
        }
      }
    }
    var detBody = '';
    for (var k = 0; k < listaDet.length; k++) {
      var item = listaDet[k];
      detBody += '<tr>' +
        '<td>' + crEsc(item.rc) + '</td>' +
        '<td>' + crEsc(item.cod) + '</td>' +
        '<td>' + crEsc(item.nome || '—') + '</td>' +
        '<td class="vq-num' + (item.faturacao < 0 ? ' vq-var-neg' : '') + '">' + crEsc(crRs(item.faturacao)) + '</td>' +
        '<td class="vq-num' + (item.comissao < 0 ? ' vq-var-neg' : '') + '">' + crEsc(crRs(item.comissao)) + '</td>' +
        '</tr>';
    }
    if (!detBody) {
      detBody = '<tr><td colspan="5" class="vq-muted" style="padding:16px;">Sem clientes neste RC.</td></tr>';
    }
    detalhe = '<h3 style="font-size:14px;font-weight:600;margin:16px 0 8px;">Clientes' +
      (filtro ? ' · ' + crEsc(filtro) : '') + '</h3>' +
      '<div class="vq-scroll vq-scroll-det"><table class="vq-table"><thead><tr>' +
      '<th>RC</th><th>Código</th><th>Cliente</th><th class="vq-num">Faturação</th><th class="vq-num">Comissão 4%</th>' +
      '</tr></thead><tbody>' + detBody + '</tbody></table></div>';

    host.innerHTML = aviso + banner +
      '<div class="vq-scroll vq-scroll-main"><table class="vq-table"><thead><tr>' +
      '<th>RC</th><th class="vq-num">Clientes</th><th class="vq-num">Faturação</th><th class="vq-num">Comissão a pagar</th>' +
      '</tr></thead><tbody>' + body +
      '<tr class="vq-total"><td>Total</td><td class="vq-num">' + totalCount + '</td>' +
      '<td class="vq-num' + (tot.faturacao < 0 ? ' vq-var-neg' : '') + '">' + crEsc(crRs(tot.faturacao)) + '</td>' +
      '<td class="vq-num' + (tot.comissao < 0 ? ' vq-var-neg' : '') + '">' + crEsc(crRs(tot.comissao)) + '</td></tr>' +
      '</tbody></table></div>' +
      '<div class="vcob-note">Faturação = soma do Fatur. dos códigos atribuídos ao RC neste mês. Comissão = 4% dessa faturação. Devoluções (valor negativo) reduzem o total. Clientes sem movimento no mês ficam a zero e não aumentam a comissão.</div>' +
      detalhe;
  }

  async function renderComissaoRc() {
    var host = document.getElementById('cr-host');
    preencherSelectsComissaoRc();
    var gen = ++_crGen;
    if (host && !_crMapa) host.innerHTML = '<div style="color:var(--muted);font-size:13px;">A ler mapa de RC e Fatur. por cliente…</div>';
    try {
      if (!_crMapa) _crMapa = await lerMapaComissaoRc();
      var store = null;
      if (typeof lerVendasClientePersistida === 'function') store = await lerVendasClientePersistida();
      if (gen !== _crGen) return;
      pintarComissaoRc(store || { meses: {} });
    } catch (e) {
      if (gen !== _crGen) return;
      if (host) host.innerHTML = '<div style="color:var(--danger);font-size:13px;">Erro ao calcular a comissão: ' + crEsc(e && e.message ? e.message : e) + '</div>';
    }
  }

  function crFiltrar(enc) {
    var nome = '';
    try { nome = decodeURIComponent(enc || ''); } catch (e) { nome = String(enc || ''); }
    if (!nome) return;
    _crFiltro = nome;
    if (typeof lerVendasClientePersistida === 'function') {
      lerVendasClientePersistida().then(function (store) { pintarComissaoRc(store || { meses: {} }); }).catch(function () {
        pintarComissaoRc({ meses: {} });
      });
      return;
    }
    pintarComissaoRc({ meses: {} });
  }

  function crLimparFiltro() {
    _crFiltro = '';
    crFiltrarCancel();
  }

  function crFiltrarCancel() {
    if (typeof lerVendasClientePersistida === 'function') {
      lerVendasClientePersistida().then(function (store) { pintarComissaoRc(store || { meses: {} }); }).catch(function () {
        pintarComissaoRc({ meses: {} });
      });
      return;
    }
    pintarComissaoRc({ meses: {} });
  }

  function comissaoRcPedidoNaUrl() {
    try {
      var loc = typeof location !== 'undefined' ? location : null;
      if (!loc) return false;
      var h = String(loc.hash || '').replace(/^#/, '').toLowerCase();
      var q = new URLSearchParams(loc.search || '');
      var af = String(q.get('af') || q.get('ecra') || '').toLowerCase();
      return h === 'comissao-rc' || af === 'comissao-rc';
    } catch (e) {
      return false;
    }
  }

  function subAreaFinanceiraInicial() {
    if (!_crDeepLinkUsado && comissaoRcPedidoNaUrl()) {
      _crDeepLinkUsado = true;
      return 'comissao-rc';
    }
    try {
      if (typeof _afSubActiva !== 'undefined' && _afSubActiva) return _afSubActiva;
    } catch (e) {}
    return 'encerramentos';
  }

  function tentarAbrirComissaoRcDeepLink() {
    if (!comissaoRcPedidoNaUrl()) return;
    if (typeof getUtilizadorAtual === 'function' && !getUtilizadorAtual()) return;
    if (typeof abrirAreaFinanceiraHome === 'function') abrirAreaFinanceiraHome();
  }

  return {
    COMISSAO_RC_TAXA: COMISSAO_RC_TAXA,
    COMISSAO_RC_SUPA_ID: COMISSAO_RC_SUPA_ID,
    COMISSAO_RC_NPESS_DIOGO: COMISSAO_RC_NPESS_DIOGO,
    pessoaEhDiogo: pessoaEhDiogo,
    normalizarMapaComissaoRc: normalizarMapaComissaoRc,
    mapaDeLinhasComissaoRc: mapaDeLinhasComissaoRc,
    faturCodNoMes: faturCodNoMes,
    comissaoDeFaturacao: comissaoDeFaturacao,
    calcularComissaoRc: calcularComissaoRc,
    ultimoYmComFaturCliente: ultimoYmComFaturCliente,
    seedMapaComissaoRc: seedMapaComissaoRc,
    renderComissaoRc: renderComissaoRc,
    crFiltrar: crFiltrar,
    crLimparFiltro: crLimparFiltro,
    comissaoRcPedidoNaUrl: comissaoRcPedidoNaUrl,
    subAreaFinanceiraInicial: subAreaFinanceiraInicial,
    tentarAbrirComissaoRcDeepLink: tentarAbrirComissaoRcDeepLink,
  };
});
