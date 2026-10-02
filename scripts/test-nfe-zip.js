#!/usr/bin/env node
/**
 * Parse do zip de NF-e do cockpit + dedupe por chave.
 * O zip tem dados de clientes e fica fora do git (_nfe_samples/ ou o caminho do upload).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const nfe = require('../nfe-emitidas.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL:', msg);
  }
}

function canalDeNpess(np) {
  const n = parseInt(np, 10);
  const map = {
    99520002: 'horeca', 99520006: 'horeca', 99520007: 'horeca', 99520010: 'horeca',
    99520015: 'horeca', 99520016: 'horeca', 99520017: 'horeca', 99520019: 'horeca',
    99520001: 'ecommerce', 99520009: 'ecommerce', 99520008: 'ecommerce',
    99520011: 'ecommerce', 99520012: 'ecommerce',
    99520018: 'varejo', 99520004: 'varejo', 99530001: 'varejo', 99530005: 'varejo',
    99520003: 'distribuidores', 99520020: 'distribuidores',
  };
  return map[n] || '';
}

function testAtribuicao() {
  const mesmo = nfe.nfeAtribuirDestinatario([
    { cod: '10', cnpj: '11.111.111/0001-11', canal: '04', npess: '99520002', vendedor: 'HÉLCIO GRÉGIO' },
    { cod: '20', cnpj: '11111111000111', canal: '03', npess: '99520015', vendedor: 'Hélcio Gregio' },
  ], canalDeNpess);
  assert(mesmo.status === 'unico', 'CNPJ repetido com o mesmo canal/vendedor fica definido');
  assert(mesmo.canalId === 'horeca', 'canal horeca quando os códigos concordam');
  assert(mesmo.cod === '10', 'escolhe um código estável (não ao acaso entre canais diferentes)');

  const diff = nfe.nfeAtribuirDestinatario([
    { cod: '10', npess: '99520002', vendedor: 'HÉLCIO GRÉGIO' },
    { cod: '30', npess: '99520018', vendedor: 'DIOGO OLIVEIRA' },
  ], canalDeNpess);
  assert(diff.status === 'cnpj_multiplos', 'CNPJ em canais diferentes não é atribuído');
  assert(diff.rotulo === 'CNPJ em mais do que um código', 'rótulo do CNPJ repetido');
  assert(!diff.canalId && !diff.vendedor, 'sem canal/vendedor quando não é óbvio');

  const sem = nfe.nfeAtribuirDestinatario([], canalDeNpess);
  assert(sem.status === 'sem_cliente', 'sem hits → sem cliente');

  const idx = nfe.nfeIndexClientes([
    { cod: '1', cnpj: '03.852.638/0001-49', npess: '99520002', vendedor: 'HÉLCIO GRÉGIO' },
  ]);
  const cruz = nfe.nfeCruzarNota({ chave: 'A', destDoc: '03852638000149' }, idx, canalDeNpess);
  assert(cruz.status === 'unico' && cruz.cod === '1', 'normaliza pontuação do CNPJ');

  const a = { chave: 'K1', numero: '1' };
  const b = { chave: 'K1', numero: '9' };
  const c = { chave: 'K2', numero: '2' };
  const m1 = nfe.nfeMergeNotas([], [a, c]);
  const m2 = nfe.nfeMergeNotas(m1.notas, [b, c]);
  assert(m1.notas.length === 2 && m1.novas === 2, 'primeira carga entra');
  assert(m2.notas.length === 2 && m2.novas === 0 && m2.repetidas === 2, 'mesma chave não duplica');
  assert(m2.notas[0].numero === '1', 'a nota já guardada mantém-se');
}

function testCpfMarcio() {
  const semLista = nfe.nfeCruzarNota({
    chave: 'CPF1', numero: '102240', destDoc: '31499205821', cliente: 'Leandro Falcone', valor: 123.12,
  }, new Map(), canalDeNpess);
  assert(semLista.status === 'unico', 'CPF sem cliente na lista fica atribuído');
  assert(semLista.vendedor === 'Marcio Gorga', 'CPF sem vendedor → Marcio Gorga, veio ' + semLista.vendedor);
  assert(semLista.canalId === 'ecommerce', 'canal Ecommerce, veio ' + semLista.canalId);
  assert(semLista.canalNome === 'Ecommerce', 'nome do canal Ecommerce');
  assert(semLista.npess === '99520001', 'código habitual 99520001, veio ' + semLista.npess);
  assert(semLista.npess === nfe.NFE_CPF_NPESS, 'constante do código do Marcio');

  const idxHelcio = nfe.nfeIndexClientes([
    { cod: '1', cnpj: '03.852.638/0001-49', npess: '99520002', vendedor: 'HÉLCIO GRÉGIO' },
  ]);
  const cnpj = nfe.nfeCruzarNota({ chave: 'CNPJ1', destDoc: '03852638000149' }, idxHelcio, canalDeNpess);
  assert(cnpj.status === 'unico' && cnpj.canalId === 'horeca', 'CNPJ casado com Hélcio mantém Horeca');
  assert(cnpj.npess === '99520002', 'CNPJ não passa para o código do Marcio');
  assert(/HELCIO/.test(nfe.nfeNormNome(cnpj.vendedor)), 'vendedor do CNPJ continua o Hélcio');
  assert(nfe.nfeReaplicarCpfSemVendedor([cnpj]).alteradas === 0, 'reler não mexe no CNPJ do Hélcio');

  const idxCpf = nfe.nfeIndexClientes([
    { cod: '77', cnpj: '314.992.058-21', npess: '99520002', vendedor: 'HÉLCIO GRÉGIO' },
  ]);
  const cpfCom = nfe.nfeCruzarNota({ chave: 'CPFHEL', destDoc: '31499205821' }, idxCpf, canalDeNpess);
  assert(cpfCom.canalId === 'horeca' && cpfCom.npess === '99520002', 'CPF que já tem vendedor respeita a lista');
  assert(nfe.nfeNormNome(cpfCom.vendedor) === 'HELCIO GREGIO', 'não manda esse CPF para o Marcio');

  const idxMulti = nfe.nfeIndexClientes([
    { cod: '10', cnpj: '11111111111', npess: '99520002', vendedor: 'HÉLCIO GRÉGIO' },
    { cod: '30', cnpj: '111.111.111-11', npess: '99520018', vendedor: 'DIOGO OLIVEIRA' },
  ]);
  const multi = nfe.nfeCruzarNota({ chave: 'MULTI', destDoc: '11111111111' }, idxMulti, canalDeNpess);
  assert(multi.status === 'cnpj_multiplos' && !multi.vendedor, 'CPF em códigos divergentes não vai para o Marcio');

  const antiga = {
    chave: 'CPF1', numero: '102240', destDoc: '31499205821', cliente: 'Leandro Falcone',
    valor: 123.12, status: 'sem_cliente', canalId: '', vendedor: '', data: '2026-10-01',
  };
  const helcioGuardado = {
    chave: 'H1', numero: '102239', destDoc: '03852638000149', status: 'unico',
    canalId: 'horeca', vendedor: 'HÉLCIO GRÉGIO', npess: '99520002',
  };
  const merged = nfe.nfeMergeNotas([antiga, helcioGuardado], [semLista, helcioGuardado]);
  assert(merged.notas.length === 2 && merged.novas === 0 && merged.repetidas === 2, 'a chave da 102240 não duplica');
  const reap = nfe.nfeReaplicarCpfSemVendedor(merged.notas);
  assert(reap.notas.length === 2 && reap.alteradas === 1, 'só a nota sem vendedor muda; as outras ficam');
  const fix = reap.notas.find(n => n.numero === '102240');
  const h = reap.notas.find(n => n.chave === 'H1');
  assert(fix && fix.vendedor === 'Marcio Gorga' && fix.canalId === 'ecommerce', '102240 gravada sem cliente passa ao Marcio');
  assert(h && h.vendedor === 'HÉLCIO GRÉGIO' && h.canalId === 'horeca' && h.npess === '99520002', 'a nota do Hélcio não se apaga nem muda');
  assert(new Set(reap.notas.map(n => n.chave)).size === reap.notas.length, 'chaves únicas depois de reaplicar');
  assert(nfe.nfeAtribDifere(antiga, fix) === true, 'o registo antigo difere da atribuição nova');
  assert(nfe.nfeAtribDifere(fix, nfe.nfeReaplicarCpfSemVendedor([fix]).notas[0]) === false, 'segunda leitura já está estável');
}

function testXmlAvulso() {
  const xml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe35261014830817000100550020000000010000000000"><ide><serie>2</serie><nNF>1</nNF><dhEmi>2026-10-01T10:00:00-03:00</dhEmi></ide><emit><CNPJ>14830817000100</CNPJ></emit><dest><CNPJ>03.852.638/0001-49</CNPJ><xNome>CLIENTE &amp; TESTE</xNome></dest><total><ICMSTot><vNF>10.50</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
  const n = nfe.nfeParseXml(xml, 'avulso.xml');
  assert(n && n.chave === '35261014830817000100550020000000010000000000', 'XML avulso tem chave');
  assert(n.cliente === 'CLIENTE & TESTE', 'unescape do nome');
  assert(n.destDoc === '03852638000149', 'CNPJ do destinatário sem pontuação');
  assert(n.valor === 10.5 && n.numero === '1' && n.serie === '2', 'número, série e valor');
  assert(nfe.nfeParseXml('<html></html>') == null, 'não é NF-e → null');
}

function findZip() {
  const candidates = [
    process.argv[2],
    process.env.NFE_ZIP,
    path.join(__dirname, '../_nfe_samples/cockpit-nfe.zip'),
    '/home/ubuntu/.cursor/projects/workspace/uploads/zipoutput6632171676370328497_f68f.zip',
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || '';
}

function testZip(zipPath) {
  const buf = fs.readFileSync(zipPath);
  const xmls = nfe.nfeReadZipXmls(buf);
  console.log('zip', zipPath);
  console.log('xml', xmls.length);
  assert(xmls.length === 17, 'o zip do cockpit tem 17 XML, veio ' + xmls.length);
  const notas = xmls.map(x => nfe.nfeParseXml(x.xml, x.name)).filter(Boolean);
  assert(notas.length === 17, 'os 17 XML são NF-e, parseou ' + notas.length);
  const conhec = notas.find(n => n.chave === '35261014830817000100550020001022391437256884');
  assert(!!conhec, 'nota conhecida 102239 presente');
  if (conhec) {
    assert(conhec.numero === '102239', 'número 102239');
    assert(conhec.serie === '2', 'série 2');
    assert(conhec.emitCnpj === '14830817000100', 'CNPJ emitente');
    assert(conhec.destDoc === '03852638000149', 'CNPJ destinatário');
    assert(conhec.valor === 417.8, 'valor 417.80, veio ' + conhec.valor);
    assert(/^2026-10-01/.test(conhec.data), 'data 2026-10-01');
    assert(/ESPETOBOM/.test(conhec.cliente), 'nome do cliente');
  }
  const chaves = new Set(notas.map(n => n.chave));
  assert(chaves.size === 17, 'chaves únicas no zip');
  const cruzadas = notas.map(n => nfe.nfeCruzarNota(n, new Map(), canalDeNpess));
  const leandro = cruzadas.find(n => n.numero === '102240');
  assert(!!leandro, 'nota 102240 presente no zip');
  if (leandro) {
    assert(leandro.destDoc === '31499205821', '102240 é CPF, veio ' + leandro.destDoc);
    assert(leandro.destDoc.length === 11, 'CPF com 11 dígitos');
    assert(leandro.valor === 123.12, 'valor 123.12');
    assert(/^2026-10-01/.test(leandro.data), 'data 2026-10-01');
    assert(/Leandro Falcone/.test(leandro.cliente), 'cliente Leandro Falcone');
    assert(leandro.vendedor === 'Marcio Gorga' && leandro.canalId === 'ecommerce', '102240 sem cliente na lista → Marcio / Ecommerce');
    assert(leandro.npess === '99520001', 'npess do Marcio');
  }
  const outras = cruzadas.filter(n => n.numero !== '102240');
  assert(outras.length === 16, 'as outras 16 notas mantêm-se');
  assert(outras.every(n => n.destDoc.length === 14 && n.status === 'sem_cliente' && !n.vendedor), 'CNPJ sem lista não vai para o Marcio');
  const guardadas = cruzadas.map(n => n.numero === '102240'
    ? Object.assign({}, n, { status: 'sem_cliente', canalId: '', canalNome: '', vendedor: '', npess: '' })
    : n);
  const outraVez = nfe.nfeMergeNotas(guardadas, cruzadas);
  assert(outraVez.notas.length === 17 && outraVez.novas === 0, 'recarregar não duplica a 102240');
  const relidas = nfe.nfeReaplicarCpfSemVendedor(outraVez.notas);
  assert(relidas.notas.length === 17 && relidas.alteradas === 1, 'reler só corrige a 102240');
  const fix = relidas.notas.find(n => n.numero === '102240');
  assert(fix && fix.vendedor === 'Marcio Gorga' && fix.canalId === 'ecommerce', '102240 gravada sem cliente aparece no Marcio');
  assert(relidas.notas.filter(n => n.numero !== '102240').every(n => n.status === 'sem_cliente'), 'as outras 16 não são apagadas nem reatribuídas');
  const outra = nfe.nfeMergeNotas(notas, notas);
  assert(outra.notas.length === 17 && outra.novas === 0 && outra.repetidas === 17, 'recarregar o mesmo zip não duplica');
  console.log('exemplo', JSON.stringify({
    numero: conhec && conhec.numero,
    serie: conhec && conhec.serie,
    dest: conhec && conhec.destDoc,
    cliente: conhec && conhec.cliente,
    valor: conhec && conhec.valor,
    data: conhec && conhec.data,
    chave: conhec && conhec.chave,
  }));
}

function testMenuCanal() {
  const notas = [
    { chave: 'H1', canalId: 'horeca', vendedor: 'Hélcio Grégio', numero: '1' },
    { chave: 'E1', canalId: 'ecommerce', vendedor: 'Marcio Gorga', numero: '102240', npess: '99520001' },
    { chave: 'S1', canalId: '', status: 'sem_cliente', vendedor: '' },
  ];
  const h = nfe.nfeNotasDoCanal(notas, 'horeca');
  assert(h.length === 1 && h[0].chave === 'H1', 'Horeca só lista notas do Horeca');
  assert(!h.some(n => n.canalId === 'ecommerce'), 'o menu Horeca não lista notas do Ecommerce');
  const e = nfe.nfeNotasDoCanal(notas, 'ecommerce');
  assert(e.length === 1 && e[0].vendedor === 'Marcio Gorga' && e[0].npess === '99520001', 'Ecommerce fica com o Marcio');
  assert(nfe.nfeNotasDoCanal(notas, '').length === 0, 'sem canal activo não mostra a lista inteira');
  assert(nfe.nfeNotasDoCanal(notas, 'varejo').length === 0, 'varejo sem notas não herda as dos outros');
}

function testHorecaNaoListaEcommerce() {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const start = html.indexOf('function nfeBucket(');
  const end = html.indexOf('async function nfeMontarVista(');
  assert(start > 0 && end > start, 'bloco de render das NF');
  const src = html.slice(start, end);
  const els = {};
  function el(id) {
    if (!els[id]) {
      els[id] = {
        id,
        style: { display: 'none' },
        classList: { toggle() {}, contains() { return false; }, add() {}, remove() {} },
        innerHTML: '',
        textContent: '',
        disabled: false,
      };
    }
    return els[id];
  }
  const notas = [
    { chave: 'H1', canalId: 'horeca', canalNome: 'Horeca', vendedor: 'Hélcio Grégio', numero: '10', cliente: 'Cliente Horeca', valor: 10, data: '2026-10-01', status: 'unico' },
    { chave: 'E1', canalId: 'ecommerce', canalNome: 'Ecommerce', vendedor: 'Marcio Gorga', numero: '102240', cliente: 'Leandro Falcone', valor: 123.12, data: '2026-10-01', status: 'unico', npess: '99520001' },
  ];
  const names = ['CANAIS_APP', 'escHtml', 'nfeNormNome', 'nfeNotasDoCanal', 'resolveCanalActivoId', 'document', '_pvView', '_nfeNotas', '_nfeFiltro', '_nfeStatusMsg', '_nfeBusy'];
  const vals = [
    { horeca: { id: 'horeca', nome: 'Horeca' }, ecommerce: { id: 'ecommerce', nome: 'Ecommerce' } },
    (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])),
    nfe.nfeNormNome,
    nfe.nfeNotasDoCanal,
    () => 'horeca',
    { getElementById: el },
    'mapa',
    notas,
    '',
    '',
    false,
  ];
  const api = new Function(...names, src + '\nreturn { nfePaintCanal, nfeCountHtml, nfeTabelaResumo, nfeFiltrarCanal, nfeLimparFiltroCanal };')(...vals);
  api.nfePaintCanal();
  const host = el('canal-nfe-host');
  const titulo = el('canal-nfe-titulo');
  assert(titulo.textContent.includes('Horeca'), 'título do menu é o canal Horeca');
  assert(host.innerHTML.includes('Cliente Horeca'), 'Horeca mostra a nota do Horeca');
  assert(!host.innerHTML.includes('Marcio'), 'o menu Horeca não lista o vendedor do Ecommerce');
  assert(!host.innerHTML.includes('102240'), 'o menu Horeca não lista a NF do Ecommerce');
  assert(!host.innerHTML.includes('Ecommerce'), 'o menu Horeca não lista o canal Ecommerce');
  assert(!host.innerHTML.includes('Leandro'), 'o menu Horeca não lista o cliente do Ecommerce');
  assert(host.innerHTML.includes('Limpar') === false, 'sem filtro ainda não há banner');
  api.nfeFiltrarCanal(encodeURIComponent('vend:' + nfe.nfeNormNome('Hélcio Grégio')));
  assert(host.innerHTML.includes('Limpar'), 'filtro activo tem botão Limpar');
  assert(host.innerHTML.includes('Cliente Horeca'), 'o filtro do vendedor mantém a nota do Horeca');
  assert(!host.innerHTML.includes('102240'), 'mesmo filtrado, a NF do Ecommerce não entra');
  api.nfeLimparFiltroCanal();
  assert(!host.innerHTML.includes('>Limpar<') && !host.innerHTML.includes('Limpar</button>'), 'Limpar tira o banner');
  const zero = api.nfeTabelaResumo([
    { key: 'total', label: 'Total', n: 0 },
    { key: 'x', label: '—', n: 4 },
  ], 'nfeFiltrar');
  assert(!zero.includes('<button'), 'zero e «—» não são clicáveis');
  assert(zero.includes('>0<'), 'zero aparece como texto');
  const um = api.nfeCountHtml(1, 'canal:horeca');
  assert(um.includes('<button') && um.includes('nfeFiltrar'), 'contagem positiva é clicável');
  assert(api.nfeCountHtml(0, 'total') === '0', 'zero não é botão');
  assert(api.nfeCountHtml(null, 'total') === '—', 'vazio é travessão');
}

function testUiCarga() {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
  const dadosIni = html.indexOf('id="panel-dados"');
  const dadosFim = html.indexOf('id="panel-historico-at"');
  const dados = html.slice(dadosIni, dadosFim);
  assert(dados.includes('ZIP de XML e PDF da TTI'), 'Dados descreve o ZIP de XML e PDF da TTI');
  assert(dados.includes('cockpit TTIN'), 'explica que o ficheiro sai do cockpit TTIN');
  assert(dados.includes('id="dados-nfe-input"'), 'o botão de carregar está no Dados');
  assert(dados.includes('Selecionar ZIP de XML e PDF da TTI'), 'o texto do botão é o ZIP de XML e PDF da TTI');
  assert(dados.includes('.pdf'), 'o bloco de Dados também aceita PDF');
  assert(!dados.includes('type="password"'), 'Dados não pede senha para o zip');
  assert(!html.includes('delta.local'), 'não liga ao host delta.local');

  const fnIni = html.indexOf('function nfeHtml(');
  const fnFim = html.indexOf('function nfeTabelaResumo(');
  const fn = html.slice(fnIni, fnFim);
  assert(fnIni > 0 && fnFim > fnIni, 'função de consulta das NF encontrada');
  assert(!fn.includes('type="file"') && !fn.includes('nfe-file-input'), 'a previsão não é o sítio de upload');
  assert(!fn.includes('Selecionar zip') && !fn.includes('Selecionar ZIP'), 'a previsão não tem botão de carregar');
  assert(fn.includes('Dados'), 'a consulta aponta a carga para Dados');
  assert(!html.includes('id="nfe-file-input"'), 'não ficou input de upload na previsão');

  const canalIni = html.indexOf('id="panel-vendas-canal"');
  const canalFim = html.indexOf('id="panel-visitas"');
  const canal = html.slice(canalIni, canalFim);
  assert(canal.includes('id="cvm-sub-notas"'), 'Notas fiscais dentro do menu Vendas do canal');
  assert(canal.includes('id="canal-nfe-host"'), 'as notas renderizam-se no menu do canal');
  assert(!canal.includes('type="file"'), 'o menu do canal não carrega o zip');
  assert(html.includes('nfeNotasDoCanal(_nfeNotas, canalId)'), 'o menu do canal usa o filtro por canal');
  assert(html.includes('v2026-10-02-nf-mesmo-vendedor'), 'service worker referido no index');
  assert(!html.includes('v2026-10-02-vendedor-atual'), 'service worker referido no index');
  assert(!html.includes('v2026-10-02-nfe-pdf'), 'service worker referido no index');
  assert(sw.includes('v2026-10-02-nf-mesmo-vendedor'), 'service worker actualizado');
  assert(!sw.includes('v2026-10-02-vendedor-atual'), 'service worker actualizado');
  assert(!sw.includes('v2026-10-02-nfe-pdf'), 'service worker actualizado');

  const homeDados = html.slice(html.indexOf('class="home-dados-card"'), html.indexOf('class="home-dados-card"') + 700);
  assert(homeDados.includes('ZIP de XML e PDF da TTI'), 'o cartão Dados na home fala do ZIP de XML e PDF da TTI');
}

function loadNfeUi(notas, canalId, pvView) {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const start = html.indexOf('function nfeBucket(');
  const end = html.indexOf('async function nfeMontarVista(');
  const src = html.slice(start, end);
  const els = {};
  function el(id) {
    if (!els[id]) {
      els[id] = {
        id,
        style: { display: 'none' },
        classList: { toggle() {}, contains() { return false; }, add() {}, remove() {} },
        innerHTML: '',
        textContent: '',
        disabled: false,
      };
    }
    return els[id];
  }
  const names = ['CANAIS_APP', 'escHtml', 'nfeNormNome', 'nfeNotasDoCanal', 'resolveCanalActivoId', 'document', '_pvView', '_nfeNotas', '_nfeFiltro', '_nfeStatusMsg', '_nfeBusy'];
  const vals = [
    {
      horeca: { id: 'horeca', nome: 'Horeca' },
      ecommerce: { id: 'ecommerce', nome: 'Ecommerce' },
      varejo: { id: 'varejo', nome: 'Varejo e Distr. Varejo' },
      distribuidores: { id: 'distribuidores', nome: 'Distribuidores' },
    },
    (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    nfe.nfeNormNome,
    nfe.nfeNotasDoCanal,
    () => canalId || '',
    { getElementById: el },
    pvView || 'mapa',
    notas,
    '',
    '',
    false,
  ];
  const api = new Function(...names, src + '\nreturn { nfePaintCanal, nfeHtml, nfeSetFiltro, nfeFiltrarCanal, nfeLimparFiltroCanal, nfeFiltrar, nfeLimparFiltro, nfeGravarFiltros, nfeCountHtml, nfeTabelaResumo, nfeAbrirPdf, el: null };')(...vals);
  api.el = el;
  return api;
}

function brl(v) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Cruzamento já conhecido destas 17 NF (lista de clientes). Os valores vêm do XML. */
const ATRIB_NFE_17 = {
  '102239': ['horeca', 'Horeca', 'HÉLCIO GRÉGIO'],
  '102241': ['horeca', 'Horeca', 'HÉLCIO GRÉGIO'],
  '102242': ['horeca', 'Horeca', 'HÉLCIO GRÉGIO'],
  '102244': ['horeca', 'Horeca', 'HÉLCIO GRÉGIO'],
  '102245': ['horeca', 'Horeca', 'HÉLCIO GRÉGIO'],
  '102246': ['horeca', 'Horeca', 'HÉLCIO GRÉGIO'],
  '102248': ['horeca', 'Horeca', 'HÉLCIO GRÉGIO'],
  '102251': ['horeca', 'Horeca', 'HÉLCIO GRÉGIO'],
  '102252': ['horeca', 'Horeca', 'HÉLCIO GRÉGIO'],
  '102253': ['horeca', 'Horeca', 'HÉLCIO GRÉGIO'],
  '102254': ['horeca', 'Horeca', 'HÉLCIO GRÉGIO'],
  '102255': ['horeca', 'Horeca', 'HÉLCIO GRÉGIO'],
  '102243': ['horeca', 'Horeca', 'PAULO FONTES'],
  '102250': ['horeca', 'Horeca', 'PAULO FONTES'],
  '102240': ['ecommerce', 'Ecommerce', 'Marcio Gorga'],
  '102249': ['ecommerce', 'Ecommerce', 'MARCIO GORGA'],
  '102247': ['distribuidores', 'Distribuidores', 'MASSIMO BOTTELLO'],
};

