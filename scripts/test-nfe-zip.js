#!/usr/bin/env node
/**
 * Parse do zip de NF-e do cockpit + dedupe por chave.
 * O zip tem dados de clientes e fica fora do git (_nfe_samples/ ou o caminho do upload).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const nfe = require('../nfe-emitidas.js');

global._nfeRelogio = new Date(2026, 9, 21, 12, 0, 0);

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
  const names = ['CANAIS_APP', 'escHtml', 'nfeNormNome', 'nfeNotasDoCanal', 'resolveCanalActivoId', 'document', '_pvView', '_nfeNotas', '_nfeTodas', '_nfeMesesCarregados', '_nfeMesesDisponiveis', '_nfePorMes', '_nfePorMesSrc', '_nfeFiltro', '_nfeStatusMsg', '_nfeBusy'];
  const vals = [
    { horeca: { id: 'horeca', nome: 'Horeca' }, ecommerce: { id: 'ecommerce', nome: 'Ecommerce' } },
    (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])),
    nfe.nfeNormNome,
    nfe.nfeNotasDoCanal,
    () => 'horeca',
    { getElementById: el },
    'mapa',
    notas,
    null,
    null,
    [],
    null,
    null,
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
  assert(host.innerHTML.includes('Outubro 2026'), 'abre no mês corrente');
  assert(host.innerHTML.includes('Limpar</button>'), 'o mês corrente fica no banner com Limpar');
  assert(host.innerHTML.includes('id="nfe-canal-mes"') && host.innerHTML.includes('type="month"'), 'o mês é um controlo à parte');
  assert(host.innerHTML.includes('id="nfe-canal-dia"') && host.innerHTML.includes('type="date"'), 'o dia é um controlo à parte');
  assert(!host.innerHTML.includes('value="2026-10-01"'), 'o dia começa vazio: o mês inteiro');
  api.nfeFiltrarCanal(encodeURIComponent('vend:' + nfe.nfeNormNome('Hélcio Grégio')));
  assert(host.innerHTML.includes('Limpar'), 'filtro activo tem botão Limpar');
  assert(host.innerHTML.includes('Cliente Horeca'), 'o filtro do vendedor mantém a nota do Horeca');
  assert(!host.innerHTML.includes('102240'), 'mesmo filtrado, a NF do Ecommerce não entra');
  api.nfeLimparFiltroCanal();
  assert(host.innerHTML.includes('Limpar</button>') && host.innerHTML.includes('Outubro 2026'), 'Limpar mantém o mês no banner');
  assert(host.innerHTML.includes('Cliente Horeca'), 'Limpar devolve a nota do mês');
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
  assert(html.includes('v2026-10-28-contratos-editar'), 'service worker referido no index');
  assert(!html.includes('v2026-10-21-nfe-mes-quente'), 'service worker antigo já não está no index');
  assert(!html.includes('v2026-10-21-nfe-filtros-rapidos'), 'service worker antigo já não está no index');
  assert(!html.includes('v2026-10-21-contratos-autosave'), 'service worker antigo já não está no index');
  assert(!html.includes('v2026-10-21-nfe-filtro-tecla'), 'service worker antigo já não está no index');
  assert(!html.includes('v2026-10-21-nfe-filtro-mes'), 'service worker antigo já não está no index');
  assert(!html.includes('v2026-10-21-nfe-pdf-tablet'), 'service worker antigo já não está no index');
  assert(!html.includes('v2026-10-20-nfe-whatsapp-contacto'), 'service worker antigo já não está no index');
  assert(!html.includes('v2026-10-02-perdas-sem-999'), 'service worker antigo já não está no index');
  assert(!html.includes('v2026-10-02-nf-mesmo-vendedor'), 'service worker referido no index');
  assert(!html.includes('v2026-10-02-vendedor-atual'), 'service worker referido no index');
  assert(!html.includes('v2026-10-02-nfe-pdf'), 'service worker referido no index');
  assert(sw.includes('v2026-10-28-contratos-editar'), 'service worker actualizado');
  assert(!sw.includes('v2026-10-21-nfe-mes-quente'), 'service worker antigo já não está no sw');
  assert(!sw.includes('v2026-10-21-nfe-filtros-rapidos'), 'service worker antigo já não está no sw');
  assert(!sw.includes('v2026-10-21-contratos-autosave'), 'service worker antigo já não está no sw');
  assert(!sw.includes('v2026-10-21-nfe-filtro-tecla'), 'service worker antigo já não está no sw');
  assert(!sw.includes('v2026-10-21-nfe-filtro-mes'), 'service worker antigo já não está no sw');
  assert(!sw.includes('v2026-10-21-nfe-pdf-tablet'), 'service worker antigo já não está no sw');
  assert(!sw.includes('v2026-10-20-nfe-whatsapp-contacto'), 'service worker antigo já não está no sw');
  assert(!sw.includes('v2026-10-02-nf-mesmo-vendedor'), 'service worker actualizado');
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
  const names = ['CANAIS_APP', 'escHtml', 'nfeNormNome', 'nfeNotasDoCanal', 'resolveCanalActivoId', 'document', '_pvView', '_nfeNotas', '_nfeTodas', '_nfeMesesCarregados', '_nfeMesesDisponiveis', '_nfePorMes', '_nfePorMesSrc', '_nfeFiltro', '_nfeStatusMsg', '_nfeBusy'];
  const state = {
    notas: notas,
    todas: null,
    mesesCarregados: null,
    mesesDisponiveis: [],
    porMes: null,
    porMesSrc: null,
  };
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
    {
      getElementById: el,
      body: { appendChild() {}, removeChild() {} },
      createElement() {
        const node = {
          href: '',
          download: '',
          target: '',
          rel: '',
          style: {},
          click() {
            if (global._nfeAnchorClicks) global._nfeAnchorClicks.push({ href: node.href, download: node.download, target: node.target });
          },
          remove() {},
        };
        return node;
      },
    },
    pvView || 'mapa',
    state.notas,
    state.todas,
    state.mesesCarregados,
    state.mesesDisponiveis,
    state.porMes,
    state.porMesSrc,
    '',
    '',
    false,
  ];
  /* Getter/setter via object: nfeAplicarHotPath reatribui _nfeNotas/_nfeTodas no scope do Function. */
  const api = new Function(...names, src + `
    return {
      nfePaintCanal, nfePaint, nfeHtml, nfeSetFiltro, nfeFlushPaintTexto, nfeFiltrarCanal, nfeLimparFiltroCanal,
      nfeFiltrar, nfeLimparFiltro, nfeGravarFiltros, nfeCountHtml, nfeTabelaResumo, nfeAbrirPdf, nfePartilharWhatsapp,
      nfeIniciarPacoteWhatsapp, nfePrefetchWhatsappChaves, nfeAgendarPrefetchWhatsapp, nfeEntregarWhatsapp, nfeEhPwaStandalone,
      nfeFiltrosGeral, nfeFiltrosCanalActivos, nfeMostrarMais, nfeConteudoGeralHtml, nfeNotasDoMesEcra,
      nfeAplicarHotPath, nfeGarantirMes, nfeMesesQuentes, nfeMesAnterior, nfeMesCorrente, nfeAbrirMes, nfeMesJaCarregado,
      getNotas: () => _nfeNotas,
      getTodas: () => _nfeTodas,
      getMesesCarregados: () => _nfeMesesCarregados,
      getMesesDisponiveis: () => _nfeMesesDisponiveis,
      el: null
    };
  `)(...vals);
  api.el = el;
  return api;
}

