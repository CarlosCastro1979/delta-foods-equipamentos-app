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

  function nfeCruzarNota(nota, index, canalDeNpess) {
    var dest = nfeNormDoc(nota && nota.destDoc);
    var hits = (index && dest && index.get(dest)) || [];
    var a = nfeAtribuirDestinatario(hits, canalDeNpess);
    return Object.assign({}, nota, a);
  }

  function nfeMergeNotas(existing, incoming) {
    var by = new Map();
    var notas = [];
    var repetidas = 0;
    var novas = 0;
    (existing || []).forEach(function (n) {
      if (!n || !n.chave || by.has(n.chave)) return;
      by.set(n.chave, n);
      notas.push(n);
    });
    (incoming || []).forEach(function (n) {
      if (!n || !n.chave) return;
      if (by.has(n.chave)) { repetidas++; return; }
      by.set(n.chave, n);
      notas.push(n);
      novas++;
    });
    return { notas: notas, novas: novas, repetidas: repetidas };
  }

  function nfeU32(buf, off) { return buf.readUInt32LE(off); }
  function nfeU16(buf, off) { return buf.readUInt16LE(off); }

  /** Lê XML de um zip (directório central — o cockpit usa data descriptor). Node. */
  function nfeReadZipXmls(input) {
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
      if (!/\.xml$/i.test(name) || /\/$|\\$/.test(name)) continue;
      if (localOff + 30 > buf.length || nfeU32(buf, localOff) !== 0x04034b50) continue;
      var ln = nfeU16(buf, localOff + 26);
      var le = nfeU16(buf, localOff + 28);
      var dataStart = localOff + 30 + ln + le;
      var comp = buf.slice(dataStart, dataStart + compSize);
      var xmlBuf;
      if (method === 0) xmlBuf = comp;
      else if (method === 8) xmlBuf = zlib.inflateRawSync(comp);
      else continue;
      out.push({ name: name, xml: xmlBuf.toString('utf8') });
    }
    return out;
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
    nfeAtribuirDestinatario: nfeAtribuirDestinatario,
    nfeCruzarNota: nfeCruzarNota,
    nfeMergeNotas: nfeMergeNotas,
    nfeReadZipXmls: nfeReadZipXmls,
  };
});
