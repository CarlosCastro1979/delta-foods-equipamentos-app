#!/usr/bin/env node
/**
 * Accuracy de fecho: compara Previsão vs N (fecho real), simétrica, ≤ 100%.
 * Não é atingimento (N / Previsão), que passava de 100% quando se fechava acima.
 */
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('Função em falta: ' + name);
  const paren = src.indexOf('(', start);
  let depth = 0;
  let bodyBrace = -1;
  for (let i = paren; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        bodyBrace = src.indexOf('{', i);
        break;
      }
    }
  }
  if (bodyBrace < 0) throw new Error('Corpo em falta: ' + name);
  depth = 0;
  for (let i = bodyBrace; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('Chaveta não fechou: ' + name);
}

function check(title, fn) {
  try {
    fn();
    console.log('OK  ' + title);
  } catch (e) {
    console.error('FAIL ' + title);
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }
}

const context = { console, Math, Number, String };
vm.createContext(context);
for (const name of ['pvAccuracyPct', 'pvFmtAccuracy', 'pvAccuracyMedia']) {
  vm.runInContext(extractFn(html, name), context);
}

const { pvAccuracyPct, pvFmtAccuracy, pvAccuracyMedia } = context;

function excelCell(v) {
  return v == null ? '' : Math.round(v);
}

check('N=115 Prev=100 → accuracy < 100 (não 115)', () => {
  const acc = pvAccuracyPct({ prevFecho: 100, n: 115 });
  assert.ok(acc != null, 'devia calcular');
  assert.ok(acc < 100, 'overshoot não pode ser ≥100, veio ' + acc);
  assert.notEqual(acc, 115);
  assert.equal(acc, 85);
});

check('N=Prev → 100', () => {
  assert.equal(pvAccuracyPct({ prevFecho: 100, n: 100 }), 100);
  assert.equal(pvAccuracyPct({ prevFecho: 858000, n: 858000 }), 100);
});

check('N=0 Prev=100 → 0', () => {
  assert.equal(pvAccuracyPct({ prevFecho: 100, n: 0 }), 0);
  assert.equal(pvFmtAccuracy(0), '<span style="color:#b91c1c;font-weight:600;">0%</span>');
});

check('em falta → null e «—»', () => {
  assert.equal(pvAccuracyPct({ prevFecho: 100, n: null }), null);
  assert.equal(pvAccuracyPct({ prevFecho: 100, n: '' }), null);
  assert.equal(pvAccuracyPct({ prevFecho: null, n: 100 }), null);
  assert.equal(pvAccuracyPct({ prevFecho: '', n: 50 }), null);
  assert.equal(pvAccuracyPct({ prevFecho: 0, n: 0 }), null);
  assert.equal(pvAccuracyPct({}), null);
  assert.equal(pvFmtAccuracy(null), '—');
  assert.equal(pvFmtAccuracy(undefined), '—');
  assert.equal(excelCell(pvAccuracyPct({ prevFecho: 100, n: null })), '');
});

check('overshoot 188% estilo Site Próprio → longe de 188 e ≤100', () => {
  const acc = pvAccuracyPct({ prevFecho: 100, n: 188 });
  assert.equal(acc, 12);
  assert.ok(acc < 100);
});

check('undershoot 38% mantém-se 38 (simétrico no lado abaixo)', () => {
  assert.equal(pvAccuracyPct({ prevFecho: 100, n: 38 }), 38);
});

check('erro absoluto > previsão → 0 (clamp)', () => {
  assert.equal(pvAccuracyPct({ prevFecho: 100, n: 250 }), 0);
});

check('Excel nunca exporta 115 nem 188 num overshoot', () => {
  const over = excelCell(pvAccuracyPct({ prevFecho: 100, n: 115 }));
  const site = excelCell(pvAccuracyPct({ prevFecho: 100, n: 188 }));
  assert.ok(over !== '' && over < 100 && over !== 115);
  assert.ok(site !== '' && site < 100 && site !== 188);
  assert.equal(excelCell(pvAccuracyPct({ prevFecho: 100, n: 100 })), 100);
});

check('média ignora meses vazios e fica ≤100', () => {
  assert.equal(pvAccuracyMedia({}), null);
  assert.equal(pvAccuracyMedia({ 0: null, 1: undefined }), null);
  const media = pvAccuracyMedia({
    0: pvAccuracyPct({ prevFecho: 100, n: 115 }),
    1: pvAccuracyPct({ prevFecho: 100, n: 100 }),
    2: null,
  });
  assert.equal(media, 92.5);
  assert.ok(media <= 100);
});

check('≥85% verde, <85% vermelho', () => {
  const ok = pvFmtAccuracy(85);
  const bad = pvFmtAccuracy(84);
  assert.ok(ok.includes('#15803d'));
  assert.ok(ok.includes('85%'));
  assert.ok(bad.includes('#b91c1c'));
});

check('UI documenta a fórmula simétrica, não N÷Previsão', () => {
  assert.ok(html.includes('100 × (1 − |N − Previsão| / Previsão)'));
  assert.ok(html.includes('limitado a 0–100'));
  assert.ok(!html.includes('Accuracy = N ÷ Previsão'));
  assert.ok(!html.includes('Accuracy = N÷Previsão'));
  assert.ok(!html.includes('% = N ÷ Previsão'));
  assert.ok(!html.includes('aqui só vês o atingimento'));
  assert.ok(html.includes('não é atingimento'));
});

if (process.exitCode) {
  console.error('\nAlguns testes falharam.');
} else {
  console.log('\nTodos os testes de accuracy passaram.');
}
