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
  // Saltar a lista de parâmetros (`({ a } = {}) {` não é o corpo).
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

const names = [
  'outlookSanitizeEmail',
  'outlookMailtoAddrList',
  'remetenteEhUtilizador',
  'remetenteEhDiogo',
  'remetenteEhMarcio',
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
let ecommerce = false;
let utilizador = 'Carlos Castro';
const EMAILS = {
  'DIOGO OLIVEIRA': 'diogo.oliveira@deltafoodsbrasil.com.br',
  'MARCIO GORGA': 'marcio.gorga@deltafoodsbrasil.com.br',
  'CARLOS CASTRO': 'carlos.castro@deltafoodsbrasil.com.br',
  'FILIPE NEVES': 'filipe.neves@deltafoodsbrasil.com.br',
};
const context = {
  CC_FIXO_FILIPE: 'filipe.neves@deltafoodsbrasil.com.br',
  CC_FIXO_DIOGO: 'diogo.oliveira@deltafoodsbrasil.com.br',
  CC_FIXO_MARCIO: 'marcio.gorga@deltafoodsbrasil.com.br',
  isCanalHorecaActivo: () => horeca,
  isCanalVarejoActivo: () => varejo,
  isCanalEcommerceActivo: () => ecommerce,
  getUtilizadorAtual: () => utilizador,
  getEmailUtilizador: (nome) => {
    const k = String(nome || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    return EMAILS[k] || '';
  },
  normNomeUtilizador: (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(),
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

check('outlookAbrirRascunho: cabeçalho Cc do .eml usa ; (nunca vírgula entre emails)', () => {
  const start = html.indexOf('async function outlookAbrirRascunho');
  const end = html.indexOf('\nfunction isAdmin()', start);
  const fn = html.slice(start, end);
  // Normalização final para ; antes de montar o EML
  assert.ok(fn.includes(".join('; ')"), 'normaliza CC com ; ');
  assert.ok(fn.includes('`Cc: ${ccVal}`') || fn.includes('Cc: ${ccVal}'), 'cabeçalho Cc no EML');
  // mailto continua com vírgulas noutro sítio
  assert.ok(html.includes("emails.join(',')"), 'mailto mantém vírgulas');
});

check('Horeca: Filipe em CC, Diogo não é forçado (Carlos a enviar)', () => {
  horeca = true;
  varejo = false;
  ecommerce = false;
  utilizador = 'Carlos Castro';
  const s = context.ccString(['carlos.castro@deltafoodsbrasil.com.br'], {
    remetente: 'Carlos Castro',
  });
  assert.ok(s.includes('filipe.neves@deltafoodsbrasil.com.br'));
  assert.equal(countAddr(s, 'diogo.oliveira'), 0);
  assert.equal(countAddr(s, 'marcio.gorga'), 0);
});

check('Retalho + Carlos: Diogo em CC (sem duplicar, sem Filipe)', () => {
  horeca = false;
  varejo = true;
  ecommerce = false;
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
  ecommerce = false;
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
  ecommerce = false;
  utilizador = 'Carlos Castro';
  const s = context.ccString(['carlos.castro@deltafoodsbrasil.com.br'], {
    to: 'diogo.oliveira@deltafoodsbrasil.com.br',
    remetente: 'Carlos Castro',
  });
  assert.equal(countAddr(s, 'diogo.oliveira'), 0);
});

check('Ecommerce + Carlos: Marcio em CC (sem Filipe/Diogo)', () => {
  horeca = false;
  varejo = false;
  ecommerce = true;
  utilizador = 'Carlos Castro';
  const s = context.ccString(['carlos.castro@deltafoodsbrasil.com.br'], {
    remetente: 'Carlos Castro',
  });
  assert.ok(s.includes('marcio.gorga@deltafoodsbrasil.com.br'));
  assert.equal(countAddr(s, 'marcio.gorga'), 1);
  assert.ok(!s.includes('filipe.neves@deltafoodsbrasil.com.br'));
  assert.equal(countAddr(s, 'diogo.oliveira'), 0);
});

check('Ecommerce + Marcio remetente: Carlos em CC, sem Marcio', () => {
  horeca = false;
  varejo = false;
  ecommerce = true;
  utilizador = 'Marcio Gorga';
  const s = context.ccString(['carlos.castro@deltafoodsbrasil.com.br'], {
    remetente: 'Marcio Gorga',
  });
  assert.equal(countAddr(s, 'marcio.gorga'), 0);
  assert.ok(s.includes('carlos.castro@deltafoodsbrasil.com.br'));
});

check('fora do retalho/ecommerce (ex. Dist) não força Diogo/Marcio/Filipe', () => {
  horeca = false;
  varejo = false;
  ecommerce = false;
  utilizador = 'Carlos Castro';
  const s = context.ccString(['carlos.castro@deltafoodsbrasil.com.br']);
  assert.equal(countAddr(s, 'diogo.oliveira'), 0);
  assert.equal(countAddr(s, 'marcio.gorga'), 0);
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

check('MC00 Para é condições especiais; CC via mc00MontarCc; saudação sem nome', () => {
  const toM = html.match(/const EMAIL_MC00_TO = '([^']+)'/);
  assert.ok(toM, 'EMAIL_MC00_TO definida');
  assert.equal(toM[1], 'condicoes.especiais@gruponabeiro.com');
  assert.ok(html.includes("EMAIL_MC00_CC_CARLOS = 'carlos.castro@deltafoodsbrasil.com.br'")
    || html.includes('carlos.castro@deltafoodsbrasil.com.br'));
  const bloco = html.slice(html.indexOf('async function mc00AbrirEmail'));
  const fn = bloco.slice(0, bloco.indexOf('\n}\n\n') + 1);
  assert.ok(fn.includes('to: EMAIL_MC00_TO'));
  assert.ok(fn.includes('mc00MontarCc'), 'MC00 monta CC pelo vendedor responsável');
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

check('mapa EMAIL + rascunho Outlook aplicam CC Diogo/Marcio por canal', () => {
  assert.ok(html.includes("'DIOGO OLIVEIRA': 'diogo.oliveira@deltafoodsbrasil.com.br'"));
  assert.ok(html.includes('marcio.gorga@deltafoodsbrasil.com.br'));
  assert.ok(html.includes("getEmailUtilizador('DIOGO OLIVEIRA')"));
  assert.ok(html.includes('function isCanalVarejoActivo'));
  assert.ok(html.includes('function isCanalEcommerceActivo'));
  assert.ok(html.includes('function remetenteEhDiogo'));
  assert.ok(html.includes('function remetenteEhMarcio'));
  assert.ok(html.includes('CC_FIXO_MARCIO'));
  const ccFn = extractFn(html, 'ccString');
  assert.ok(ccFn.includes('isCanalEcommerceActivo'));
  assert.ok(ccFn.includes('remetenteEhMarcio'));
  const start = html.indexOf('async function outlookAbrirRascunho');
  const end = html.indexOf('\nfunction isAdmin()', start);
  assert.ok(start >= 0 && end > start);
  const fn = html.slice(start, end);
  assert.ok(fn.includes('ccString('));
  assert.ok(fn.includes('{ to, remetente'));
  assert.ok(html.includes('async function prosAbrirEmailCadastro'));
  const cad = html.slice(
    html.indexOf('async function prosAbrirEmailCadastro'),
    html.indexOf('let _modoAlteracaoCnpj'),
  );
  // Dist (soDaniela) passa ccExact; retalho/Horeca continua a usar ccString no Outlook.
  assert.ok(cad.includes('outlookAbrirRascunho'));
  assert.ok(cad.includes('cc: mail.cc'));
  assert.ok(cad.includes('ccExact') || cad.includes('ccString(mail.cc'));
  assert.ok(html.includes('ccString('));
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
  'outlookFoldMimeLines',
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
  assert.ok(fn.includes('outlookFoldMimeLines'));
  assert.ok(fn.includes('X-Unsent: 1'));
  assert.ok(fn.includes('Content-Type: text/html; charset=UTF-8'));
  assert.ok(!fn.includes('Content-Type: text/plain'),
    'sem text/plain curto que o Outlook use para meter a assinatura no meio');
});

check('outlookFoldMimeLines parte linhas longas sem perder o quadro', () => {
  const longa = '<table>' + '<td style="color:#111;">JOCINEI NEVES R$ 886,73</td>'.repeat(80) + '</table>';
  assert.ok(longa.length > 998);
  const folded = context.outlookFoldMimeLines(longa);
  for (const line of folded.split('\r\n')) {
    assert.ok(line.length <= 900, String(line.length));
  }
  assert.ok(folded.includes('JOCINEI NEVES'));
  assert.ok(folded.includes('R$ 886,73'));
  const src =
    `<p>Bom dia,</p><p>segue o quadro.</p>` +
    `<table><tr><td>${'X'.repeat(2000)}</td></tr></table>`;
  const wrapped = context.outlookWrapHtmlCorpo(src);
  const emlHtml = context.outlookFoldMimeLines(wrapped);
  for (const line of emlHtml.split('\r\n')) {
    assert.ok(line.length <= 900, String(line.length));
  }
  assert.ok(emlHtml.includes('segue o quadro.'));
  assert.ok(emlHtml.includes('X'.repeat(50)));
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

// ── Abertura de Cliente: Daniela se BOM NEGÓCIO ou não café ───────────────
context.EMAIL_CADASTRO_CARLOS = 'carlos.castro@deltafoodsbrasil.com.br';
context.EMAIL_CADASTRO_DANIELA = 'daniela.kucinski@deltafoodsbrasil.com.br';
context.getUtilizadorAtual = () => 'Carlos Castro';
context.getEmailUtilizador = () => 'carlos.castro@deltafoodsbrasil.com.br';
context.isCanalDistribuidores = () => false;
for (const name of [
  'outlookEmailEsc',
  'prosCadastroResumoRows',
  'prosCadastroResumoEmailHtml',
  'prosCadastroResumoEmailText',
  'prosPropostaEBomNegocio',
  'prosCadastroEmailPolitica',
  'prosCadastroSoDaniela',
  'prosCadastroAnexosTxt',
  'prosCadastroEmailIntro',
  'prosCadastroSaudacaoHora',
  'prosCadastroMontarEmail',
]) {
  vm.runInContext(extractFn(html, name), context);
}

const cadastroDados = {
  motivo: 'Abertura de Cliente',
  nome: 'AURELLIA PAES E DOCES E RESTAURANTE LTDA',
  empresa: 'GN52 - Delta Foods Brasil',
  fantasia: 'AURELLIA',
  cnpj: '00.000.000/0001-00',
  email: 'x@y.com',
  tel1: '11999999999',
  rua: 'Rua A',
  nro: '1',
  bairro: 'Centro',
  cep: '01000-000',
  cidade: 'SÃO PAULO',
  canal: 'HORECA',
  regiao: 'SP',
  pagto: '30 DDL',
  vendedor: '03 - PAULO FONTES',
};
const agoraTarde = new Date('2026-08-28T15:00:00');

check('veredito BOM NEGÓCIO (com e sem acento)', () => {
  assert.equal(context.prosPropostaEBomNegocio('BOM NEGÓCIO'), true);
  assert.equal(context.prosPropostaEBomNegocio('bom negocio'), true);
  assert.equal(context.prosPropostaEBomNegocio('REQUER AVALIAÇÃO'), false);
  assert.equal(context.prosPropostaEBomNegocio('REJEITAR'), false);
  assert.equal(context.prosPropostaEBomNegocio(''), false);
});

check('bom negócio → To Daniela, CC Carlos (sem Filipe na lista; ccString Horeca acrescenta)', () => {
  const pol = context.prosCadastroEmailPolitica({ isCafe: true, isBomNegocio: true });
  assert.equal(pol.to, 'daniela.kucinski@deltafoodsbrasil.com.br');
  assert.deepEqual(pol.cc, ['carlos.castro@deltafoodsbrasil.com.br']);
  assert.equal(pol.conformeAprovado, true);
  assert.equal(pol.pedirAprovacao, false);
  assert.ok(!pol.cc.includes('filipe.neves@deltafoodsbrasil.com.br'));
  horeca = true;
  const cc = context.ccString(pol.cc);
  assert.ok(cc.includes('carlos.castro@deltafoodsbrasil.com.br'));
  assert.ok(cc.includes('filipe.neves@deltafoodsbrasil.com.br'));
  assert.equal((cc.match(/filipe\.neves@deltafoodsbrasil\.com\.br/gi) || []).length, 1);
  const mail = context.prosCadastroMontarEmail(cadastroDados, {
    isCafe: true, isBomNegocio: true, agora: agoraTarde,
    propTexto: 'Proposta de negócio (Grão)',
  });
  assert.equal(mail.to, pol.to);
  assert.ok(/conforme aprovado/i.test(mail.introTxt));
  assert.ok(/conforme aprovado/i.test(mail.html));
  assert.ok(!/para aprovação/i.test(mail.introTxt));
  assert.ok(!/para aprovação/i.test(mail.html));
  assert.ok(!/Aguardo aprovação/i.test(mail.bodyTxt));
  assert.ok(!/Aguardo aprovação/i.test(mail.html));
  assert.ok(mail.html.includes('Resumo do cadastro'));
  assert.ok(mail.bodyTxt.includes('Resumo do cadastro') || mail.bodyTxt.includes('Motivo'));
  assert.ok(mail.html.includes('AURELLIA PAES E DOCES E RESTAURANTE LTDA'));
  assert.ok(mail.html.includes('Boa tarde,'));
  assert.ok(!/Boa tarde,\s*Daniela/i.test(mail.html));
  assert.ok(!/Boa tarde,\s*Carlos/i.test(mail.html));
  assert.ok(mail.html.includes('<p>Boa tarde,<br><br>Conforme aprovado'),
    'saudação e intro no mesmo <p> (Outlook injeta assinatura após o 1.º </p>)');
  assert.ok(!mail.html.includes('<p>Boa tarde,</p>'),
    'saudação do cadastro não pode ser um <p> sozinho');
});

check('cliente não café → To Daniela, conforme aprovado (sem pedir aprovação)', () => {
  const pol = context.prosCadastroEmailPolitica({ isCafe: false, isBomNegocio: false });
  assert.equal(pol.to, 'daniela.kucinski@deltafoodsbrasil.com.br');
  assert.deepEqual(pol.cc, ['carlos.castro@deltafoodsbrasil.com.br']);
  assert.equal(pol.conformeAprovado, true);
  const mail = context.prosCadastroMontarEmail(cadastroDados, {
    isCafe: false, isBomNegocio: false, agora: agoraTarde,
  });
  assert.equal(mail.to, pol.to);
  assert.ok(/conforme aprovado/i.test(mail.introTxt));
  assert.ok(!/para aprovação/i.test(mail.introTxt));
  assert.ok(!/Aguardo aprovação/i.test(mail.bodyTxt));
  assert.ok(mail.introTxt.includes('ficha de cadastro'));
  assert.ok(!mail.introTxt.includes('proposta de negócio'));
  horeca = true;
  const cc = context.ccString(mail.cc);
  assert.ok(cc.includes('filipe.neves@deltafoodsbrasil.com.br'));
  assert.equal((cc.match(/filipe\.neves@deltafoodsbrasil\.com\.br/gi) || []).length, 1);
});

check('café + não bom negócio → To Carlos, para aprovação', () => {
  const pol = context.prosCadastroEmailPolitica({ isCafe: true, isBomNegocio: false });
  assert.equal(pol.to, 'carlos.castro@deltafoodsbrasil.com.br');
  assert.deepEqual(pol.cc, ['daniela.kucinski@deltafoodsbrasil.com.br']);
  assert.equal(pol.pedirAprovacao, true);
  assert.equal(pol.conformeAprovado, false);
  const mail = context.prosCadastroMontarEmail(cadastroDados, {
    isCafe: true, isBomNegocio: false, agora: agoraTarde,
    propTexto: 'Proposta de negócio (Grão)',
  });
  assert.equal(mail.to, pol.to);
  assert.ok(/para aprovação/i.test(mail.introTxt));
  assert.ok(!/conforme aprovado/i.test(mail.introTxt));
  assert.ok(/Aguardo aprovação/i.test(mail.bodyTxt));
  assert.ok(/Aguardo aprovação/i.test(mail.html));
  assert.ok(mail.introTxt.includes('ficha de cadastro e a proposta de negócio'));
  horeca = true;
  const cc = context.ccString(mail.cc);
  assert.ok(cc.includes('daniela.kucinski@deltafoodsbrasil.com.br'));
  assert.ok(cc.includes('filipe.neves@deltafoodsbrasil.com.br'));
  assert.ok(mail.html.includes('<p>Boa tarde,<br><br>Segue em anexo'),
    'café a pedir aprovação também junta saudação e intro no mesmo <p>');
});

check('lead ganho calcula BOM NEGÓCIO e passa isBomNegocio ao email', () => {
  const start = html.indexOf('async function prosGanhoExportar');
  const end = html.indexOf('\nasync function gerarCadastroXlsxLocal', start);
  assert.ok(start >= 0 && end > start);
  const fn = html.slice(start, end);
  assert.ok(fn.includes('isBomNegocio'));
  assert.ok(fn.includes('prosPropostaEBomNegocio'));
  assert.ok(fn.includes('propComputeModel'));
  assert.ok(fn.includes('prosAbrirEmailCadastro(dados, { isCafe, isBomNegocio, propTexto, attachments })'));
});

check('cadastro: constantes Daniela/Carlos e saudação sem nome', () => {
  assert.ok(html.includes("const EMAIL_CADASTRO_DANIELA = 'daniela.kucinski@deltafoodsbrasil.com.br'"));
  assert.ok(html.includes("const EMAIL_CADASTRO_CARLOS = 'carlos.castro@deltafoodsbrasil.com.br'"));
  const start = html.indexOf('function prosCadastroMontarEmail');
  const end = html.indexOf('\nasync function prosAbrirEmailCadastro', start);
  const fn = html.slice(start, end);
  assert.ok(fn.includes('${outlookEmailEsc(saudacao)},<br><br>${intro}'));
  assert.ok(!fn.includes('${outlookEmailEsc(saudacao)},</p>'));
  // Saudação sem nome próprio (evitar falso positivo em soDaniela / EMAIL_…_DANIELA).
  assert.ok(!/['"`]Carlos,/.test(fn));
  assert.ok(!/['"`]Daniela,/.test(fn));
  assert.ok(!fn.includes('${saudacao}, Carlos'));
  assert.ok(!fn.includes('${saudacao}, Daniela'));
});

check('Distribuidores: cadastro só para a Daniela, sem Carlos nem Filipe', () => {
  context.isCanalDistribuidores = () => true;
  const pol = context.prosCadastroEmailPolitica({
    isCafe: false, isBomNegocio: false, forcarPedidoAprovacao: true, soDaniela: true,
  });
  assert.equal(pol.to, 'daniela.kucinski@deltafoodsbrasil.com.br');
  assert.deepEqual(pol.cc, []);
  assert.equal(pol.pedirAprovacao, false);
  assert.equal(pol.conformeAprovado, true);
  const mail = context.prosCadastroMontarEmail({
    ...cadastroDados,
    nome: 'ERMAR DISTRIBUIDORA LTDA',
    canal: 'DISTRIBUIDORES',
  }, {
    isCafe: false,
    forcarPedidoAprovacao: true,
    soDaniela: true,
    agora: agoraTarde,
  });
  assert.equal(mail.to, 'daniela.kucinski@deltafoodsbrasil.com.br');
  assert.deepEqual(mail.cc, []);
  assert.equal(mail.ccExact, true);
  assert.ok(/conforme aprovado/i.test(mail.introTxt));
  assert.ok(!/para aprovação/i.test(mail.introTxt));
  assert.ok(!/Aguardo aprovação/i.test(mail.bodyTxt));
  assert.ok(!mail.cc.includes('carlos.castro@deltafoodsbrasil.com.br'));
  assert.ok(html.includes('soDaniela: isDist'));
  assert.ok(html.includes("ccExact"));
  const abrir = html.slice(html.indexOf('async function prosAbrirEmailCadastro'), html.indexOf('let _modoAlteracaoCnpj'));
  assert.ok(abrir.includes('ccExact'));
  assert.ok(abrir.includes('mail.cc'));
  context.isCanalDistribuidores = () => false;
});

check('serve.ps1 abre rascunho SÓ via COM (nunca /eml — evita argumento inválido)', () => {
  const ps1 = fs.readFileSync(path.join(root, 'serve.ps1'), 'utf8');
  assert.ok(ps1.includes('function Open-EmlViaCom'));
  assert.ok(ps1.includes('function Parse-DeltaEml'));
  assert.ok(ps1.includes('CreateItem(0)'));
  assert.ok(ps1.includes('HTMLBody'));
  assert.ok(ps1.includes("X-Delta-Outlook-Bridge") || ps1.includes("'X-Delta-Outlook-Bridge'"));
  assert.ok(ps1.includes('com-v4'));
  assert.ok(ps1.includes('Display($false)'), 'Display não-modal (evita caixa de diálogo aberta)');
  assert.ok(!/Display\(\$true\)/.test(ps1), 'sem Display modal');
  assert.ok(ps1.includes('503'), '503 se Outlook tiver diálogo aberto');
  // CC/To: Recipients.Add — NUNCA $mail.CC = lista (vírgulas → Verificar nomes)
  assert.ok(ps1.includes('function Add-OutlookRecipientList'), 'Add-OutlookRecipientList');
  assert.ok(ps1.includes('Recipients.Add'), 'Recipients.Add por endereço');
  assert.ok(!/\$mail\.CC\s*=/.test(ps1), 'não atribui lista a $mail.CC');
  assert.ok(!/\$mail\.To\s*=/.test(ps1), 'não atribui lista a $mail.To');
  // Start-EmlDraft não pode lançar /eml (Start-Process "sucesso" + diálogo Outlook)
  const startFn = ps1.slice(ps1.indexOf('function Start-EmlDraft'), ps1.indexOf('function Complete-EmlDraftFocus'));
  assert.ok(startFn.includes('Open-EmlViaCom'));
  assert.ok(!startFn.includes('/eml'), 'Start-EmlDraft sem /eml');
  assert.ok(!startFn.includes('Start-Process'), 'Start-EmlDraft sem Start-Process outlook.exe');
  assert.ok(ps1.includes('Deferred'), 'cold-start COM depois do HTTP 204');
  assert.ok(fs.existsSync(path.join(root, 'Atualizar-Ponte-Outlook.bat')), 'bat para actualizar a ponte');
  const bat = fs.readFileSync(path.join(root, 'Atualizar-Ponte-Outlook.bat'), 'utf8');
  assert.ok(bat.includes('com-v4'), 'bat verifica com-v4');
});

check('browser aceita ponte com-v3+ e NUNCA faz POST a pontes antigas', () => {
  assert.ok(html.includes("OUTLOOK_BRIDGE_VERSION = 'com-v4'"));
  assert.ok(html.includes('OUTLOOK_BRIDGE_MIN_MAJOR = 3') || html.includes('OUTLOOK_BRIDGE_MIN_MAJOR=3'));
  assert.ok(html.includes('outlookBridgeVersionOk'));
  assert.ok(html.includes('outlookProbeBridgeVersion'));
  assert.ok(html.includes('Atualizar-Ponte-Outlook.bat'));
  const ver = html.slice(html.indexOf('function outlookBridgeVersionOk'), html.indexOf('function outlookWarnPonteDesatualizada'));
  assert.ok(ver.includes('com-v') && ver.includes('MIN_MAJOR'), 'aceita com-v3+ (todos os canais)');
  const post = html.slice(html.indexOf('async function outlookPostDraft'), html.indexOf('let _outlookFindInflight'));
  assert.ok(post.includes('outlookProbeBridgeVersion') || post.includes('skipProbe'), 'probe ou skipProbe');
  assert.ok(post.includes("return 'dialog'") || post.includes("'dialog'"), '503 → dialog sem downloads');
  assert.ok(post.includes('skipProbe') || post.includes('doPost'), 'POST com retry / skipProbe');
  // Sem varrer portas com POST (era o que disparava /eml na ponte antiga)
  const abrir = html.slice(html.indexOf('async function outlookAbrirRascunho'), html.indexOf('\nfunction isAdmin()'));
  assert.ok(abrir.includes('outlookFindLiveApi'));
  assert.ok(abrir.includes('skipProbe: true'), 'POST sem 2.ª probe (fila monothread)');
  assert.ok(!/for \(const ep of outlookDraftApiUrls\(\)\)/.test(abrir), 'não faz POST a todas as portas');
  assert.ok(abrir.includes('outlookOpenMailtoPlusExcel'), 'PC sem ponte → mailto');
  assert.ok(abrir.includes("openedEp === 'dialog'"), 'dialog → toast sem download');
  // Fallback PC: só .eml (não Excel+.eml)
  const pcFb = abrir.indexOf('PC sem ponte');
  const pcSlice = pcFb >= 0 ? abrir.slice(pcFb, pcFb + 900) : abrir;
  assert.ok(pcSlice.includes('outlookDownloadEml'), 'fallback descarrega .eml');
  assert.ok(!/triggerBlobDownload\(att\.blob/.test(pcSlice), 'fallback NÃO descarrega Excel à parte');
  // Descoberta sequencial — Promise.all saturava o serve.ps1 e o MC00 caía no .eml
  const findFn = html.slice(html.indexOf('async function outlookFindLiveApi'), html.indexOf('async function outlookAbrirEmailTexto'));
  assert.ok(findFn.includes('for (let i = 0') || findFn.includes('for (const ep of'), 'probe sequencial');
  assert.ok(!findFn.includes('Promise.all'), 'sem flood paralelo de OPTIONS');
});

check('SW não intercepta localhost nem API Outlook (Private Network Access)', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(sw.includes("host === 'localhost'"));
  assert.ok(sw.includes("host === '127.0.0.1'"));
  assert.ok(sw.includes('/api/open-outlook-draft'));
  assert.ok(sw.includes('url.origin !== self.location.origin'));
  // O early-return tem de existir ANTES do respondWith genérico
  const bypassIdx = sw.indexOf("host === 'localhost'");
  const respondIdx = sw.lastIndexOf('e.respondWith(fetch(req))');
  assert.ok(bypassIdx >= 0 && respondIdx > bypassIdx, 'bypass localhost antes do fetch genérico');
});

check('PC Windows sem ponte + anexos: só .eml (nunca mailto sem anexo)', () => {
  const start = html.indexOf('async function outlookAbrirRascunho');
  const end = html.indexOf('\nfunction isAdmin()', start);
  const fn = html.slice(start, end);
  assert.ok(fn.includes('outlookDownloadEml'));
  assert.ok(fn.includes('NUNCA mailto') || fn.includes('já tem o Excel anexado'));
  assert.ok(!/for \(const ep of outlookDraftApiUrls\(\)\)/.test(fn));
  const pcBlock = fn.indexOf('PC sem ponte');
  assert.ok(pcBlock >= 0);
  const attIf = fn.indexOf('if (hasAttachments)', pcBlock);
  assert.ok(attIf > pcBlock, 'ramo if (hasAttachments) no PC');
  const retEml = fn.indexOf("return emlOk ? 'eml'", attIf);
  assert.ok(retEml > attIf, 'return eml sem mailto');
  const attSlice = fn.slice(attIf, retEml + 40);
  assert.ok(attSlice.includes('outlookDownloadEml'));
  assert.ok(!attSlice.includes('outlookOpenMailtoPlusExcel'), 'com anexos não abre mailto');
  const probe = html.slice(html.indexOf('async function outlookProbeBridgeVersion'), html.indexOf('async function outlookPostDraft'));
  assert.ok(probe.includes('5000'), 'probe timeout 5000ms (PNA cold-start)');
  assert.ok(!probe.includes('2500') || probe.includes('5000'), 'timeout actualizado');
});


check('Cadastro Dist/Ganho: sem downloads extras quando Outlook OK', () => {
  const ganho = html.slice(html.indexOf('async function prosGanhoExportar'), html.indexOf('async function gerarCadastroXlsxLocal'));
  const alt = html.slice(html.indexOf('async function alteracaoCadastralExportar'), html.indexOf('async function prosGanhoExportar'));
  assert.ok(ganho.includes('skipDownload: true'), 'prosGanhoExportar não descarrega antes do Outlook');
  assert.ok(alt.includes('skipDownload: true'), 'alteracaoCadastralExportar não descarrega antes do Outlook');
  // Só descarrega se ok === false (ponte falhou)
  assert.ok(ganho.includes('ok === false'), 'Ganho só descarrega se Outlook falhar');
  assert.ok(alt.includes('ok === false'), 'Alteração só descarrega se Outlook falhar');
  assert.ok(ganho.includes("ok === 'dialog'"), 'Ganho: diálogo Outlook sem download');
  assert.ok(alt.includes("ok === 'dialog'"), 'Alteração: diálogo Outlook sem download');
  const warn = html.slice(html.indexOf('function outlookWarnPonteDesatualizada'), html.indexOf('async function outlookProbeBridgeVersion'));
  assert.ok(!warn.includes('a.download'), 'warn da ponte NÃO descarrega o .bat');
});

check('ExcelJS: ficheiro local + loader tenta local antes do CDN', () => {
  const localPath = path.join(root, 'exceljs.min.js');
  assert.ok(fs.existsSync(localPath), 'exceljs.min.js no repositório');
  assert.ok(fs.statSync(localPath).size > 100000, 'exceljs.min.js não está vazio');
  const start = html.indexOf('async function prosEnsureExcelJS');
  const end = html.indexOf('\nasync function propGerarSimulador', start);
  const fn = html.slice(start, end);
  assert.ok(fn.includes('exceljs.min.js'));
  assert.ok(fn.includes('/delta-foods-equipamentos-app/exceljs.min.js'));
  const localIdx = fn.indexOf("'exceljs.min.js'");
  const cdnIdx = fn.indexOf('cdnjs.cloudflare.com');
  assert.ok(localIdx >= 0 && cdnIdx > localIdx, 'local antes do CDN Cloudflare');
  assert.ok(fn.includes('cdn.jsdelivr.net') || fn.includes('unpkg.com'), 'CDN fallback alternativo');
  const ps1 = fs.readFileSync(path.join(root, 'serve.ps1'), 'utf8');
  assert.ok(ps1.includes("'exceljs.min.js'"), 'serve.ps1 sincroniza exceljs.min.js');
});

check('XLSX/SheetJS: ficheiro local + ensureXLSX antes do CDN (↓ Excel Prospecção)', () => {
  const localPath = path.join(root, 'xlsx.full.min.js');
  assert.ok(fs.existsSync(localPath), 'xlsx.full.min.js no repositório');
  assert.ok(fs.statSync(localPath).size > 100000, 'xlsx.full.min.js não está vazio');
  const start = html.indexOf('async function ensureXLSX');
  const end = html.indexOf('\nfunction writeXlsxDownload', start);
  const fn = html.slice(start, end);
  assert.ok(fn.includes('xlsx.full.min.js'));
  assert.ok(fn.includes('/delta-foods-equipamentos-app/xlsx.full.min.js'));
  const localIdx = fn.indexOf("'xlsx.full.min.js'");
  const remoteIdx = Math.min(
    ...['XLSX_CDN', 'cdn.jsdelivr.net', 'unpkg.com']
      .map(s => { const i = fn.indexOf(s); return i < 0 ? Infinity : i; }),
  );
  assert.ok(localIdx >= 0 && remoteIdx > localIdx, 'local antes dos CDN remotos');
  // Sem loaders inline que bypassem ensureXLSX
  const inlineLoads = (html.match(/s\.src\s*=\s*'https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx/g) || []).length;
  assert.equal(inlineLoads, 0, 'não há s.src directo ao CDN xlsx');
  const ps1 = fs.readFileSync(path.join(root, 'serve.ps1'), 'utf8');
  assert.ok(ps1.includes("'xlsx.full.min.js'"), 'serve.ps1 sincroniza xlsx.full.min.js');
  const pros = html.slice(html.indexOf('async function exportProsExcel'), html.indexOf('\nfunction escHtml'));
  assert.ok(pros.includes('catch'), 'exportProsExcel mostra erro se falhar');
});

if (process.exitCode) {
  console.error('\nFalhou pelo menos um teste.');
  process.exit(process.exitCode);
}
console.log('\nTodos os testes de email/chamado AT passaram.');