function testFiltrosETotal(zipPath) {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert(html.includes('const NFE_FILTROS_MS = 1000'), 'autosave dos filtros espera 1000 ms');
  assert(html.includes('setTimeout(nfeGravarFiltros, NFE_FILTROS_MS)'), 'a gravação dos filtros passa pelo debounce');
  assert(html.includes('delta_nfe_filtros'), 'os filtros ficam no localStorage');
  assert(!html.slice(html.indexOf('function nfeFiltrosHtml('), html.indexOf('function nfeListaHtml(')).includes('Guardar'), 'não há botão Guardar nos filtros');

  const buf = fs.readFileSync(zipPath);
  const xmls = nfe.nfeReadZipXmls(buf);
  const notas = xmls.map(x => nfe.nfeParseXml(x.xml, x.name)).filter(Boolean).map(nota => {
    const a = ATRIB_NFE_17[nota.numero];
    assert(!!a, 'cada NF do zip entra no conjunto conhecido, veio ' + nota.numero);
    return Object.assign({}, nota, { canalId: a[0], canalNome: a[1], vendedor: a[2], status: 'unico' });
  });
  assert(notas.length === 17, '17 notas');
  assert(Object.keys(ATRIB_NFE_17).length === 17, 'o mapa conhecido tem 17 números');
  const helcio = notas.filter(n => nfe.nfeNormNome(n.vendedor) === 'HELCIO GREGIO');
  const paulo = notas.filter(n => nfe.nfeNormNome(n.vendedor) === 'PAULO FONTES');
  assert(helcio.length === 12, 'Hélcio tem 12 notas, veio ' + helcio.length);
  assert(paulo.length === 2, 'Paulo tem 2 notas');
  const somaHelcio = helcio.reduce((s, n) => s + Math.round(Number(n.valor) * 100), 0) / 100;
  assert(somaHelcio === 11176.36, 'a soma do Hélcio é a soma dos 12 valores, veio ' + somaHelcio);
  const nota255 = helcio.find(n => n.numero === '102255');
  assert(nota255 && nota255.valor === 417.8, 'a 102255 vale 417,80');

  const mem = new Map();
  global.localStorage = {
    getItem(k) { return mem.has(k) ? mem.get(k) : null; },
    setItem(k, v) { mem.set(k, String(v)); },
  };

  const horeca = loadNfeUi(notas, 'horeca');
  horeca.nfePaintCanal();
  let host = horeca.el('canal-nfe-host').innerHTML;
  assert(host.includes('id="nfe-canal-vendedor"'), 'menu do canal filtra por vendedor');
  assert(host.includes('id="nfe-canal-dia"'), 'menu do canal filtra por dia');
  assert(host.includes('id="nfe-canal-numero"'), 'menu do canal filtra por número');
  assert(!host.includes('id="nfe-canal-canal"') && !host.includes('id="nfe-geral-canal"'), 'o menu do canal não tem filtro de canal');
  assert(!host.includes('Ecommerce') && !host.includes('Marcio') && !host.includes('102240'), 'Horeca não lista o Ecommerce');
  assert(!host.includes('Massimo') && !host.includes('102247'), 'Horeca não lista Distribuidores');
  assert(!host.includes('Linhas'), 'a lista de NF não repõe a coluna Linhas');
  const iNum = host.indexOf('>Número<');
  const depois = host.slice(iNum);
  assert(iNum > 0 && depois.indexOf('>Cliente<') < depois.indexOf('>Valor<') && depois.indexOf('>Valor<') < depois.indexOf('>Data<'), 'a ordem das colunas da lista mantém-se');
  assert(host.includes('>Valor<'), 'o resumo tem a coluna de valor');
  assert(host.includes(brl(somaHelcio)), 'o resumo do Hélcio mostra a soma em R$');

  const vendKey = 'vend:' + nfe.nfeNormNome('Hélcio Grégio');
  horeca.nfeFiltrarCanal(encodeURIComponent(vendKey));
  host = horeca.el('canal-nfe-host').innerHTML;
  assert(host.includes('Limpar'), 'filtro do vendedor tem Limpar');
  assert(host.includes('Total da lista: 12 notas'), 'a lista do Hélcio conta 12');
  assert(host.includes(brl(somaHelcio)), 'a lista do Hélcio mostra o total em R$');
  assert(!host.includes('102243') && !host.includes('102250'), 'a lista do Hélcio não inclui o Paulo');
  horeca.nfeSetFiltro('canal', 'dia', '2026-10-01');
  host = horeca.el('canal-nfe-host').innerHTML;
  assert(host.includes('value="2026-10-01"'), 'o dia fica no filtro');
  assert(host.includes('Total da lista: 12 notas') && host.includes(brl(somaHelcio)), 'Hélcio + 01/10/2026 continua a ser as 12 notas');
  assert(host.includes('01/10/2026'), 'o banner junta o dia ao vendedor');
  horeca.nfeSetFiltro('canal', 'numero', '102255');
  host = horeca.el('canal-nfe-host').innerHTML;
  assert(host.includes('Total da lista: 1 nota'), 'filtro de número deixa uma nota');
  assert(host.includes(brl(nota255.valor)), 'o total dessa nota é o valor dela');
  assert(host.includes('102255') && !host.includes('102241') && !host.includes('2.409,79'), 'as outras notas do Hélcio saem da lista');
  horeca.nfeSetFiltro('canal', 'numero', '102243');
  host = horeca.el('canal-nfe-host').innerHTML;
  assert(host.includes('Nenhuma nota neste filtro.'), 'Hélcio + NF do Paulo não devolve notas');
  horeca.nfeLimparFiltroCanal();
  host = horeca.el('canal-nfe-host').innerHTML;
  assert(!host.includes('Limpar</button>'), 'Limpar repõe vendedor, dia e número');
  assert(host.includes('102243') && host.includes('102255'), 'sem filtro voltam as notas do canal');

  const ecom = loadNfeUi(notas, 'ecommerce');
  ecom.nfePaintCanal();
  host = ecom.el('canal-nfe-host').innerHTML;
  assert(host.includes('102240') && host.includes('102249'), 'Ecommerce lista as duas do Marcio');
  assert(host.includes(brl(123.12 + 318.83)), 'a soma do Marcio no Ecommerce junta as duas notas');
  assert(!host.includes('102255') && !host.includes('Horeca'), 'Ecommerce não mostra o Horeca');
  assert(!host.includes('id="nfe-geral-canal"'), 'Ecommerce também não escolhe outro canal');

  const dist = loadNfeUi(notas, 'distribuidores');
  dist.nfePaintCanal();
  host = dist.el('canal-nfe-host').innerHTML;
  assert(host.includes('102247') && host.includes(brl(4574.48)), 'Distribuidores mostra a nota do Massimo e o total');
  assert(!host.includes('102255') && !host.includes('102240'), 'Distribuidores não herda os outros canais');

  const varejo = loadNfeUi(notas, 'varejo');
  varejo.nfePaintCanal();
  host = varejo.el('canal-nfe-host').innerHTML;
  assert(host.includes('Ainda sem NF deste canal'), 'Varejo sem notas não herda as dos outros');

  const geral = loadNfeUi(notas, '', 'nfe');
  let g = geral.nfeHtml();
  assert(g.includes('id="nfe-geral-canal"'), 'o quadro geral tem filtro de canal');
  assert(g.includes('id="nfe-geral-vendedor"') && g.includes('id="nfe-geral-dia"') && g.includes('id="nfe-geral-numero"'), 'o quadro geral tem vendedor, dia e número');
  geral.nfeSetFiltro('geral', 'canal', 'canal:ecommerce');
  geral.nfeSetFiltro('geral', 'vendedor', 'vend:' + nfe.nfeNormNome('Marcio Gorga'));
  g = geral.nfeHtml();
  assert(g.includes('102240') && g.includes('102249') && !g.includes('102255'), 'canal Ecommerce + Marcio não mostra o Hélcio');
  assert(g.includes('Total da lista: 2 notas') && g.includes(brl(441.95)), 'o total geral acompanha canal e vendedor');
  geral.nfeSetFiltro('geral', 'vendedor', 'vend:' + nfe.nfeNormNome('Hélcio Grégio'));
  geral.nfeSetFiltro('geral', 'dia', '2026-10-01');
  g = geral.nfeHtml();
  assert(g.includes('Nenhuma nota neste filtro.'), 'Ecommerce + Hélcio + dia não mistura canais');
  geral.nfeLimparFiltro();
  geral.nfeSetFiltro('geral', 'vendedor', 'vend:' + nfe.nfeNormNome('Hélcio Grégio'));
  geral.nfeSetFiltro('geral', 'dia', '2026-10-01');
  g = geral.nfeHtml();
  assert(g.includes('Total da lista: 12 notas') && g.includes(brl(somaHelcio)), 'no geral, Hélcio + dia soma as 12');
  assert(!g.includes('102240') && !g.includes('102243'), 'no geral o Hélcio não traz Paulo nem o CPF do Marcio');
  geral.nfeLimparFiltro();

  mem.clear();
  const persist = loadNfeUi(notas, 'horeca');
  const antes = mem.get('delta_nfe_filtros') || null;
  persist.nfeSetFiltro('canal', 'dia', '2026-10-01');
  persist.nfeSetFiltro('canal', 'numero', '102255');
  assert((mem.get('delta_nfe_filtros') || null) === antes, 'vendedor/dia/número não gravam no próprio toque');
  persist.nfeGravarFiltros();
  const gravado = JSON.parse(mem.get('delta_nfe_filtros'));
  assert(gravado.porCanal.horeca.dia === '2026-10-01' && gravado.porCanal.horeca.numero === '102255', 'o autosave guarda dia e número do canal');
  assert(!gravado.porCanal.horeca.canal, 'o menu do canal não grava um canal à escolha');
  const outra = loadNfeUi(notas, 'horeca');
  outra.nfePaintCanal();
  host = outra.el('canal-nfe-host').innerHTML;
  assert(host.includes('value="2026-10-01"') && host.includes('value="102255"'), 'ao reabrir, os filtros do canal voltam');
  assert(host.includes('Total da lista: 1 nota') && host.includes(brl(417.8)), 'os filtros restaurados continuam a filtrar a lista');
  outra.nfeLimparFiltroCanal();
  const limpo = JSON.parse(mem.get('delta_nfe_filtros'));
  assert(limpo.porCanal.horeca.dia === '' && limpo.porCanal.horeca.numero === '' && limpo.porCanal.horeca.vendedor === '', 'Limpar grava os filtros vazios');

  horeca.nfeLimparFiltroCanal();
  ecom.nfeLimparFiltroCanal();
  dist.nfeLimparFiltroCanal();
  varejo.nfeLimparFiltroCanal();
  geral.nfeLimparFiltro();
  persist.nfeLimparFiltroCanal();
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  files.forEach(f => {
    const name = Buffer.from(f.name);
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(Buffer.concat([local, data]));
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  });
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cd, eocd]));
}

