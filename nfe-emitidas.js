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
   * CNPJ que não está na lista: o nome da NF cruza com o catálogo
   * (vendas_cliente / Excel, já com o NPess atual de 2026).
   * Um código, ou vários com o mesmo NPess atual, atribuem esse vendedor e o canal dele.
   * Códigos com NPess diferentes ficam sem cliente — não se junta o de 2025 se 2026 tiver outro.
   * CPF não entra aqui.
   */
  function nfeCruzarNota(nota, index, canalDeNpess, catalogo) {
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
      var ym = row.ym ? String(row.ym).slice(0, 7) : nfeYmDeData(row.data);
      if (!/^\d{4}-\d{2}$/.test(ym)) return;
      var npess = parseInt(row.npess, 10) || 0;
      if (!npess) return;
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

  /** 44 dígitos seguidos no nome do ficheiro (a chave da NF-e). */
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
      if (!p || !nfeEhPdf(p.name) || !nfeTemPdfBinario(p)) return;
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

  /** Teto seguro do JSON da célula lista_clientes (o PDF grande fica só no browser). */
  var NFE_NUVEM_JSON_MAX = 750000;

  function nfeNotaSemPdfBinario(nota) {
    if (!nota || !nota.pdfBase64) return nota;
    var o = Object.assign({}, nota);
    delete o.pdfBase64;
    if (o.pdfNome) o.temPdf = true;
    return o;
  }

  function nfeJsonLen(arr) {
    try { return JSON.stringify(arr).length; } catch (_) { return Infinity; }
  }

  function nfeNotasParaNuvem(notas) {
    var arr = (notas || []).map(function (n) { return Object.assign({}, n); });
    if (nfeJsonLen(arr) <= NFE_NUVEM_JSON_MAX) return { notas: arr, pdfNaNuvem: true, pdfsFora: 0 };
    var idxs = [];
    arr.forEach(function (n, i) { if (nfeTemPdfBinario(n)) idxs.push(i); });
    idxs.sort(function (a, b) {
      return String(arr[b].pdfBase64).length - String(arr[a].pdfBase64).length;
    });
    var stripped = 0;
    idxs.forEach(function (i) {
      if (nfeJsonLen(arr) <= NFE_NUVEM_JSON_MAX) return;
      arr[i] = nfeNotaSemPdfBinario(arr[i]);
      stripped++;
    });
    return { notas: arr, pdfNaNuvem: stripped === 0, pdfsFora: stripped };
  }

  function nfeJuntarPdfsLocais(notas, pdfs) {
    var map = pdfs && typeof pdfs === 'object' ? pdfs : null;
    if (!map) return (notas || []).map(function (n) { return Object.assign({}, n); });
    return (notas || []).map(function (n) {
      if (!n) return n;
      if (nfeTemPdfBinario(n)) return Object.assign({}, n);
      var hit = n.chave ? map[n.chave] : null;
      var b64 = hit && (hit.b64 || hit.pdfBase64);
      if (!b64) return Object.assign({}, n);
      return Object.assign({}, n, {
        pdfBase64: b64,
        pdfNome: n.pdfNome || hit.nome || '',
        temPdf: true,
      });
    });
  }

  function nfePdfDaNota(nota, pdfMap) {
    var comMapa = nfeJuntarPdfsLocais(nota ? [nota] : [], pdfMap);
    var n = comMapa[0];
    if (!n || !nfeTemPdfBinario(n)) return { ok: false, msg: 'Esta NF não tem PDF.' };
    return {
      ok: true,
      pdfBase64: n.pdfBase64,
      pdfNome: n.pdfNome || ((n.chave || 'nota') + '.pdf'),
    };
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
    nfeNotasDoCanal: nfeNotasDoCanal,
    nfeTemPdfBinario: nfeTemPdfBinario,
    nfeBaseNome: nfeBaseNome,
    nfeChaveNoNome: nfeChaveNoNome,
    nfeNumeroNoNome: nfeNumeroNoNome,
    nfeAssociarPdfs: nfeAssociarPdfs,
    NFE_NUVEM_JSON_MAX: NFE_NUVEM_JSON_MAX,
    nfeNotaSemPdfBinario: nfeNotaSemPdfBinario,
    nfeNotasParaNuvem: nfeNotasParaNuvem,
    nfeJuntarPdfsLocais: nfeJuntarPdfsLocais,
    nfePdfDaNota: nfePdfDaNota,
    nfeReadZipEntries: nfeReadZipEntries,
    nfeReadZipXmls: nfeReadZipXmls,
  };
});
