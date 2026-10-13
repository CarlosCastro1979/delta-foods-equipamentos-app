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
  var _crVista = 'mensal';
  var CR_MESES_NOME = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

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

  var COMISSAO_RC_LS_KEY = 'df_comissao_rc';

  function normHeaderRc(h) {
    return String(h == null ? '' : h)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Código de cliente vindo do Excel (número ou texto). */
  function codCelulaRc(val) {
    if (val == null || val === '') return '';
    if (typeof val === 'number' && Number.isFinite(val)) return normCodRc(String(Math.round(val)));
    var s = String(val).trim();
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
    return normCodRc(s);
  }

  function indiceCabecalhoRc(rows) {
    var lista = Array.isArray(rows) ? rows : [];
    var limite = Math.min(lista.length, 30);
    for (var i = 0; i < limite; i++) {
      var row = lista[i] || [];
      for (var j = 0; j < row.length; j++) {
        if (/nome\s*vendedor/.test(normHeaderRc(row[j]))) return i;
      }
    }
    return -1;
  }

  /**
   * Folha «Lista Completa»: código do cliente, nome do cliente, NOME VENDEDOR.
   * «Nr e N» / «e Cliente» é o cabeçalho já visto nesse ficheiro.
   */
  function colunasComissaoRc(headers) {
    var hn = [];
    var i;
    for (i = 0; i < headers.length; i++) hn.push(normHeaderRc(headers[i]));
    var iVend = -1;
    for (i = 0; i < hn.length; i++) {
      if (/nome\s*vendedor/.test(hn[i])) { iVend = i; break; }
    }
    var iCod = -1;
    for (i = 0; i < hn.length; i++) {
      if (i === iVend) continue;
      if (/^cliente$/.test(hn[i]) || /^cod(igo)?\.?\s*(cliente|sap)?$/.test(hn[i])) { iCod = i; break; }
    }
    if (iCod < 0) {
      for (i = 0; i < hn.length; i++) {
        if (i === iVend) continue;
        if (/^nr\b/.test(hn[i]) || /^n[o°]\b/.test(hn[i]) || /^numero\b/.test(hn[i])) { iCod = i; break; }
      }
    }
    var iNome = -1;
    for (i = 0; i < hn.length; i++) {
      if (i === iVend || i === iCod) continue;
      if (/^nome\b/.test(hn[i]) || /nome\s*(do\s*)?cliente/.test(hn[i])) { iNome = i; break; }
    }
    if (iNome < 0) {
      for (i = 0; i < hn.length; i++) {
        if (i === iVend || i === iCod) continue;
        if (/cliente/.test(hn[i])) { iNome = i; break; }
      }
    }
    var iNpess = -1;
    for (i = 0; i < hn.length; i++) {
      if (/npess|n[ºo°.]?\s*pess|pessoa\s*resp/.test(hn[i])) { iNpess = i; break; }
    }
    return { iCod: iCod, iNome: iNome, iVend: iVend, iNpess: iNpess };
  }

  /**
   * Lê a grelha (primeira linha útil = cabeçalho). Diogo sai.
   * O primeiro código não-Diogo fica; uma repetição não o põe noutro RC.
   * Não grava nada — uma leitura falhada devolve ok:false.
   */
  function linhasDeTabelaComissaoRc(rows) {
    var lista = Array.isArray(rows) ? rows : [];
    var iCab = indiceCabecalhoRc(lista);
    if (iCab < 0) {
      return {
        ok: false,
        cabecalho: false,
        erro: 'Não encontrei a coluna NOME VENDEDOR. O mapa de RC não foi alterado.',
        linhas: [],
        ignorados: 0,
      };
    }
    var cols = colunasComissaoRc(lista[iCab] || []);
    if (cols.iVend < 0 || cols.iCod < 0 || cols.iNome < 0) {
      return {
        ok: false,
        cabecalho: true,
        erro: 'Não encontrei o código e o nome do cliente ao lado de NOME VENDEDOR. O mapa de RC não foi alterado.',
        linhas: [],
        ignorados: 0,
      };
    }
    var linhas = [];
    var vistos = {};
    var ignorados = 0;
    for (var r = iCab + 1; r < lista.length; r++) {
      var row = lista[r] || [];
      var pessoa = normNomeRc(row[cols.iVend]);
      if (!pessoa) continue;
      var npess = cols.iNpess >= 0 ? row[cols.iNpess] : 0;
      if (pessoaEhDiogo(pessoa, npess)) { ignorados++; continue; }
      var cod = codCelulaRc(row[cols.iCod]);
      if (!cod || vistos[cod]) continue;
      vistos[cod] = 1;
      linhas.push({
        pessoa: pessoa,
        npess: npess,
        cod: cod,
        nome: normNomeRc(row[cols.iNome]),
      });
    }
    if (!linhas.length) {
      return {
        ok: false,
        cabecalho: true,
        erro: 'A folha não tem clientes de RC (nomes com Diogo são ignorados). O mapa de RC não foi alterado.',
        linhas: [],
        ignorados: ignorados,
      };
    }
    return { ok: true, cabecalho: true, erro: '', linhas: linhas, ignorados: ignorados };
  }

  /**
   * A folha é a lista nova completa. Código que não vem no ficheiro sai.
   * Leitura inválida ou cifrada devolve o mapa anterior intacto.
   */
  function substituirMapaComissaoRc(anterior, leitura) {
    var previo = normalizarMapaComissaoRc(anterior);
    if (!leitura || leitura.ok !== true) {
      var erro = leitura && leitura.erro
        ? String(leitura.erro)
        : 'Ficheiro inválido. O mapa de RC não foi alterado.';
      if (!/não foi alterado/i.test(erro)) erro += ' O mapa de RC não foi alterado.';
      return { substituido: false, mapa: previo, erro: erro };
    }
    var mapa = mapaDeLinhasComissaoRc(leitura.linhas);
    if (!mapa.rcs.length) {
      return {
        substituido: false,
        mapa: previo,
        erro: 'A folha não tem clientes de RC (nomes com Diogo são ignorados). O mapa de RC não foi alterado.',
      };
    }
    return { substituido: true, mapa: mapa, erro: '' };
  }

  function payloadMapaComissaoRc(mapa) {
    var base = normalizarMapaComissaoRc(mapa);
    return {
      taxa: COMISSAO_RC_TAXA,
      origem: 'Lista Completa',
      nota: 'Atribuições cujo nome contém Diogo foram ignoradas. Cada RC fica com os códigos de cliente da coluna NOME VENDEDOR. A comissão é 4% da faturação mensal desses clientes.',
      atualizado_em: new Date().toISOString(),
      rcs: base.rcs,
    };
  }

  async function lerCacheLocalComissaoRc() {
    var local = null;
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem) {
        local = JSON.parse(localStorage.getItem(COMISSAO_RC_LS_KEY) || 'null');
      }
    } catch (e) {}
    if ((!local || !local.rcs) && typeof idbGet === 'function') {
      try { local = await idbGet(COMISSAO_RC_LS_KEY); } catch (e2) {}
    }
    var norm = normalizarMapaComissaoRc(local);
    return norm.rcs.length ? norm : null;
  }

  async function gravarCacheLocalComissaoRc(payload) {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.setItem) {
        localStorage.setItem(COMISSAO_RC_LS_KEY, JSON.stringify(payload));
      }
    } catch (e) {}
    try {
      if (typeof idbSet === 'function') await idbSet(COMISSAO_RC_LS_KEY, payload);
    } catch (e2) {}
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

  function centsDeReais(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) v = 0;
    var sign = v < 0 ? -1 : 1;
    return sign * Math.round(Math.abs(v) * 100);
  }

  /**
   * Dívida (saldo negativo) abate-se na comissão dos meses seguintes.
   * Mês negativo: a pagar fica 0 e a dívida aumenta. Mês a zero não abate.
   * Mês positivo: abate até zerar; o que sobra é a pagar. Saldo nunca fica positivo.
   */
  function aplicarCarryComissao(comissao, saldoAnterior) {
    var com = centsDeReais(comissao);
    var saldo = centsDeReais(saldoAnterior);
    if (saldo > 0) saldo = 0;
    var abat;
    var pagar;
    var novo;
    if (com <= 0) {
      abat = 0;
      pagar = 0;
      novo = saldo + com;
    } else {
      var divida = -saldo;
      abat = com < divida ? com : divida;
      pagar = com - abat;
      novo = -(divida - abat);
    }
    return {
      comissao: com / 100,
      abatimento: abat / 100,
      aPagar: pagar / 100,
      saldo: novo / 100,
    };
  }

  function mesesYmOrdenados(store) {
    var meses = (store && store.meses) || {};
    return Object.keys(meses).filter(function (ym) { return /^\d{4}-\d{2}$/.test(ym); }).sort();
  }

  /** Percorre só os meses que existem na faturação, por RC, em ordem cronológica. */
  function serieCarryComissaoRc(mapa, store) {
    var yms = mesesYmOrdenados(store);
    var base = normalizarMapaComissaoRc(mapa);
    var porNome = {};
    for (var i = 0; i < base.rcs.length; i++) {
      porNome[base.rcs[i].nome] = { saldo: 0, meses: {} };
    }
    for (var m = 0; m < yms.length; m++) {
      var ym = yms[m];
      var calc = calcularComissaoRc(base, (store.meses && store.meses[ym]) || { clientes: {} });
      for (var j = 0; j < calc.linhas.length; j++) {
        var linha = calc.linhas[j];
        var bucket = porNome[linha.nome];
        if (!bucket) bucket = porNome[linha.nome] = { saldo: 0, meses: {} };
        var passo = aplicarCarryComissao(linha.comissao, bucket.saldo);
        bucket.saldo = passo.saldo;
        bucket.meses[ym] = {
          nome: linha.nome,
          ym: ym,
          nClientes: linha.nClientes,
          faturacao: linha.faturacao,
          comissao: passo.comissao,
          abatimento: passo.abatimento,
          aPagar: passo.aPagar,
          saldo: passo.saldo,
          clientes: linha.clientes,
        };
      }
    }
    return { yms: yms, porNome: porNome, nomes: base.rcs.map(function (r) { return r.nome; }) };
  }

  function saldoAntesDeYm(bucket, ym) {
    if (!bucket || !bucket.meses) return 0;
    var keys = Object.keys(bucket.meses).filter(function (k) { return k < ym; }).sort();
    if (!keys.length) return 0;
    return bucket.meses[keys[keys.length - 1]].saldo;
  }

  /**
   * Estado de um mês (mesmo que não exista na base: comissão 0, a dívida anterior mantém-se).
   * A ordenação das linhas segue a faturação do mês, como no quadro mensal.
   */
  function estadoMensalComissaoRc(mapa, store, ym) {
    var serie = serieCarryComissaoRc(mapa, store || { meses: {} });
    var mes = (store && store.meses && store.meses[ym]) || { clientes: {} };
    var calc = calcularComissaoRc(mapa, mes);
    var linhas = [];
    var totN = 0;
    var totFat = 0;
    var totCom = 0;
    var totAbat = 0;
    var totPagar = 0;
    var totSaldo = 0;
    for (var i = 0; i < calc.linhas.length; i++) {
      var linha = calc.linhas[i];
      var bucket = serie.porNome[linha.nome];
      var estado = bucket && bucket.meses[ym];
      if (!estado) {
        var passo = aplicarCarryComissao(linha.comissao, saldoAntesDeYm(bucket, ym));
        estado = {
          nome: linha.nome,
          ym: ym,
          nClientes: linha.nClientes,
          faturacao: linha.faturacao,
          comissao: passo.comissao,
          abatimento: passo.abatimento,
          aPagar: passo.aPagar,
          saldo: passo.saldo,
          clientes: linha.clientes,
        };
      }
      linhas.push(estado);
      totN += estado.nClientes;
      totFat += centsDeReais(estado.faturacao);
      totCom += centsDeReais(estado.comissao);
      totAbat += centsDeReais(estado.abatimento);
      totPagar += centsDeReais(estado.aPagar);
      totSaldo += centsDeReais(estado.saldo);
    }
    return {
      ym: ym,
      taxa: COMISSAO_RC_TAXA,
      linhas: linhas,
      total: {
        nClientes: totN,
        faturacao: totFat / 100,
        comissao: totCom / 100,
        abatimento: totAbat / 100,
        aPagar: totPagar / 100,
        saldo: totSaldo / 100,
      },
    };
  }

  /**
   * Os 12 meses do ano Y, por RC (nome, depois mês).
   * O saldo de abertura é a dívida no fim de Dezembro de Y-1 (ou do último mês anterior que exista).
   * Mês sem faturação entra na mesma, com comissão 0, para a dívida continuar visível.
   */
  function resumoAnualComissaoRc(mapa, store, ano) {
    var anoN = parseInt(ano, 10);
    if (!anoN) anoN = new Date().getFullYear();
    var serie = serieCarryComissaoRc(mapa, store || { meses: {} });
    var inicio = anoN + '-01';
    var linhas = [];
    var totCom = 0;
    var totAbat = 0;
    var totPagar = 0;
    var totSaldoDez = 0;
    var nomes = serie.nomes || [];
    for (var i = 0; i < nomes.length; i++) {
      var nome = nomes[i];
      var bucket = serie.porNome[nome] || { saldo: 0, meses: {} };
      var saldo = saldoAntesDeYm(bucket, inicio);
      for (var m = 1; m <= 12; m++) {
        var ym = anoN + '-' + String(m).padStart(2, '0');
        var existente = bucket.meses[ym];
        var com = existente ? existente.comissao : 0;
        var passo = aplicarCarryComissao(com, saldo);
        saldo = passo.saldo;
        linhas.push({
          nome: nome,
          ym: ym,
          mes: m,
          faturacao: existente ? existente.faturacao : 0,
          comissao: passo.comissao,
          abatimento: passo.abatimento,
          aPagar: passo.aPagar,
          saldo: passo.saldo,
        });
        totCom += centsDeReais(passo.comissao);
        totAbat += centsDeReais(passo.abatimento);
        totPagar += centsDeReais(passo.aPagar);
      }
      totSaldoDez += centsDeReais(saldo);
    }
    return {
      ano: anoN,
      linhas: linhas,
      total: {
        comissao: totCom / 100,
        abatimento: totAbat / 100,
        aPagar: totPagar / 100,
        saldoDezembro: totSaldoDez / 100,
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

  function urlListaClientesRc() {
    return typeof LISTA_CLIENTES_SUPA_URL !== 'undefined'
      ? LISTA_CLIENTES_SUPA_URL
      : 'https://qnscwppgljobelplgbkp.supabase.co/rest/v1/lista_clientes';
  }

  /** A linha comissao_rc na nuvem ganha ao ficheiro empacotado quando tem RC. */
  async function lerMapaComissaoRc() {
    var seed = seedMapaComissaoRc();
    var key = typeof SUPA_KEY !== 'undefined' ? SUPA_KEY : '';
    if (key && typeof fetch === 'function') {
      try {
        var res = await fetch(urlListaClientesRc() + '?id=eq.' + COMISSAO_RC_SUPA_ID + '&select=data', {
          headers: { apikey: key, Authorization: 'Bearer ' + key },
        });
        if (res.ok) {
          var rows = await res.json();
          var data = rows && rows[0] && rows[0].data;
          var remoto = normalizarMapaComissaoRc(data);
          if (remoto.rcs.length) {
            gravarCacheLocalComissaoRc(data && data.rcs ? data : remoto);
            return remoto;
          }
        }
      } catch (e) {
        console.warn('lerMapaComissaoRc:', e && e.message ? e.message : e);
      }
    }
    var local = await lerCacheLocalComissaoRc();
    if (local) return local;
    return seed;
  }

  /**
   * Grava o mapa uma vez (carga de ficheiro, não autosave).
   * Só a linha comissao_rc. Não mexe em vendas, NF nem na lista de clientes.
   */
  async function guardarMapaComissaoRc(mapa) {
    var payload = payloadMapaComissaoRc(mapa);
    if (!payload.rcs.length) {
      return { ok: false, erro: 'Mapa de RC vazio. O mapa anterior mantém-se.' };
    }
    var key = typeof SUPA_KEY !== 'undefined' ? SUPA_KEY : '';
    if (!key || typeof fetch !== 'function') {
      return { ok: false, erro: 'Sem ligação para gravar o mapa de RC. O mapa anterior mantém-se.' };
    }
    try {
      var res = await fetch(urlListaClientesRc(), {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          id: COMISSAO_RC_SUPA_ID,
          data: payload,
          atualizado_em: payload.atualizado_em,
        }),
      });
      if (!res || !res.ok) {
        return { ok: false, erro: 'Não foi possível gravar o mapa de RC (HTTP ' + (res && res.status) + '). O mapa anterior mantém-se.' };
      }
    } catch (e) {
      return { ok: false, erro: 'Não foi possível gravar o mapa de RC. O mapa anterior mantém-se.' };
    }
    _crMapa = normalizarMapaComissaoRc(payload);
    await gravarCacheLocalComissaoRc(payload);
    return { ok: true, mapa: _crMapa };
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

  function crTdValor(n) {
    var cls = n < 0 ? ' vq-var-neg' : '';
    return '<td class="vq-num' + cls + '">' + crEsc(crRs(n)) + '</td>';
  }

  /** Saldo negativo é dívida que ainda vai ser abatida. O sinal fica explícito. */
  function crTdSaldo(n) {
    if (n < 0) {
      return '<td class="vq-num vq-var-neg" title="Dívida a abater nos meses seguintes">' +
        crEsc(crRs(n)) + ' em dívida</td>';
    }
    return '<td class="vq-num">' + crEsc(crRs(0)) + '</td>';
  }

  function crAplicarVistaDom() {
    var mensal = document.getElementById('cr-sub-mensal');
    var anual = document.getElementById('cr-sub-anual');
    if (mensal) mensal.classList.toggle('active', _crVista !== 'anual');
    if (anual) anual.classList.toggle('active', _crVista === 'anual');
    var mesWrap = document.getElementById('cr-mes-wrap');
    if (mesWrap) mesWrap.style.display = _crVista === 'anual' ? 'none' : '';
    var emailBtn = document.getElementById('cr-btn-email');
    if (emailBtn) emailBtn.style.display = _crVista === 'anual' ? 'none' : '';
    var lead = document.getElementById('cr-lead');
    if (lead) {
      lead.textContent = _crVista === 'anual'
        ? 'Visão do ano, por RC e por mês: comissão, o que se abate da dívida anterior e o que fica a pagar.'
        : 'Faturação mensal da soma dos clientes de cada RC. A comissão é 4%. Uma comissão negativa fica em dívida e abate-se nos meses seguintes.';
    }
  }

  function showComissaoRcSub(vista) {
    _crVista = vista === 'anual' ? 'anual' : 'mensal';
    crAplicarVistaDom();
    renderComissaoRc();
  }

  var CR_NOTA_ABATIMENTO = 'Se a comissão do mês for negativa, o RC não devolve o dinheiro: a pagar fica a zero e o valor fica em dívida no saldo a transportar (a vermelho); nos meses seguintes esse saldo é abatido até zerar, e a dívida não se apaga em Janeiro.';

  function pintarComissaoMensalRc(store) {
    var host = document.getElementById('cr-host');
    if (!host || !_crMapa) return;
    var periodo = crPeriodo();
    var mes = store && store.meses ? store.meses[periodo.ym] : null;
    _crMes = mes || { clientes: {} };
    var modelo = estadoMensalComissaoRc(_crMapa, store, periodo.ym);
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
      body += '<tr class="' + (on ? 'vq-emp' : 'vq-vend') + '">' +
        '<td>' + crBotaoNome(row.nome, row.nClientes, on) + '</td>' +
        '<td class="vq-num">' + crBotaoContagem(row.nClientes, row.nome) + '</td>' +
        crTdValor(row.faturacao) +
        crTdValor(row.comissao) +
        crTdValor(row.abatimento) +
        crTdValor(row.aPagar) +
        crTdSaldo(row.saldo) +
        '</tr>';
    }
    if (!modelo.linhas.length) {
      body = '<tr><td colspan="7" class="vq-muted" style="padding:16px;">Sem RC no mapa (Diogo fica de fora).</td></tr>';
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
        var cls = ln.clientes || [];
        for (var c = 0; c < cls.length; c++) {
          var cli = cls[c];
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
      '<div class="vq-scroll vq-scroll-main"><table class="vq-table" style="min-width:1100px"><thead><tr>' +
      '<th>RC</th><th class="vq-num">Clientes</th><th class="vq-num">Faturação</th>' +
      '<th class="vq-num">Comissão do mês</th><th class="vq-num">Abatimento</th>' +
      '<th class="vq-num">A pagar</th><th class="vq-num">Saldo a transportar</th>' +
      '</tr></thead><tbody>' + body +
      '<tr class="vq-total"><td>Total</td><td class="vq-num">' + totalCount + '</td>' +
      crTdValor(tot.faturacao) + crTdValor(tot.comissao) + crTdValor(tot.abatimento) +
      crTdValor(tot.aPagar) + crTdSaldo(tot.saldo) + '</tr>' +
      '</tbody></table></div>' +
      '<div class="vcob-note">' + crEsc(CR_NOTA_ABATIMENTO) + '</div>' +
      detalhe;
  }

  function pintarResumoAnualRc(store) {
    var host = document.getElementById('cr-host');
    if (!host || !_crMapa) return;
    var anoEl = document.getElementById('cr-ano');
    var ano = parseInt(anoEl && anoEl.value, 10) || new Date().getFullYear();
    var modelo = resumoAnualComissaoRc(_crMapa, store, ano);
    var body = '';
    for (var i = 0; i < modelo.linhas.length; i++) {
      var row = modelo.linhas[i];
      var nomeMes = CR_MESES_NOME[row.mes - 1] || String(row.mes);
      body += '<tr class="vq-vend">' +
        '<td>' + crEsc(row.nome) + '</td>' +
        '<td>' + crEsc(nomeMes) + '</td>' +
        crTdValor(row.comissao) +
        crTdValor(row.abatimento) +
        crTdValor(row.aPagar) +
        crTdSaldo(row.saldo) +
        '</tr>';
    }
    if (!modelo.linhas.length) {
      body = '<tr><td colspan="6" class="vq-muted" style="padding:16px;">Sem RC no mapa (Diogo fica de fora).</td></tr>';
    }
    var tot = modelo.total;
    host.innerHTML =
      '<div class="vq-scroll vq-scroll-main"><table class="vq-table" style="min-width:920px"><thead><tr>' +
      '<th>RC</th><th>Mês</th><th class="vq-num">Comissão do mês</th><th class="vq-num">Abatimento</th>' +
      '<th class="vq-num">A pagar</th><th class="vq-num">Saldo a transportar</th>' +
      '</tr></thead><tbody>' + body +
      '<tr class="vq-total"><td>Total</td><td class="vq-muted" title="O saldo de cada mês fica na linha desse mês">—</td>' +
      crTdValor(tot.comissao) + crTdValor(tot.abatimento) + crTdValor(tot.aPagar) +
      crTdSaldo(tot.saldoDezembro) + '</tr>' +
      '</tbody></table></div>' +
      '<div class="vcob-note">Os 12 meses de cada RC ficam no mesmo quadro, mesmo sem vendas. O saldo do total é o de Dezembro (o que ainda transita para o ano seguinte), não a soma dos meses. ' +
      crEsc(CR_NOTA_ABATIMENTO) + '</div>';
  }

  function pintarComissaoRc(store) {
    crAplicarVistaDom();
    if (_crVista === 'anual') pintarResumoAnualRc(store);
    else pintarComissaoMensalRc(store);
  }

  async function renderComissaoRc() {
    var host = document.getElementById('cr-host');
    preencherSelectsComissaoRc();
    crAplicarVistaDom();
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

  var COMISSAO_RC_EMAIL_TO = 'alice.menezes@bakertilly.com.br';
  var COMISSAO_RC_EMAIL_CC = [
    'andrea.albuquerque@deltafoodsbrasil.com.br',
    'diego.silva@bakertilly.com.br',
    'leticia.silva@bakertilly.com.br',
    'christian.souza@deltafoodsbrasil.com.br',
    'diogo.oliveira@deltafoodsbrasil.com.br',
    'felipe.morgado@bakertilly.com.br',
  ];
  var COMISSAO_RC_MESES = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  var COMISSAO_RC_CARRY = [
    { key: 'comissao', label: 'Comissão do mês', tipo: 'rs', keys: ['comissaoMes', 'comissaoDoMes', 'comissao'], detect: ['comissaoMes', 'comissaoDoMes'] },
    { key: 'abatimento', label: 'Abatimento', tipo: 'rs', keys: ['abatimento'], detect: ['abatimento'] },
    { key: 'aPagar', label: 'A pagar', tipo: 'rs', keys: ['aPagar', 'a_pagar'], detect: ['aPagar', 'a_pagar'] },
    { key: 'saldo', label: 'Saldo a transportar', tipo: 'rs', keys: ['saldoTransportar', 'saldoATransportar', 'saldo'], detect: ['saldoTransportar', 'saldoATransportar', 'saldo'] },
  ];

  function nomeMesComissaoRc(mes) {
    var n = parseInt(mes, 10);
    return COMISSAO_RC_MESES[n - 1] || '';
  }

  function horaAmericaSaoPaulo(agora) {
    var d = agora instanceof Date ? agora : new Date(agora || Date.now());
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) d = new Date();
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(d);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type !== 'hour') continue;
        var h = parseInt(parts[i].value, 10);
        if (h === 24) h = 0;
        if (h >= 0 && h <= 23) return h;
      }
    } catch (e) {}
    var utc = d.getUTCHours() - 3;
    if (utc < 0) utc += 24;
    return utc;
  }

  /** Antes das 12:00 em São Paulo: Bom dia. Daí em diante: Boa tarde. */
  function saudacaoComissaoRc(agora) {
    return horaAmericaSaoPaulo(agora) < 12 ? 'Bom dia' : 'Boa tarde';
  }

  function campoNumerico(obj, keys) {
    if (!obj) return null;
    for (var i = 0; i < keys.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(obj, keys[i])) continue;
      if (obj[keys[i]] == null || obj[keys[i]] === '') continue;
      var n = Number(obj[keys[i]]);
      return Number.isFinite(n) ? n : 0;
    }
    return null;
  }

  function apuramentoTemTransporte(modelo) {
    var linhas = (modelo && modelo.linhas) || [];
    var alvos = linhas.concat([(modelo && modelo.total) || {}]);
    for (var c = 0; c < COMISSAO_RC_CARRY.length; c++) {
      var detect = COMISSAO_RC_CARRY[c].detect || COMISSAO_RC_CARRY[c].keys;
      for (var i = 0; i < alvos.length; i++) {
        if (campoNumerico(alvos[i], detect) != null) return true;
      }
    }
    return false;
  }

  function colunasApuramentoComissaoRc(modelo) {
    var cols = [
      { key: 'nome', label: 'RC', tipo: 'text' },
      { key: 'nClientes', label: 'Clientes', tipo: 'int' },
      { key: 'faturacao', label: 'Faturação', tipo: 'rs' },
    ];
    if (apuramentoTemTransporte(modelo)) {
      for (var i = 0; i < COMISSAO_RC_CARRY.length; i++) cols.push(COMISSAO_RC_CARRY[i]);
    } else {
      cols.push({ key: 'comissao', label: 'Comissão a pagar', tipo: 'rs' });
    }
    return cols;
  }

  function lerCelulaApuramento(obj, col) {
    if (col.tipo === 'text') return obj && obj[col.key] != null ? obj[col.key] : '';
    var n = campoNumerico(obj, col.keys || [col.key]);
    return n == null ? 0 : n;
  }

  function escEmailRc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtRsEmail(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) v = 0;
    try {
      return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    } catch (e) {
      var neg = v < 0;
      var abs = Math.abs(v).toFixed(2).replace('.', ',');
      return (neg ? '-R$ ' : 'R$ ') + abs;
    }
  }

  function fmtCelulaEmail(col, valor) {
    if (col.tipo === 'rs') {
      var s = fmtRsEmail(valor);
      if ((col.key === 'saldo' || col.key === 'saldoTransportar') && Number(valor) < 0) s += ' em dívida';
      return s;
    }
    if (col.tipo === 'int') return String(parseInt(valor, 10) || 0);
    return String(valor == null ? '' : valor);
  }

  function fmtCelulaHtml(col, valor) {
    var txt = escEmailRc(fmtCelulaEmail(col, valor));
    if (col.tipo === 'rs') txt = txt.replace(/ /g, '&nbsp;').replace(/\u00a0/g, '&nbsp;');
    if (col.tipo === 'rs' && Number(valor) < 0) {
      return '<span style="color:#b91c1c;">' + txt + '</span>';
    }
    return txt;
  }

  function linhasDetalheComissaoRc(modelo) {
    var out = [];
    var linhas = (modelo && modelo.linhas) || [];
    for (var i = 0; i < linhas.length; i++) {
      var ln = linhas[i];
      if (!ln || pessoaEhDiogo(ln.nome, 0)) continue;
      var clientes = ln.clientes || [];
      for (var j = 0; j < clientes.length; j++) {
        var c = clientes[j] || {};
        out.push({
          rc: ln.nome,
          cod: c.cod,
          nome: c.nome || '',
          faturacao: Number(c.faturacao) || 0,
          comissao: Number(c.comissao) || 0,
        });
      }
    }
    return out;
  }

  function tabelaHtmlComissaoRc(cols, linhasVals, totalVals) {
    var td = 'border:1px solid #d1d5db;padding:6px 10px;font-family:Calibri,Arial,sans-serif;font-size:12px;';
    var th = td + 'background:#c8102e;color:#ffffff;font-weight:700;';
    var head = cols.map(function (col) {
      var align = col.tipo === 'text' ? 'left' : 'right';
      return '<th style="' + th + 'text-align:' + align + ';">' + escEmailRc(col.label) + '</th>';
    }).join('');
    function tr(vals, extra) {
      var cells = cols.map(function (col, i) {
        var align = col.tipo === 'text' ? 'left' : 'right';
        return '<td style="' + td + extra + 'text-align:' + align + ';white-space:nowrap;">' + fmtCelulaHtml(col, vals[i]) + '</td>';
      }).join('');
      return '<tr>' + cells + '</tr>';
    }
    var body = linhasVals.map(function (vals, idx) {
      return tr(vals, idx % 2 ? 'background:#f9fafb;' : 'background:#ffffff;');
    }).join('');
    var foot = tr(totalVals, 'background:#f3f4f6;font-weight:700;');
    return '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #c8102e;margin:12px 0;">' +
      '<thead><tr>' + head + '</tr></thead><tbody>' + body + foot + '</tbody></table>';
  }

  function tabelaTextoComissaoRc(cols, linhasVals, totalVals) {
    function formatLinha(vals) {
      return vals.map(function (v, i) { return fmtCelulaEmail(cols[i], v); }).join(' | ');
    }
    var linhas = [cols.map(function (c) { return c.label; }).join(' | ')];
    for (var i = 0; i < linhasVals.length; i++) linhas.push(formatLinha(linhasVals[i]));
    linhas.push(formatLinha(totalVals));
    return linhas.join('\n');
  }

  /**
   * Payload do email da comissão do mês seleccionado.
   * Não envia nada: o ecrã passa isto ao mesmo Outlook / .eml dos outros quadros.
   */
  function montarEmailComissaoRc(opts) {
    var o = opts || {};
    var modelo = o.modelo || { linhas: [], total: {} };
    var mes = parseInt(o.mes, 10);
    var ano = parseInt(o.ano, 10);
    var nomeMes = nomeMesComissaoRc(mes);
    var saudacao = saudacaoComissaoRc(o.agora);
    var remetente = String(o.remetente == null ? '' : o.remetente).trim();
    var frase = 'segue em anexo as comissões dos RC referente ao mês ' + nomeMes + ' de ' + ano + '.';
    var fecho = 'Qualquer dúvida ou correção favor enviar a mesma para análise.';
    var cols = colunasApuramentoComissaoRc(modelo);
    var linhas = modelo.linhas || [];
    var linhasVals = [];
    for (var i = 0; i < linhas.length; i++) {
      if (pessoaEhDiogo(linhas[i] && linhas[i].nome, 0)) continue;
      linhasVals.push(cols.map(function (col) { return lerCelulaApuramento(linhas[i], col); }));
    }
    var totalSrc = Object.assign({ nome: 'Total' }, modelo.total || {});
    var totalVals = cols.map(function (col, idx) {
      if (idx === 0) return 'Total';
      return lerCelulaApuramento(totalSrc, col);
    });
    var detalheCols = [
      { key: 'rc', label: 'RC', tipo: 'text' },
      { key: 'cod', label: 'Código do cliente', tipo: 'text' },
      { key: 'nome', label: 'Nome do cliente', tipo: 'text' },
      { key: 'faturacao', label: 'Faturação do mês', tipo: 'rs' },
      { key: 'comissao', label: 'Comissão 4%', tipo: 'rs' },
    ];
    var detalhe = linhasDetalheComissaoRc(modelo);
    var detalheVals = detalhe.map(function (row) {
      return detalheCols.map(function (col) { return row[col.key]; });
    });
    var mm = String(mes || 0).padStart(2, '0');
    var tituloMes = nomeMes ? (nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1)) : String(mes || '');
    var html =
      '<!DOCTYPE html>\n<html><head><meta charset="UTF-8"></head>\n' +
      '<body style="font-family:Calibri,Arial,sans-serif;font-size:14px;color:#111827;line-height:1.45;">\n' +
      '<p>' + escEmailRc(saudacao) + ',</p>\n' +
      '<p>' + escEmailRc(frase) + '</p>\n' +
      tabelaHtmlComissaoRc(cols, linhasVals, totalVals) + '\n' +
      '<p>' + escEmailRc(fecho) + '</p>\n' +
      '<p>Muito obrigado,' + (remetente ? '<br>' + escEmailRc(remetente) : '') + '</p>\n' +
      '</body></html>';
    var textoLinhas = [
      saudacao + ',',
      '',
      frase,
      '',
      tabelaTextoComissaoRc(cols, linhasVals, totalVals),
      '',
      fecho,
      '',
      'Muito obrigado,',
    ];
    if (remetente) textoLinhas.push(remetente);
    var largurasAp = cols.map(function (col) {
      if (col.tipo === 'text') return { wch: 28 };
      if (col.tipo === 'int') return { wch: 12 };
      return { wch: 22 };
    });
    return {
      to: COMISSAO_RC_EMAIL_TO,
      cc: COMISSAO_RC_EMAIL_CC.slice(),
      subject: 'Comissões RC — ' + tituloMes + ' ' + ano,
      saudacao: saudacao,
      frase: frase,
      fecho: fecho,
      remetente: remetente,
      html: html,
      texto: textoLinhas.join('\n'),
      filename: 'Comissao_RC_' + ano + '-' + mm + '.xlsx',
      folhas: [
        {
          name: 'Apuramento',
          tipos: cols.map(function (c) { return c.tipo; }),
          cols: largurasAp,
          rows: [cols.map(function (c) { return c.label; })].concat(linhasVals, [totalVals]),
        },
        {
          name: 'Detalhe',
          tipos: detalheCols.map(function (c) { return c.tipo; }),
          cols: [{ wch: 28 }, { wch: 18 }, { wch: 42 }, { wch: 18 }, { wch: 16 }],
          rows: [detalheCols.map(function (c) { return c.label; })].concat(detalheVals),
        },
      ],
    };
  }

  function aplicarFormatoFolhaRc(ws, XLSX, tipos) {
    if (!ws || !ws['!ref'] || !tipos || !XLSX.utils || !XLSX.utils.decode_range) return;
    var range = XLSX.utils.decode_range(ws['!ref']);
    for (var R = range.s.r + 1; R <= range.e.r; R++) {
      for (var C = range.s.c; C <= range.e.c && C < tipos.length; C++) {
        if (tipos[C] !== 'rs' && tipos[C] !== 'int') continue;
        var addr = XLSX.utils.encode_cell({ r: R, c: C });
        var cell = ws[addr];
        if (!cell || typeof cell.v !== 'number') continue;
        cell.z = tipos[C] === 'rs' ? '"R$"#,##0.00' : '0';
      }
    }
  }

  function blobXlsxComissaoRc(folhas) {
    var XLSX = (typeof window !== 'undefined' && window.XLSX) ? window.XLSX : null;
    if (!XLSX || !XLSX.utils) throw new Error('Excel indisponível');
    var wb = XLSX.utils.book_new();
    var lista = folhas || [];
    for (var i = 0; i < lista.length; i++) {
      var f = lista[i];
      var ws = XLSX.utils.aoa_to_sheet(f.rows || []);
      if (f.cols) ws['!cols'] = f.cols;
      aplicarFormatoFolhaRc(ws, XLSX, f.tipos);
      if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };
      XLSX.utils.book_append_sheet(wb, ws, f.name || ('Folha' + (i + 1)));
    }
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  async function comissaoRcExportarEmail() {
    var btn = typeof document !== 'undefined' ? document.getElementById('cr-btn-email') : null;
    if (btn) btn.disabled = true;
    try {
      if (!_crMapa && typeof lerMapaComissaoRc === 'function') _crMapa = await lerMapaComissaoRc();
      if (!_crMapa || !_crMapa.rcs || !_crMapa.rcs.length) {
        if (typeof toast === 'function') toast('Sem mapa de RC para exportar.', 'warn');
        return;
      }
      var periodo = crPeriodo();
      var store = { meses: {} };
      if (typeof lerVendasClientePersistida === 'function') {
        try { store = (await lerVendasClientePersistida()) || store; } catch (e1) { store = { meses: {} }; }
      }
      var modelo = estadoMensalComissaoRc(_crMapa, store, periodo.ym);
      var remetente = typeof getUtilizadorAtual === 'function' ? String(getUtilizadorAtual() || '').trim() : '';
      var email = montarEmailComissaoRc({
        modelo: modelo,
        mes: periodo.mes,
        ano: periodo.ano,
        remetente: remetente,
        agora: new Date(),
      });
      if (typeof toast === 'function') toast('A gerar Excel…');
      if (typeof ensureXLSX === 'function') await ensureXLSX();
      var blob = blobXlsxComissaoRc(email.folhas);
      if (typeof outlookAbrirRascunho !== 'function') {
        if (typeof triggerBlobDownload === 'function') triggerBlobDownload(blob, email.filename);
        if (typeof toast === 'function') toast('Excel descarregado. O Outlook não está disponível neste ecrã.', 'warn');
        return;
      }
      await outlookAbrirRascunho({
        to: email.to,
        cc: email.cc.join('; '),
        subject: email.subject,
        html: email.html,
        attachments: [{
          blob: blob,
          filename: email.filename,
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }],
        draftName: email.filename.replace(/\.xlsx$/i, '') + '.eml',
        toastMsg: '📧 Outlook aberto com o quadro das comissões no corpo e o Excel em anexo.',
        mailtoFallback: {
          body: email.texto,
          toastMsg: '📧 Outlook a abrir. Anexa o Excel descarregado ao email.',
        },
        ccExact: true,
      });
    } catch (e) {
      console.error('comissaoRcExportarEmail', e);
      if (typeof toast === 'function') toast('Erro ao exportar o email: ' + (e && e.message ? e.message : e), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  return {
    COMISSAO_RC_TAXA: COMISSAO_RC_TAXA,
    COMISSAO_RC_SUPA_ID: COMISSAO_RC_SUPA_ID,
    COMISSAO_RC_NPESS_DIOGO: COMISSAO_RC_NPESS_DIOGO,
    pessoaEhDiogo: pessoaEhDiogo,
    normalizarMapaComissaoRc: normalizarMapaComissaoRc,
    mapaDeLinhasComissaoRc: mapaDeLinhasComissaoRc,
    linhasDeTabelaComissaoRc: linhasDeTabelaComissaoRc,
    substituirMapaComissaoRc: substituirMapaComissaoRc,
    lerMapaComissaoRc: lerMapaComissaoRc,
    guardarMapaComissaoRc: guardarMapaComissaoRc,
    COMISSAO_RC_LS_KEY: COMISSAO_RC_LS_KEY,
    faturCodNoMes: faturCodNoMes,
    comissaoDeFaturacao: comissaoDeFaturacao,
    calcularComissaoRc: calcularComissaoRc,
    aplicarCarryComissao: aplicarCarryComissao,
    estadoMensalComissaoRc: estadoMensalComissaoRc,
    resumoAnualComissaoRc: resumoAnualComissaoRc,
    ultimoYmComFaturCliente: ultimoYmComFaturCliente,
    seedMapaComissaoRc: seedMapaComissaoRc,
    renderComissaoRc: renderComissaoRc,
    showComissaoRcSub: showComissaoRcSub,
    crFiltrar: crFiltrar,
    crLimparFiltro: crLimparFiltro,
    comissaoRcPedidoNaUrl: comissaoRcPedidoNaUrl,
    subAreaFinanceiraInicial: subAreaFinanceiraInicial,
    tentarAbrirComissaoRcDeepLink: tentarAbrirComissaoRcDeepLink,
    COMISSAO_RC_EMAIL_TO: COMISSAO_RC_EMAIL_TO,
    COMISSAO_RC_EMAIL_CC: COMISSAO_RC_EMAIL_CC,
    saudacaoComissaoRc: saudacaoComissaoRc,
    nomeMesComissaoRc: nomeMesComissaoRc,
    montarEmailComissaoRc: montarEmailComissaoRc,
    comissaoRcExportarEmail: comissaoRcExportarEmail,
  };
});