function testPdfZipMinimo() {
  const chave = '35261014830817000100550020000000010000000000';
  const xml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${chave}"><ide><serie>2</serie><nNF>1</nNF><dhEmi>2026-10-01T10:00:00-03:00</dhEmi></ide><emit><CNPJ>14830817000100</CNPJ></emit><dest><CNPJ>03852638000149</CNPJ><xNome>CLIENTE</xNome></dest><total><ICMSTot><vNF>10.50</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
  const pdf = Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const zip = makeZip([
    { name: chave + '.xml', data: Buffer.from(xml) },
    { name: chave + '.pdf', data: pdf },
    { name: 'solto.pdf', data: Buffer.from('%PDF-solto') },
  ]);
  const entries = nfe.nfeReadZipEntries(zip);
  const xmls = entries.filter(e => e.xml);
  const pdfs = entries.filter(e => e.pdfBase64);
  assert(xmls.length === 1 && pdfs.length === 2, 'o zip mínimo traz 1 XML e 2 PDF');
  assert(nfe.nfeReadZipXmls(zip).length === 1, 'a leitura de XML ignora o PDF');
  const nota = nfe.nfeParseXml(xmls[0].xml, xmls[0].name);
  const assoc = nfe.nfeAssociarPdfs([nota], pdfs);
  assert(assoc.notas.length === 1, 'o PDF sem par não vira nota');
  assert(assoc.ligados === 1 && assoc.soltos === 1, 'só o PDF da chave liga');
  assert(assoc.notas[0].chave === chave && assoc.notas[0].numero === '1' && assoc.notas[0].serie === '2', 'a nota do XML mantém-se');
  assert(assoc.notas[0].pdfNome === chave + '.pdf', 'o PDF associado é o da chave, veio ' + assoc.notas[0].pdfNome);
  assert(Buffer.from(assoc.notas[0].pdfBase64, 'base64').equals(pdf), 'o binário é o PDF cujo nome é a chave');

  const outraChave = '35261014830817000100550020000000100000000011';
  const s1 = { chave: chave, numero: '10', serie: '1' };
  const s2 = { chave: outraChave, numero: '10', serie: '2' };
  const porNumero = nfe.nfeAssociarPdfs([s1, s2], [{ name: '10.pdf', pdfBase64: Buffer.from('%PDF-10').toString('base64') }]);
  assert(porNumero.ligados === 0 && porNumero.soltos === 1, 'número repetido em duas séries não liga o PDF');
  assert(!porNumero.notas[0].pdfBase64 && !porNumero.notas[1].pdfBase64, 'nenhuma das séries ficou com o PDF ambíguo');
  assert(porNumero.notas.length === 2, 'o PDF sem par não cria nota');

  const soUma = nfe.nfeAssociarPdfs([s1], [{ name: '10.pdf', pdfBase64: Buffer.from('%PDF-10').toString('base64') }]);
  assert(soUma.ligados === 1 && soUma.notas[0].pdfNome === '10.pdf', 'um único número liga {número}.pdf');
  const pelaChave = nfe.nfeAssociarPdfs([s1, s2], [{ name: outraChave + '.pdf', pdfBase64: Buffer.from('%PDF-s2').toString('base64') }]);
  assert(pelaChave.ligados === 1 && pelaChave.notas[1].pdfNome === outraChave + '.pdf' && !pelaChave.notas[0].pdfBase64, 'a chave ganha ao número quando há duas séries');

  const ja = { chave: chave, numero: '1', serie: '2' };
  const deNovo = nfe.nfeAssociarPdfs(nfe.nfeMergeNotas([ja], [nota]).notas, pdfs);
  assert(deNovo.notas.length === 1 && deNovo.ligados === 1, 'a mesma chave não duplica e recebe o PDF');
  assert(deNovo.notas[0].numero === '1', 'a nota já guardada mantém o número');

  const grande = 'A'.repeat(nfe.NFE_NUVEM_JSON_MAX);
  const nuvem = nfe.nfeNotasParaNuvem([Object.assign({}, nota, { pdfNome: chave + '.pdf', pdfBase64: grande, temPdf: true })]);
  assert(nuvem.pdfsFora === 1 && !nuvem.notas[0].pdfBase64, 'PDF grande sai da célula da nuvem');
  assert(nuvem.notas[0].pdfNome === chave + '.pdf' && nuvem.notas[0].chave === chave, 'na nuvem fica a referência: chave e nome');
  const pequeno = nfe.nfeNotasParaNuvem([Object.assign({}, nota, { pdfNome: 'a.pdf', pdfBase64: 'QQ==', temPdf: true })]);
  assert(pequeno.pdfNaNuvem && pequeno.notas[0].pdfBase64 === 'QQ==', 'PDF pequeno pode ir com a nota');
}

