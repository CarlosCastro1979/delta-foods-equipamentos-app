/**
 * NF-e do zip do cockpit — parse e cruzamento por CNPJ/CPF do destinatário.
 * Sem DOM. O mesmo ficheiro corre no browser (global) e no Node (require).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  var g = root || (typeof globalThis !== 'undefined' ? globalThis : null);
  if (!g) return;
  Object.keys(api).forEach(function (k) { g[k] = api[k]; });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var NFE_STATUS_MULTI = 'cnpj_multiplos';
  var NFE_STATUS_SEM = 'sem_cliente';
  var NFE_STATUS_UNICO = 'unico';
  var NFE_ROTULO_MULTI = 'CNPJ em mais do que um código';
  /** CPF (11 dígitos) sem vendedor na lista → Marcio Gorga / Ecommerce. Código habitual 99520001. */
  var NFE_CPF_CANAL = 'ecommerce';
  var NFE_CPF_CANAL_NOME = 'Ecommerce';
  var NFE_CPF_VENDEDOR = 'Marcio Gorga';
  var NFE_CPF_NPESS = '99520001';
  /**
   * Transferência intragrupo Delta Espírito Santo ↔ Delta São Paulo.
   * Confirmado nas NF 4555, 4557, 4558 e 4559 (série 1, 02/10/2026):
   * emitente ES 14.830.817/0003-63, destinatário SP 14.830.817/0001-00.
   * Os dois sentidos entre estes CNPJ. Não é o nome «Delta».
   */
  var NFE_DELTA_CNPJ_ES = '14830817000363';
  var NFE_DELTA_CNPJ_SP = '14830817000100';
  var NFE_TRANSF_CANAL = 'transferencias';
  var NFE_TRANSF_CANAL_NOME = 'Transferências internas';

  function nfeNormDoc(v) {
    return String(v == null ? '' : v).replace(/\D/g, '');
  }

  function nfeNormNome(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function nfeUnescape(s) {
    return String(s || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function nfeFirstTag(xml, local) {
    var re = new RegExp('<(?:[\\w.-]+:)?' + local + '(?:\\s[^>]*)?>([^<]*)</(?:[\\w.-]+:)?' + local + '>', 'i');
    var m = String(xml || '').match(re);
    return m ? nfeUnescape(m[1]) : '';
  }

  function nfeBlock(xml, local) {
    var re = new RegExp('<(?:[\\w.-]+:)?' + local + '\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?' + local + '>', 'i');
    var m = String(xml || '').match(re);
    return m ? m[1] : '';
  }

  function nfeParseXml(xmlText, filename) {
    var raw = String(xmlText || '').replace(/^\uFEFF/, '').trim();
    if (!raw || raw.charAt(0) !== '<') return null;
    if (!/<infNFe\b/i.test(raw) && !/<NFe\b/i.test(raw)) return null;

    var ide = nfeBlock(raw, 'ide');
    var emit = nfeBlock(raw, 'emit');
    var dest = nfeBlock(raw, 'dest');
    var total = nfeBlock(raw, 'total');
    var icms = nfeBlock(total, 'ICMSTot') || nfeBlock(raw, 'ICMSTot');

    var chave = '';
    var idm = raw.match(/\bId="NFe(\d{44})"/i);
    if (idm) chave = idm[1];
    if (!chave) {
      var ch = raw.match(/<(?:[\w.-]+:)?chNFe>(\d{44})<\/(?:[\w.-]+:)?chNFe>/i);
      if (ch) chave = ch[1];
    }
    var numero = nfeFirstTag(ide, 'nNF');
    if (!chave || !numero) return null;

    var destDoc = nfeNormDoc(nfeFirstTag(dest, 'CNPJ') || nfeFirstTag(dest, 'CPF'));
    var vRaw = nfeFirstTag(icms, 'vNF');
    var valor = vRaw === '' ? null : Number(String(vRaw).replace(',', '.'));
    if (valor != null && !Number.isFinite(valor)) valor = null;
    if (valor != null) valor = Math.round(valor * 100) / 100;

    return {
      chave: chave,
      emitCnpj: nfeNormDoc(nfeFirstTag(emit, 'CNPJ') || nfeFirstTag(emit, 'CPF')),
      destDoc: destDoc,
      cliente: nfeFirstTag(dest, 'xNome'),
      numero: numero,
      serie: nfeFirstTag(ide, 'serie'),
      data: nfeFirstTag(ide, 'dhEmi') || nfeFirstTag(ide, 'dEmi'),
      valor: valor,
      arquivo: filename ? String(filename).split(/[/\\]/).pop() : '',
    };
  }

  function nfeDocKeys(digits) {
    var d = nfeNormDoc(digits);
    var keys = [];
    if (d.length === 11 || d.length === 14) keys.push(d);
    if (d.length > 0 && d.length < 14) {
      var padded = d.padStart(14, '0');
      if (keys.indexOf(padded) < 0) keys.push(padded);
    }
    return keys;
  }

  function nfeIndexClientes(clientes) {
    var map = new Map();
    (clientes || []).forEach(function (c) {
      nfeDocKeys(c && c.cnpj).forEach(function (k) {
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(c);
      });
    });
    return map;
  }

  /**
   * CNPJ único → canal e vendedor desse código.
   * CNPJ repetido: se todos os códigos partilham o mesmo canal e o mesmo vendedor, fica definido.
   * Se divergirem, não escolhe ao acaso.
   */
  function nfeAtribuirDestinatario(hits, canalDeNpess) {
    var list = Array.isArray(hits) ? hits.filter(Boolean) : [];
    var vazio = {
      status: NFE_STATUS_SEM,
      canalId: '',
      vendedor: '',
      cod: '',
      npess: '',
      codigos: [],
      rotulo: '',
    };
    if (!list.length) return vazio;

    var enriched = list.map(function (c) {
      var npess = parseInt(c.npess, 10) || 0;
      var canalId = '';
      try {
        canalId = (typeof canalDeNpess === 'function' ? canalDeNpess(npess) : '') || '';
      } catch (_) { canalId = ''; }
      return {
        npess: npess,
        canalId: String(canalId || ''),
        vendedor: String(c.vendedor || '').trim(),
        cod: String(c.cod == null ? '' : c.cod).trim(),
      };
    });

    var sigs = {};
    enriched.forEach(function (e) {
      sigs[e.canalId + '\0' + nfeNormNome(e.vendedor)] = true;
    });
    var nSig = Object.keys(sigs).length;
    var codigos = enriched.map(function (e) { return e.cod; }).filter(Boolean);

    if (list.length > 1 && nSig !== 1) {
      return {
        status: NFE_STATUS_MULTI,
        canalId: '',
        vendedor: '',
        cod: '',
        npess: '',
        codigos: codigos,
        rotulo: NFE_ROTULO_MULTI,
      };
    }

    enriched.sort(function (a, b) {
      return a.cod.localeCompare(b.cod, 'pt', { numeric: true });
    });
    var pick = enriched[0];
    return {
      status: NFE_STATUS_UNICO,
      canalId: pick.canalId,
      vendedor: pick.vendedor,
      cod: pick.cod,
      npess: pick.npess ? String(pick.npess) : '',
      codigos: codigos,
      rotulo: '',
    };
  }

  function nfeDocEhCpf(doc) {
    return nfeNormDoc(doc).length === 11;
  }

  /**
   * CPF sem vendedor: não está na lista, ou o código não tem vendedor.
   * CPF que já tem vendedor fica na lista. CNPJ não entra nesta regra.
   * Vários códigos com vendedores diferentes também não — não se escolhe ao acaso.
   */
  function nfeCpfPrecisaMarcio(nota) {
    if (!nota || !nfeDocEhCpf(nota.destDoc)) return false;
    if (nota.status === NFE_STATUS_MULTI) return false;
    return !String(nota.vendedor || '').trim();
  }

  function nfeComMarcioEcommerce(nota) {
    return Object.assign({}, nota, {
      status: NFE_STATUS_UNICO,
      canalId: NFE_CPF_CANAL,
      canalNome: NFE_CPF_CANAL_NOME,
      vendedor: NFE_CPF_VENDEDOR,
      npess: NFE_CPF_NPESS,
      rotulo: '',
    });
  }

  /**
   * Par emitente/destinatário entre os dois CNPJ da Delta (ES ↔ SP).
   * Qualquer outro CNPJ, mesmo com «Delta» no nome, não é transferência.
   */
  function nfeEhTransferenciaInterna(nota) {
    if (!nota) return false;
    var emit = nfeNormDoc(nota.emitCnpj);
    var dest = nfeNormDoc(nota.destDoc);
    if (!emit || !dest || emit === dest) return false;
    var es = emit === NFE_DELTA_CNPJ_ES || dest === NFE_DELTA_CNPJ_ES;
    var sp = emit === NFE_DELTA_CNPJ_SP || dest === NFE_DELTA_CNPJ_SP;
    return es && sp;
  }

  function nfeComTransferenciaInterna(nota) {
    return Object.assign({}, nota, {
      status: NFE_STATUS_UNICO,
      canalId: NFE_TRANSF_CANAL,
      canalNome: NFE_TRANSF_CANAL_NOME,
      vendedor: '',
      npess: '',
      cod: '',
      codigos: [],
      rotulo: '',
    });
  }

  /**
   * Transferência Delta ES ↔ SP fica nesse canal, sem vendedor.
   * O resto: CNPJ na lista, ou nome no catálogo com o NPess atual de 2026.
   * CPF sem vendedor vai para o Marcio / Ecommerce.
   */
  function nfeCruzarNota(nota, index, canalDeNpess, catalogo) {
    if (nfeEhTransferenciaInterna(nota)) return nfeComTransferenciaInterna(nota);
    var dest = nfeNormDoc(nota && nota.destDoc);
    var hits = (index && dest && index.get(dest)) || [];
    var a = nfeAtribuirDestinatario(hits, canalDeNpess);
    var out = Object.assign({}, nota, a);
    if (out.status === NFE_STATUS_SEM && !nfeDocEhCpf(out.destDoc) && catalogo) {
      var porNome = nfeAtribuirPorNome(out.cliente, catalogo, canalDeNpess);
      if (porNome) out = Object.assign({}, out, porNome);
    }
    if (nfeCpfPrecisaMarcio(out)) return nfeComMarcioEcommerce(out);
    return out;
  }

  /** Nome comparável: sem acentos, pontuação vira espaço. */
  function nfeNormChaveNome(s) {
    return nfeNormNome(s).replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * O nome da NF corresponde ao do código quando são iguais ou um é frase inteira do outro.
   * Nomes curtos (menos de 8 letras) não chegam — evita apanhar «ME» ou «LTDA» sozinhos.
   */
  function nfeNomeCorresponde(nfNome, clienteNome) {
    var a = nfeNormChaveNome(nfNome);
    var b = nfeNormChaveNome(clienteNome);
    if (!a || !b) return false;
    if (a === b) return true;
    var curto = a.length <= b.length ? a : b;
    var longo = a.length <= b.length ? b : a;
    if (curto.length < 8) return false;
    return (' ' + longo + ' ').indexOf(' ' + curto + ' ') >= 0;
  }

  function nfeYmDeData(data) {
    var s = String(data || '').trim();
    if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
    var m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (!m) return '';
    var mes = String(parseInt(m[2], 10)).padStart(2, '0');
    if (mes < '01' || mes > '12') return '';
    return m[3] + '-' + mes;
  }

  /**
   * NPess que conta, por código SAP. Códigos diferentes não se juntam.
   * É o das vendas mais recentes: o mês maior; se 2026 já tem vendas, 2025 não entra.
   * No mesmo mês, fica o NPess com mais Fatur.
   * linhas: { cod, data|ym, npess, valor, nome }
   * devolve { cod: { npess, ym, nome, valor } }
   */
  function npessAtualDeLinhas(linhas) {
    var porCod = {};
    (linhas || []).forEach(function (row) {
      if (!row) return;
      var cod = String(row.cod == null ? '' : row.cod).trim();
      if (!cod) return;
      var codNorm = cod.replace(/\u00a0/g, ' ').trim().split(/\s+/)[0].replace(/^0+/, '');
      if (codNorm === '441908') return;
      var ym = row.ym ? String(row.ym).slice(0, 7) : nfeYmDeData(row.data);
      if (!/^\d{4}-\d{2}$/.test(ym)) return;
      var npess = parseInt(row.npess, 10) || 0;
      if (!npess) return;
      // Devolução Q Brasil → Delta. Não é venda e não pode ficar como vendedor actual.
      if (npess === 99520099) return;
      var valor = Number(row.valor);
      if (!Number.isFinite(valor)) valor = 0;
      var nome = String(row.nome || '').trim();
      if (!porCod[cod]) porCod[cod] = {};
      if (!porCod[cod][ym]) porCod[cod][ym] = {};
      if (!porCod[cod][ym][npess]) porCod[cod][ym][npess] = { valor: 0, nome: '' };
      porCod[cod][ym][npess].valor += valor;
      if (nome) porCod[cod][ym][npess].nome = nome;
    });
    var out = {};
    Object.keys(porCod).forEach(function (cod) {
      var meses = porCod[cod];
      var yms = Object.keys(meses);
      var temDesde2026 = yms.some(function (ym) { return ym >= '2026-01'; });
      var candidatos = temDesde2026 ? yms.filter(function (ym) { return ym >= '2026-01'; }) : yms;
      var ym = candidatos.slice().sort().pop();
      var slots = meses[ym];
      var bestNp = 0;
      var bestVal = null;
      var bestNome = '';
      Object.keys(slots).forEach(function (np) {
        var v = slots[np].valor;
        var n = parseInt(np, 10) || 0;
        if (!n) return;
        if (bestVal == null || v > bestVal) {
          bestVal = v;
          bestNp = n;
          bestNome = slots[np].nome || '';
        }
      });
      if (!bestNp) return;
      out[cod] = { npess: bestNp, ym: ym, nome: bestNome, valor: bestVal };
    });
    return out;
  }

  function npessAtualPorCodDeVendasCliente(store) {
    var meses = (store && store.meses) || {};
    var linhas = [];
    Object.keys(meses).forEach(function (ym) {
      var clientes = (meses[ym] && meses[ym].clientes) || {};
      Object.keys(clientes).forEach(function (k) {
        var c = clientes[k];
        if (!c || !c.cod) return;
        linhas.push({ cod: c.cod, ym: ym, npess: c.npess, valor: c.valor, nome: c.nome });
      });
    });
    return npessAtualDeLinhas(linhas);
  }

  /** Um registo por código, já com o NPess atual e o nome gravado nesse mês. */
  function catalogoVendedorAtual(storeOrLinhas) {
    var mapa;
    if (storeOrLinhas && storeOrLinhas.meses) mapa = npessAtualPorCodDeVendasCliente(storeOrLinhas);
    else if (Array.isArray(storeOrLinhas)) mapa = npessAtualDeLinhas(storeOrLinhas);
    else mapa = {};
    return Object.keys(mapa).map(function (cod) {
      var e = mapa[cod];
      return { cod: cod, npess: e.npess, nome: e.nome, ym: e.ym };
    });
  }

  function nfeCodigosPorNome(nomeNf, catalogo) {
    var hits = {};
    (catalogo || []).forEach(function (c) {
      if (!c || c.cod == null || !c.nome) return;
      if (!nfeNomeCorresponde(nomeNf, c.nome)) return;
      var cod = String(c.cod).trim();
      if (!cod || hits[cod]) return;
      hits[cod] = c;
    });
    return Object.keys(hits).map(function (cod) { return hits[cod]; });
  }

  /**
   * Um código: fica esse código, o NPess atual e o canal.
   * Vários códigos com o mesmo NPess atual (e o mesmo vendedor): a nota vai para esse
   * vendedor e para o canal dele. O código SAP não é escolhido ao acaso — fica em branco
   * e os códigos vão em `codigos`. NPess ou vendedores diferentes não se atribuem.
   */
  function nfeCanalDoNpess(npess, canalDeNpess) {
    var canalId = '';
    try {
      canalId = (typeof canalDeNpess === 'function' ? canalDeNpess(npess) : '') || '';
    } catch (_) { canalId = ''; }
    return String(canalId || '');
  }

  function nfeAtribuirPorNome(nomeNf, catalogo, canalDeNpess) {
    var hits = nfeCodigosPorNome(nomeNf, catalogo);
    if (!hits.length) return null;
    if (hits.length === 1) {
      var c = hits[0];
      var npess = parseInt(c.npess, 10) || 0;
      var cod = String(c.cod).trim();
      return {
        status: NFE_STATUS_UNICO,
        canalId: nfeCanalDoNpess(npess, canalDeNpess),
        vendedor: String(c.vendedor || '').trim(),
        cod: cod,
        npess: npess ? String(npess) : '',
        codigos: cod ? [cod] : [],
        rotulo: '',
      };
    }
    var npSet = {};
    var vendPorNorm = {};
    var semNpess = false;
    hits.forEach(function (h) {
      var np = parseInt(h.npess, 10) || 0;
      if (!np) { semNpess = true; return; }
      npSet[String(np)] = np;
      var bruto = String(h.vendedor || '').trim();
      var norm = nfeNormNome(bruto);
      if (norm && !vendPorNorm[norm]) vendPorNorm[norm] = bruto;
    });
    var npKeys = Object.keys(npSet);
    var vendKeys = Object.keys(vendPorNorm);
    if (semNpess || npKeys.length !== 1 || vendKeys.length !== 1) return null;
    var npessM = npSet[npKeys[0]];
    var codigos = hits.map(function (h) { return String(h.cod).trim(); }).filter(Boolean);
    codigos.sort(function (a, b) { return a.localeCompare(b, 'pt', { numeric: true }); });
    return {
      status: NFE_STATUS_UNICO,
      canalId: nfeCanalDoNpess(npessM, canalDeNpess),
      vendedor: vendPorNorm[vendKeys[0]],
      cod: '',
      npess: String(npessM),
      codigos: codigos,
      rotulo: '',
    };
  }

  /** Notas já «sem cliente»: CNPJ cujo nome casa com o NPess atual (um código, ou vários do mesmo vendedor) passa a esse vendedor. O resto fica. */
  function nfeReaplicarVendedorPorNome(notas, catalogo, canalDeNpess) {
    var alteradas = 0;
    if (!catalogo || !catalogo.length) return { notas: notas || [], alteradas: 0 };
    var out = (notas || []).map(function (n) {
      if (!n || n.status !== NFE_STATUS_SEM) return n;
      if (nfeDocEhCpf(n.destDoc)) return n;
      if (String(n.vendedor || '').trim()) return n;
      var porNome = nfeAtribuirPorNome(n.cliente, catalogo, canalDeNpess);
      if (!porNome) return n;
      alteradas++;
      return Object.assign({}, n, porNome);
    });
    return { notas: out, alteradas: alteradas };
  }

  /**
   * Notas já gravadas: o par Delta ES ↔ Delta SP passa a Transferências internas,
   * mesmo que já estivesse no Marcio. Outro CNPJ não muda.
   */
  function nfeReaplicarTransferenciasInternas(notas) {
    var alteradas = 0;
    var out = (notas || []).map(function (n) {
      if (!nfeEhTransferenciaInterna(n)) return n;
      var next = nfeComTransferenciaInterna(n);
      if (!nfeAtribDifere(n, next)) return n;
      alteradas++;
      return next;
    });
    return { notas: out, alteradas: alteradas };
  }

  /** Notas já gravadas «sem cliente»: o CPF sem vendedor passa a Marcio / Ecommerce. O resto fica. */
  function nfeReaplicarCpfSemVendedor(notas) {
    var alteradas = 0;
    var out = (notas || []).map(function (n) {
      if (!nfeCpfPrecisaMarcio(n)) return n;
      alteradas++;
      return nfeComMarcioEcommerce(n);
    });
    return { notas: out, alteradas: alteradas };
  }

  function nfeCampo(v) {
    return v == null ? '' : String(v);
  }

  function nfeAtribDifere(a, b) {
    if (!a || !b) return true;
    return nfeCampo(a.status) !== nfeCampo(b.status)
      || nfeCampo(a.canalId) !== nfeCampo(b.canalId)
      || nfeNormNome(a.vendedor) !== nfeNormNome(b.vendedor)
      || nfeCampo(a.npess) !== nfeCampo(b.npess);
  }

  function nfeTemPdfBinario(n) {
    return !!(n && typeof n.pdfBase64 === 'string' && n.pdfBase64.length > 0);
  }

  function nfeTemBoletoBinario(n) {
    if (!n) return false;
    if (typeof n.boletoBase64 === 'string' && n.boletoBase64.length > 0) return true;
    if (!Array.isArray(n.boletos)) return false;
    for (var i = 0; i < n.boletos.length; i++) {
      var b = n.boletos[i];
      var b64 = b && (b.pdfBase64 || b.b64 || b.boletoBase64);
      if (typeof b64 === 'string' && b64.length > 0) return true;
    }
    return false;
  }

  /** Quantos PDF de boleto a nota tem. O campo antigo boletoBase64 conta como um. */
  function nfeContaBoletosBinario(n) {
    if (!n) return 0;
    var n1 = 0;
    if (Array.isArray(n.boletos)) {
      n.boletos.forEach(function (b) {
        var b64 = b && (b.pdfBase64 || b.b64 || b.boletoBase64);
        if (typeof b64 === 'string' && b64.length > 0) n1++;
      });
    }
    if (!n1 && typeof n.boletoBase64 === 'string' && n.boletoBase64.length > 0) return 1;
    return n1;
  }

  function nfeTemJuntoBinario(n) {
    return !!(n && typeof n.pdfJuntoBase64 === 'string' && n.pdfJuntoBase64.length > 0);
  }

  /**
   * Coluna Boleto da lista de NF: S ou N.
   * S quando a nota tem boleto gravado — boletoBase64, o PDF junto
   * (pdfJuntoBase64), ou a marca que fica na célula leve (temBoleto,
   * temPdfJunto, boletoNome, pdfJuntoNome) depois de tirar o base64.
   * O PDF da DANFE sozinho não conta. Sem esses campos, N.
   */
  function nfeMarcaBoleto(n) {
    if (!n) return 'N';
    if (typeof n.boletoBase64 === 'string' && n.boletoBase64.length > 0) return 'S';
    if (typeof n.pdfJuntoBase64 === 'string' && n.pdfJuntoBase64.length > 0) return 'S';
    if (n.temBoleto) return 'S';
    if (n.temPdfJunto) return 'S';
    if (typeof n.boletoNome === 'string' && n.boletoNome.length > 0) return 'S';
    if (typeof n.pdfJuntoNome === 'string' && n.pdfJuntoNome.length > 0) return 'S';
    if (Array.isArray(n.boletos) && n.boletos.some(function (b) {
      return !!(b && (b.nome || b.boletoNome || b.pdfBase64 || b.b64));
    })) return 'S';
    return 'N';
  }

  function nfeTemAlgumBinario(n) {
    return nfeTemPdfBinario(n) || nfeTemBoletoBinario(n) || nfeTemJuntoBinario(n);
  }

  function nfeTamanhoBinarios(n) {
    if (!n) return 0;
    var bol = 0;
    if (Array.isArray(n.boletos) && n.boletos.length) {
      n.boletos.forEach(function (b) {
        bol += String((b && (b.pdfBase64 || b.b64 || b.boletoBase64)) || '').length;
      });
    }
    if (!bol) bol = String(n.boletoBase64 || '').length;
    return String(n.pdfBase64 || '').length + bol + String(n.pdfJuntoBase64 || '').length;
  }

  function nfeMergeNotas(existing, incoming) {
    var by = new Map();
    var notas = [];
    var repetidas = 0;
    var novas = 0;
    var pdfsNovos = 0;
    (existing || []).forEach(function (n) {
      if (!n || !n.chave || by.has(n.chave)) return;
      var copia = Object.assign({}, n);
      by.set(copia.chave, copia);
      notas.push(copia);
    });
    (incoming || []).forEach(function (n) {
      if (!n || !n.chave) return;
      if (by.has(n.chave)) {
        repetidas++;
        var prev = by.get(n.chave);
        if (!nfeTemPdfBinario(prev) && nfeTemPdfBinario(n)) {
          prev.pdfBase64 = n.pdfBase64;
          prev.pdfNome = n.pdfNome || prev.pdfNome || '';
          prev.temPdf = true;
          pdfsNovos++;
        } else if (!prev.pdfNome && n.pdfNome) {
          prev.pdfNome = n.pdfNome;
          if (n.temPdf) prev.temPdf = true;
        }
        var prevBol = nfeBoletosDaNota(prev).filter(function (b) { return b && b.pdfBase64; });
        var novoBol = nfeBoletosDaNota(n).filter(function (b) { return b && b.pdfBase64; });
        if (novoBol.length > prevBol.length) {
          var mapaBol = {};
          prevBol.forEach(function (b) { mapaBol[b.nome || ('\0' + b.pdfBase64)] = b; });
          novoBol.forEach(function (b) { mapaBol[b.nome || ('\0' + b.pdfBase64)] = b; });
          var listaBol = [];
          Object.keys(mapaBol).forEach(function (k) { listaBol.push(mapaBol[k]); });
          nfeAplicarBoletos(prev, listaBol);
          if (nfeTemJuntoBinario(n)) {
            prev.pdfJuntoBase64 = n.pdfJuntoBase64;
            prev.pdfJuntoNome = n.pdfJuntoNome || prev.pdfJuntoNome || '';
            prev.temPdfJunto = true;
          } else {
            delete prev.pdfJuntoBase64;
            prev.temPdfJunto = false;
          }
        } else if (!prevBol.length && novoBol.length) {
          nfeAplicarBoletos(prev, novoBol);
        } else if (!prev.boletoNome && n.boletoNome) {
          prev.boletoNome = n.boletoNome;
          if (n.temBoleto) prev.temBoleto = true;
          if (Array.isArray(n.boletos) && n.boletos.length && !Array.isArray(prev.boletos)) {
            prev.boletos = n.boletos.map(function (b) { return Object.assign({}, b); });
          }
        }
        if (!nfeTemJuntoBinario(prev) && nfeTemJuntoBinario(n) && novoBol.length >= prevBol.length) {
          prev.pdfJuntoBase64 = n.pdfJuntoBase64;
          prev.pdfJuntoNome = n.pdfJuntoNome || prev.pdfJuntoNome || '';
          prev.temPdfJunto = true;
        } else if (!prev.pdfJuntoNome && n.pdfJuntoNome) {
          prev.pdfJuntoNome = n.pdfJuntoNome;
          if (n.temPdfJunto) prev.temPdfJunto = true;
        }
        return;
      }
      var nova = Object.assign({}, n);
      by.set(nova.chave, nova);
      notas.push(nova);
      novas++;
    });
    return { notas: notas, novas: novas, repetidas: repetidas, pdfsNovos: pdfsNovos };
  }

  function nfeBaseNome(name) {
    return String(name || '').split(/[/\\]/).pop();
  }

  function nfeEhPdf(name) {
    return /\.pdf$/i.test(nfeBaseNome(name));
  }

  /** Boleto do cockpit: Boleto_{número}-{série}_….pdf. Não é a DANFE. */
  function nfeEhBoleto(name) {
    return /^boleto([_.-]|$)/i.test(nfeBaseNome(name));
  }

  /**
   * Chave de 44 dígitos em qualquer segmento do caminho.
   * O cockpit grava a pasta NFe{chave}/ com a DANFE, o XML e o boleto.
   */
  function nfeChaveNoCaminho(name) {
    var parts = String(name || '').replace(/\\/g, '/').split('/');
    for (var i = parts.length - 1; i >= 0; i--) {
      var m = parts[i].match(/(\d{44})/);
      if (m) return m[1];
    }
    return '';
  }

  /**
   * Boleto_102577-2_1_1.pdf → número 102577, série 2.
   * Boleto_102606-2.pdf (sem parcela) também entra.
   */
  function nfeBoletoNumeroSerie(name) {
    var m = nfeBaseNome(name).match(/^boleto_(\d+)-(\d+)(?:[_.]|$)/i);
    if (!m) return null;
    return { numero: String(parseInt(m[1], 10)), serie: String(parseInt(m[2], 10)) };
  }

  /**
   * Boleto_102606-2_1_3.pdf → parcela 1 de 3.
   * Boleto_102606-2.pdf não tem parcela (boleto único, zips antigos).
   */
  function nfeParcelaDeNome(name) {
    var base = nfeBaseNome(name).replace(/\.pdf$/i, '');
    var m = base.match(/^boleto_\d+-\d+_(\d+)_(\d+)/i);
    if (!m) return { parcela: null, total: null };
    var parcela = parseInt(m[1], 10);
    var total = parseInt(m[2], 10);
    if (!isFinite(parcela)) return { parcela: null, total: null };
    return { parcela: parcela, total: isFinite(total) ? total : null };
  }

  function nfeItemBoleto(nome, pdfBase64, parcela, total) {
    var info = (parcela != null && parcela !== '' && isFinite(Number(parcela)))
      ? { parcela: Number(parcela), total: (total == null || total === '' || !isFinite(Number(total))) ? null : Number(total) }
      : nfeParcelaDeNome(nome);
    return {
      nome: nome || '',
      pdfBase64: pdfBase64 || '',
      parcela: info.parcela,
      total: info.total,
    };
  }

  /** Parcela 1, depois 2, depois 3. Sem índice, no fim. Mesma parcela: ordem do nome. */
  function nfeOrdenarBoletos(lista) {
    return (lista || []).slice().sort(function (a, b) {
      var pa = a && a.parcela != null && isFinite(Number(a.parcela)) ? Number(a.parcela) : 1000000000;
      var pb = b && b.parcela != null && isFinite(Number(b.parcela)) ? Number(b.parcela) : 1000000000;
      if (pa !== pb) return pa - pb;
      var na = String((a && a.nome) || '');
      var nb = String((b && b.nome) || '');
      if (na < nb) return -1;
      if (na > nb) return 1;
      return 0;
    });
  }

  /**
   * Todos os boletos da nota. O array boletos é a lista; boletoBase64
   * (formato antigo, só o primeiro) entra se ainda não estiver nessa lista.
   */
  function nfeBoletosDaNota(nota) {
    var lista = [];
    if (nota && Array.isArray(nota.boletos)) {
      nota.boletos.forEach(function (b) {
        if (!b) return;
        var nome = b.nome || b.boletoNome || '';
        var b64 = b.pdfBase64 || b.b64 || b.boletoBase64 || '';
        if (!nome && !b64) return;
        lista.push(nfeItemBoleto(nome, b64, b.parcela, b.total));
      });
    }
    if (nota && typeof nota.boletoBase64 === 'string' && nota.boletoBase64.length > 0) {
      var nomeLeg = nota.boletoNome || '';
      var achou = false;
      for (var i = 0; i < lista.length; i++) {
        if (nomeLeg && lista[i].nome === nomeLeg) {
          if (!lista[i].pdfBase64) lista[i].pdfBase64 = nota.boletoBase64;
          achou = true;
        } else if (!nomeLeg && lista[i].pdfBase64 === nota.boletoBase64) {
          achou = true;
        }
      }
      if (!achou) lista.push(nfeItemBoleto(nomeLeg, nota.boletoBase64, null, null));
    }
    return nfeOrdenarBoletos(lista);
  }

  function nfeAplicarBoletos(nota, lista) {
    var ord = nfeOrdenarBoletos((lista || []).filter(function (b) { return b && b.pdfBase64; }));
    if (!ord.length) return false;
    nota.boletos = ord.map(function (b) {
      return {
        nome: b.nome || '',
        pdfBase64: b.pdfBase64,
        parcela: b.parcela == null || !isFinite(Number(b.parcela)) ? null : Number(b.parcela),
        total: b.total == null || !isFinite(Number(b.total)) ? null : Number(b.total),
      };
    });
    nota.boletoNome = nota.boletos[0].nome;
    nota.boletoBase64 = nota.boletos[0].pdfBase64;
    nota.temBoleto = true;
    return true;
  }

  function nfeChaveBoletos(lista) {
    return nfeOrdenarBoletos((lista || []).filter(function (b) { return b && b.pdfBase64; })).map(function (b) {
      return String(b.parcela == null ? '' : b.parcela) + '\t' + (b.nome || '') + '\t' + b.pdfBase64;
    }).join('\n');
  }

  /** Copia os PDF dos boletos para o mapa (IndexedDB / blocos da nuvem). Não encolhe uma lista já maior. */
  function nfePreencherHitBoleto(hit, n) {
    if (!hit) return false;
    var lista = nfeBoletosDaNota(n).filter(function (b) { return b && b.pdfBase64; });
    if (!lista.length) return false;
    var prevN = 0;
    if (Array.isArray(hit.boletos)) {
      hit.boletos.forEach(function (b) {
        if (b && (b.b64 || b.pdfBase64)) prevN++;
      });
    }
    if (!prevN && (hit.boletoB64 || hit.boletoBase64)) prevN = 1;
    if (lista.length < prevN) return false;
    hit.boletoNome = (n && n.boletoNome) || lista[0].nome || '';
    hit.boletoB64 = (n && n.boletoBase64) || lista[0].pdfBase64;
    hit.boletos = lista.map(function (b) {
      return {
        nome: b.nome || '',
        b64: b.pdfBase64,
        parcela: b.parcela == null ? null : b.parcela,
        total: b.total == null ? null : b.total,
      };
    });
    return true;
  }

  function nfeBoletosDoHit(hit) {
    if (!hit) return [];
    if (Array.isArray(hit.boletos) && hit.boletos.length) {
      var out = [];
      hit.boletos.forEach(function (b) {
        if (!b) return;
        var nome = b.nome || '';
        var b64 = b.b64 || b.pdfBase64 || '';
        if (!b64) return;
        out.push(nfeItemBoleto(nome, b64, b.parcela, b.total));
      });
      if (out.length) return nfeOrdenarBoletos(out);
    }
    var bb = hit.boletoB64 || hit.boletoBase64 || '';
    if (!bb) return [];
    return [nfeItemBoleto(hit.boletoNome || '', bb, null, null)];
  }

  /**
   * 44 dígitos seguidos no nome do ficheiro (a chave da NF-e).
   * O cockpit grava pastas com barra invertida:
   * ...\NFe{chave}.pdf ao lado de ...\NFe{chave}_prot.xml.
   * NFe{chave}.pdf (ou só os 44 dígitos) no nome continua a contar.
   */
  function nfeChaveNoNome(name) {
    var base = nfeBaseNome(name);
    var m = base.match(/(\d{44})/);
    return m ? m[1] : '';
  }

  /**
   * Número da NF no nome: o ficheiro chama-se o número, ou {número}.pdf.
   * A chave de 44 dígitos não conta como número.
   */
  function nfeNumeroNoNome(name) {
    var base = nfeBaseNome(name).replace(/\.pdf$/i, '');
    if (!/^\d{1,9}$/.test(base)) return '';
    return String(parseInt(base, 10));
  }

  function nfeNumIgual(a, b) {
    var da = String(a == null ? '' : a).replace(/\D/g, '').replace(/^0+/, '');
    var db = String(b == null ? '' : b).replace(/\D/g, '').replace(/^0+/, '');
    return da !== '' && da === db;
  }

  function nfeLigarPdf(nota, pdf) {
    nota.pdfNome = nfeBaseNome(pdf.name);
    nota.pdfBase64 = pdf.pdfBase64;
    nota.temPdf = true;
  }

  /**
   * Liga cada PDF a uma nota já parseada. Primeiro pela chave no nome,
   * depois pelo número — e só se houver uma única nota com esse número
   * (séries diferentes não partilham o PDF). PDF sem par não vira nota.
   */
  function nfeAssociarPdfs(notas, pdfs) {
    var out = (notas || []).map(function (n) { return Object.assign({}, n); });
    var livres = [];
    (pdfs || []).forEach(function (p) {
      if (!p || !nfeEhPdf(p.name) || !nfeTemPdfBinario(p) || nfeEhBoleto(p.name)) return;
      livres.push({ name: p.name, pdfBase64: p.pdfBase64, usado: false });
    });

    livres.forEach(function (pdf) {
      var ch = nfeChaveNoNome(pdf.name);
      if (!ch) return;
      for (var i = 0; i < out.length; i++) {
        if (out[i] && out[i].chave === ch && !nfeTemPdfBinario(out[i])) {
          nfeLigarPdf(out[i], pdf);
          pdf.usado = true;
          return;
        }
      }
    });

    livres.forEach(function (pdf) {
      if (pdf.usado) return;
      var num = nfeNumeroNoNome(pdf.name);
      if (!num) return;
      var hits = out.filter(function (n) {
        return n && !nfeTemPdfBinario(n) && nfeNumIgual(n.numero, num);
      });
      if (hits.length !== 1) return;
      nfeLigarPdf(hits[0], pdf);
      pdf.usado = true;
    });

    var ligados = livres.filter(function (p) { return p.usado; }).length;
    return { notas: out, ligados: ligados, soltos: livres.length - ligados };
  }

  /**
   * Liga cada boleto à nota. Primeiro pela pasta NFe{chave},
   * depois por Boleto_{número}-{série} se só houver uma nota com esse par.
   * Pagamento parcelado: todos os PDF Boleto_{número}-{série}_{parcela}_{total}
   * da mesma nota entram, por ordem da parcela. Sem parcela continua a ligar
   * (um boleto, zips antigos). Boleto sem par não vira nota. A DANFE não é substituída.
   */
  function nfeAssociarBoletos(notas, pdfs) {
    var out = (notas || []).map(function (n) { return Object.assign({}, n); });
    var livres = [];
    (pdfs || []).forEach(function (p) {
      if (!p || !nfeEhPdf(p.name) || !nfeTemPdfBinario(p) || !nfeEhBoleto(p.name)) return;
      livres.push({ name: p.name, pdfBase64: p.pdfBase64, usado: false });
    });

    var grupos = {};
    function juntar(i, pdf) {
      if (!grupos[i]) grupos[i] = [];
      grupos[i].push(pdf);
      pdf.usado = true;
    }

    livres.forEach(function (pdf) {
      var ch = nfeChaveNoCaminho(pdf.name);
      if (!ch) return;
      for (var i = 0; i < out.length; i++) {
        if (out[i] && out[i].chave === ch) {
          juntar(i, pdf);
          return;
        }
      }
    });

    livres.forEach(function (pdf) {
      if (pdf.usado) return;
      var ns = nfeBoletoNumeroSerie(pdf.name);
      if (!ns) return;
      var hits = [];
      for (var i = 0; i < out.length; i++) {
        var n = out[i];
        if (n && nfeNumIgual(n.numero, ns.numero) && nfeNumIgual(n.serie, ns.serie)) hits.push(i);
      }
      if (hits.length !== 1) return;
      juntar(hits[0], pdf);
    });

    Object.keys(grupos).forEach(function (k) {
      var nota = out[Number(k)];
      var antes = nfeChaveBoletos(nfeBoletosDaNota(nota));
      var mapa = {};
      nfeBoletosDaNota(nota).forEach(function (b) {
        if (!b || !b.pdfBase64) return;
        mapa[b.nome || ('\0' + b.pdfBase64)] = b;
      });
      grupos[k].forEach(function (pdf) {
        var nome = nfeBaseNome(pdf.name);
        var info = nfeParcelaDeNome(nome);
        mapa[nome] = { nome: nome, pdfBase64: pdf.pdfBase64, parcela: info.parcela, total: info.total };
      });
      var lista = [];
      Object.keys(mapa).forEach(function (key) { lista.push(mapa[key]); });
      nfeAplicarBoletos(nota, lista);
      if (antes !== nfeChaveBoletos(nfeBoletosDaNota(nota)) && nfeTemJuntoBinario(nota)) {
        delete nota.pdfJuntoBase64;
        nota.temPdfJunto = false;
      }
    });

    var ligados = livres.filter(function (p) { return p.usado; }).length;
    return { notas: out, ligados: ligados, soltos: livres.length - ligados };
  }

  function nfeB64ParaBytes(b64) {
    var s = String(b64 || '');
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
    return out;
  }

  function nfeBytesParaB64(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
    var bin = '';
    var chunk = 0x8000;
    for (var i = 0; i < u8.length; i += chunk) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function nfePdfLib() {
    var g = typeof globalThis !== 'undefined' ? globalThis : null;
    if (g && g.PDFLib && g.PDFLib.PDFDocument) return g.PDFLib;
    if (typeof require === 'function') {
      try {
        var lib = require('./pdf-lib.min.js');
        if (lib && lib.PDFDocument) {
          if (g) g.PDFLib = lib;
          return lib;
        }
      } catch (_) {}
    }
    return null;
  }

  /** Junta os PDF por esta ordem: páginas da NF e depois cada boleto, pela parcela. */
  async function nfeFundirPdfs(partesB64) {
    var lib = nfePdfLib();
    if (!lib) throw new Error('pdf-lib indisponível');
    var out = await lib.PDFDocument.create();
    var paginas = 0;
    var lista = partesB64 || [];
    for (var i = 0; i < lista.length; i++) {
      if (!lista[i]) continue;
      var doc = await lib.PDFDocument.load(nfeB64ParaBytes(lista[i]), { ignoreEncryption: true });
      var pages = await out.copyPages(doc, doc.getPageIndices());
      pages.forEach(function (p) { out.addPage(p); });
      paginas += pages.length;
    }
    if (!paginas) throw new Error('PDF sem páginas');
    var saved = await out.save();
    return { b64: nfeBytesParaB64(saved), paginas: paginas };
  }

  /**
   * Quando a nota tem o PDF da NF e boleto(s), grava também um único PDF:
   * páginas da DANFE, depois a parcela 1, a 2, a 3, e assim por diante.
   * Sem a DANFE ou sem boleto, não inventa páginas.
   */
  async function nfeAnexarDocsJuntos(notas) {
    var out = [];
    var juntos = 0;
    var falhas = 0;
    var lista = notas || [];
    for (var i = 0; i < lista.length; i++) {
      var n = Object.assign({}, lista[i]);
      if (Array.isArray(lista[i].boletos)) {
        n.boletos = lista[i].boletos.map(function (b) { return Object.assign({}, b); });
      }
      if (nfeTemPdfBinario(n) && nfeTemBoletoBinario(n) && !nfeTemJuntoBinario(n)) {
        try {
          var partes = [n.pdfBase64];
          nfeBoletosDaNota(n).forEach(function (b) {
            if (b && b.pdfBase64) partes.push(b.pdfBase64);
          });
          var fus = await nfeFundirPdfs(partes);
          n.pdfJuntoBase64 = fus.b64;
          n.pdfJuntoNome = 'NF-' + (n.numero || n.chave || 'nota') + '-boleto.pdf';
          n.temPdfJunto = true;
          juntos++;
        } catch (_) {
          falhas++;
        }
      }
      out.push(n);
    }
    return { notas: out, juntos: juntos, falhas: falhas };
  }

  /** Teto seguro do JSON de uma célula lista_clientes. O que não cabe vai para células nfe_pdfs_N. */
  var NFE_NUVEM_JSON_MAX = 750000;

  function nfeNotaSemPdfBinario(nota) {
    if (!nota || !nfeTemAlgumBinario(nota)) return nota;
    var o = Object.assign({}, nota);
    if (o.pdfBase64) {
      delete o.pdfBase64;
      if (o.pdfNome) o.temPdf = true;
    }
    if (Array.isArray(o.boletos)) {
      o.boletos = o.boletos.map(function (b) {
        if (!b) return null;
        var nome = b.nome || b.boletoNome || '';
        if (!nome) return null;
        return {
          nome: nome,
          parcela: b.parcela == null || b.parcela === '' ? null : b.parcela,
          total: b.total == null || b.total === '' ? null : b.total,
        };
      }).filter(Boolean);
      if (o.boletos.length) o.temBoleto = true;
    }
    if (o.boletoBase64) {
      delete o.boletoBase64;
      if (o.boletoNome || (o.boletos && o.boletos.length)) o.temBoleto = true;
    }
    if (o.pdfJuntoBase64) {
      delete o.pdfJuntoBase64;
      if (o.pdfJuntoNome) o.temPdfJunto = true;
    }
    return o;
  }

  function nfeJsonLen(arr) {
    try { return JSON.stringify(arr).length; } catch (_) { return Infinity; }
  }

  function nfeNotasParaNuvem(notas) {
    var arr = (notas || []).map(function (n) { return Object.assign({}, n); });
    if (nfeJsonLen(arr) <= NFE_NUVEM_JSON_MAX) return { notas: arr, pdfNaNuvem: true, pdfsFora: 0 };
    var idxs = [];
    arr.forEach(function (n, i) { if (nfeTemAlgumBinario(n)) idxs.push(i); });
    idxs.sort(function (a, b) {
      return nfeTamanhoBinarios(arr[b]) - nfeTamanhoBinarios(arr[a]);
    });
    var stripped = 0;
    idxs.forEach(function (i) {
      if (nfeJsonLen(arr) <= NFE_NUVEM_JSON_MAX) return;
      arr[i] = nfeNotaSemPdfBinario(arr[i]);
      stripped++;
    });
    return { notas: arr, pdfNaNuvem: stripped === 0, pdfsFora: stripped };
  }

  /** PDF que a célula das notas já não leva — estes é que têm de ir para blocos à parte. */
  function nfePdfsForaDaCelula(notas, notasNuvem) {
    var nuvem = {};
    (notasNuvem || []).forEach(function (n) {
      if (n && n.chave) nuvem[n.chave] = n;
    });
    var fora = [];
    (notas || []).forEach(function (n) {
      if (!n || !n.chave) return;
      var c = nuvem[n.chave];
      var faltaPdf = nfeTemPdfBinario(n) && !(c && nfeTemPdfBinario(c));
      var faltaBol = nfeContaBoletosBinario(n) > nfeContaBoletosBinario(c);
      var faltaJunto = nfeTemJuntoBinario(n) && !(c && nfeTemJuntoBinario(c));
      if (!faltaPdf && !faltaBol && !faltaJunto) return;
      fora.push(n);
    });
    return fora;
  }

  function nfeTamanhoBlocoPdf(lista) {
    return nfeJsonLen({ __format: 'nfe_pdfs', pdfs: lista });
  }

  /**
   * Parte os PDF em listas cujo JSON cabe numa célula.
   * Um PDF maior do que o tecto fica sozinho no seu bloco.
   */
  function nfePartirPdfsEmChunks(notas) {
    var itens = [];
    (notas || []).forEach(function (n) {
      if (!n || !n.chave || !nfeTemAlgumBinario(n)) return;
      var item = { chave: String(n.chave) };
      if (nfeTemPdfBinario(n)) {
        item.nome = n.pdfNome || (String(n.chave) + '.pdf');
        item.b64 = n.pdfBase64;
      }
      if (nfeTemBoletoBinario(n)) {
        var hitBol = {};
        if (nfePreencherHitBoleto(hitBol, n)) {
          item.boletoNome = hitBol.boletoNome || '';
          item.boletoB64 = hitBol.boletoB64;
          item.boletos = hitBol.boletos;
        }
      }
      if (nfeTemJuntoBinario(n)) {
        item.juntoNome = n.pdfJuntoNome || '';
        item.juntoB64 = n.pdfJuntoBase64;
      }
      itens.push(item);
    });
    var chunks = [];
    var atual = [];
    itens.forEach(function (item) {
      if (!atual.length) {
        atual = [item];
        return;
      }
      var junto = atual.concat([item]);
      if (nfeTamanhoBlocoPdf(junto) > NFE_NUVEM_JSON_MAX) {
        chunks.push(atual);
        atual = [item];
      } else {
        atual = junto;
      }
    });
    if (atual.length) chunks.push(atual);
    return chunks;
  }

  function nfeMapaPdfsDeChunks(chunks) {
    var map = {};
    (chunks || []).forEach(function (chunk) {
      var lista = Array.isArray(chunk) ? chunk : (chunk && (chunk.pdfs || chunk));
      if (!Array.isArray(lista)) return;
      lista.forEach(function (p) {
        if (!p || !p.chave) return;
        var prev = map[String(p.chave)] || {};
        var b64 = p.b64 || p.pdfBase64 || '';
        var bol = p.boletoB64 || p.boletoBase64 || '';
        var jun = p.juntoB64 || p.pdfJuntoBase64 || '';
        var incoming = Array.isArray(p.boletos) ? p.boletos : [];
        var previous = Array.isArray(prev.boletos) ? prev.boletos : [];
        var bols = (incoming.length >= previous.length && incoming.length) ? incoming : (previous.length ? previous : null);
        if (!b64 && !bol && !jun && !bols && !prev.b64 && !prev.boletoB64 && !prev.juntoB64) return;
        var hit = {
          nome: p.nome || prev.nome || '',
          b64: b64 || prev.b64 || '',
          boletoNome: p.boletoNome || prev.boletoNome || '',
          boletoB64: bol || prev.boletoB64 || '',
          juntoNome: p.juntoNome || prev.juntoNome || '',
          juntoB64: jun || prev.juntoB64 || '',
        };
        if (bols) hit.boletos = bols;
        map[String(p.chave)] = hit;
      });
    });
    return map;
  }

  function nfeJuntarPdfsLocais(notas, pdfs) {
    var map = pdfs && typeof pdfs === 'object' ? pdfs : null;
    return (notas || []).map(function (n) {
      if (!n) return n;
      var o = Object.assign({}, n);
      if (!map || !n.chave) return o;
      var hit = map[n.chave];
      if (!hit) return o;
      if (!nfeTemPdfBinario(o)) {
        var b64 = hit.b64 || hit.pdfBase64;
        if (b64) {
          o.pdfBase64 = b64;
          o.pdfNome = o.pdfNome || hit.nome || '';
          o.temPdf = true;
        }
      }
      var doHit = nfeBoletosDoHit(hit);
      var atuais = nfeBoletosDaNota(o).filter(function (b) { return b && b.pdfBase64; });
      if (doHit.length) {
        var mapaBol = {};
        atuais.forEach(function (b) { mapaBol[b.nome || ('\0' + b.pdfBase64)] = b; });
        doHit.forEach(function (b) { mapaBol[b.nome || ('\0' + b.pdfBase64)] = b; });
        var listaBol = [];
        Object.keys(mapaBol).forEach(function (k) { listaBol.push(mapaBol[k]); });
        if (listaBol.length >= atuais.length) nfeAplicarBoletos(o, listaBol);
      }
      if (!nfeTemJuntoBinario(o)) {
        var jb = hit.juntoB64 || hit.pdfJuntoBase64;
        if (jb) {
          o.pdfJuntoBase64 = jb;
          o.pdfJuntoNome = o.pdfJuntoNome || hit.juntoNome || '';
          o.temPdfJunto = true;
        }
      }
      return o;
    });
  }

  function nfePdfDaNota(nota, pdfMap) {
    var comMapa = nfeJuntarPdfsLocais(nota ? [nota] : [], pdfMap);
    var n = comMapa[0];
    if (!n) return { ok: false, msg: 'Esta NF não tem PDF.' };
    if (nfeTemJuntoBinario(n)) {
      return {
        ok: true,
        pdfBase64: n.pdfJuntoBase64,
        pdfNome: n.pdfJuntoNome || ('NF-' + (n.numero || n.chave || 'nota') + '-boleto.pdf'),
        junto: true,
      };
    }
    if (!nfeTemPdfBinario(n)) return { ok: false, msg: 'Esta NF não tem PDF.' };
    return {
      ok: true,
      pdfBase64: n.pdfBase64,
      pdfNome: n.pdfNome || ((n.chave || 'nota') + '.pdf'),
      junto: false,
    };
  }

  /**
   * Site próprio do Marcio Gorga: NPess 99520009.
   * Não é Lojas online (99520001), nem Institucional (99520005), nem Restauração QB (99530003).
   * Notas deste canal entram no Ecommerce pelo mapa de vendedor; aqui identificam-se à parte.
   */
  var NFE_SITE_MARCIO_NPESS = '99520009';

  function nfeNormCanal(s) {
    return nfeNormNome(s).replace(/_/g, ' ');
  }

  function nfeEhSiteProprio(n) {
    if (!n) return false;
    var np = String(n.npess == null ? '' : n.npess).replace(/\D/g, '');
    if (np === NFE_SITE_MARCIO_NPESS) return true;
    var id = nfeNormCanal(n.canalId);
    if (id === 'DFB SITE' || id === 'SITE PROPRIO') return true;
    var nomes = [n.canalNome, n.canal, n.canalPl];
    for (var i = 0; i < nomes.length; i++) {
      if (nfeNormCanal(nomes[i]) === 'SITE PROPRIO') return true;
    }
    return false;
  }

  function nfeNotasSemSiteMarcio(notas) {
    return (notas || []).filter(function (n) { return !nfeEhSiteProprio(n); });
  }

  /** Notas de um menu de canal. Outro canal e notas sem canal ficam de fora. */
  function nfeNotasDoCanal(notas, canalId) {
    var id = String(canalId || '');
    if (!id) return [];
    return (notas || []).filter(function (n) {
      return !!(n && String(n.canalId || '') === id);
    });
  }

  function nfeU32(buf, off) { return buf.readUInt32LE(off); }
  function nfeU16(buf, off) { return buf.readUInt16LE(off); }

  /** Lê XML e PDF de um zip (directório central — o cockpit usa data descriptor). Node. */
  function nfeReadZipEntries(input) {
    var zlib;
    try { zlib = require('zlib'); } catch (_) { zlib = null; }
    if (!zlib || typeof Buffer === 'undefined') {
      throw new Error('Leitura de zip neste runtime só está disponível em Node.');
    }
    var buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
    if (buf.length < 22) throw new Error('ZIP vazio ou inválido.');
    var eocd = -1;
    var min = Math.max(0, buf.length - 22 - 65535);
    for (var i = buf.length - 22; i >= min; i--) {
      if (nfeU32(buf, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Não é um ZIP (fim do directório central em falta).');
    var count = nfeU16(buf, eocd + 10);
    var cdOff = nfeU32(buf, eocd + 16);
    if (cdOff === 0xFFFFFFFF) throw new Error('ZIP64 não suportado.');
    var out = [];
    var p = cdOff;
    for (var n = 0; n < count; n++) {
      if (p + 46 > buf.length || nfeU32(buf, p) !== 0x02014b50) break;
      var method = nfeU16(buf, p + 10);
      var compSize = nfeU32(buf, p + 20);
      var nameLen = nfeU16(buf, p + 28);
      var extraLen = nfeU16(buf, p + 30);
      var commentLen = nfeU16(buf, p + 32);
      var localOff = nfeU32(buf, p + 42);
      var name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
      p += 46 + nameLen + extraLen + commentLen;
      var isXml = /\.xml$/i.test(name);
      var isPdf = /\.pdf$/i.test(name);
      if ((!isXml && !isPdf) || /\/$|\\$/.test(name)) continue;
      if (localOff + 30 > buf.length || nfeU32(buf, localOff) !== 0x04034b50) continue;
      var ln = nfeU16(buf, localOff + 26);
      var le = nfeU16(buf, localOff + 28);
      var dataStart = localOff + 30 + ln + le;
      var comp = buf.slice(dataStart, dataStart + compSize);
      var fileBuf;
      if (method === 0) fileBuf = comp;
      else if (method === 8) fileBuf = zlib.inflateRawSync(comp);
      else continue;
      if (isXml) out.push({ name: name, xml: fileBuf.toString('utf8') });
      else out.push({ name: name, pdfBase64: fileBuf.toString('base64') });
    }
    return out;
  }

  function nfeReadZipXmls(input) {
    return nfeReadZipEntries(input).filter(function (e) { return e && e.xml != null; }).map(function (e) {
      return { name: e.name, xml: e.xml };
    });
  }

  return {
    NFE_STATUS_MULTI: NFE_STATUS_MULTI,
    NFE_STATUS_SEM: NFE_STATUS_SEM,
    NFE_STATUS_UNICO: NFE_STATUS_UNICO,
    NFE_ROTULO_MULTI: NFE_ROTULO_MULTI,
    nfeNormDoc: nfeNormDoc,
    nfeNormNome: nfeNormNome,
    nfeParseXml: nfeParseXml,
    nfeIndexClientes: nfeIndexClientes,
    NFE_CPF_CANAL: NFE_CPF_CANAL,
    NFE_CPF_VENDEDOR: NFE_CPF_VENDEDOR,
    NFE_CPF_NPESS: NFE_CPF_NPESS,
    NFE_DELTA_CNPJ_ES: NFE_DELTA_CNPJ_ES,
    NFE_DELTA_CNPJ_SP: NFE_DELTA_CNPJ_SP,
    NFE_TRANSF_CANAL: NFE_TRANSF_CANAL,
    NFE_TRANSF_CANAL_NOME: NFE_TRANSF_CANAL_NOME,
    nfeEhTransferenciaInterna: nfeEhTransferenciaInterna,
    nfeReaplicarTransferenciasInternas: nfeReaplicarTransferenciasInternas,
    nfeAtribuirDestinatario: nfeAtribuirDestinatario,
    nfeCruzarNota: nfeCruzarNota,
    nfeNormChaveNome: nfeNormChaveNome,
    nfeNomeCorresponde: nfeNomeCorresponde,
    npessAtualDeLinhas: npessAtualDeLinhas,
    npessAtualPorCodDeVendasCliente: npessAtualPorCodDeVendasCliente,
    catalogoVendedorAtual: catalogoVendedorAtual,
    nfeCodigosPorNome: nfeCodigosPorNome,
    nfeAtribuirPorNome: nfeAtribuirPorNome,
    nfeReaplicarVendedorPorNome: nfeReaplicarVendedorPorNome,
    nfeReaplicarCpfSemVendedor: nfeReaplicarCpfSemVendedor,
    nfeAtribDifere: nfeAtribDifere,
    nfeMergeNotas: nfeMergeNotas,
    NFE_SITE_MARCIO_NPESS: NFE_SITE_MARCIO_NPESS,
    nfeEhSiteProprio: nfeEhSiteProprio,
    nfeNotasSemSiteMarcio: nfeNotasSemSiteMarcio,
    nfeNotasDoCanal: nfeNotasDoCanal,
    nfeTemPdfBinario: nfeTemPdfBinario,
    nfeTemBoletoBinario: nfeTemBoletoBinario,
    nfeContaBoletosBinario: nfeContaBoletosBinario,
    nfePreencherHitBoleto: nfePreencherHitBoleto,
    nfeTemJuntoBinario: nfeTemJuntoBinario,
    nfeMarcaBoleto: nfeMarcaBoleto,
    nfeBaseNome: nfeBaseNome,
    nfeEhBoleto: nfeEhBoleto,
    nfeChaveNoNome: nfeChaveNoNome,
    nfeChaveNoCaminho: nfeChaveNoCaminho,
    nfeNumeroNoNome: nfeNumeroNoNome,
    nfeBoletoNumeroSerie: nfeBoletoNumeroSerie,
    nfeAssociarPdfs: nfeAssociarPdfs,
    nfeAssociarBoletos: nfeAssociarBoletos,
    nfeFundirPdfs: nfeFundirPdfs,
    nfeAnexarDocsJuntos: nfeAnexarDocsJuntos,
    NFE_NUVEM_JSON_MAX: NFE_NUVEM_JSON_MAX,
    nfeNotaSemPdfBinario: nfeNotaSemPdfBinario,
    nfeNotasParaNuvem: nfeNotasParaNuvem,
    nfePdfsForaDaCelula: nfePdfsForaDaCelula,
    nfePartirPdfsEmChunks: nfePartirPdfsEmChunks,
    nfeMapaPdfsDeChunks: nfeMapaPdfsDeChunks,
    nfeJuntarPdfsLocais: nfeJuntarPdfsLocais,
    nfePdfDaNota: nfePdfDaNota,
    nfeReadZipEntries: nfeReadZipEntries,
    nfeReadZipXmls: nfeReadZipXmls,
  };
});
