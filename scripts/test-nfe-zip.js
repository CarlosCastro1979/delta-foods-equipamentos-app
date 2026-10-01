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
  assert(dados.includes('ZIP de XML da TTI'), 'Dados descreve o ZIP de XML da TTI');
  assert(dados.includes('cockpit TTIN'), 'explica que o ficheiro sai do cockpit TTIN');
  assert(dados.includes('id="dados-nfe-input"'), 'o botão de carregar está no Dados');
  assert(dados.includes('Selecionar ZIP de XML da TTI'), 'o texto do botão é o ZIP de XML da TTI');
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
  assert(html.includes('v2026-10-01-vendas-atualizado-ate'), 'service worker referido no index');
  assert(sw.includes('v2026-10-01-vendas-atualizado-ate'), 'service worker actualizado');

  const homeDados = html.slice(html.indexOf('class="home-dados-card"'), html.indexOf('class="home-dados-card"') + 700);
  assert(homeDados.includes('ZIP de XML da TTI'), 'o cartão Dados na home fala do ZIP de XML da TTI');
}

testAtribuicao();
testCpfMarcio();
testMenuCanal();
testHorecaNaoListaEcommerce();
testXmlAvulso();
testUiCarga();
const zipPath = findZip();
if (!zipPath) {
  console.log('SKIP zip: ficheiro do cockpit não está no repo (dados de clientes).');
} else {
  testZip(zipPath);
}

if (failed) {
  console.error(failed + ' asserção(ões) falharam');
  process.exit(1);
}
console.log('ok');
