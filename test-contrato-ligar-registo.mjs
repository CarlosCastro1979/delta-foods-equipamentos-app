#!/usr/bin/env node
/**
 * Gerar contrato grava o registo: consumo, Tag = Nº Série, NF.
 * Horeca → contratos + equipamentos. Dist → dist_contratos.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.dirname(fileURLToPath(import.meta.url));
const CACHE = 'v2026-11-25-contrato-no-registo';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.ok(html.includes(CACHE), 'index cache');
assert.ok(sw.includes(CACHE), 'sw cache');
assert.ok(html.includes('function ctMontarRegistoDoContrato('), 'montador');
assert.ok(html.includes('const gravado = await ctGuardarContratoSuapbase(data);'), 'ctGerar espera a gravação');
assert.ok(html.includes('data.ANEXO_I'), 'anexo I cru para o registo');

const gerar = html.slice(html.indexOf('async function ctGerar('), html.indexOf('function ctBuildDocumentXml('));
const iAwait = gerar.indexOf('await ctGuardarContratoSuapbase');
const iClear = gerar.indexOf('ctClearDraft');
const iMail = gerar.indexOf('ctAbrirEmail');
assert.ok(iAwait > 0 && iClear > iAwait && iMail > iClear, 'limpa o rascunho e abre o email só depois de gravar');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('Função em falta: ' + name);
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('Chaveta não fechou: ' + name);
}

const names = [
  'ctUnidadeRegisto',
  'ctTipoMaquinaContrato',
  'ctTagMaquinaContrato',
  'ctNfMaquinaContrato',
  'ctEquipamentosDoAnexoI',
  'ctInicioMesActual',
  'ctLinhaContratoDoGerador',
  'ctJuntarEquipamentos',
  'ctJuntarDistContratos',
  'ctEquipamentosPlanosDist',
  'ctClienteJaTemEsteNumero',
  'ctMontarRegistoDoContrato',
];
const ctx = { console, String, Number, parseInt, Array, Object, Date, RegExp };
vm.createContext(ctx);
vm.runInContext(names.map(n => extractFn(html, n)).join('\n'), ctx);

const base = {
  COMOD_COD: '406016',
  COMOD_EMPRESA: 'F. J. RIBEIRO CAFÉ',
  NUM_CONTRATO: 'B0100/26',
  VENDEDOR: 'EDUARDO MADEIRA',
  DURACAO_NUM: '24',
  DIAS_PAG_NUM: '30',
  GAMAS: [
    { lote: 'Qonvicta', unidade: 'Caps', qtd: '120' },
    { lote: 'Grão', unidade: 'Kg', qtd: '8' },
  ],
  ANEXO_I: [
    { tipo: 'MAQ.MAYOR DIG.2 GR PRETA', tag: 'TG-441', nf: '99881' },
  ],
  A2_R1_DESC: 'Bem investimento que não é máquina',
  A2_R1_SERIE: 'NAO-TAG',
};

const plain = (v) => JSON.parse(JSON.stringify(v));
const novo = plain(ctx.ctMontarRegistoDoContrato(base, { dist: false, inicio: '2026-11', sap: { cep: '88301-320' } }));
assert.equal(novo.acao, 'post');
assert.equal(novo.body.contrato, 'B0100/26');
assert.equal(novo.body.cep, '88301-320');
assert.equal(novo.body.contratos.length, 1);
assert.equal(novo.body.contratos[0].consumo, 120);
assert.equal(novo.body.contratos[0].unidade, 'Capsulas');
assert.equal(novo.body.contratos[0].duracao, 24);
assert.equal(novo.body.contratos[0].pdv, 'unico');
assert.equal(novo.body.contratos[0].inicio, '2026-11');
assert.equal(novo.body.contratos[0].gamas.length, 2);
assert.equal(novo.body.contratos[0].gamas[1].unidade, 'Kg');
assert.equal(novo.body.contratos[0].gamas[1].consumo, 8);
assert.deepEqual(novo.body.equipamentos, [
  { tipo: 'MAQ.MAYOR DIG.2 GR PRETA', tag: 'TG-441', nf: '99881' },
]);
assert.equal(novo.body.tem_comodato, undefined);

const comPrefixo = plain(ctx.ctMontarRegistoDoContrato({
  ...base,
  ANEXO_I: undefined,
  A1_R1_DESC: 'Gama 1 — Qonvicta (Caps) — MAQ.MAYOR DIG.2 GR PRETA',
  A1_R1_SERIE: 'TG-441',
  A1_R1_NF: '99881',
  A2_R1_DESC: 'Investimento',
  A2_R1_SERIE: 'NAO',
}, { dist: false, inicio: '2026-11' }));
assert.equal(comPrefixo.body.equipamentos[0].tipo, 'MAQ.MAYOR DIG.2 GR PRETA');
assert.equal(comPrefixo.body.equipamentos[0].tag, 'TG-441');
assert.equal(comPrefixo.body.equipamentos.length, 1);

const existente = {
  id: 'reg-1',
  cod: '406016',
  nome: 'F. J. RIBEIRO CAFÉ',
  vendedor: 'EDUARDO MADEIRA',
  cep: '88301-320',
  contrato: 'B0001/24',
  contratos: [{ num: 'B0001/24', inicio: '2024-01', consumo: 10, duracao: 12, unidade: 'Capsulas', pdv: 'unico' }],
  equipamentos: [{ tipo: 'MÁQUINA ANTIGA', tag: 'OLD-1' }],
};
const merge = plain(ctx.ctMontarRegistoDoContrato(base, { dist: false, existente, inicio: '2026-11' }));
assert.equal(merge.acao, 'patch');
assert.equal(merge.id, 'reg-1');
assert.equal(merge.body.contrato, 'B0100/26');
assert.deepEqual(merge.body.contratos.map(c => c.num), ['B0001/24', 'B0100/26']);
assert.equal(merge.body.equipamentos.length, 2);
assert.equal(merge.body.equipamentos[0].tag, 'OLD-1');
assert.equal(merge.body.equipamentos[1].tag, 'TG-441');

const dup = plain(ctx.ctMontarRegistoDoContrato(base, {
  dist: false,
  existente: { ...existente, contratos: [{ num: 'B0100/26', consumo: 1, duracao: 12, inicio: '2025-01' }] },
  inicio: '2026-11',
}));
assert.ok(dup.error, 'não duplica o mesmo número');
assert.equal(dup.body, undefined);

const distNovo = plain(ctx.ctMontarRegistoDoContrato(base, { dist: true, inicio: '2026-11', sap: { cep: '88301-320' } }));
assert.equal(distNovo.acao, 'post');
assert.equal(distNovo.body.tem_comodato, true);
assert.equal(distNovo.body.dist_contratos.length, 1);
assert.equal(distNovo.body.dist_contratos[0].numero, 'B0100/26');
assert.equal(distNovo.body.dist_contratos[0].equipamentos[0].tag, 'TG-441');
assert.equal(distNovo.body.dist_contratos[0].equipamentos[0].nf, '99881');
assert.equal(distNovo.body.dist_contratos[0].equipamentos[0].origem, 'contrato');
assert.equal(distNovo.body.equipamentos[0].tag, 'TG-441');
assert.equal(distNovo.body.contratos.length, 0);

const distMerge = plain(ctx.ctMontarRegistoDoContrato(base, {
  dist: true,
  inicio: '2026-11',
  existente: {
    id: 'd1',
    cod: '406016',
    nome: 'F. J. RIBEIRO CAFÉ',
    vendedor: 'EDUARDO MADEIRA',
    cep: '88301-320',
    tem_comodato: true,
    contrato: 'B0009/25',
    dist_contratos: [{
      numero: 'B0009/25',
      equipamentos: [{ tipo: 'MAQ ANTIGA', tag: 'T-9', nf: '111', origem: 'carga' }],
    }],
    equipamentos: [{ tipo: 'MAQ ANTIGA', tag: 'T-9', nf: '111' }],
  },
}));
assert.equal(distMerge.acao, 'patch');
assert.deepEqual(distMerge.body.dist_contratos.map(c => c.numero), ['B0009/25', 'B0100/26']);
assert.equal(distMerge.body.dist_contratos[0].equipamentos[0].tag, 'T-9');
assert.equal(distMerge.body.equipamentos.length, 2);

const distSem = plain(ctx.ctMontarRegistoDoContrato(base, {
  dist: true,
  inicio: '2026-11',
  existente: {
    id: 'd2',
    cod: '431363',
    nome: 'MONDO',
    vendedor: 'MASSIMO BOTTELLO',
    cep: '60862-515',
    tem_comodato: false,
    contrato: 'SEM_COMODATO',
    dist_contratos: [],
    equipamentos: [],
  },
}));
assert.equal(distSem.body.tem_comodato, true);
assert.equal(distSem.body.contrato, 'B0100/26');
assert.equal(distSem.body.dist_contratos[0].equipamentos[0].tag, 'TG-441');

console.log('ok contrato ligado ao registo');