async function testCliqueSemPdf() {
  const sem = nfe.nfePdfDaNota({ chave: 'H1', numero: '10' }, null);
  assert(sem.ok === false && sem.msg === 'Esta NF não tem PDF.', 'nota antiga sem PDF');
  const com = nfe.nfePdfDaNota({ chave: 'H1', numero: '10' }, { H1: { b64: 'JVBERg==', nome: 'H1.pdf' } });
  assert(com.ok === true && com.pdfNome === 'H1.pdf', 'o PDF guardado neste browser abre pela chave');

  const notas = [
    { chave: 'H1', canalId: 'horeca', canalNome: 'Horeca', vendedor: 'Hélcio Grégio', numero: '10', cliente: 'Cliente Horeca', valor: 10, data: '2026-10-01', status: 'unico', serie: '2' },
  ];
  const api = loadNfeUi(notas, 'horeca');
  api.nfePaintCanal();
  const host = api.el('canal-nfe-host');
  const antes = host.innerHTML;
  assert(antes.includes("nfeAbrirPdf('H1')"), 'no menu do canal o número da NF é clicável');
  assert(antes.includes('sér. 2'), 'a série continua ao lado do número');
  const geral = loadNfeUi(notas, '', 'nfe');
  const g = geral.nfeHtml();
  assert(g.includes("nfeAbrirPdf('H1')"), 'na previsão o número da NF é clicável');
  const toasts = [];
  global.toast = (m) => { toasts.push(String(m)); };
  global.idbGet = async () => null;
  await api.nfeAbrirPdf('H1');
  assert(host.innerHTML === antes, 'clicar numa NF sem PDF não rebenta a lista');
  assert(toasts.some(t => t.indexOf('Esta NF não tem PDF') >= 0), 'avisa que esta NF não tem PDF, veio ' + toasts.join('|'));
}

