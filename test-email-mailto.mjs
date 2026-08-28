#!/usr/bin/env node
/**
 * Regressões do chamado AT no tablet:
 *  - Gmail «Verificar endereço de email» (CC com ponto-e-vírgula)
 *  - Corpo «Pedido Delta Foods» (tablet tratado como PC / stub de 1800 chars)
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
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('Chaveta não fechou: ' + name);
}

const names = [
  'outlookSanitizeEmail',
  'outlookMailtoAddrList',
  'remetenteEhDiogo',
  'ccString',
  'mailtoAddr',
  'mailtoToPath',
  'ccMailtoParam',
  'outlookReadNav',
  'outlookIsAndroid',
  'outlookIsIosLike',
  'outlookIsWindowsPc',
  'outlookIsMobileClient',
];

let horeca = true;
let varejo = false;
let utilizador = 'Carlos Castro';
const EMAILS = {
  'DIOGO OLIVEIRA': 'diogo.oliveira@deltafoodsbrasil.com.br',
  'CARLOS CASTRO': 'carlos.castro@deltafoodsbrasil.com.br',
  'FILIPE NEVES': 'filipe.neves@deltafoodsbrasil.com.br',
};
const context = {
  CC_FIXO_FILIPE: 'filipe.neves@deltafoodsbrasil.com.br',
  CC_FIXO_DIOGO: 'diogo.oliveira@deltafoodsbrasil.com.br',
  isCanalHorecaActivo: () => horeca,
  isCanalVarejoActivo: () => varejo,
  getUtilizadorAtual: () => utilizador,
  getEmailUtilizador: (nome) => {
    const k = String(nome || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    return EMAILS[k] || '';
  },
  console,
  Date,
};
vm.createContext(context);
for (const name of names) {
  vm.runInContext(extractFn(html, name), context);
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

// ── Gmail: vírgulas no mailto, nunca ';' ──────────────────────────────────
check('lista parte CC com ; em endereços distintos', () => {
  const list = context.outlookMailtoAddrList(
    'carlos.castro@deltafoodsbrasil.com.br; ricardo.vicentesilva@deltafoodsbrasil.com.br; daniela.silva@deltafoodsbrasil.com.br; filipe.neves@deltafoodsbrasil.com.br'
  );
  assert.equal(list.length, 4);
  assert.ok(list.every(e => e.includes('@') && !e.includes(';')));
});

check('To do chamado AT não leva %40 no path', () => {
  const to = context.mailtoToPath('info.br@gruponabeiro.com');
  assert.equal(to, 'info.br@gruponabeiro.com');
});

check('To com ; vira vírgulas (RFC 6068)', () => {
  const to = context.mailtoToPath(
    'andrea.albuquerque@deltafoodsbrasil.com.br; daniela.kucinski@deltafoodsbrasil.com.br'
  );
  assert.equal(
    to,
    'andrea.albuquerque@deltafoodsbrasil.com.br,daniela.kucinski@deltafoodsbrasil.com.br'
  );
});

function countAddr(s, needle) {
  return String(s || '').split(/[,;]/).filter(e => e.toLowerCase().includes(needle)).length;
}

check('cc mailto do chamado (Horeca) — Gmail não vê ponto-e-vírgula', () => {
  horeca = true;
  varejo = false;
  const param = context.ccMailtoParam([
    'carlos.castro@deltafoodsbrasil.com.br',
    'ricardo.vicentesilva@deltafoodsbrasil.com.br',
    'daniela.silva@deltafoodsbrasil.com.br',
  ]);
  assert.ok(param.startsWith('cc='));
  const raw = param.slice(3);
  assert.equal(raw.indexOf('%3B'), -1, 'cc mailto não pode ter ; encoded');
  assert.equal(raw.indexOf(';'), -1, 'cc mailto não pode ter ; cru');
  const decoded = decodeURIComponent(raw);
  assert.equal(decoded.indexOf(';'), -1);
  assert.ok(decoded.includes(','));
  assert.ok(decoded.includes('filipe.neves@deltafoodsbrasil.com.br'));
  assert.ok(decoded.includes('daniela.silva@deltafoodsbrasil.com.br'));
  assert.ok(!decoded.toLowerCase().includes('diogo.oliveira'), 'Horeca não força Diogo');
});

check('cc .eml (ccString) continua com ; para Outlook desktop', () => {
  horeca = true;
  varejo = false;
  const s = context.ccString(['carlos.castro@deltafoodsbrasil.com.br']);
  assert.ok(s.includes(';') || s.includes('filipe.neves@deltafoodsbrasil.com.br'));
  assert.ok(s.includes('carlos.castro@deltafoodsbrasil.com.br'));
});

check('Horeca: Filipe em CC, Diogo não é forçado (Carlos a enviar)', () => {
  horeca = true;
  varejo = false;
  utilizador = 'Carlos Castro';
  const s = context.ccString(['carlos.castro@deltafoodsbrasil.com.br'], {
    remetente: 'Carlos Castro',
  });
  assert.ok(s.includes('filipe.neves@deltafoodsbrasil.com.br'));
  assert.equal(countAddr(s, 'diogo.oliveira'), 0);
});

check('Retalho + Carlos: Diogo em CC (sem duplicar, sem Filipe)', () => {
  horeca = false;
  varejo = true;
  utilizador = 'Carlos Castro';
  const s = context.ccString(['carlos.castro@deltafoodsbrasil.com.br'], {
    remetente: 'Carlos Castro',
  });
  assert.ok(s.includes('carlos.castro@deltafoodsbrasil.com.br'));
  assert.ok(s.includes('diogo.oliveira@deltafoodsbrasil.com.br'));
  assert.ok(!s.includes('filipe.neves@deltafoodsbrasil.com.br'));
  assert.equal(countAddr(s, 'diogo.oliveira'), 1);
  const dup = context.ccString(
    ['carlos.castro@deltafoodsbrasil.com.br', 'diogo.oliveira@deltafoodsbrasil.com.br'],
    { remetente: 'Carlos Castro' }
  );
  assert.equal(countAddr(dup, 'diogo.oliveira'), 1);
  const param = context.ccMailtoParam(['carlos.castro@deltafoodsbrasil.com.br'], {
    to: 'condicoes.especiais@gruponabeiro.com',
    remetente: 'Carlos Castro',
  });
  const decoded = decodeURIComponent(param.slice(3));
  assert.ok(decoded.includes('diogo.oliveira@deltafoodsbrasil.com.br'));
  assert.ok(!decoded.includes('filipe.neves@deltafoodsbrasil.com.br'));
});

check('Retalho + Diogo remetente: não duplica o Diogo no CC', () => {
  horeca = false;
  varejo = true;
  utilizador = 'Diogo Oliveira';
  const s = context.ccString(['carlos.castro@deltafoodsbrasil.com.br'], {
    remetente: 'Diogo Oliveira',
  });
  assert.equal(countAddr(s, 'diogo.oliveira'), 0);
  assert.ok(s.includes('carlos.castro@deltafoodsbrasil.com.br'));
  const jaLa = context.ccString(
    ['carlos.castro@deltafoodsbrasil.com.br', 'diogo.oliveira@deltafoodsbrasil.com.br'],
    { remetente: 'Diogo Oliveira' }
  );
  assert.equal(countAddr(jaLa, 'diogo.oliveira'), 0);
  const porEmail = context.ccString(['carlos.castro@deltafoodsbrasil.com.br'], {
    remetente: 'diogo.oliveira@deltafoodsbrasil.com.br',
  });
  assert.equal(countAddr(porEmail, 'diogo.oliveira'), 0);
  const porLogin = context.ccString(['carlos.castro@deltafoodsbrasil.com.br']);
  assert.equal(countAddr(porLogin, 'diogo.oliveira'), 0, 'login Diogo via getUtilizadorAtual');
});

check('Retalho: Diogo já no To não entra em CC', () => {
  horeca = false;
  varejo = true;
  utilizador = 'Carlos Castro';
  const s = context.ccString(['carlos.castro@deltafoodsbrasil.com.br'], {
    to: 'diogo.oliveira@deltafoodsbrasil.com.br',
    remetente: 'Carlos Castro',
  });
  assert.equal(countAddr(s, 'diogo.oliveira'), 0);
});

check('fora do retalho (ex. Dist) não força Diogo nem Filipe', () => {
  horeca = false;
  varejo = false;
  utilizador = 'Carlos Castro';
  const s = context.ccString(['carlos.castro@deltafoodsbrasil.com.br']);
  assert.equal(countAddr(s, 'diogo.oliveira'), 0);
  assert.ok(!s.includes('filipe.neves@deltafoodsbrasil.com.br'));
});

check('sanitiza lixo invisível / <> que o Gmail rejeita', () => {
  const e = context.outlookSanitizeEmail('\u200B<info.br@gruponabeiro.com>;\u00A0');
  assert.equal(e, 'info.br@gruponabeiro.com');
});

check('URL mailto do chamado AT (screenshot Daniela) é Gmail-safe', () => {
  horeca = true;
  varejo = false;
  utilizador = 'Carlos Castro';
  const to = context.mailtoToPath('info.br@gruponabeiro.com');
  const cc = context.ccMailtoParam([
    'carlos.castro@deltafoodsbrasil.com.br',
    'ricardo.vicentesilva@deltafoodsbrasil.com.br',
    'daniela.silva@deltafoodsbrasil.com.br',
  ]);
  const body = encodeURIComponent(
    `PEDIDO DE ASSISTÊNCIA TÉCNICA — DELTA FOODS BRASIL\n  Nome      : JULES PANIFICADORA E CONFEITARIA\n  Código    : 748520`
  );
  const mailto = `mailto:${to}?${cc}&subject=${encodeURIComponent('ABERTURA DE CHAMADO 748520 JULES PANIFICADORA E CONFEITARIA')}&body=${body}`;
  assert.ok(!mailto.includes('Pedido Delta Foods.'));
  assert.ok(mailto.includes('748520'));
  const q = mailto.split('?')[1];
  const ccQ = new URLSearchParams(q).get('cc');
  assert.ok(ccQ && !ccQ.includes(';'), 'Gmail recebe CC com vírgulas');
  assert.ok(ccQ.includes(','));
  assert.ok(ccQ.includes('filipe.neves@deltafoodsbrasil.com.br'));
  assert.ok(!ccQ.toLowerCase().includes('diogo.oliveira'));
  const bodyQ = new URLSearchParams(q).get('body');
  assert.ok(bodyQ.includes('PEDIDO DE ASSISTÊNCIA TÉCNICA'));
  assert.ok(!bodyQ.includes('Pedido Delta Foods.'));
});

// ── Deteção: tablet com UA desktop ≠ PC Windows ───────────────────────────
const galaxyDesktopWindowsUa = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  platform: 'Linux x86_64',
  userAgentData: { platform: 'Android', mobile: false },
  maxTouchPoints: 5,
};
const galaxyLinuxDesktopUa = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  platform: 'Linux x86_64',
  userAgentData: { platform: 'Android', mobile: false },
  maxTouchPoints: 5,
};
const windowsPc = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  platform: 'Win32',
  userAgentData: { platform: 'Windows', mobile: false },
  maxTouchPoints: 0,
};
const surfacePc = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  platform: 'Win32',
  userAgentData: { platform: 'Windows', mobile: false },
  maxTouchPoints: 10,
};

check('Galaxy «site para computador» (UA Windows NT + platform Android) NÃO é PC', () => {
  assert.equal(context.outlookIsWindowsPc(galaxyDesktopWindowsUa), false);
  assert.equal(context.outlookIsAndroid(galaxyDesktopWindowsUa), true);
  assert.equal(context.outlookIsMobileClient(galaxyDesktopWindowsUa), true);
});

check('Galaxy teclado (UA Linux x86_64) NÃO é PC', () => {
  assert.equal(context.outlookIsWindowsPc(galaxyLinuxDesktopUa), false);
  assert.equal(context.outlookIsMobileClient(galaxyLinuxDesktopUa), true);
});

check('Galaxy UA Windows NT + platform Linux (sem Client Hints) NÃO é PC', () => {
  const nav = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    platform: 'Linux x86_64',
    maxTouchPoints: 5,
  };
  assert.equal(context.outlookIsWindowsPc(nav), false);
  assert.equal(context.outlookIsMobileClient(nav), true);
});

check('PC Windows real continua PC (serve.ps1)', () => {
  assert.equal(context.outlookIsWindowsPc(windowsPc), true);
  assert.equal(context.outlookIsMobileClient(windowsPc), false);
});

check('Surface com toque continua PC Windows', () => {
  assert.equal(context.outlookIsWindowsPc(surfacePc), true);
  assert.equal(context.outlookIsMobileClient(surfacePc), false);
});

// ── Fonte: o stub que esvaziava o chamado não pode voltar ─────────────────
check('index.html já não substitui o corpo por Pedido Delta Foods', () => {
  assert.equal(html.includes("bodyForMail = hasExcel"), false);
  assert.equal(/bodyForMail = hasExcel[\s\S]{0,80}Pedido Delta Foods/.test(html), false);
  assert.ok(html.includes('NUNCA «Pedido Delta Foods» vazio'));
  assert.ok(html.includes('SEMPRE vírgulas'));
});

// ── MC00 tablet: quadro resumo no mailto (não só «anexa o Excel») ─────────
const mc00Names = ['mc00Num', 'mc00Fmt', 'mc00CalcPlf', 'mc00ResumoProdutosEmailText', 'outlookHtmlToPlainText'];
for (const name of mc00Names) {
  vm.runInContext(extractFn(html, name), context);
}

check('MC00 texto inclui os negócios (código, produto, preços)', () => {
  const txt = context.mc00ResumoProdutosEmailText([
    { sapCode: '1001234', descricao: 'CAFÉ TORRADO 1KG', preco: '45,00', desc1: '10' },
    { sapCode: '1005678', descricao: 'LEITE CONDENSADO', preco: '12,50', desc1: '5' },
  ]);
  assert.ok(txt.includes('Cód.SAP'));
  assert.ok(txt.includes('1001234'));
  assert.ok(txt.includes('CAFÉ TORRADO 1KG'));
  assert.ok(txt.includes('1005678'));
  assert.ok(txt.includes('P.Final'));
  assert.ok(txt.includes('R$'));
});

check('MC00 mailtoFallback no código chama o quadro de produtos', () => {
  assert.ok(html.includes('mc00ResumoProdutosEmailText(d.produtos)'));
  const bloco = html.slice(html.indexOf('async function mc00AbrirEmail'));
  const bodyTxt = bloco.slice(0, bloco.indexOf('return outlookAbrirRascunho'));
  assert.ok(bodyTxt.includes('Resumo para validação'));
  assert.ok(bodyTxt.includes('mc00ResumoProdutosEmailText'));
  assert.equal(bodyTxt.includes('Anexa o ficheiro Excel MC00') && !bodyTxt.includes('mc00ResumoProdutosEmailText'), false);
});

check('MC00 Para é condições especiais; Carlos em CC; saudação sem nome', () => {
  const toM = html.match(/const EMAIL_MC00_TO = '([^']+)'/);
  const ccM = html.match(/const EMAIL_MC00_CC = \[([^\]]+)\]/);
  assert.ok(toM, 'EMAIL_MC00_TO definida');
  assert.equal(toM[1], 'condicoes.especiais@gruponabeiro.com');
  assert.ok(ccM && ccM[1].includes('carlos.castro@deltafoodsbrasil.com.br'));
  const bloco = html.slice(html.indexOf('async function mc00AbrirEmail'));
  const fn = bloco.slice(0, bloco.indexOf('\n}\n\n') + 1);
  assert.ok(fn.includes('to: EMAIL_MC00_TO'));
  assert.ok(/ccString\(EMAIL_MC00_CC/.test(fn), 'MC00 usa ccString (Filipe/Diogo por canal)');
  assert.ok(!fn.includes("to: 'carlos.castro@deltafoodsbrasil.com.br'"));
  assert.ok(!fn.includes("to: 'condicoes.especiais@gruponabeiro.com'"),
    'usar a constante EMAIL_MC00_TO, não o literal no rascunho');
  assert.ok(fn.includes('mc00SaudacaoHora()'));
  assert.ok(fn.includes('${mc00EmailEsc(saudacao)},'));
  assert.ok(fn.includes('${saudacao},'));
  assert.ok(!fn.includes('${mc00EmailEsc(saudacao)} Carlos,'));
  assert.ok(!fn.includes('${saudacao} Carlos,'));
  assert.ok(!/\$\{mc00EmailEsc\(saudacao\)\}[^<]{0,40}Carlos,/.test(fn));
  assert.ok(!/\$\{saudacao\}[^$\n]{0,40}Carlos,/.test(fn));
  assert.ok(!html.includes('${mc00EmailEsc(saudacao)} Carlos,'),
    'nenhum caminho MC00 pode saudar «Carlos»');
  assert.ok(!html.includes('${saudacao} Carlos,'));
  assert.ok(fn.includes('${mc00EmailEsc(saudacao)},<br><br>Peço o carregamento'),
    'saudação e pedido no mesmo <p> (Outlook injeta assinatura após o 1.º </p>)');
  assert.ok(!fn.includes('${mc00EmailEsc(saudacao)},</p>'),
    'saudação MC00 não pode ser um <p> sozinho');
  assert.ok(!/\$\{saudacao\},\s*\n\s*\n\s*Peço/.test(fn),
    'mailto MC00 sem linha em branco a seguir à saudação');
  assert.ok(fn.includes('Peço o carregamento das condições especiais de fornecimento (MC00)'));
  assert.ok(fn.includes('Aguardo a vossa aprovação.'));
  assert.equal((html.match(/async function mc00AbrirEmail/g) || []).length, 1,
    'um único caminho a abrir o email MC00');
});

check('mapa EMAIL + rascunho Outlook aplicam CC Diogo no retalho', () => {
  assert.ok(html.includes("'DIOGO OLIVEIRA': 'diogo.oliveira@deltafoodsbrasil.com.br'"));
  assert.ok(html.includes("getEmailUtilizador('DIOGO OLIVEIRA')"));
  assert.ok(html.includes('function isCanalVarejoActivo'));
  assert.ok(html.includes('function remetenteEhDiogo'));
  const start = html.indexOf('async function outlookAbrirRascunho');
  const end = html.indexOf('\nfunction isAdmin()', start);
  assert.ok(start >= 0 && end > start);
  const fn = html.slice(start, end);
  assert.ok(fn.includes('ccString('));
  assert.ok(fn.includes('{ to, remetente'));
  assert.ok(html.includes('async function prosAbrirEmailCadastro'));
  const cad = html.slice(html.indexOf('async function prosAbrirEmailCadastro'));
  assert.ok(cad.includes('ccString(cc)'));
  assert.ok(cad.includes('outlookAbrirRascunho'));
});

check('mc00SaudacaoHora nunca inclui Carlos', () => {
  vm.runInContext(extractFn(html, 'mc00SaudacaoHora'), context);
  const manha = context.mc00SaudacaoHora(new Date('2026-08-28T10:00:00'));
  const tarde = context.mc00SaudacaoHora(new Date('2026-08-28T15:00:00'));
  assert.equal(manha, 'Bom dia');
  assert.equal(tarde, 'Boa tarde');
  assert.ok(!manha.includes('Carlos'));
  assert.ok(!tarde.includes('Carlos'));
});

// ── Outlook: assinatura a meio do rascunho HTML ────────────────────────────
context.OUTLOOK_MSG_WRAP_ID = 'outlook-msg-wrap';
context.OUTLOOK_BODY_FONT =
  'font-family:Calibri,Arial,sans-serif;font-size:14px;color:#111827;line-height:1.45;';
for (const name of [
  'outlookCorpoJaEnvolvido',
  'outlookInnerHtml',
  'outlookTxtJuntarSaudacao',
  'outlookWrapHtmlCorpo',
]) {
  vm.runInContext(extractFn(html, name), context);
}

check('outlookWrapHtmlCorpo: um único wrapper, sem <p>, conteúdo intacto', () => {
  const src =
    `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>` +
    `<body style="font-family:Calibri,Arial,sans-serif;font-size:14px;color:#111827;line-height:1.45;">` +
    `<p>Bom dia,</p><p>Peço o carregamento das condições especiais.</p>` +
    `<p style="font-weight:700;">Resumo para validação:</p>` +
    `<table><tr><td>1001234</td><td>CAFÉ</td></tr></table>` +
    `</body></html>`;
  const out = context.outlookWrapHtmlCorpo(src);
  assert.ok(out.includes('id="outlook-msg-wrap"'), 'tabela contentor');
  assert.ok(out.includes('Peço o carregamento das condições especiais.'));
  assert.ok(out.includes('Bom dia,'));
  assert.ok(out.includes('Resumo para validação:'));
  assert.ok(out.includes('1001234'));
  assert.equal((out.match(/<p[\s>]/gi) || []).length, 0, 'sem <p> — slot da assinatura Outlook');
  assert.ok(out.includes('Bom dia,'));
  const out2 = context.outlookWrapHtmlCorpo(out);
  assert.equal((out2.match(/id="outlook-msg-wrap"/g) || []).length, 1, 'idempotente');
});

check('outlookTxtJuntarSaudacao: sem parágrafo vazio após Bom dia', () => {
  const j = context.outlookTxtJuntarSaudacao('Bom dia,\n\nPeço o carregamento\n\nResumo');
  assert.equal(j.startsWith('Bom dia,\nPeço o carregamento'), true);
  assert.ok(!j.startsWith('Bom dia,\n\n'));
  assert.ok(j.includes('\n\nResumo'), 'resto das linhas em branco mantém-se');
});

check('outlookAbrirRascunho envolve o HTML; EML continua text/html UTF-8', () => {
  const start = html.indexOf('async function outlookAbrirRascunho');
  const end = html.indexOf('\nfunction isAdmin()', start);
  assert.ok(start >= 0 && end > start);
  const fn = html.slice(start, end);
  assert.ok(fn.includes('outlookWrapHtmlCorpo'));
  assert.ok(fn.includes('X-Unsent: 1'));
  assert.ok(fn.includes('Content-Type: text/html; charset=UTF-8'));
  assert.ok(!fn.includes('Content-Type: text/plain'),
    'sem text/plain curto que o Outlook use para meter a assinatura no meio');
});

check('quadro HTML continua legível em texto depois do wrapper', () => {
  const src =
    `<p>Resumo</p><table><tr><th>Cód.SAP</th><th>Produto</th></tr>` +
    `<tr><td>1001234</td><td>CAFÉ</td></tr></table>`;
  const wrapped = context.outlookWrapHtmlCorpo(src);
  const txt = context.outlookHtmlToPlainText(wrapped);
  assert.ok(txt.includes('1001234'));
  assert.ok(txt.includes('CAFÉ'));
  assert.ok(txt.includes('|'), 'células da tabela separadas por |');
});

check('HTML de tabela vira quadro texto (tablet sem HTML no mailto)', () => {
  const htmlTbl = `<p>Resumo</p><table><tr><th>Cód.SAP</th><th>Produto</th></tr><tr><td>1001234</td><td>CAFÉ</td></tr></table>`;
  const txt = context.outlookHtmlToPlainText(htmlTbl);
  assert.ok(txt.includes('1001234'));
  assert.ok(txt.includes('CAFÉ'));
  assert.ok(txt.includes('|'), 'células da tabela separadas por |');
});

if (process.exitCode) {
  console.error('\nFalhou pelo menos um teste.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes de email/chamado AT passaram.');
