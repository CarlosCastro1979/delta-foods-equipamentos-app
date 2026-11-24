#!/usr/bin/env node
/**
 * Prémios Equipa: mensal ≥100%, comissão 2,3% acima 55k, trim + recuperação.
 */
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pe = require(path.join(root, 'premios-equipa.js'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

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

check('UI: separador Prémios Equipa ao lado de Comissão de RC', () => {
  assert.ok(html.includes("showAreaFinanceira('premios-equipa')"));
  assert.ok(html.includes('id="af-sec-premios-equipa"'));
  assert.ok(html.includes('id="af-tab-pe"'));
  assert.ok(html.includes('premios-equipa.js'));
  const iRc = html.indexOf("showAreaFinanceira('comissao-rc')");
  const iPe = html.indexOf("showAreaFinanceira('premios-equipa')");
  assert.ok(iRc > 0 && iPe > iRc, 'tab Prémios depois de Comissão RC');
  assert.ok(html.includes("'premios-equipa': 'af-sec-premios-equipa'"));
  assert.ok(html.includes('renderPremiosEquipa'));
});

check('pacotes 2026: valores mensais/trim e comissão só Hélcio/Daniela', () => {
  const by = Object.fromEntries(pe.PREMIOS_EQUIPA_PESSOAS.map(p => [p.id, p]));
  assert.equal(by.marcio.mensal, 500);
  assert.equal(by.marcio.trim, 1000);
  assert.equal(by.massimo.mensal, 3000);
  assert.equal(by.eduardo.mensal, 3000);
  assert.equal(by.diogo.mensal, 3000);
  assert.equal(by.filipe.mensal, 3000);
  assert.equal(by.filipe.scope, 'filipe_equipa');
  assert.equal(by.helcio.mensal, 1300);
  assert.equal(by.helcio.trim, 1600);
  assert.equal(by.helcio.comissao, true);
  assert.equal(by.daniela.mensal, 1300);
  assert.equal(by.daniela.trim, 1600);
  assert.equal(by.daniela.comissao, true);
  assert.equal(by.paulo.mensal, 1650);
  assert.equal(by.paulo.trim, 2050);
  assert.equal(by.paulo.comissao, false);
  assert.equal(pe.PREMIOS_LIMIAR_COMISSAO, 55000);
  assert.equal(pe.PREMIOS_TAXA_COMISSAO, 0.023);
});

check('mensal: ≥100% paga; <100% zero; sem obj zero', () => {
  assert.equal(pe.premiosValorMensal(1, 3000), 3000);
  assert.equal(pe.premiosValorMensal(1.05, 3000), 3000);
  assert.equal(pe.premiosValorMensal(0.99, 3000), 0);
  assert.equal(pe.premiosValorMensal(null, 3000), 0);
  assert.equal(pe.premiosPctCumprimento(100, 100), 1);
  assert.equal(pe.premiosPctCumprimento(50, 100), 0.5);
  assert.equal(pe.premiosPctCumprimento(50, null), null);
});

check('var. obj. %: (N−obj)/obj — Excel/menu, não base 100', () => {
  assert.ok(Math.abs(pe.premiosVarObjPct(339848.80, 350129) - ((339848.80 - 350129) / 350129)) < 1e-9);
  assert.ok(pe.premiosVarObjPct(339848.80, 350129) < 0); // Set Filipe ≈ −3%
  assert.ok(Math.abs(pe.premiosVarObjPct(118, 100) - 0.18) < 1e-9);
  assert.equal(pe.peFmtVarObj(-0.03), '−3%');
  assert.equal(pe.peFmtVarObj(0.186), '+18,6%');
  assert.equal(pe.peFmtVarObj(0), '0%');
  // Cumprimento 0.97 (= −3%) NÃO paga
  assert.equal(pe.premiosValorMensal(pe.premiosPctCumprimento(339848.80, 350129), 3000), 0);
});

check('YYYY-MM → mês 1–12 (sem off-by-one: Set=9 não 8)', () => {
  assert.deepEqual(pe.premiosYmParaMesAno('2026-09'), { ano: 2026, mes: 9 });
  assert.deepEqual(pe.premiosYmParaMesAno('2026-01'), { ano: 2026, mes: 1 });
  assert.deepEqual(pe.premiosYmParaMesAno('2026-12'), { ano: 2026, mes: 12 });
});

check('comissão: (fat−55k)×2,3%; abaixo de 55k = 0', () => {
  assert.equal(pe.premiosComissaoExcedente(54999), 0);
  assert.equal(pe.premiosComissaoExcedente(55000), 0);
  const c = pe.premiosComissaoExcedente(92055);
  assert.ok(Math.abs(c - (92055 - 55000) * 0.023) < 0.001);
  // typo Abril Excel (5500) NÃO se replica
  assert.ok(pe.premiosComissaoExcedente(92055, 5500) > pe.premiosComissaoExcedente(92055));
});

check('trimestre: recuperação = tecto − já pago; só se fechou trim', () => {
  assert.equal(pe.premiosTectoTrim(3000), 9000);
  assert.equal(pe.premiosRecuperacaoTrim(false, [0, 0, 3000], 9000), 0);
  assert.equal(pe.premiosRecuperacaoTrim(true, [0, 0, 3000], 9000), 6000);
  assert.equal(pe.premiosRecuperacaoTrim(true, [3000, 3000, 3000], 9000), 0);
  assert.equal(pe.premiosRecuperacaoTrim(true, [3000, 0, 3000], 9000), 3000);
  assert.equal(pe.premiosValorTrim(true, 1600), 1600);
  assert.equal(pe.premiosValorTrim(false, 1600), 0);
});

check('Massimo Jan falhou / Fev falhou / Mar ok + trim ok → recuperação 6000', () => {
  const cfg = { id: 'massimo', nome: 'Massimo', mensal: 3000, trim: 3000, comissao: false };
  const serie = [
    { vendas: 100, obj: 200, temVendas: true }, // 50%
    { vendas: 100, obj: 200, temVendas: true }, // 50%
    { vendas: 700, obj: 200, temVendas: true }, // 350% → trim ok
  ];
  // pad rest
  while (serie.length < 12) serie.push({ vendas: 0, obj: null, temVendas: false });
  const mar = pe.premiosCalcularPessoaMes(cfg, serie, 2);
  assert.equal(mar.premio, 3000);
  assert.ok(mar.atingiuTrim);
  assert.equal(mar.premioTrim, 3000);
  assert.equal(mar.recuperacao, 6000);
  assert.equal(mar.totalFecho, 3000 + 6000 + 3000);
  assert.equal(mar.ehFechoTrim, true);
});

check('Hélcio: prémio + comissão no mesmo mês', () => {
  const cfg = { id: 'helcio', nome: 'Hélcio', mensal: 1300, trim: 1600, comissao: true };
  const serie = Array.from({ length: 12 }, () => ({ vendas: 0, obj: null, temVendas: false }));
  serie[0] = { vendas: 92055, obj: 80000, temVendas: true };
  const jan = pe.premiosCalcularPessoaMes(cfg, serie, 0);
  assert.equal(jan.premio, 1300);
  assert.ok(Math.abs(jan.comissao - (92055 - 55000) * 0.023) < 0.001);
  assert.ok(Math.abs(jan.totalMes - (1300 + jan.comissao)) < 0.001);
  assert.equal(jan.ehFechoTrim, false);
});

check('Marcio 99% → 0; 100% → 500', () => {
  const cfg = { id: 'marcio', nome: 'Marcio', mensal: 500, trim: 1000, comissao: false };
  const serie = Array.from({ length: 12 }, () => ({ vendas: 0, obj: null, temVendas: false }));
  serie[3] = { vendas: 99, obj: 100, temVendas: true };
  assert.equal(pe.premiosCalcularPessoaMes(cfg, serie, 3).premio, 0);
  serie[3] = { vendas: 100, obj: 100, temVendas: true };
  assert.equal(pe.premiosCalcularPessoaMes(cfg, serie, 3).premio, 500);
});

check('fecho trim: Var. trim. % + Total a Pagar; Outlook sem forceEmlFallback', () => {
  const js = fs.readFileSync(path.join(root, 'premios-equipa.js'), 'utf8');
  assert.ok(js.includes('Var. trim. %'));
  assert.ok(js.includes('Total a Pagar'));
  assert.ok(!js.includes('Total fecho'));
  assert.ok(js.includes('varPctTrim'));
  assert.ok(js.includes('premiosCalcularScorecard'));
  assert.ok(js.includes('premiosEquipaExportarEmail'));
  assert.ok(!/forceEmlFallback\s*:/.test(js), 'seguir padrão Comissão RC — ponte Outlook, não .eml em Transferências');
  assert.ok(html.includes('premiosEquipaExportarEmail()'));
  assert.ok(html.includes("showPremiosEquipaSub('scorecard')"));
  assert.ok(html.includes('id="pe-btn-email"'));
});

check('scorecard: ganhos÷tecto; comissão fora; tecto = 12×mensal+4×trim', () => {
  assert.equal(pe.premiosTectoAnual({ mensal: 3000, trim: 3000 }), 12 * 3000 + 4 * 3000);
  assert.equal(pe.premiosTectoAteMes({ mensal: 3000, trim: 3000 }, 2), 3 * 3000 + 1 * 3000); // Jan–Mar
  assert.equal(pe.premiosTectoAteMes({ mensal: 3000, trim: 3000 }, 8), 9 * 3000 + 3 * 3000); // Jan–Set
  const cfg = { id: 'x', nome: 'X', mensal: 3000, trim: 3000, comissao: false };
  const serie = Array.from({ length: 12 }, () => ({ vendas: 200, obj: 100, temVendas: true }));
  // todos os meses batem → 9×3000 + 3×3000 trim (Set) se ate=8; recuperação 0
  const ganhos = pe.premiosGanhosAteMes(cfg, serie, 8);
  assert.equal(ganhos, 9 * 3000 + 3 * 3000);
  const score = pe.premiosCalcularScorecard([cfg], { x: serie }, 8);
  assert.equal(score.linhas[0].acumPct, 1);
});

check('email: saudação + frase com mês + Obrigado + remetente; To vazio', () => {
  const cfg = { id: 'diogo', nome: 'Diogo', mensal: 3000, trim: 3000, comissao: false };
  const serie = Array.from({ length: 12 }, () => ({ vendas: 50, obj: 100, temVendas: true }));
  const modelo = pe.premiosCalcularQuadro([Object.assign({}, cfg, { id: 'diogo' })], { diogo: serie }, 8);
  // fix id in serie map
  const modelo2 = pe.premiosCalcularQuadro(
    [{ id: 'diogo', nome: 'Diogo Oliveira', mensal: 3000, trim: 3000, comissao: false }],
    { diogo: serie },
    8
  );
  const email = pe.peMontarEmail({
    modelo: modelo2,
    mesIdx: 8,
    ano: 2026,
    remetente: 'Carlos Castro',
    agora: new Date(2026, 8, 15, 15, 0, 0),
  });
  assert.equal(email.to, '');
  assert.ok(email.subject.includes('Setembro'));
  assert.ok(email.html.includes('Boa tarde'));
  assert.ok(email.html.includes('apuração do prémio referente ao mês Setembro'));
  assert.ok(email.html.includes('contabilização e pagamento'));
  assert.ok(email.html.includes('Obrigado'));
  assert.ok(email.html.includes('Carlos Castro'));
  assert.ok(email.filename.includes('2026-09'));
});

check('scorecard email: só tabela, sem saudação', () => {
  const js = fs.readFileSync(path.join(root, 'premios-equipa.js'), 'utf8');
  assert.ok(js.includes('peScorecardTabelaHtml'));
  assert.ok(js.includes('Scorecard: só a tabela'));
});

check('Cache SW / dfb-build alinhados (premios-outlook-padrao)', () => {
  assert.ok(html.includes('v2026-11-23-premios-outlook-padrao'));
  assert.ok(sw.includes('v2026-11-23-premios-outlook-padrao'));
  assert.ok(/<!--\s*dfb-build:[^>]*premios-outlook-padrao[^>]*-->/.test(html.slice(0, 400)));
});

if (!process.exitCode) console.log('\nTodos os testes Prémios Equipa passaram.');