/** Simula digitar letra a letra no filtro de cliente (valor = acumulado, como input.value). */
function simularTeclasCliente(ui, scope, texto) {
  const passos = [];
  let acc = '';
  for (const ch of String(texto || '')) {
    acc += ch;
    ui.nfeSetFiltro(scope, 'cliente', acc);
    const f = scope === 'geral' ? ui.nfeFiltrosGeral() : ui.nfeFiltrosCanalActivos();
    passos.push(String(f.cliente || ''));
  }
  return passos;
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
  assert(iNum > 0 && depois.indexOf('>Boleto<') > 0 && depois.indexOf('>Boleto<') < depois.indexOf('>Cliente<') && depois.indexOf('>Cliente<') < depois.indexOf('>Valor<') && depois.indexOf('>Valor<') < depois.indexOf('>Data<'), 'a coluna Boleto fica imediatamente ao lado do número');
  const marcasSem = depois.match(/class="nfe-boleto"[^>]*>[SN]</g) || [];
  assert(marcasSem.length > 0 && marcasSem.every(m => m.endsWith('>N<')), 'notas sem boleto gravado mostram N e a coluna não se esconde');
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
  horeca.nfeFlushPaintTexto();
  host = horeca.el('canal-nfe-host').innerHTML;
  assert(host.includes('Total da lista: 1 nota'), 'filtro de número deixa uma nota');
  assert(host.includes(brl(nota255.valor)), 'o total dessa nota é o valor dela');
  assert(host.includes('102255') && !host.includes('102241') && !host.includes('2.409,79'), 'as outras notas do Hélcio saem da lista');
  horeca.nfeSetFiltro('canal', 'numero', '102243');
  horeca.nfeFlushPaintTexto();
  host = horeca.el('canal-nfe-host').innerHTML;
  assert(host.includes('Nenhuma nota neste filtro.'), 'Hélcio + NF do Paulo não devolve notas');
  horeca.nfeLimparFiltroCanal();
  host = horeca.el('canal-nfe-host').innerHTML;
  assert(!host.includes('value="2026-10-01"') && !host.includes('value="102255"'), 'Limpar tira dia e número');
  assert(host.includes('Outubro 2026') && host.includes('Limpar</button>'), 'Limpar volta ao mês corrente e mantém o banner');
  assert(host.includes('102243') && host.includes('102255'), 'sem filtro de dia voltam as notas do canal');

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
  assert(g.includes('id="nfe-geral-mes"') && g.includes('id="nfe-geral-cliente"'), 'o quadro geral tem mês e cliente');
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

function zipSemPdf(zipPath) {
  const buf = fs.readFileSync(zipPath);
  const entries = nfe.nfeReadZipEntries(buf);
  const xmls = entries.filter(e => e.xml != null);
  const pdfs = entries.filter(e => e.pdfBase64);
  const notas = xmls.map(x => nfe.nfeParseXml(x.xml, x.name)).filter(Boolean);
  const assoc = nfe.nfeAssociarPdfs(notas, pdfs);
  const sem = assoc.notas.filter(n => !n.pdfBase64);
  return { xmls: xmls.length, pdfs: pdfs.length, parsed: notas.length, ligados: assoc.ligados, soltos: assoc.soltos, sem: sem.length };
}

function testPdfNomesCockpit() {
  const chave = '35261014830817000100550020001022771810192077';
  const xml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${chave}"><ide><serie>2</serie><nNF>102277</nNF><dhEmi>2026-10-02T10:00:00-03:00</dhEmi></ide><emit><CNPJ>14830817000100</CNPJ></emit><dest><CNPJ>03852638000149</CNPJ><xNome>CLIENTE</xNome></dest><total><ICMSTot><vNF>10.50</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
  const pdf = Buffer.from('%PDF-cockpit-pasta');
  const pasta = '14830817000100_Delta Foods Brasil - SP\\02_10_2026__02_10_2026\\Saida\\';
  const zip = makeZip([
    { name: pasta + 'NFe' + chave + '_prot.xml', data: Buffer.from(xml) },
    { name: pasta + 'NFe' + chave + '.pdf', data: pdf },
  ]);
  const entries = nfe.nfeReadZipEntries(zip);
  const xmls = entries.filter(e => e.xml);
  const pdfs = entries.filter(e => e.pdfBase64);
  assert(xmls.length === 1 && pdfs.length === 1, 'a pasta com barra invertida traz o XML e o PDF');
  const nota = nfe.nfeParseXml(xmls[0].xml, xmls[0].name);
  assert(nota && nota.chave === chave, 'infNFe é a chave do nome');
  assert(nfe.nfeChaveNoNome(pdfs[0].name) === chave, 'a chave do PDF é a do XML');
  const assoc = nfe.nfeAssociarPdfs([nota], pdfs);
  assert(assoc.ligados === 1 && assoc.soltos === 0 && assoc.notas.every(n => n.pdfBase64), '0 XML sem PDF neste formato');
  assert(assoc.notas[0].pdfNome === 'NFe' + chave + '.pdf', 'o nome gravado é NFe{chave}.pdf');
  assert(Buffer.from(assoc.notas[0].pdfBase64, 'base64').equals(pdf), 'o binário é o PDF ao lado do _prot.xml');

  const antigo = nfe.nfeAssociarPdfs(
    [{ chave: chave, numero: '102277' }],
    [{ name: 'NFe' + chave + '.pdf', pdfBase64: Buffer.from('%PDF-antigo').toString('base64') }]
  );
  assert(antigo.ligados === 1 && antigo.notas[0].pdfNome === 'NFe' + chave + '.pdf', 'o formato antigo NFe{chave}.pdf continua a ligar');

  const guardada = { chave: chave, numero: '102277' };
  const outra = nfe.nfeAssociarPdfs(nfe.nfeMergeNotas([guardada], [nota]).notas, pdfs);
  assert(outra.notas.length === 1 && outra.ligados === 1 && outra.notas[0].pdfBase64, 'nota já gravada sem PDF recebe o PDF na carga seguinte');

  const este = '/home/ubuntu/.cursor/projects/workspace/uploads/zipoutput4279624288744104709_7bcd.zip';
  const anterior = '/home/ubuntu/.cursor/projects/workspace/uploads/zipoutput2931485085134692785_ae6b.zip';
  if (fs.existsSync(este)) {
    const r = zipSemPdf(este);
    assert(r.xmls === 18 && r.pdfs === 18 && r.parsed === 18 && r.sem === 0 && r.soltos === 0, 'este zip fica com 0 XML sem PDF, veio ' + JSON.stringify(r));
  }
  if (fs.existsSync(anterior)) {
    const r = zipSemPdf(anterior);
    assert(r.xmls === 49 && r.pdfs === 49 && r.parsed === 49 && r.sem === 0 && r.soltos === 0, 'o zip anterior não piora, veio ' + JSON.stringify(r));
  }
}

function testPdfChunks() {
  const pequeno = nfe.nfeNotasParaNuvem([
    { chave: 'A', numero: '1', pdfNome: 'A.pdf', pdfBase64: 'QQ==' },
  ]);
  assert(pequeno.pdfsFora === 0, 'um PDF pequeno fica na célula');
  assert(nfe.nfePdfsForaDaCelula(
    [{ chave: 'A', pdfBase64: 'QQ==', pdfNome: 'A.pdf' }],
    pequeno.notas
  ).length === 0, 'o que cabe na célula não vai para bloco');

  const grande = 'B'.repeat(Math.floor(nfe.NFE_NUVEM_JSON_MAX / 2) + 2000);
  const notas = [1, 2, 3].map(i => ({
    chave: 'K' + i,
    numero: String(i),
    pdfNome: 'K' + i + '.pdf',
    pdfBase64: grande + i,
  }));
  const nuvem = nfe.nfeNotasParaNuvem(notas);
  assert(nuvem.pdfsFora > 0, 'três PDF grandes não cabem todos na célula');
  const fora = nfe.nfePdfsForaDaCelula(notas, nuvem.notas);
  assert(fora.length === nuvem.pdfsFora, 'os PDF tirados da célula são os que faltam gravar');
  const chunks = nfe.nfePartirPdfsEmChunks(fora);
  assert(chunks.length >= 1, 'há pelo menos um bloco');
  chunks.forEach(bloco => {
    const tam = JSON.stringify({ __format: 'nfe_pdfs', pdfs: bloco }).length;
    assert(tam <= nfe.NFE_NUVEM_JSON_MAX || bloco.length === 1, 'cada bloco cabe na célula ou é um PDF só, veio ' + tam);
  });
  const mapa = nfe.nfeMapaPdfsDeChunks(chunks);
  assert(Object.keys(mapa).length === fora.length, 'o mapa repõe cada PDF tirado da célula');
  const leves = nuvem.notas.map(n => Object.assign({}, n));
  const juntos = nfe.nfeJuntarPdfsLocais(leves, mapa);
  notas.forEach(n => {
    const hit = juntos.find(x => x.chave === n.chave);
    assert(hit && hit.pdfBase64 === n.pdfBase64, 'depois dos blocos a nota ' + n.chave + ' tem o PDF');
  });

  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert(html.includes('__pdfChunks'), 'a célula das NF indica os blocos de PDF');
  assert(html.includes('nfe_pdfs_'), 'os PDF que não cabem gravam-se em nfe_pdfs_');
  assert(!html.includes('na nuvem ficou a referência'), 'a carga já não diz que o PDF ficou só de referência');
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
  const semDevolucao = nfe.npessAtualDeLinhas([
    { cod: '445753', ym: '2026-09', npess: 99520099, valor: 146838.16, nome: 'Q-BRASIL IMP.E DIST.MAQUINAS E ALIM' },
    { cod: '445753', ym: '2026-10', npess: '99520099', valor: 26638.72, nome: 'Q-BRASIL IMP.E DIST.MAQUINAS E ALIM' },
    { cod: '100', ym: '2026-09', npess: 99520010, valor: 50, nome: 'CLIENTE REAL' },
  ]);
  assert(!semDevolucao['445753'], '99520099 não fica como vendedor actual');
  assert(semDevolucao['100'].npess === 99520010, 'outro vendedor no catálogo mantém-se');
  const semInterna = nfe.npessAtualDeLinhas([
    { cod: '441908', ym: '2026-10', npess: 99520005, valor: 2059.67, nome: 'UNILOG' },
    { cod: '0441908', ym: '2026-10', npess: 99530002, valor: 3952.43, nome: 'UNILOG' },
    { cod: '430787', ym: '2026-10', npess: 99520005, valor: 80, nome: 'OUTRO' },
  ]);
  assert(!semInterna['441908'], '441908 não fica como vendedor actual');
  assert(semInterna['430787'].npess === 99520005, 'outro cliente no mesmo NPess mantém-se');

  const nomes = {
    99520020: 'EDUARDO MADEIRA',
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
  assert(ribeiro.vendedor === 'EDUARDO MADEIRA' && ribeiro.canalId === 'distribuidores', '102282 canal distribuidores');
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
    { cod: '222', npess: 99520020, nome: 'CASA DUPLA LTDA', vendedor: 'EDUARDO MADEIRA' },
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
    { cod: '222', npess: 99520020, nome: 'CASA DUPLA LTDA', vendedor: 'EDUARDO MADEIRA' },
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

function xmlTransferencia(numero, valor, emit, dest) {
  const emitDoc = String(emit || '14830817000363').replace(/\D/g, '');
  const destDoc = String(dest || '14830817000100').replace(/\D/g, '');
  const n = String(numero);
  const chave = ('32' + emitDoc + '55001' + n.padStart(9, '0')).padEnd(44, '0').slice(0, 44);
  return `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${chave}"><ide><serie>1</serie><nNF>${n}</nNF><dhEmi>2026-10-02T10:00:00-03:00</dhEmi><natOp>Transferência de mercadoria</natOp></ide><emit><CNPJ>${emit}</CNPJ><xNome>Delta Foods Brasil Com Imp Exp Prod</xNome></emit><dest><CNPJ>${dest}</CNPJ><xNome>Delta Foods Brasil Com Imp Exp Prod</xNome></dest><total><ICMSTot><vNF>${valor}</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
}

function testTransferenciasInternas() {
  assert(nfe.NFE_DELTA_CNPJ_ES === '14830817000363', 'CNPJ da Delta ES');
  assert(nfe.NFE_DELTA_CNPJ_SP === '14830817000100', 'CNPJ da Delta SP');
  assert(nfe.NFE_TRANSF_CANAL === 'transferencias' && nfe.NFE_TRANSF_CANAL_NOME === 'Transferências internas', 'canal Transferências internas');

  const catalogoMarcio = [{
    cod: '900', npess: 99520001, nome: 'Delta Foods Brasil Com Imp Exp Prod', vendedor: 'MARCIO GORGA',
  }];
  const idxMarcio = nfe.nfeIndexClientes([
    { cod: '900', cnpj: '14.830.817/0001-00', npess: '99520001', vendedor: 'MARCIO GORGA' },
  ]);
  const idxHelcio = nfe.nfeIndexClientes([
    { cod: '1', cnpj: '03.852.638/0001-49', npess: '99520002', vendedor: 'HÉLCIO GRÉGIO' },
  ]);

  const brutas = [
    { numero: '4559', valor: '22110.07' },
    { numero: '4558', valor: '214943.85' },
    { numero: '4557', valor: '194179.64' },
    { numero: '4555', valor: '126840.93' },
  ].map(function (r) {
    return nfe.nfeParseXml(xmlTransferencia(r.numero, r.valor, '14.830.817/0003-63', '14.830.817/0001-00'), r.numero + '.xml');
  });
  assert(brutas.every(Boolean), 'as 4 NF de transferência parseiam');
  brutas.forEach(function (n) {
    assert(n.emitCnpj === '14830817000363', n.numero + ' emitente é a Delta ES, veio ' + n.emitCnpj);
    assert(n.destDoc === '14830817000100', n.numero + ' destinatário é a Delta SP, veio ' + n.destDoc);
    assert(n.serie === '1' && /^2026-10-02/.test(n.data), n.numero + ' série 1 em 02/10/2026');
  });
  const soma = brutas.reduce(function (s, n) { return s + Math.round(n.valor * 100); }, 0) / 100;
  assert(soma === 558074.49, 'as 4 notas somam 558.074,49, veio ' + soma);

  const cruzadas = brutas.map(function (n) {
    return nfe.nfeCruzarNota(n, idxMarcio, canalDeNpess, catalogoMarcio);
  });
  cruzadas.forEach(function (n) {
    assert(n.canalId === 'transferencias' && n.canalNome === 'Transferências internas', n.numero + ' vai para Transferências internas, veio ' + n.canalId);
    assert(!n.vendedor && !n.npess, n.numero + ' fica sem o Marcio, veio ' + n.vendedor + ' ' + n.npess);
    assert(nfe.nfeNormNome(n.vendedor) !== 'MARCIO GORGA', n.numero + ' não fica no Marcio');
  });
  assert(nfe.nfeNotasDoCanal(cruzadas, 'ecommerce').length === 0, 'o menu do Ecommerce não fica com estas notas');
  assert(nfe.nfeNotasDoCanal(cruzadas, 'transferencias').length === 4, 'as 4 notas estão no canal de transferências');

  const gravadas = brutas.map(function (n) {
    return Object.assign({}, n, {
      status: 'unico', canalId: '', canalNome: '', vendedor: 'MARCIO GORGA', npess: '99520001', cod: '900',
    });
  });
  const cpfGravado = {
    chave: 'CPF1', numero: '102240', destDoc: '31499205821', cliente: 'Leandro Falcone',
    status: 'sem_cliente', canalId: '', vendedor: '', valor: 123.12, data: '2026-10-01',
  };
  const helcio = nfe.nfeCruzarNota({
    chave: 'H1', numero: '102239', destDoc: '03852638000149', emitCnpj: '14830817000100',
    cliente: 'DELTA CAFES DO CLIENTE LTDA',
  }, idxHelcio, canalDeNpess, catalogoMarcio);
  assert(helcio.canalId === 'horeca' && /HELCIO/.test(nfe.nfeNormNome(helcio.vendedor)), 'CNPJ de cliente normal, mesmo com Delta no nome e emitente SP, não vira transferência');
  assert(!nfe.nfeEhTransferenciaInterna(helcio), 'o CNPJ 03.852.638/0001-49 não é transferência');

  const outroNome = nfe.nfeCruzarNota({
    chave: 'D1', numero: '102282', destDoc: '11239661000190', emitCnpj: '14830817000100',
    cliente: 'F. J. RIBEIRO CAFÉ-ME',
  }, new Map(), canalDeNpess, [
    { cod: '406016', npess: 99520020, nome: 'F. J. RIBEIRO CAFÉ-ME', vendedor: 'EDUARDO MADEIRA' },
  ]);
  assert(outroNome.vendedor === 'EDUARDO MADEIRA' && outroNome.canalId === 'distribuidores', 'venda da Delta SP para cliente normal continua nesse vendedor');
  assert(outroNome.canalId !== 'transferencias', 'CNPJ de cliente normal não entra em Transferências internas');

  const inverso = nfe.nfeCruzarNota(
    nfe.nfeParseXml(xmlTransferencia('4600', '10.00', '14830817000100', '14830817000363'), '4600.xml'),
    idxMarcio, canalDeNpess, catalogoMarcio
  );
  assert(inverso.canalId === 'transferencias' && !inverso.vendedor, 'SP → ES entre os dois CNPJ da Delta também é transferência');

  const terceiro = nfe.nfeCruzarNota({
    chave: 'T1', numero: '8', destDoc: '14830817000100', emitCnpj: '03852638000149',
    cliente: 'Delta Foods Brasil Com Imp Exp Prod',
  }, idxMarcio, canalDeNpess, catalogoMarcio);
  assert(terceiro.canalId !== 'transferencias', 'destinatário SP com emitente que não é a Delta ES não é o par');

  const nomePrimeiro = nfe.nfeReaplicarVendedorPorNome(gravadas.map(function (n) {
    return Object.assign({}, n, { status: 'sem_cliente', vendedor: '', npess: '', canalId: '', cod: '' });
  }).concat([cpfGravado, helcio]), catalogoMarcio, canalDeNpess);
  const cpfDepois = nfe.nfeReaplicarCpfSemVendedor(nomePrimeiro.notas);
  const reap = nfe.nfeReaplicarTransferenciasInternas(cpfDepois.notas);
  assert(reap.alteradas === 4, 'as 4 notas já gravadas mudam ao abrir a lista, veio ' + reap.alteradas);
  reap.notas.filter(function (n) { return ['4559', '4558', '4557', '4555'].indexOf(n.numero) >= 0; }).forEach(function (n) {
    assert(n.canalId === 'transferencias' && !n.vendedor && !n.npess, n.numero + ' gravada sai do Marcio');
  });
  const cpfFix = reap.notas.find(function (n) { return n.numero === '102240'; });
  assert(cpfFix && cpfFix.vendedor === 'Marcio Gorga' && cpfFix.canalId === 'ecommerce', 'CPF sem vendedor continua no Marcio Ecommerce');
  const hFix = reap.notas.find(function (n) { return n.chave === 'H1'; });
  assert(hFix && hFix.canalId === 'horeca' && /HELCIO/.test(nfe.nfeNormNome(hFix.vendedor)), 'a nota do Hélcio não passa a transferência');
  const outra = nfe.nfeReaplicarTransferenciasInternas(reap.notas);
  assert(outra.alteradas === 0, 'segunda leitura das transferências já está estável');
  assert(nfe.nfeAtribDifere(gravadas[0], reap.notas.find(function (n) { return n.numero === '4559'; })), 'a 4559 gravada no Marcio difere da classificação nova');

  const jaNoMarcio = nfe.nfeReaplicarTransferenciasInternas(gravadas.concat([helcio, {
    chave: 'CPFHEL', destDoc: '31499205821', status: 'unico', canalId: 'horeca', vendedor: 'HÉLCIO GRÉGIO', npess: '99520002',
  }]));
  assert(jaNoMarcio.alteradas === 4, 'notas já no Marcio sem canal também saem');
  assert(jaNoMarcio.notas.every(function (n) {
    if (['4559', '4558', '4557', '4555'].indexOf(String(n.numero)) < 0) return n.vendedor && n.canalId !== 'transferencias';
    return n.canalId === 'transferencias' && !n.vendedor;
  }), 'só as 4 transferências mudam; Hélcio e o CPF dele ficam');

  const ui = loadNfeUi(reap.notas.filter(function (n) {
    return ['4559', '4558', '4557', '4555'].indexOf(String(n.numero)) >= 0;
  }).map(function (n) { return Object.assign({}, n, { status: 'unico' }); }), '', 'nfe');
  const lista = ui.nfeHtml();
  assert(lista.includes('Transferências internas'), 'a lista mostra Transferências internas');
  ['4559', '4558', '4557', '4555'].forEach(function (num) {
    assert(lista.includes(num), 'a lista mostra a NF ' + num);
  });
  assert(lista.includes(brl(558074.49)), 'a lista mostra R$ 558.074,49');
  const corpo = lista.slice(lista.indexOf('Total da lista:'));
  assert(corpo.indexOf('Transferências internas') >= 0 && !/Marcio|MARCIO/i.test(corpo), 'as 4 notas não aparecem no Marcio');
  assert(lista.includes('canal%3Atransferencias'), 'a contagem de Transferências internas é clicável');

  const mista = reap.notas.filter(function (n) {
    return ['4559', '4558', '4557', '4555', '102240'].indexOf(String(n.numero)) >= 0;
  });
  const eco = loadNfeUi(mista, 'ecommerce');
  eco.nfePaintCanal();
  const hostEco = eco.el('canal-nfe-host').innerHTML;
  assert(hostEco.includes('102240'), 'o Ecommerce continua com o CPF do Marcio');
  assert(!hostEco.includes('4559') && !hostEco.includes('4555'), 'o menu do Marcio não lista as transferências');

  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const regraIni = html.indexOf('function nfeAplicarRegraGuardada');
  const regraFim = html.indexOf('function nfeCatalogoVendedorAtual');
  const regra = html.slice(regraIni, regraFim);
  assert(regra.includes('nfeReaplicarTransferenciasInternas'), 'abrir a lista reaplica a transferência nas notas já gravadas');
  assert(regra.indexOf('nfeReaplicarVendedorPorNome') < regra.indexOf('nfeReaplicarTransferenciasInternas'), 'a transferência corre depois do nome');
  assert(regra.indexOf('nfeReaplicarCpfSemVendedor') < regra.indexOf('nfeReaplicarTransferenciasInternas'), 'a transferência corre depois do CPF');
  const porReg = html.slice(html.indexOf('function listaPorRegistarDoCanal'), html.indexOf('function listaPorRegistarDoCanal') + 900);
  assert(!porReg.includes('transferencias') && !porReg.includes('Transferências'), 'Por Registar fica intacto');

  const zipReal = [
    process.env.NFE_ZIP_ES,
    '/home/ubuntu/.cursor/projects/workspace/uploads/zipoutput4279624288744104709_7bcd.zip',
  ].filter(Boolean).find(function (p) { return fs.existsSync(p); });
  if (!zipReal) {
    console.log('SKIP xml real 4555-4559: zip fora do repo.');
    return;
  }
  const reais = nfe.nfeReadZipXmls(fs.readFileSync(zipReal))
    .map(function (x) { return nfe.nfeParseXml(x.xml, x.name); })
    .filter(function (n) { return n && ['4559', '4558', '4557', '4555'].indexOf(n.numero) >= 0 && n.serie === '1'; });
  assert(reais.length === 4, 'o zip tem as 4 NF, veio ' + reais.length);
  reais.forEach(function (n) {
    const c = nfe.nfeCruzarNota(n, idxMarcio, canalDeNpess, catalogoMarcio);
    assert(n.emitCnpj === '14830817000363' && n.destDoc === '14830817000100', 'XML real ' + n.numero + ' é ES → SP');
    assert(c.canalId === 'transferencias' && !c.vendedor, 'XML real ' + n.numero + ' sai do Marcio');
  });
}

function testSiteProprioRegra() {
  assert(nfe.NFE_SITE_MARCIO_NPESS === '99520009', 'o site do Marcio é o NPess 99520009');
  assert(nfe.nfeEhSiteProprio({ npess: '99520009', canalId: 'ecommerce', canalNome: 'Ecommerce' }), 'NPess 99520009 é Site próprio mesmo gravado no Ecommerce');
  assert(nfe.nfeEhSiteProprio({ canalNome: 'Site próprio', canalId: 'ecommerce' }), 'o nome Site próprio entra na regra');
  assert(nfe.nfeEhSiteProprio({ canalId: 'dfb_site' }), 'o id dfb_site entra na regra');
  assert(!nfe.nfeEhSiteProprio({ npess: '99520001', canalId: 'ecommerce', canalNome: 'Ecommerce', vendedor: 'Marcio Gorga' }), 'Lojas online e o CPF do Marcio (99520001) ficam');
  assert(!nfe.nfeEhSiteProprio({ npess: '99520005', canalId: 'ecommerce' }), 'Institucional Balcão não sai');
  assert(!nfe.nfeEhSiteProprio({ npess: '99530003', canalId: 'ecommerce' }), 'Restauração QB não sai');
  assert(!nfe.nfeEhSiteProprio({ canalId: 'site', canalNome: 'Ecommerce' }), 'a palavra site sozinha não chega');
  const guardadas = [
    { chave: 'S', npess: '99520009' },
    { chave: 'L', npess: '99520001' },
  ];
  const vis = nfe.nfeNotasSemSiteMarcio(guardadas);
  assert(guardadas.length === 2 && vis.length === 1 && vis[0].chave === 'L', 'excluir o site não apaga a nota da lista original');
}

function testFiltroMesCliente() {
  const mem = new Map();
  global.localStorage = {
    getItem(k) { return mem.has(k) ? mem.get(k) : null; },
    setItem(k, v) { mem.set(k, String(v)); },
  };
  const notas = [
    { chave: 'J1', numero: '102605', serie: '2', canalId: 'horeca', canalNome: 'Horeca', vendedor: 'Daniela Santos', cliente: 'JULES PANIFICADORA E CONFEITARIA', cod: '88021', valor: 1635.3, data: '2026-10-20', status: 'unico', temBoleto: true, temPdfJunto: true },
    { chave: 'J2', numero: '102610', serie: '2', canalId: 'horeca', canalNome: 'Horeca', vendedor: 'Daniela Santos', cliente: 'José da Padaria', cod: '77001', valor: 10, data: '2026-10-02', status: 'unico' },
    { chave: 'L1', numero: '102240', canalId: 'ecommerce', canalNome: 'Ecommerce', vendedor: 'Marcio Gorga', cliente: 'Loja Online', npess: '99520001', cod: '900', valor: 50, data: '2026-10-03', status: 'unico' },
    { chave: 'I1', numero: '102710', canalId: 'ecommerce', canalNome: 'Ecommerce', vendedor: 'Marcio Gorga', cliente: 'Balcao Institucional', npess: '99520005', valor: 20, data: '2026-10-04', status: 'unico' },
    { chave: 'S1', numero: '102700', canalId: 'ecommerce', canalNome: 'Ecommerce', vendedor: 'Marcio Gorga', cliente: 'Site do Marcio', npess: '99520009', cod: '995', valor: 99, data: '2026-10-05', status: 'unico', temBoleto: true },
    { chave: 'P1', numero: '102500', canalId: 'horeca', canalNome: 'Horeca', vendedor: 'Daniela Santos', cliente: 'Setembro Ltda', cod: '66001', valor: 5, data: '2026-09-15', status: 'unico' },
  ];
  const ui = loadNfeUi(notas, '', 'nfe');
  let g = ui.nfeHtml();
  assert(g.includes('id="nfe-geral-mes"') && g.includes('type="month"'), 'há filtro de mês');
  assert(g.includes('id="nfe-geral-dia"') && g.includes('type="date"'), 'há filtro de dia');
  assert(g.includes('id="nfe-geral-cliente"') && g.includes('Nome ou código'), 'há filtro de cliente por nome ou código');
  assert(g.includes('value="2026-10"') && !g.includes('value="2026-10-20"'), 'o mês corrente vem escolhido e o dia vem vazio');
  assert(g.includes('Outubro 2026') && g.includes('Limpar</button>'), 'o banner nomeia o mês e tem Limpar');
  assert(g.includes('102605') && g.includes('102610') && g.includes('102240') && g.includes('102710'), 'o mês corrente lista Horeca, Lojas online e Institucional');
  assert(!g.includes('102500'), 'setembro não entra na lista de outubro');
  assert(!g.includes('102700') && !g.includes('Site do Marcio'), 'o site próprio do Marcio não entra na lista');
  assert(g.includes('notas em Outubro 2026'), 'a contagem do ecrã é a do mês, sem o site');
  const tabela = g.indexOf('>Notas<');
  const iEco = g.indexOf('>Ecommerce<', tabela);
  const rowEco = g.slice(iEco, g.indexOf('</tr>', iEco));
  assert(iEco > tabela && rowEco.includes('>2<'), 'Ecommerce conta Lojas online e Institucional, não o site, veio ' + rowEco);
  const iVar = g.indexOf('>Varejo e Distr. Varejo<', tabela);
  const rowVar = g.slice(iVar, g.indexOf('</tr>', iVar));
  assert(iVar > tabela && rowVar.includes('>0<') && !rowVar.includes('<button'), 'zero não é clicável');
  assert(g.includes('class="nfe-wa"') && g.includes('nfe-wa-btn'), 'a coluna WhatsApp mantém-se');
  const iBol = g.indexOf('102605');
  assert(g.slice(iBol, iBol + 500).includes('>S<'), 'a coluna Boleto mantém o S');

  assert(g.includes("nfeSetFiltro('geral','cliente',this.value)"), 'o input de cliente usa this.value (não concatena event.data)');
  assert(/NFE_TEXTO_MS\s*=\s*120/.test(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')), 'há debounce curto do re-paint ao escrever');
  assert(/NFE_LISTA_PAGE\s*=\s*100/.test(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')), 'a lista pagina de 100 em 100');
  assert(g.includes('id="nfe-geral-conteudo"'), 'o conteúdo (resumo+lista) tem contentor próprio');

  const teclas = simularTeclasCliente(ui, 'geral', 'jules');
  assert(teclas.join('|') === 'j|ju|jul|jule|jules', 'cada tecla acrescenta só essa letra: ' + teclas.join('|'));
  assert(ui.nfeFiltrosGeral().cliente === 'jules', 'o estado final é jules sem duplicar');
  const antesPaint = ui.el('pv-canal-panels').innerHTML;
  assert(!antesPaint.includes('value="jules"') || !antesPaint.includes('102605'), 'durante a digitação o paint da lista ainda não correu (debounce)');
  ui.nfeFlushPaintTexto();
  g = ui.el('pv-canal-panels').innerHTML;
  assert(g.includes('value="jules"') && g.includes('102605') && !g.includes('102610'), 'após o flush, o campo mostra jules e filtra');

  ui.nfeSetFiltro('geral', 'cliente', 'jules');
  g = ui.nfeHtml();
  assert(g.includes('102605') && !g.includes('102610') && !g.includes('102240'), 'o nome parcial filtra a lista');
  const iTot = g.indexOf('>Total<');
  const rowTot = g.slice(iTot, g.indexOf('</tr>', iTot));
  assert(rowTot.includes('>1<'), 'o filtro de cliente também reduz o resumo');
  ui.nfeSetFiltro('geral', 'cliente', 'jose');
  g = ui.nfeHtml();
  assert(g.includes('102610') && g.includes('José da Padaria') && !g.includes('102605'), 'o nome ignora acentos');
  ui.nfeSetFiltro('geral', 'cliente', '88021');
  g = ui.nfeHtml();
  assert(g.includes('102605') && !g.includes('102610'), 'o código do cliente filtra');
  ui.nfeSetFiltro('geral', 'cliente', '102605');
  g = ui.nfeHtml();
  assert(g.includes('Nenhuma nota neste filtro.'), 'o código do cliente não é o número da NF');
  ui.nfeSetFiltro('geral', 'numero', '102605');
  ui.nfeFlushPaintTexto();
  g = ui.nfeHtml();
  assert(g.includes('Nenhuma nota neste filtro.'), 'cliente errado + número certo: o cliente ainda exclui');
  ui.nfeSetFiltro('geral', 'cliente', '');
  ui.nfeFlushPaintTexto();
  g = ui.nfeHtml();
  assert(g.includes('102605') && !g.includes('102610'), 'só o número da NF filtra');
  ui.nfeSetFiltro('geral', 'numero', '');
  ui.nfeFlushPaintTexto();
  ui.nfeSetFiltro('geral', 'dia', '2026-10-20');
  g = ui.nfeHtml();
  assert(g.includes('value="2026-10-20"') && g.includes('20/10/2026'), 'o dia escolhido fica no filtro e no banner');
  assert(g.includes('102605') && !g.includes('102610') && !g.includes('102240'), 'com dia só entra essa data');
  ui.nfeSetFiltro('geral', 'dia', '');
  g = ui.nfeHtml();
  assert(!g.includes('value="2026-10-20"'), 'dia vazio');
  assert(g.includes('102605') && g.includes('102610') && g.includes('102240'), 'dia vazio é o mês inteiro');
  ui.nfeSetFiltro('geral', 'dia', '2026-10-20');
  ui.nfeSetFiltro('geral', 'mes', '2026-09');
  g = ui.nfeHtml();
  assert(g.includes('value="2026-09"') && !g.includes('value="2026-10-20"'), 'mudar o mês limpa o dia');
  assert(g.includes('102500') && g.includes('Setembro 2026'), 'outro mês mostra as NF desse mês');
  assert(!g.includes('102605') && !g.includes('102700'), 'outubro e o site ficam de fora');
  ui.nfeLimparFiltro();
  g = ui.nfeHtml();
  assert(g.includes('value="2026-10"') && g.includes('102605') && !g.includes('102500'), 'Limpar volta ao mês corrente');

  ui.nfeSetFiltro('geral', 'canal', 'canal:horeca');
  ui.nfeSetFiltro('geral', 'vendedor', 'vend:' + nfe.nfeNormNome('Daniela Santos'));
  ui.nfeSetFiltro('geral', 'cliente', 'jules');
  ui.nfeFlushPaintTexto();
  g = ui.nfeHtml();
  assert(g.includes('102605') && !g.includes('102610') && !g.includes('102240'), 'canal + vendedor + cliente juntos');
  const iTotComb = g.indexOf('>Total<');
  const rowTotComb = g.slice(iTotComb, g.indexOf('</tr>', iTotComb));
  assert(rowTotComb.includes('>1<'), 'o resumo combina com os filtros activos');
  ui.nfeLimparFiltro();
  g = ui.nfeHtml();
  assert(g.includes('102605') && g.includes('102240') && !g.includes('102700'), 'Limpar tira canal/vendedor/cliente e mantém o site fora');

  mem.clear();
  const persist = loadNfeUi(notas, 'horeca');
  persist.nfeSetFiltro('canal', 'dia', '2026-10-02');
  persist.nfeSetFiltro('canal', 'numero', '102610');
  persist.nfeGravarFiltros();
  const gravado = JSON.parse(mem.get('delta_nfe_filtros'));
  assert(gravado.porCanal.horeca.dia === '2026-10-02' && gravado.porCanal.horeca.mes === '2026-10' && gravado.porCanal.horeca.numero === '102610', 'dia escolhido grava o mês junto');
  const reaberto = loadNfeUi(notas, 'horeca');
  reaberto.nfePaintCanal();
  const hostP = reaberto.el('canal-nfe-host').innerHTML;
  assert(hostP.includes('value="2026-10-02"') && hostP.includes('value="102610"') && hostP.includes('José da Padaria'), 'ao reabrir, mês, dia e número voltam a filtrar');
  assert(!hostP.includes('102605'), 'o dia restaurado não traz as outras notas do mês');
  reaberto.nfeLimparFiltroCanal();
  const limpo = JSON.parse(mem.get('delta_nfe_filtros'));
  assert(limpo.porCanal.horeca.dia === '' && limpo.porCanal.horeca.mes === '' && limpo.porCanal.horeca.numero === '' && limpo.porCanal.horeca.cliente === '', 'Limpar grava mês, dia, cliente e número vazios');
  mem.clear();

  mem.set('delta_nfe_filtros', JSON.stringify({ geral: { dia: '2026-10-20' }, porCanal: {} }));
  const legado = loadNfeUi(notas, '', 'nfe');
  const leg = legado.nfeHtml();
  assert(!leg.includes('value="2026-10-20"') && leg.includes('102605') && leg.includes('102610'), 'um dia gravado sem mês não prende a abertura a esse dia');

  const muitas = [];
  for (let i = 0; i < 120; i++) {
    muitas.push({
      chave: 'P' + i,
      numero: String(200000 + i),
      canalId: 'horeca',
      canalNome: 'Horeca',
      vendedor: 'Daniela Santos',
      cliente: 'Cliente ' + i,
      cod: String(50000 + i),
      valor: 1 + (i % 7),
      data: '2026-10-15',
      status: 'unico',
    });
  }
  const page = loadNfeUi(muitas, '', 'nfe');
  let gp = page.nfeHtml();
  assert(gp.includes('Total da lista: 120 notas'), 'o total da lista conta o mês filtrado completo');
  assert(gp.includes('Mostrar mais (20)'), 'com mais de 100 notas aparece Mostrar mais');
  /* Ordenação: número desc → 200119…200020 na 1.ª página; 200019…200000 ficam para Mostrar mais. */
  assert(gp.includes('>200119<') && gp.includes('>200020<') && !gp.includes('>200000<'), 'a primeira página mostra 100 e esconde o resto');
  const iTotP = gp.indexOf('>Total<');
  const rowTotP = gp.slice(iTotP, gp.indexOf('</tr>', iTotP));
  assert(rowTotP.includes('>120<'), 'o resumo mantém as 120 mesmo com lista paginada');
  page.nfeMostrarMais('geral');
  gp = page.el('pv-canal-panels').innerHTML;
  assert(gp.includes('>200000<') && !gp.includes('Mostrar mais'), 'Mostrar mais revela o resto e tira o botão');
}

function testCargaLeve() {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const metaIni = html.indexOf('async function nfeHidrateMeta(');
  const metaFim = html.indexOf('async function nfeGarantirClientes(');
  const meta = html.slice(metaIni, metaFim);
  assert(metaIni > 0 && metaFim > metaIni, 'há carga só de metadados');
  assert(meta.includes('chunks: false'), 'a lista não pede os blocos de PDF');
  assert(meta.includes('_nfeMetaPronta') && meta.includes('opts && opts.force'), 'na mesma sessão não volta a pedir a nuvem');
  assert(!meta.includes('nfeLerPdfsNuvem') && !meta.includes('nfeLerPdfsLocais') && !meta.includes('nfePersistir'), 'abrir o ecrã não lê PDF nem regrava a nuvem');
  assert(meta.includes('nfeAplicarHotPath(leves)'), 'abrir aplica o hot path (só corrente+anterior)');
  assert(meta.includes('await idbSet(NFE_IDB_KEY, { notas: leves'), 'grava o arquivo completo, não só os meses quentes');
  assert(html.includes('await nfeHidrateMeta()'), 'as vistas usam a carga leve');
  assert(html.includes('nfeIndicePorMes') && html.includes('nfeNotasDoMesDoCanal'), 'há índice por mês para filtrar sem varrer tudo');
  assert(html.includes('nfePaintConteudo') && html.includes('nfe-geral-conteudo'), 'o filtro de texto actualiza só o conteúdo');
  assert(html.includes('function nfeMesesQuentes(') && html.includes('function nfeGarantirMes('), 'há meses quentes e carga sob pesquisa');
  assert(html.includes('A carregar ') && html.includes('nfeAbrirMes'), 'mês antigo mostra estado de carga');
  const onIni = html.indexOf('async function nfeOnFiles(');
  const onFim = html.indexOf('\nasync function nfe', onIni + 10);
  const on = html.slice(onIni, onFim > onIni ? onFim : onIni + 2500);
  assert(on.includes('await nfeHidrate()') && !on.includes('nfeHidrateMeta'), 'a carga do ZIP continua a juntar os PDF');
  assert(on.includes('nfeArquivoNotas()') && on.includes('nfeAplicarHotPath(reap.notas)'), 'o ZIP junta ao arquivo completo e volta ao hot path');
  const pdfIni = html.indexOf('async function nfePdfResolvido(');
  const pdf = html.slice(pdfIni, html.indexOf('function nfeEhTelemovel('));
  assert(pdf.includes("idbGet('delta_nfe_pdfs')") && pdf.includes('nfeCarregarPdfDaNuvem'), 'o PDF só é lido ao abrir a NF ou no WhatsApp (IndexedDB ou blocos nfe_pdfs_N)');
  assert(!pdf.includes('nfeGarantirChunksPdf'), 'o clique não descarrega todos os blocos de uma vez');
  const vista = html.slice(html.indexOf('async function nfeMontarVista('), html.indexOf('async function nfeMontarVista(') + 400);
  const canal = html.slice(html.indexOf('async function nfeMontarCanal('), html.indexOf('async function nfeMontarCanal(') + 400);
  const dados = html.slice(html.indexOf('async function nfeAoAbrirDados('), html.indexOf('async function nfeAoAbrirDados(') + 400);
  [vista, canal, dados].forEach(function (bloco) {
    assert(bloco.includes('nfeHidrateMeta') && !bloco.includes('nfeHidrate()'), 'o ecrã não usa a carga com PDF');
  });
}

async function testMesesQuentesHotPath() {
  const notas = [
    { chave: 'O1', numero: '102605', canalId: 'horeca', canalNome: 'Horeca', vendedor: 'Daniela Santos', cliente: 'Outubro SA', cod: '1', valor: 10, data: '2026-10-20', status: 'unico' },
    { chave: 'S1', numero: '102500', canalId: 'horeca', canalNome: 'Horeca', vendedor: 'Daniela Santos', cliente: 'Setembro Ltda', cod: '2', valor: 5, data: '2026-09-15', status: 'unico' },
    { chave: 'A1', numero: '101100', canalId: 'horeca', canalNome: 'Horeca', vendedor: 'Daniela Santos', cliente: 'Agosto Ltda', cod: '3', valor: 7, data: '2026-08-10', status: 'unico' },
    { chave: 'SP', numero: '102700', canalId: 'ecommerce', canalNome: 'Ecommerce', vendedor: 'Marcio Gorga', cliente: 'Site do Marcio', npess: '99520009', cod: '995', valor: 99, data: '2026-10-05', status: 'unico' },
    { chave: 'SP9', numero: '101900', canalId: 'ecommerce', canalNome: 'Ecommerce', vendedor: 'Marcio Gorga', cliente: 'Site Setembro', npess: '99520009', valor: 1, data: '2026-09-01', status: 'unico' },
  ];
  const ui = loadNfeUi(notas, '', 'nfe');
  assert(ui.nfeMesCorrente() === '2026-10', 'relógio de teste = Outubro 2026');
  assert(ui.nfeMesAnterior('2026-10') === '2026-09', 'mês anterior de Outubro é Setembro');
  assert(ui.nfeMesesQuentes().join(',') === '2026-10,2026-09', 'quentes = corrente + anterior');

  ui.nfeAplicarHotPath(notas);
  const hot = ui.getNotas();
  const chaves = hot.map(n => n.chave).sort().join(',');
  assert(chaves === 'O1,S1,SP,SP9', 'hot path traz Outubro+Setembro (inclui site no arquivo quente), veio ' + chaves);
  assert(!hot.some(n => n.chave === 'A1'), 'Agosto não entra no hot path à abertura');
  assert(ui.getTodas().length === 5, 'arquivo completo mantém os 5');
  assert(Array.from(ui.getMesesCarregados()).sort().join(',') === '2026-09,2026-10', 'meses carregados = quentes');
  assert(ui.getMesesDisponiveis().indexOf('2026-08') >= 0, 'Agosto continua listável (existe no arquivo)');

  let g = ui.nfeHtml();
  assert(g.includes('value="2026-10"') && g.includes('102605'), 'abre no mês corrente');
  assert(!g.includes('102500') && !g.includes('101100'), 'lista do mês corrente não traz Setembro/Agosto');
  assert(!g.includes('Site do Marcio') && !g.includes('102700'), 'Site próprio continua fora do menu');

  ui.nfeSetFiltro('geral', 'cliente', 'outubro');
  ui.nfeFlushPaintTexto();
  g = ui.nfeHtml();
  assert(g.includes('102605') && !g.includes('102500') && !g.includes('101100'), 'filtro no mês corrente não precisa de Agosto');

  ui.nfeLimparFiltro();
  assert(!ui.nfeMesJaCarregado('2026-08'), 'Agosto ainda não está no hot path');
  await ui.nfeSetFiltro('geral', 'mes', '2026-08');
  /* nfeSetFiltro dispara nfeAbrirMes (async); espera a hidratação sob pesquisa. */
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert(ui.nfeMesJaCarregado('2026-08'), 'escolher Agosto carrega esse mês');
  assert(ui.getNotas().some(n => n.chave === 'A1'), 'Agosto entra em _nfeNotas após pesquisa');
  g = ui.nfeHtml();
  assert(g.includes('101100') && g.includes('Agosto 2026'), 'lista mostra Agosto após carga');
  assert(!g.includes('102605') && !g.includes('102500'), 'só o mês escolhido');
  assert(ui.getTodas().length === 5, 'arquivo não perdeu meses ao hidratar Agosto');

  ui.nfeSetFiltro('geral', 'mes', '2026-10');
  await new Promise(r => setTimeout(r, 0));
  g = ui.nfeHtml();
  assert(g.includes('102605') && !g.includes('101100'), 'voltar a Outubro é imediato (já estava quente)');
  assert(ui.nfeMesJaCarregado('2026-08'), 'Agosto fica em cache na sessão');
}

testAtribuicao();
testCpfMarcio();
testVendedorAtual();
testMenuCanal();
testHorecaNaoListaEcommerce();
testSiteProprioRegra();
testFiltroMesCliente();
testCargaLeve();
testXmlAvulso();
testUiCarga();
testPdfZipMinimo();
testPdfNomesCockpit();
testPdfChunks();
const zipPath = findZip();
if (!zipPath) {
  console.log('SKIP zip: ficheiro do cockpit não está no repo (dados de clientes).');
} else {
  testZip(zipPath);
  testFiltrosETotal(zipPath);
}

async function pdfComTamanhos(sizes) {
  const { PDFDocument } = require('../pdf-lib.min.js');
  const doc = await PDFDocument.create();
  sizes.forEach(function (s) { doc.addPage(s); });
  return Buffer.from(await doc.save());
}

async function tamanhosPdf(buf) {
  const { PDFDocument } = require('../pdf-lib.min.js');
  const doc = await PDFDocument.load(buf);
  const pages = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    const s = doc.getPage(i).getSize();
    pages.push([Math.round(s.width), Math.round(s.height)]);
  }
  return pages;
}

async function testBoletosPdf() {
  const chave = '35261014830817000100550020000000010000000000';
  const chaveSem = '35261014830817000100550020000000020000000000';
  const chaveSoBol = '35261014830817000100550020000000030000000000';
  const xml = (ch, nNF) => `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${ch}"><ide><serie>2</serie><nNF>${nNF}</nNF><dhEmi>2026-10-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>14830817000100</CNPJ></emit><dest><CNPJ>03852638000149</CNPJ><xNome>CLIENTE</xNome></dest><total><ICMSTot><vNF>10.50</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
  const nfPaginas = [[200, 300], [210, 310]];
  const bolPaginas = [[400, 120]];
  const nfPdf = await pdfComTamanhos(nfPaginas);
  const bolPdf = await pdfComTamanhos(bolPaginas);
  const nfSo = await pdfComTamanhos([[180, 280]]);
  const pasta = (ch) => '14830817000100_Delta Foods Brasil - SP/20_10_2026__20_10_2026/Saida/NFe' + ch + '/';
  const zip = makeZip([
    { name: pasta(chave) + 'NFe' + chave + '_prot.xml', data: Buffer.from(xml(chave, 1)) },
    { name: pasta(chave) + 'NFe' + chave + '.pdf', data: nfPdf },
    { name: pasta(chave) + 'Boleto_1-2_1_1.pdf', data: bolPdf },
    { name: pasta(chaveSem) + 'NFe' + chaveSem + '_prot.xml', data: Buffer.from(xml(chaveSem, 2)) },
    { name: pasta(chaveSem) + 'NFe' + chaveSem + '.pdf', data: nfSo },
    { name: pasta(chaveSoBol) + 'NFe' + chaveSoBol + '_prot.xml', data: Buffer.from(xml(chaveSoBol, 3)) },
    { name: pasta(chaveSoBol) + 'Boleto_3-2_1_1.pdf', data: bolPdf },
    { name: 'Boleto_9-1_1_1.pdf', data: bolPdf },
  ]);
  const entries = nfe.nfeReadZipEntries(zip);
  const xmls = entries.filter(e => e.xml);
  const pdfs = entries.filter(e => e.pdfBase64);
  assert(xmls.length === 3 && pdfs.length === 5, 'o zip de teste traz 3 XML e 5 PDF, veio ' + xmls.length + '/' + pdfs.length);
  const notas = xmls.map(x => nfe.nfeParseXml(x.xml, x.name)).filter(Boolean);
  const assoc = nfe.nfeAssociarPdfs(notas, pdfs);
  assert(assoc.ligados === 2 && assoc.soltos === 0, 'os boletos não contam como PDF de NF solto, veio ' + assoc.ligados + '/' + assoc.soltos);
  const comBol = nfe.nfeAssociarBoletos(assoc.notas, pdfs);
  assert(comBol.ligados === 2 && comBol.soltos === 1, 'dois boletos ligam pela pasta e um fica sem nota, veio ' + comBol.ligados + '/' + comBol.soltos);
  const porNum = comBol.notas.find(n => n.chave === chave);
  const semBol = comBol.notas.find(n => n.chave === chaveSem);
  const soBol = comBol.notas.find(n => n.chave === chaveSoBol);
  assert(porNum && porNum.pdfNome === 'NFe' + chave + '.pdf', 'a DANFE continua a ser o PDF da NF');
  assert(Buffer.from(porNum.pdfBase64, 'base64').equals(nfPdf), 'o PDF original da NF fica gravado');
  assert(porNum.boletoNome === 'Boleto_1-2_1_1.pdf' && porNum.temBoleto, 'o boleto fica na mesma nota');
  assert(Buffer.from(porNum.boletoBase64, 'base64').equals(bolPdf), 'o PDF original do boleto fica gravado');
  assert(semBol && semBol.pdfBase64 && !semBol.boletoBase64 && !semBol.temBoleto, 'NF sem boleto mantém só o PDF da nota');
  assert(soBol && soBol.boletoBase64 && !soBol.pdfBase64, 'boleto sem DANFE fica guardado e não inventa PDF da NF');

  const junto = await nfe.nfeAnexarDocsJuntos(comBol.notas);
  assert(junto.juntos === 1 && junto.falhas === 0, 'só a nota com os dois PDF gera o documento junto, veio ' + JSON.stringify({ juntos: junto.juntos, falhas: junto.falhas }));
  const fundida = junto.notas.find(n => n.chave === chave);
  const semJunto = junto.notas.find(n => n.chave === chaveSem);
  const soBolJ = junto.notas.find(n => n.chave === chaveSoBol);
  assert(fundida.temPdfJunto && fundida.pdfJuntoNome === 'NF-1-boleto.pdf', 'o nome do PDF junto identifica a NF e o boleto');
  assert(fundida.pdfBase64 === porNum.pdfBase64 && fundida.boletoBase64 === porNum.boletoBase64, 'originais da NF e do boleto mantêm-se ao lado do PDF junto');
  const pags = await tamanhosPdf(Buffer.from(fundida.pdfJuntoBase64, 'base64'));
  assert(pags.length === nfPaginas.length + bolPaginas.length, 'o PDF junto soma as páginas, veio ' + pags.length);
  assert(JSON.stringify(pags) === JSON.stringify(nfPaginas.concat(bolPaginas)), 'a ordem é NF e depois boleto, veio ' + JSON.stringify(pags));
  assert(!semJunto.pdfJuntoBase64, 'sem boleto não há PDF junto');
  assert(!soBolJ.pdfJuntoBase64, 'boleto sem DANFE não inventa PDF junto');

  const aberto = nfe.nfePdfDaNota(fundida, null);
  assert(aberto.ok && aberto.junto === true && aberto.pdfBase64 === fundida.pdfJuntoBase64, 'abrir/exportar devolve o PDF junto quando há boleto');
  const soNf = nfe.nfePdfDaNota(semJunto, null);
  assert(soNf.ok && soNf.junto === false && soNf.pdfBase64 === semJunto.pdfBase64, 'sem boleto abre só a NF');
  const nada = nfe.nfePdfDaNota(soBolJ, null);
  assert(nada.ok === false, 'boleto sem DANFE não abre um PDF inventado');

  const leve = nfe.nfeNotaSemPdfBinario(fundida);
  assert(!leve.pdfBase64 && !leve.boletoBase64 && !leve.pdfJuntoBase64, 'a célula leve não leva os binários');
  assert(leve.temPdf && leve.temBoleto && leve.temPdfJunto, 'a célula leve guarda que há NF, boleto e PDF junto');
  const mapa = nfe.nfeMapaPdfsDeChunks(nfe.nfePartirPdfsEmChunks([fundida]));
  const volta = nfe.nfeJuntarPdfsLocais([leve], mapa)[0];
  assert(volta.pdfBase64 === fundida.pdfBase64 && volta.boletoBase64 === fundida.boletoBase64 && volta.pdfJuntoBase64 === fundida.pdfJuntoBase64, 'os blocos repor NF, boleto e PDF junto');
  assert(nfe.nfePdfDaNota(leve, mapa).pdfBase64 === fundida.pdfJuntoBase64, 'depois dos blocos a exportação continua a ser o PDF junto');

  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert(html.includes('pdf-lib.min.js'), 'a página carrega o pdf-lib');
  assert(html.includes('nfeAssociarBoletos'), 'a carga liga o boleto');
  assert(html.includes('nfeAnexarDocsJuntos'), 'a carga grava o PDF junto ao ler o zip');
  assert(html.includes('Abrir NF e boleto'), 'o número da NF com boleto abre o documento junto');
  assert(html.includes('>Boleto<'), 'a lista de NF tem a coluna Boleto');

  assert(nfe.nfeMarcaBoleto(fundida) === 'S', 'nota com boletoBase64 e PDF junto marca S');
  assert(nfe.nfeMarcaBoleto(semJunto) === 'N', 'nota só com DANFE marca N');
  assert(nfe.nfeMarcaBoleto(soBolJ) === 'S', 'boleto sem DANFE marca S');
  const leveCom = nfe.nfeNotaSemPdfBinario(fundida);
  const leveSem = nfe.nfeNotaSemPdfBinario(semJunto);
  assert(nfe.nfeMarcaBoleto(leveCom) === 'S' && !leveCom.boletoBase64 && !leveCom.pdfJuntoBase64, 'a célula leve com temBoleto marca S');
  assert(nfe.nfeMarcaBoleto(leveSem) === 'N', 'a célula leve sem boleto marca N');
  assert(nfe.nfeMarcaBoleto({ pdfJuntoBase64: 'QQ==' }) === 'S', 'pdfJuntoBase64 sozinho marca S');
  assert(nfe.nfeMarcaBoleto({ pdfBase64: 'QQ==', temPdf: true }) === 'N', 'só o PDF da NF marca N');

  function marcaNaLista(pagina, numero) {
    const lista = pagina.indexOf('Total da lista');
    const i = pagina.indexOf('>' + numero + '</button>', lista >= 0 ? lista : 0);
    assert(i >= 0, 'a lista mostra o número ' + numero);
    const cab = pagina.indexOf('>Número<');
    const bol = pagina.indexOf('>Boleto<');
    const cli = pagina.indexOf('>Cliente<');
    assert(cab >= 0 && bol > cab && cli > bol, 'Boleto fica ao lado do número, antes do cliente');
    const m = pagina.slice(i, i + 700).match(/class="nfe-boleto"[^>]*>([SN])</);
    assert(m, 'a linha ' + numero + ' tem a célula Boleto');
    return m[1];
  }
  const notasUi = [fundida, semJunto, soBolJ].map(n => Object.assign({}, n, { canalId: 'horeca', canalNome: 'Horeca' }));
  const geral = loadNfeUi(notasUi, '', 'nfe').nfeHtml();
  assert(marcaNaLista(geral, '1') === 'S', 'no quadro geral a NF com boleto mostra S');
  assert(marcaNaLista(geral, '2') === 'N', 'no quadro geral a NF sem boleto mostra N');
  assert(marcaNaLista(geral, '3') === 'S', 'no quadro geral o boleto sem DANFE mostra S');
  assert(!geral.includes('>Sim<') && !geral.includes('>Não<'), 'a coluna usa S ou N');
  const canalUi = loadNfeUi(notasUi, 'horeca');
  canalUi.nfePaintCanal();
  const canalHtml = canalUi.el('canal-nfe-host').innerHTML;
  assert(marcaNaLista(canalHtml, '1') === 'S' && marcaNaLista(canalHtml, '2') === 'N', 'o menu do canal repete a coluna Boleto');
  const soSem = loadNfeUi([semJunto], '', 'nfe').nfeHtml();
  assert(soSem.includes('>Boleto<') && marcaNaLista(soSem, '2') === 'N', 'a coluna Boleto fica visível quando todas são N');
  const leves = loadNfeUi([leveCom, leveSem].map(n => Object.assign({}, n, { canalId: 'horeca' })), '', 'nfe').nfeHtml();
  assert(marcaNaLista(leves, '1') === 'S' && marcaNaLista(leves, '2') === 'N', 'a lista usa a marca da célula leve');
}

async function testBoletosParcelas() {
  const chave = '35261014830817000100550020001026061000000000';
  const xml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${chave}"><ide><serie>2</serie><nNF>102606</nNF><dhEmi>2026-10-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>14830817000100</CNPJ></emit><dest><CNPJ>03852638000149</CNPJ><xNome>CLIENTE</xNome></dest><total><ICMSTot><vNF>10.50</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
  const nfPaginas = [[200, 300], [210, 310]];
  const p1 = [[401, 101]];
  const p2 = [[402, 102]];
  const p3 = [[403, 103]];
  const nfPdf = await pdfComTamanhos(nfPaginas);
  const b1 = await pdfComTamanhos(p1);
  const b2 = await pdfComTamanhos(p2);
  const b3 = await pdfComTamanhos(p3);
  const zip = makeZip([
    { name: 'saida/NFe' + chave + '_prot.xml', data: Buffer.from(xml) },
    { name: 'saida/NFe' + chave + '.pdf', data: nfPdf },
    { name: 'saida/Boleto_102606-2_3_3.pdf', data: b3 },
    { name: 'saida/Boleto_102606-2_1_3.pdf', data: b1 },
    { name: 'saida/Boleto_102606-2_2_3.pdf', data: b2 },
  ]);
  const entries = nfe.nfeReadZipEntries(zip);
  const pdfs = entries.filter(e => e.pdfBase64);
  const notas = entries.filter(e => e.xml).map(x => nfe.nfeParseXml(x.xml, x.name)).filter(Boolean);
  const assoc = nfe.nfeAssociarPdfs(notas, pdfs);
  assert(assoc.ligados === 1 && assoc.soltos === 0, 'a DANFE liga e os boletos não contam como NF, veio ' + assoc.ligados + '/' + assoc.soltos);
  const comBol = nfe.nfeAssociarBoletos(assoc.notas, pdfs);
  assert(comBol.ligados === 3 && comBol.soltos === 0, 'os 3 boletos da 102606-2 ligam, veio ' + comBol.ligados + '/' + comBol.soltos);
  const nota = comBol.notas.find(n => n.numero === '102606');
  assert(nota && Array.isArray(nota.boletos) && nota.boletos.length === 3, 'a nota guarda os 3 boletos');
  assert(nota.boletos.map(b => b.nome).join(',') === 'Boleto_102606-2_1_3.pdf,Boleto_102606-2_2_3.pdf,Boleto_102606-2_3_3.pdf', 'a ordem é a parcela, veio ' + nota.boletos.map(b => b.nome).join(','));
  assert(nota.boletos.map(b => b.parcela).join(',') === '1,2,3', 'os índices são 1, 2 e 3');
  assert(nota.boletoNome === 'Boleto_102606-2_1_3.pdf' && nota.temBoleto, 'o primeiro boleto gravado continua a ser a parcela 1');
  assert(Buffer.from(nota.boletoBase64, 'base64').equals(b1), 'boletoBase64 é a parcela 1, não o primeiro ficheiro do zip');
  assert(Buffer.from(nota.boletos[1].pdfBase64, 'base64').equals(b2), 'a parcela 2 fica guardada');
  assert(Buffer.from(nota.boletos[2].pdfBase64, 'base64').equals(b3), 'a parcela 3 fica guardada');
  const junto = await nfe.nfeAnexarDocsJuntos(comBol.notas);
  assert(junto.juntos === 1 && junto.falhas === 0, 'a 102606 gera um PDF junto com as 3 parcelas');
  const fundida = junto.notas[0];
  const pags = await tamanhosPdf(Buffer.from(fundida.pdfJuntoBase64, 'base64'));
  assert(pags.length === nfPaginas.length + 3, 'o PDF junto soma a DANFE e as 3 parcelas, veio ' + pags.length);
  assert(JSON.stringify(pags) === JSON.stringify(nfPaginas.concat(p1, p2, p3)), 'a ordem é DANFE, parcela 1, 2 e 3, veio ' + JSON.stringify(pags));
  assert(nfe.nfeMarcaBoleto(fundida) === 'S', 'com parcelas a coluna continua S');
  const aberto = nfe.nfePdfDaNota(fundida, null);
  assert(aberto.ok && aberto.junto === true && aberto.pdfBase64 === fundida.pdfJuntoBase64, 'abrir a NF devolve o PDF com as 3 parcelas');

  const leve = nfe.nfeNotaSemPdfBinario(fundida);
  assert(!leve.boletoBase64 && !(leve.boletos || []).some(b => b && b.pdfBase64), 'a célula leve não leva os PDF das parcelas');
  assert(leve.temBoleto && leve.boletos && leve.boletos.length === 3, 'a célula leve lembra que há 3 parcelas');
  const volta = nfe.nfeJuntarPdfsLocais([leve], nfe.nfeMapaPdfsDeChunks(nfe.nfePartirPdfsEmChunks([fundida])))[0];
  assert(volta.boletos && volta.boletos.map(b => b.nome).join(',') === nota.boletos.map(b => b.nome).join(','), 'os blocos repõem as 3 parcelas por ordem');
  assert(Buffer.from(volta.boletos[2].pdfBase64, 'base64').equals(b3), 'a parcela 3 volta dos blocos');
  assert(nfe.nfePdfDaNota(leve, nfe.nfeMapaPdfsDeChunks(nfe.nfePartirPdfsEmChunks([fundida]))).pdfBase64 === fundida.pdfJuntoBase64, 'a exportação depois dos blocos é o PDF com as 3 parcelas');

  const antiga = {
    chave: chave,
    numero: '102606',
    serie: '2',
    pdfBase64: nota.pdfBase64,
    pdfNome: nota.pdfNome,
    temPdf: true,
    boletoNome: 'Boleto_102606-2_1_3.pdf',
    boletoBase64: nota.boletos[0].pdfBase64,
    temBoleto: true,
    pdfJuntoBase64: 'QQ==',
    pdfJuntoNome: 'NF-102606-boleto.pdf',
    temPdfJunto: true,
  };
  const relida = nfe.nfeAssociarBoletos([antiga], pdfs);
  assert(relida.notas[0].boletos.length === 3 && !relida.notas[0].pdfJuntoBase64, 'relêr o zip junta as parcelas em falta e descarta o PDF que só tinha a primeira');
  const junto2 = await nfe.nfeAnexarDocsJuntos(relida.notas);
  const pags2 = await tamanhosPdf(Buffer.from(junto2.notas[0].pdfJuntoBase64, 'base64'));
  assert(JSON.stringify(pags2) === JSON.stringify(nfPaginas.concat(p1, p2, p3)), 'o PDF refeito inclui as 3 parcelas');

  const semParc = makeZip([
    { name: 'saida/NFe' + chave + '_prot.xml', data: Buffer.from(xml) },
    { name: 'saida/NFe' + chave + '.pdf', data: nfPdf },
    { name: 'saida/Boleto_102606-2.pdf', data: b1 },
  ]);
  const entSem = nfe.nfeReadZipEntries(semParc);
  const notasSem = entSem.filter(e => e.xml).map(x => nfe.nfeParseXml(x.xml, x.name)).filter(Boolean);
  const pdfsSem = entSem.filter(e => e.pdfBase64);
  const um = nfe.nfeAssociarBoletos(nfe.nfeAssociarPdfs(notasSem, pdfsSem).notas, pdfsSem);
  assert(um.ligados === 1 && um.soltos === 0, 'Boleto_102606-2.pdf sem parcela continua a ligar');
  const notaUm = um.notas[0];
  assert(notaUm.boletos.length === 1 && notaUm.boletoNome === 'Boleto_102606-2.pdf', 'o boleto único antigo fica gravado');
  const juntoUm = await nfe.nfeAnexarDocsJuntos(um.notas);
  const pagsUm = await tamanhosPdf(Buffer.from(juntoUm.notas[0].pdfJuntoBase64, 'base64'));
  assert(JSON.stringify(pagsUm) === JSON.stringify(nfPaginas.concat(p1)), 'sem parcela o PDF junto é DANFE e esse boleto');

  const chaveIx = '35261014830817000100550020000000081000000000';
  const xmlIx = xml.replace(chave, chaveIx).replace('<nNF>102606</nNF>', '<nNF>8</nNF>');
  const p2b = [[502, 112]];
  const p10 = [[510, 120]];
  const b2b = await pdfComTamanhos(p2b);
  const b10 = await pdfComTamanhos(p10);
  const zipIx = makeZip([
    { name: 'NFe' + chaveIx + '_prot.xml', data: Buffer.from(xmlIx) },
    { name: 'NFe' + chaveIx + '.pdf', data: nfPdf },
    { name: 'Boleto_8-2_10_12.pdf', data: b10 },
    { name: 'Boleto_8-2_2_12.pdf', data: b2b },
  ]);
  const entIx = nfe.nfeReadZipEntries(zipIx);
  const pdfIx = entIx.filter(e => e.pdfBase64);
  const notaIx0 = entIx.filter(e => e.xml).map(x => nfe.nfeParseXml(x.xml, x.name)).filter(Boolean);
  const ix = nfe.nfeAssociarBoletos(nfe.nfeAssociarPdfs(notaIx0, pdfIx).notas, pdfIx).notas[0];
  assert(ix.boletos.map(b => b.parcela).join(',') === '2,10', 'a parcela 2 fica antes da 10, veio ' + ix.boletos.map(b => b.nome).join(','));
  const pagsIx = await tamanhosPdf(Buffer.from((await nfe.nfeAnexarDocsJuntos([ix])).notas[0].pdfJuntoBase64, 'base64'));
  assert(JSON.stringify(pagsIx) === JSON.stringify(nfPaginas.concat(p2b, p10)), 'o PDF segue o índice numérico da parcela');

  const chaveDup = '35261014830817000100550020000000071000000000';
  const xmlDup = xml.replace(chave, chaveDup).replace('<nNF>102606</nNF>', '<nNF>7</nNF>');
  const dA = [[611, 111]];
  const dB = [[612, 112]];
  const fA = await pdfComTamanhos(dA);
  const fB = await pdfComTamanhos(dB);
  const zipDup = makeZip([
    { name: 'NFe' + chaveDup + '_prot.xml', data: Buffer.from(xmlDup) },
    { name: 'NFe' + chaveDup + '.pdf', data: nfPdf },
    { name: 'Boleto_7-2_1_2_b.pdf', data: fB },
    { name: 'Boleto_7-2_1_2.pdf', data: fA },
  ]);
  const entDup = nfe.nfeReadZipEntries(zipDup);
  const pdfDup = entDup.filter(e => e.pdfBase64);
  const notaDup0 = entDup.filter(e => e.xml).map(x => nfe.nfeParseXml(x.xml, x.name)).filter(Boolean);
  const dup = nfe.nfeAssociarBoletos(nfe.nfeAssociarPdfs(notaDup0, pdfDup).notas, pdfDup).notas[0];
  assert(dup.boletos.length === 2 && dup.boletos.every(b => b.parcela === 1), 'dois ficheiros com a mesma parcela ficam os dois');
  assert(dup.boletos.map(b => b.nome).join(',') === 'Boleto_7-2_1_2.pdf,Boleto_7-2_1_2_b.pdf', 'mesma parcela: ordem do nome, veio ' + dup.boletos.map(b => b.nome).join(','));
  const pagsDup = await tamanhosPdf(Buffer.from((await nfe.nfeAnexarDocsJuntos([dup])).notas[0].pdfJuntoBase64, 'base64'));
  assert(JSON.stringify(pagsDup) === JSON.stringify(nfPaginas.concat(dA, dB)), 'mesma parcela mantém a ordem do nome no PDF');

  const chavePasta = '35261014830817000100550020000000061000000000';
  const xmlPasta = xml.replace(chave, chavePasta).replace('<nNF>102606</nNF>', '<nNF>6</nNF>');
  const pasta = 'NFe' + chavePasta + '/';
  const zipPasta = makeZip([
    { name: pasta + 'NFe' + chavePasta + '_prot.xml', data: Buffer.from(xmlPasta) },
    { name: pasta + 'NFe' + chavePasta + '.pdf', data: nfPdf },
    { name: pasta + 'Boleto_6-2_2_2.pdf', data: b2 },
    { name: pasta + 'Boleto_6-2_1_2.pdf', data: b1 },
  ]);
  const entPasta = nfe.nfeReadZipEntries(zipPasta);
  const pdfPasta = entPasta.filter(e => e.pdfBase64);
  const notaPasta0 = entPasta.filter(e => e.xml).map(x => nfe.nfeParseXml(x.xml, x.name)).filter(Boolean);
  const naPasta = nfe.nfeAssociarBoletos(nfe.nfeAssociarPdfs(notaPasta0, pdfPasta).notas, pdfPasta);
  assert(naPasta.ligados === 2 && naPasta.soltos === 0, 'na pasta NFe{chave} entram as duas parcelas');
  assert(naPasta.notas[0].boletos.map(b => b.nome).join(',') === 'Boleto_6-2_1_2.pdf,Boleto_6-2_2_2.pdf', 'na pasta a ordem também é a parcela');
}

async function testWhatsappPdf() {
  const junto = await pdfComTamanhos([[200, 300], [401, 101], [402, 102]]);
  const danfe = await pdfComTamanhos([[180, 280]]);
  const chave = '35261014830817000100550020000000990000000000';
  const nota = {
    chave,
    numero: '99',
    serie: '1',
    canalId: 'horeca',
    canalNome: 'Horeca',
    vendedor: 'Hélcio Grégio',
    cliente: 'Cliente WA',
    valor: 10,
    data: '2026-10-20',
    status: 'unico',
    temPdf: true,
    temBoleto: true,
    temPdfJunto: true,
    pdfJuntoBase64: junto.toString('base64'),
    pdfJuntoNome: 'NF-99-boleto.pdf',
    pdfBase64: Buffer.from('%PDF-so-danfe').toString('base64'),
    boletoBase64: Buffer.from('%PDF-so-bol').toString('base64'),
  };
  const api = loadNfeUi([nota], '', 'nfe');
  const html = api.nfeHtml();
  const canal = loadNfeUi([nota], 'horeca');
  canal.nfePaintCanal();
  const canalHtml = canal.el('canal-nfe-host').innerHTML;
  [html, canalHtml].forEach(function (pagina, idx) {
    const onde = idx ? 'menu do canal' : 'NF emitidas';
    const cab = pagina.indexOf('>Número<');
    const bol = pagina.indexOf('>Boleto<', cab);
    const cli = pagina.indexOf('>Cliente<', bol);
    const thWa = pagina.indexOf('class="nfe-wa"', bol);
    assert(cab > 0 && bol > cab && thWa > bol && cli > thWa, onde + ': o ícone fica no cabeçalho entre Boleto e Cliente');
    const iBtn = pagina.indexOf("nfeAbrirPdf('" + chave + "')");
    const iBolCell = pagina.indexOf('class="nfe-boleto"', iBtn);
    const iSn = pagina.indexOf('>S<', iBolCell);
    const iWa = pagina.indexOf("nfePartilharWhatsapp('" + chave + "'", iSn);
    const iCell = pagina.lastIndexOf('class="nfe-wa"', iWa);
    const iCli = pagina.indexOf('Cliente WA', iWa);
    assert(iBtn > 0 && iBolCell > iBtn && iSn > iBolCell && iCell > iSn && iWa > iCell && iCli > iWa, onde + ': o botão WhatsApp fica a seguir à célula S/N');
    assert(pagina.includes("onpointerdown=\"nfePrepararWhatsapp('" + chave + "')\" onclick=\"nfeAbrirPdf('" + chave + "')\""), onde + ': o número começa a ler o PDF no toque');
    const celula = pagina.slice(iCell, iCli);
    assert(celula.includes('nfe-wa-btn') && celula.includes('<svg') && celula.includes('#25D366'), onde + ': a célula tem o ícone verde');
    assert(celula.includes('nfePrepararWhatsapp'), onde + ': o toque prepara o PDF antes da folha');
    assert(!/Exportar|partilhar no/i.test(celula), onde + ': a célula não tem texto além do ícone');
  });

  const partilhas = [];
  const abertosCedo = [];
  function porNavigator(nav) {
    Object.defineProperty(global, 'navigator', { value: nav, configurable: true, writable: true });
  }
  const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
  const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  function navPartilha(ua) {
    return {
      userAgent: ua || UA_DESKTOP,
      maxTouchPoints: ua === UA_ANDROID ? 5 : 0,
      canShare(data) {
        return !!(data && data.files && data.files[0] && data.files[0].size > 0);
      },
      share(data) {
        partilhas.push(data);
        return Promise.resolve();
      },
    };
  }
  porNavigator(navPartilha(UA_ANDROID));
  global.window = { open(url) { abertosCedo.push(url); return {}; } };
  global.idbGet = async () => null;
  global.toast = () => {};
  await api.nfeIniciarPacoteWhatsapp(chave);
  await api.nfePartilharWhatsapp(chave);
  assert(partilhas.length === 1, 'navigator.share foi chamado com o PDF junto');
  const f = partilhas[0] && partilhas[0].files && partilhas[0].files[0];
  assert(f instanceof File && f.size > 0 && f.type === 'application/pdf', 'o File partilhado não está vazio');
  assert(f.name === 'NF-99-boleto.pdf', 'usa o nome do PDF junto, veio ' + (f && f.name));
  assert(partilhas[0].text === 'NF 99', 'o texto da partilha é curto');
  const got = Buffer.from(await f.arrayBuffer());
  assert(got.equals(junto), 'o File é o PDF junto, não o primeiro boleto nem a DANFE isolada');
  assert(abertosCedo.length === 0, 'no telemóvel com partilha de ficheiro não abre wa.me sem o PDF');
  assert(!abertosCedo.some(u => /wa\.me|whatsapp:\/\//i.test(String(u))), 'o telemóvel não usa ligação só com texto');

  const sem = Object.assign({}, nota, {
    chave: chave + 'B',
    numero: '98',
    cliente: 'Cliente DANFE',
    temBoleto: false,
    temPdfJunto: false,
    pdfJuntoBase64: '',
    pdfJuntoNome: '',
    boletoBase64: '',
    pdfBase64: danfe.toString('base64'),
    pdfNome: 'NF_98.pdf',
  });
  const apiSem = loadNfeUi([sem], '', 'nfe');
  const semHtml = apiSem.nfeHtml();
  const iN = semHtml.indexOf('class="nfe-boleto"');
  assert(semHtml.slice(iN, iN + 220).includes('>N<'), 'sem boleto a célula continua N');
  assert(semHtml.indexOf("nfePartilharWhatsapp('" + sem.chave + "'") > semHtml.indexOf('>N<'), 'o ícone também aparece quando o boleto é N');
  partilhas.length = 0;
  await apiSem.nfeIniciarPacoteWhatsapp(sem.chave);
  await apiSem.nfePartilharWhatsapp(sem.chave);
  const f2 = partilhas[0] && partilhas[0].files && partilhas[0].files[0];
  assert(f2 && f2.name === 'NF_98.pdf' && Buffer.from(await f2.arrayBuffer()).equals(danfe), 'sem boleto partilha só a DANFE');

  const noIdb = await pdfComTamanhos([[190, 290], [403, 103]]);
  const leve = {
    chave: 'IDB1',
    numero: '97',
    canalId: 'horeca',
    canalNome: 'Horeca',
    cliente: 'Cliente IDB',
    valor: 1,
    data: '2026-10-20',
    status: 'unico',
    temPdf: true,
    temBoleto: true,
    temPdfJunto: true,
    pdfJuntoNome: 'NF-97-boleto.pdf',
  };
  global.idbGet = async (k) => {
    if (k !== 'delta_nfe_pdfs') return null;
    return { pdfs: { IDB1: { juntoB64: noIdb.toString('base64'), juntoNome: 'NF-97-boleto.pdf', b64: Buffer.from('%PDF-danfe').toString('base64'), nome: 'danfe.pdf' } } };
  };
  const apiIdb = loadNfeUi([leve], '', 'nfe');
  partilhas.length = 0;
  await apiIdb.nfeIniciarPacoteWhatsapp('IDB1');
  await apiIdb.nfePartilharWhatsapp('IDB1');
  const f3 = partilhas[0] && partilhas[0].files && partilhas[0].files[0];
  assert(f3 && f3.size > 0 && Buffer.from(await f3.arrayBuffer()).equals(noIdb), 'com o binário no IndexedDB partilha o PDF junto');

  const toasts = [];
  const abertos = [];
  global._nfeAnchorClicks = [];
  global.toast = (m) => { toasts.push(String(m)); };
  global.window = { open(url) { abertos.push(url); return {}; } };
  global.idbGet = async () => null;
  porNavigator({
    userAgent: UA_DESKTOP,
    maxTouchPoints: 0,
    canShare() { return false; },
    share() { throw new Error('share não devia correr sem ficheiros'); },
  });
  await api.nfePartilharWhatsapp(chave);
  assert(toasts.some(t => t.indexOf('Neste browser o PDF foi descarregado para anexar no WhatsApp') >= 0), 'fallback avisa a descarga, veio ' + toasts.join('|'));
  assert(abertos.some(u => String(u).indexOf('https://wa.me/?text=') === 0), 'no desktop sem partilha de ficheiro abre o WhatsApp, veio ' + abertos.join('|'));
  assert(global._nfeAnchorClicks.some(a => a.download === 'NF-99-boleto.pdf'), 'fallback descarrega o PDF junto');

  // Android/Samsung: canShare({files}) mente — mesmo assim tenta navigator.share.
  const partilhasCanShareFalso = [];
  const toastsCanShareFalso = [];
  global._nfeAnchorClicks = [];
  global.toast = (m) => { toastsCanShareFalso.push(String(m)); };
  global.window = { open() { return {}; } };
  porNavigator({
    userAgent: UA_ANDROID,
    maxTouchPoints: 5,
    canShare() { return false; },
    share(data) { partilhasCanShareFalso.push(data); return Promise.resolve(); },
  });
  await api.nfeIniciarPacoteWhatsapp(chave);
  await api.nfePartilharWhatsapp(chave);
  assert(partilhasCanShareFalso.length === 1, 'telemóvel com canShare falso ainda chama share');
  const fCan = partilhasCanShareFalso[0] && partilhasCanShareFalso[0].files && partilhasCanShareFalso[0].files[0];
  assert(fCan && fCan.size > 0 && fCan.type === 'application/pdf', 'com canShare falso o File partilhado não está vazio');
  assert(toastsCanShareFalso.length === 0, 'canShare falso com share a funcionar não descarrega, veio ' + toastsCanShareFalso.join('|'));

  const toastsMovel = [];
  const abertosMovel = [];
  global._nfeAnchorClicks = [];
  global.toast = (m) => { toastsMovel.push(String(m)); };
  global.window = { open(url) { abertosMovel.push(url); return {}; } };
  porNavigator({
    userAgent: UA_ANDROID,
    maxTouchPoints: 5,
    canShare() { return false; },
    share() {
      const e = new Error('Share not supported');
      e.name = 'TypeError';
      return Promise.reject(e);
    },
  });
  await api.nfeIniciarPacoteWhatsapp(chave);
  await api.nfePartilharWhatsapp(chave);
  assert(toastsMovel.some(t => t.indexOf('PDF descarregado. Abre o WhatsApp e anexa o ficheiro') >= 0), 'telemóvel sem anexar ficheiro avisa a descarga, veio ' + toastsMovel.join('|'));
  assert(!abertosMovel.some(u => /wa\.me|whatsapp:\/\//i.test(String(u))), 'telemóvel sem partilha de ficheiro não abre WhatsApp só com texto');
  assert(global._nfeAnchorClicks.some(a => a.download === 'NF-99-boleto.pdf'), 'telemóvel sem partilha descarrega o PDF junto');

  // Prefetch helper existe e aquece a cache para o toque ser síncrono.
  assert(typeof api.nfePrefetchWhatsappChaves === 'function', 'prefetch helper existe');
  assert(typeof api.nfeIniciarPacoteWhatsapp === 'function', 'iniciar pacote exportado para testes');
  const apiSync = loadNfeUi([nota], '', 'nfe');
  const partilhasSync = [];
  let shareAntesDeMicrotask = false;
  let microtaskAntesShare = false;
  global.toast = () => {};
  global._nfeAnchorClicks = [];
  global.window = { open() { return {}; } };
  global.idbGet = async () => null;
  await apiSync.nfeIniciarPacoteWhatsapp(chave);
  Promise.resolve().then(() => { microtaskAntesShare = !shareAntesDeMicrotask; });
  porNavigator({
    userAgent: UA_ANDROID,
    maxTouchPoints: 5,
    canShare() { return true; },
    share(data) {
      shareAntesDeMicrotask = true;
      partilhasSync.push(data);
      return Promise.resolve();
    },
  });
  await apiSync.nfePartilharWhatsapp(chave);
  await Promise.resolve();
  assert(partilhasSync.length === 1, 'com cache síncrono chama share');
  assert(shareAntesDeMicrotask, 'share corre no toque com cache (sem await de fetch antes)');
  assert(!microtaskAntesShare, 'nenhuma microtask de fetch corre antes do share com cache');
  assert(global._nfeAnchorClicks.length === 0, 'cache síncrono com share a funcionar não descarrega');

  // 1.º toque frio (await) → não tenta share; marca pronto. 2.º toque partilha em sync.
  const partilhas2 = [];
  const toasts2 = [];
  global._nfeAnchorClicks = [];
  global.toast = (m) => { toasts2.push(String(m)); };
  global.window = { open() { return {}; } };
  porNavigator({
    userAgent: UA_ANDROID,
    maxTouchPoints: 5,
    canShare() { return true; },
    share(data) {
      partilhas2.push(data);
      return Promise.resolve();
    },
  });
  await api.nfePartilharWhatsapp(chave);
  assert(toasts2.some(t => t.indexOf('PDF pronto. Toca outra vez no WhatsApp') >= 0), 'após preparar async avisa o 2.º toque, veio ' + toasts2.join('|'));
  assert(!toasts2.some(t => t.indexOf('O PDF já está pronto. Toca outra vez no WhatsApp para escolher o contacto') >= 0), 'não usa o toast antigo em loop');
  assert(partilhas2.length === 0, 'o 1.º toque frio não chama share depois do await');
  toasts2.length = 0;
  await api.nfePartilharWhatsapp(chave);
  assert(partilhas2.length === 1, 'o 2.º toque chama share com o PDF em cache');
  const f2tap = partilhas2[0] && partilhas2[0].files && partilhas2[0].files[0];
  assert(f2tap instanceof File && f2tap.size > 0 && f2tap.type === 'application/pdf', 'o 2.º toque partilha um PDF não vazio');
  assert(Buffer.from(await f2tap.arrayBuffer()).equals(junto), 'o 2.º toque envia o PDF junto completo');
  assert(toasts2.length === 0, 'o 2.º toque com share a funcionar não mostra toast, veio ' + toasts2.join('|'));
  assert(global._nfeAnchorClicks.length === 0, 'o 2.º toque com share a funcionar não descarrega');

  // Cache quente + NotAllowedError / canShare falso → fallback descarga no mesmo toque (sem loop).
  const apiFall = loadNfeUi([nota], '', 'nfe');
  await apiFall.nfeIniciarPacoteWhatsapp(chave);
  const toastsFall = [];
  global._nfeAnchorClicks = [];
  const abertosFall = [];
  global.toast = (m) => { toastsFall.push(String(m)); };
  global.window = { open(url) { abertosFall.push(url); return {}; } };
  porNavigator({
    userAgent: 'Mozilla/5.0 (Linux; Android 12; SM-T500) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/20.0 Chrome/106.0.0.0 Safari/537.36',
    maxTouchPoints: 5,
    canShare() { return false; },
    share(data) {
      if (data && data.files) {
        const e = new Error('gesture');
        e.name = 'NotAllowedError';
        return Promise.reject(e);
      }
      return Promise.resolve();
    },
  });
  await apiFall.nfePartilharWhatsapp(chave);
  assert(global._nfeAnchorClicks.some(a => a.download === 'NF-99-boleto.pdf'), 'NotAllowedError com cache descarrega o PDF no mesmo toque');
  assert(toastsFall.some(t => t.indexOf('PDF descarregado. Abre o WhatsApp e anexa o ficheiro') >= 0), 'fallback avisa a descarga com o nome do ficheiro, veio ' + toastsFall.join('|'));
  assert(!toastsFall.some(t => t.indexOf('O PDF já está pronto. Toca outra vez') >= 0), 'NotAllowedError já não entra em loop de toast');
  assert(!abertosFall.some(u => /wa\.me|whatsapp:\/\//i.test(String(u))), 'fallback no tablet não abre wa.me só com texto');

  // PWA standalone: prefere descarga sem insistir no share com ficheiros.
  const apiPwa = loadNfeUi([nota], '', 'nfe');
  await apiPwa.nfeIniciarPacoteWhatsapp(chave);
  const toastsPwa = [];
  const partilhasPwa = [];
  global._nfeAnchorClicks = [];
  global.toast = (m) => { toastsPwa.push(String(m)); };
  global.window = {
    open() { return {}; },
    matchMedia(q) {
      return { matches: String(q).indexOf('standalone') >= 0, media: q, addListener() {}, removeListener() {} };
    },
  };
  porNavigator({
    userAgent: UA_ANDROID,
    maxTouchPoints: 5,
    standalone: true,
    canShare() { return true; },
    share(data) {
      partilhasPwa.push(data);
      return Promise.resolve();
    },
  });
  assert(apiPwa.nfeEhPwaStandalone(), 'detecta PWA standalone');
  await apiPwa.nfePartilharWhatsapp(chave);
  assert(!partilhasPwa.some(p => p && p.files && p.files.length), 'PWA standalone não tenta share com ficheiros');
  assert(global._nfeAnchorClicks.some(a => a.download === 'NF-99-boleto.pdf'), 'PWA standalone descarrega o PDF');
  assert(toastsPwa.some(t => t.indexOf('PDF descarregado. Abre o WhatsApp e anexa o ficheiro') >= 0), 'PWA standalone avisa a descarga');

  const toastsAbort = [];
  const apiAbort = loadNfeUi([nota], '', 'nfe');
  await apiAbort.nfeIniciarPacoteWhatsapp(chave);
  global.toast = (m) => { toastsAbort.push(String(m)); };
  const abertosAbort = [];
  global._nfeAnchorClicks = [];
  global.window = { open(url) { abertosAbort.push(url); return {}; } };
  porNavigator({
    userAgent: UA_ANDROID,
    maxTouchPoints: 5,
    canShare() { return true; },
    share() {
      const e = new Error('The user aborted a request.');
      e.name = 'AbortError';
      return Promise.reject(e);
    },
  });
  await apiAbort.nfePartilharWhatsapp(chave);
  assert(toastsAbort.length === 0, 'cancelar a folha de partilha não mostra toast');
  assert(abertosAbort.length === 0, 'cancelar no telemóvel não abre uma ligação só com texto');
  assert(global._nfeAnchorClicks.length === 0, 'cancelar não descarrega o PDF');
}

async function testPdfTabletNuvem() {
  const junto = Buffer.from('%PDF-1.4 nuvem-junto');
  const danfe = Buffer.from('%PDF-1.4 so-danfe');
  const chave = 'NUVEMTABLET1';
  function notaLeve() {
    return {
      chave: chave,
      numero: '55',
      serie: '1',
      canalId: 'horeca',
      canalNome: 'Horeca',
      cliente: 'Cliente Nuvem',
      valor: 1,
      data: '2026-10-21',
      status: 'unico',
      temPdf: true,
      temBoleto: true,
      temPdfJunto: true,
      pdfNome: 'danfe.pdf',
      pdfJuntoNome: 'NF-55-boleto.pdf',
      boletoNome: 'Boleto_55-1.pdf',
    };
  }
  const chunk = [{
    data: {
      __format: 'nfe_pdfs',
      pdfs: [{
        chave: chave,
        nome: 'danfe.pdf',
        b64: danfe.toString('base64'),
        juntoB64: junto.toString('base64'),
        juntoNome: 'NF-55-boleto.pdf',
        boletoB64: Buffer.from('%PDF-bol').toString('base64'),
        boletoNome: 'Boleto_55-1.pdf',
      }],
    },
  }];
  const fetches = [];
  global.LISTA_CLIENTES_SUPA_URL = 'https://example.test/lista_clientes';
  global.SUPA_KEY = 'test-key';
  global.fetch = async (url) => {
    fetches.push(String(url));
    return { ok: true, status: 200, json: async () => chunk };
  };
  global.idbGet = async () => null;
  const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const abertos = [];
  const blobs = [];
  if (!global.URL) global.URL = URL;
  global.URL.createObjectURL = (b) => {
    blobs.push(b);
    return 'blob:nfe-teste';
  };
  global.URL.revokeObjectURL = () => {};
  function popup() {
    const loc = {};
    Object.defineProperty(loc, 'href', { set(v) { abertos.push(v); }, configurable: true });
    loc.replace = (v) => { abertos.push(v); };
    return { closed: false, location: loc, close() { abertos.push('close'); } };
  }
  global.window = { open(url) { abertos.push(url); return url === 'about:blank' ? popup() : {}; } };
  function porNavigator(nav) {
    Object.defineProperty(global, 'navigator', { value: nav, configurable: true, writable: true });
  }
  porNavigator({ userAgent: UA_ANDROID, maxTouchPoints: 5, canShare() { return false; }, share() { return Promise.resolve(); } });
  const toastsAbrir = [];
  global.toast = (m) => { toastsAbrir.push(String(m)); };
  const apiAbrir = loadNfeUi([notaLeve()], '', 'nfe');
  await apiAbrir.nfeAbrirPdf(chave);
  assert(!toastsAbrir.some(t => /não tem PDF|nao tem pdf|sem pdf/i.test(t)), 'abrir com bloco na nuvem não diz que não tem PDF, veio ' + toastsAbrir.join('|'));
  assert(fetches.some(u => u.indexOf('nfe_pdfs_') >= 0 && u.indexOf('cs.') >= 0), 'abrir pede o bloco da nuvem, veio ' + fetches.join('|'));
  assert(abertos.indexOf('about:blank') === 0, 'no tablet a janela abre no toque, antes do PDF chegar');
  assert(blobs.some(b => b && b.size > 0), 'abrir recebe um PDF não vazio');
  const aberto = blobs.find(b => b && b.size > 0);
  assert(Buffer.from(await aberto.arrayBuffer()).equals(junto), 'o número abre o PDF junto que estava só no bloco');

  const partilhas = [];
  blobs.length = 0;
  fetches.length = 0;
  porNavigator({
    userAgent: UA_ANDROID,
    maxTouchPoints: 5,
    canShare(data) { return !!(data && data.files && data.files[0] && data.files[0].size > 0); },
    share(data) { partilhas.push(data); return Promise.resolve(); },
  });
  const toastsWa = [];
  global.toast = (m) => { toastsWa.push(String(m)); };
  const apiWa = loadNfeUi([notaLeve()], '', 'nfe');
  await apiWa.nfeIniciarPacoteWhatsapp(chave);
  assert(fetches.some(u => u.indexOf('nfe_pdfs_') >= 0), 'partilhar também lê o bloco quando a memória e o IndexedDB estão vazios');
  await apiWa.nfePartilharWhatsapp(chave);
  assert(!toastsWa.some(t => /não tem PDF|nao tem pdf|sem pdf/i.test(t)), 'WhatsApp com bloco na nuvem não diz que não tem PDF, veio ' + toastsWa.join('|'));
  const f = partilhas[0] && partilhas[0].files && partilhas[0].files[0];
  assert(f && f.size > 0 && f.type === 'application/pdf', 'o tablet partilha um PDF não vazio');
  assert(Buffer.from(await f.arrayBuffer()).equals(junto), 'o WhatsApp recebe o PDF junto do bloco, não um ficheiro vazio');

  blobs.length = 0;
  const abertosPc = [];
  global._nfeAnchorClicks = [];
  global.window = { open(url) { abertosPc.push(url); return {}; } };
  porNavigator({
    userAgent: UA_DESKTOP,
    maxTouchPoints: 0,
    canShare() { return false; },
    share() { throw new Error('no PC sem partilha de ficheiro o share não corre'); },
  });
  const toastsPc = [];
  global.toast = (m) => { toastsPc.push(String(m)); };
  const apiPc = loadNfeUi([notaLeve()], '', 'nfe');
  await apiPc.nfePartilharWhatsapp(chave);
  assert(toastsPc.some(t => t.indexOf('Neste browser o PDF foi descarregado para anexar no WhatsApp') >= 0), 'no PC o aviso de descarga mantém-se, veio ' + toastsPc.join('|'));
  assert(abertosPc.some(u => String(u).indexOf('https://wa.me/?text=') === 0), 'no PC continua a abrir o WhatsApp');
  const pcBlob = blobs.find(b => b && b.size > 0);
  assert(pcBlob && pcBlob.size > 0 && Buffer.from(await pcBlob.arrayBuffer()).equals(junto), 'no PC o PDF descarregado para anexar não está vazio');

  fetches.length = 0;
  global.fetch = async () => { fetches.push('falha'); throw new Error('offline'); };
  const toastsFalha = [];
  global.toast = (m) => { toastsFalha.push(String(m)); };
  global.window = { open() { return { close() {}, closed: true, location: null }; } };
  porNavigator({ userAgent: UA_DESKTOP, maxTouchPoints: 0 });
  const apiFalha = loadNfeUi([notaLeve()], '', 'nfe');
  await apiFalha.nfeAbrirPdf(chave);
  await apiFalha.nfePartilharWhatsapp(chave);
  assert(toastsFalha.length >= 2 && toastsFalha.every(t => t.indexOf('Não consegui ler o PDF na nuvem') >= 0), 'se o bloco falha e a marca existe, não diz que o PDF não foi carregado, veio ' + toastsFalha.join('|'));
  assert(!toastsFalha.some(t => t.indexOf('Esta NF não tem PDF') >= 0), 'falha de leitura não usa a mensagem de NF sem PDF');

  global.fetch = async () => ({ ok: true, status: 200, json: async () => [] });
  const toastsVazio = [];
  global.toast = (m) => { toastsVazio.push(String(m)); };
  const apiVazio = loadNfeUi([notaLeve()], '', 'nfe');
  await apiVazio.nfeAbrirPdf(chave);
  assert(toastsVazio.some(t => t.indexOf('não tem o PDF na nuvem') >= 0), 'bloco vazio com marca diz que o PDF não está na nuvem, veio ' + toastsVazio.join('|'));
  assert(!toastsVazio.some(t => t.indexOf('Esta NF não tem PDF.') >= 0), 'bloco vazio não usa a mensagem genérica');
}

testMesesQuentesHotPath()
  .then(() => testCliqueSemPdf())
  .then(() => testBoletosPdf())
  .then(() => testBoletosParcelas())
  .then(() => testWhatsappPdf())
  .then(() => testPdfTabletNuvem())
  .then(() => {
    if (failed) {
      console.error(failed + ' asserção(ões) falharam');
      process.exit(1);
    }
    console.log('ok');
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