function testVendedorAtual() {
  const linhas = [
    { cod: '406016', ym: '2025-09', npess: 99520003, valor: 58480.46, nome: 'F. J. RIBEIRO CAFÉ-ME' },
    { cod: '406016', ym: '2026-01', npess: 99520003, valor: 28362.37, nome: 'F. J. RIBEIRO CAFÉ-ME' },
    { cod: '406016', ym: '2026-09', npess: 99520020, valor: 46662.60, nome: 'F. J. RIBEIRO CAFÉ-ME' },
    { cod: '797629', ym: '2025-12', npess: 99520003, valor: 12338.82, nome: 'BRAVISSIMA CAFES E MAQUINAS LTDA' },
    { cod: '797629', ym: '2026-01', npess: 99520003, valor: 11671.58, nome: 'BRAVISSIMA CAFES E MAQUINAS LTDA' },
    { cod: '797629', ym: '2026-09', npess: 99520020, valor: 6461.62, nome: 'BRAVISSIMA CAFES E MAQUINAS LTDA' },
    { cod: '444540', ym: '2026-01', npess: 99520004, valor: 379412.07, nome: 'DIFRISUL DISTRIBUIDORA LTDA' },
    { cod: '447886', ym: '2026-02', npess: 99520004, valor: 115681.71, nome: 'NUTRI MAIS DISTRIBUIDORA ALIMENTOS' },
    { cod: '447886', ym: '2026-08', npess: 99520004, valor: 23594.37, nome: 'NUTRI MAIS DISTRIBUIDORA ALIMENTOS' },
    { cod: '449064', ym: '2026-08', npess: 99520008, valor: 70143.33, nome: 'CREATIVE VARIEDADES LTDA' },
    { cod: '778577', ym: '2025-01', npess: 99520001, valor: 163102.07, nome: 'CREATIVE VARIEDADES LTDA' },
    { cod: '778577', ym: '2026-09', npess: 99520008, valor: 96960.36, nome: 'CREATIVE VARIEDADES LTDA' },
    { cod: '453756', ym: '2026-07', npess: 99520004, valor: 23243.9, nome: 'BEER BEV COM IMP E DIST ALIMENTOS' },
    { cod: '455724', ym: '2026-07', npess: 99520004, valor: 30449.06, nome: 'BEER BEV COM.IMP.E DIST.ALIMENTOS,' },
  ];
  const mapa = nfe.npessAtualDeLinhas(linhas);
  assert(mapa['406016'].npess === 99520020 && mapa['406016'].ym === '2026-09', '406016 fica no Eduardo, mês 2026-09');
  assert(mapa['797629'].npess === 99520020, 'Bravissima fica no Eduardo');
  assert(mapa['444540'].npess === 99520004, 'Difrisul fica no Diogo');
  assert(mapa['447886'].npess === 99520004 && mapa['447886'].ym === '2026-08', 'Nutri Mais fica no Diogo do mês mais recente');
  assert(mapa['449064'].npess === 99520008 && mapa['778577'].npess === 99520008, 'Creative são dois códigos, cada um com o NPess atual');
  assert(mapa['778577'].npess !== 99520001, '778577 não usa o NPess de 2025');
  assert(mapa['453756'].npess === 99520004 && mapa['455724'].npess === 99520004, 'Beer Bev: cada código fica com o NPess atual do Diogo');
  const recente = nfe.npessAtualDeLinhas([
    { cod: '406016', ym: '2026-01', npess: 99520003, valor: 999999, nome: 'F. J. RIBEIRO CAFÉ-ME' },
    { cod: '406016', ym: '2026-09', npess: 99520020, valor: 10, nome: 'F. J. RIBEIRO CAFÉ-ME' },
  ]);
  assert(recente['406016'].npess === 99520020 && recente['406016'].ym === '2026-09', 'o mês mais recente ganha mesmo com menos Fatur');

  const nomes = {
    99520020: 'EDUARDO MOREIRA',
    99520004: 'DIOGO OLIVEIRA',
    99520008: 'MARCIO GORGA',
    99520003: 'MASSIMO BOTTELLO',
  };
  const catalogo = nfe.catalogoVendedorAtual(linhas).map(c => Object.assign({}, c, { vendedor: nomes[c.npess] || '' }));
  function canal(np) {
    const n = parseInt(np, 10);
    if (n === 99520020 || n === 99520003) return 'distribuidores';
    if (n === 99520004) return 'varejo';
    if (n === 99520008 || n === 99520001) return 'ecommerce';
    return canalDeNpess(np);
  }
  const vazio = new Map();
  const ribeiro = nfe.nfeCruzarNota({
    chave: 'NF102282', numero: '102282', destDoc: '11239661000190',
    cliente: 'F. J. RIBEIRO CAFÉ-ME RIBER COFFEE',
  }, vazio, canal, catalogo);
  assert(ribeiro.status === 'unico' && ribeiro.cod === '406016' && ribeiro.npess === '99520020', 'NF 102282 vai para o Eduardo do 406016, veio ' + ribeiro.npess + ' ' + ribeiro.cod);
  assert(ribeiro.vendedor === 'EDUARDO MOREIRA' && ribeiro.canalId === 'distribuidores', '102282 canal distribuidores');
  const difri = nfe.nfeCruzarNota({
    chave: 'NF102272', numero: '102272', destDoc: '83690339000194',
    cliente: 'DIFRISUL DISTRIBUIDORA LTDA DRIFISUL',
  }, vazio, canal, catalogo);
  assert(difri.status === 'unico' && difri.cod === '444540' && difri.npess === '99520004', 'NF 102272 Difrisul vai para o Diogo, veio ' + difri.npess + ' ' + difri.cod);
  assert(difri.vendedor === 'DIOGO OLIVEIRA' && difri.canalId === 'varejo', '102272 canal varejo');
  const creative = nfe.nfeCruzarNota({
    chave: 'CRE', numero: '102278', destDoc: '00000000000191', cliente: 'CREATIVE VARIEDADES LTDA',
  }, vazio, canal, catalogo);
  assert(creative.status === 'unico' && creative.vendedor === 'MARCIO GORGA' && creative.npess === '99520008', '102278 Creative vai para o Márcio, veio ' + creative.vendedor + ' ' + creative.npess);
  assert(creative.canalId === 'ecommerce', 'Creative fica no canal do Márcio');
  assert(!creative.cod, 'Creative não grava um código SAP ao acaso');
  assert(creative.codigos.slice().sort().join(',') === '449064,778577', 'Creative guarda os dois códigos, veio ' + creative.codigos.join(','));
  const creative2 = nfe.nfeCruzarNota({
    chave: 'CRE2', numero: '102281', destDoc: '00000000000195', cliente: 'CREATIVE VARIEDADES LTDA',
  }, vazio, canal, catalogo);
  assert(creative2.vendedor === 'MARCIO GORGA' && creative2.npess === '99520008' && !creative2.cod, '102281 Creative também vai para o Márcio');
  const beer = nfe.nfeCruzarNota({
    chave: 'BB', numero: '102276', destDoc: '13140521000439', cliente: 'BEER BEV COM.IMP.E DIST.ALIMENTOS,',
    valor: 107460,
  }, vazio, canal, catalogo);
  assert(beer.status === 'unico' && beer.vendedor === 'DIOGO OLIVEIRA' && beer.npess === '99520004', '102276 Beer Bev vai para o Diogo, veio ' + beer.vendedor + ' ' + beer.npess);
  assert(beer.canalId === 'varejo', '102276 fica no canal do Diogo');
  assert(!beer.cod, 'Beer Bev não escolhe um código SAP');
  assert(beer.codigos.slice().sort().join(',') === '453756,455724', 'Beer Bev guarda os dois códigos, veio ' + beer.codigos.join(','));
  const divergente = nfe.nfeCruzarNota({
    chave: 'DIV', numero: '9', destDoc: '00000000000193', cliente: 'CASA DUPLA LTDA',
  }, vazio, canal, catalogo.concat([
    { cod: '111', npess: 99520004, nome: 'CASA DUPLA LTDA', vendedor: 'DIOGO OLIVEIRA' },
    { cod: '222', npess: 99520020, nome: 'CASA DUPLA LTDA', vendedor: 'EDUARDO MOREIRA' },
  ]));
  assert(divergente.status === 'sem_cliente' && !divergente.vendedor && !divergente.cod, 'dois códigos com vendedores diferentes não se atribuem');
  const so2025 = nfe.catalogoVendedorAtual([
    { cod: '449064', ym: '2026-08', npess: 99520008, valor: 1, nome: 'CREATIVE VARIEDADES LTDA' },
    { cod: '778577', ym: '2025-01', npess: 99520001, valor: 1, nome: 'CREATIVE VARIEDADES LTDA' },
  ]).map(c => Object.assign({}, c, { vendedor: nomes[c.npess] || '' }));
  const creativeMisto = nfe.nfeCruzarNota({
    chave: 'CREM', numero: '8', destDoc: '00000000000196', cliente: 'CREATIVE VARIEDADES LTDA',
  }, vazio, canal, so2025);
  assert(creativeMisto.status === 'sem_cliente' && !creativeMisto.vendedor, 'não junta o NPess de 2025 com o de 2026');
  const idxLista = nfe.nfeIndexClientes([
    { cod: '9', cnpj: '11.239.661/0001-90', npess: '99520002', vendedor: 'HÉLCIO GRÉGIO' },
  ]);
  const pelaLista = nfe.nfeCruzarNota({
    chave: 'L', numero: '102282', destDoc: '11239661000190', cliente: 'F. J. RIBEIRO CAFÉ-ME RIBER COFFEE',
  }, idxLista, canal, catalogo);
  assert(pelaLista.cod === '9' && pelaLista.npess === '99520002', 'CNPJ que já está na lista não passa pelo nome');
  const reap = nfe.nfeReaplicarVendedorPorNome([
    { chave: 'NF102282', numero: '102282', destDoc: '11239661000190', cliente: 'F. J. RIBEIRO CAFÉ-ME RIBER COFFEE', status: 'sem_cliente', vendedor: '' },
    { chave: 'H1', status: 'unico', vendedor: 'HÉLCIO GRÉGIO', npess: '99520002', canalId: 'horeca', destDoc: '03852638000149' },
    { chave: 'CPF1', destDoc: '31499205821', cliente: 'Leandro Falcone', status: 'sem_cliente', vendedor: '' },
    { chave: 'BB', numero: '102276', destDoc: '13140521000439', cliente: 'BEER BEV COM.IMP.E DIST.ALIMENTOS,', status: 'sem_cliente', vendedor: '', valor: 107460 },
    { chave: 'DIV', numero: '9', destDoc: '00000000000193', cliente: 'CASA DUPLA LTDA', status: 'sem_cliente', vendedor: '' },
  ], catalogo.concat([
    { cod: '111', npess: 99520004, nome: 'CASA DUPLA LTDA', vendedor: 'DIOGO OLIVEIRA' },
    { cod: '222', npess: 99520020, nome: 'CASA DUPLA LTDA', vendedor: 'EDUARDO MOREIRA' },
  ]), canal);
  assert(reap.alteradas === 2, 'o nome unívoco e a Beer Bev já gravada sem cliente mudam, veio ' + reap.alteradas);
  assert(reap.notas[0].npess === '99520020' && reap.notas[0].cod === '406016', '102282 já gravada passa ao Eduardo');
  assert(reap.notas[1].vendedor === 'HÉLCIO GRÉGIO' && reap.notas[1].npess === '99520002', 'a nota do Hélcio não muda');
  assert(!reap.notas[2].vendedor, 'CPF sem vendedor não entra na regra do nome');
  assert(reap.notas[3].vendedor === 'DIOGO OLIVEIRA' && reap.notas[3].npess === '99520004' && reap.notas[3].canalId === 'varejo' && !reap.notas[3].cod, '102276 gravada sem cliente aparece no Diogo');
  assert(reap.notas[4].status === 'sem_cliente' && !reap.notas[4].vendedor, 'códigos com vendedores diferentes continuam sem cliente');
  const uiDiogo = loadNfeUi([Object.assign({}, reap.notas[3], { canalNome: 'Varejo e Distr. Varejo', data: '2026-10-01' })], 'varejo');
  uiDiogo.nfePaintCanal();
  uiDiogo.nfeFiltrarCanal(encodeURIComponent('vend:' + nfe.nfeNormNome('DIOGO OLIVEIRA')));
  const listaDiogo = uiDiogo.el('canal-nfe-host').innerHTML;
  assert(listaDiogo.includes('102276'), 'a lista do Diogo mostra a nota 102276');
  assert(listaDiogo.includes('Limpar'), 'o filtro do Diogo tem Limpar');
  const cpf = nfe.nfeCruzarNota({ chave: 'CPF1', destDoc: '31499205821', cliente: 'Leandro Falcone' }, vazio, canal, catalogo);
  assert(cpf.vendedor === 'Marcio Gorga' && cpf.npess === '99520001', 'CPF sem lista continua no Marcio');
}

testAtribuicao();
testCpfMarcio();
testVendedorAtual();
testMenuCanal();
testHorecaNaoListaEcommerce();
testXmlAvulso();
testUiCarga();
testPdfZipMinimo();
const zipPath = findZip();
if (!zipPath) {
  console.log('SKIP zip: ficheiro do cockpit não está no repo (dados de clientes).');
} else {
  testZip(zipPath);
  testFiltrosETotal(zipPath);
}

testCliqueSemPdf().then(() => {
  if (failed) {
    console.error(failed + ' asserção(ões) falharam');
    process.exit(1);
  }
  console.log('ok');
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
