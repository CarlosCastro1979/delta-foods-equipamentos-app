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

testAtribuicao();
testXmlAvulso();
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
