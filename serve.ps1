# Ponte instalada (silent): preferir 8090 — 8088/8080 costumam estar ocupadas
# por Live Server / IIS / outros sem CORS → Chrome: «No Access-Control-Allow-Origin»
# e a app cai no .eml em Transferências.
$silent = ($env:DELTA_OUTLOOK_SILENT -eq '1')
$preferred = if ($env:PORT) { [int]$env:PORT } elseif ($silent) { 8090 } else { 8088 }
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $root 'delta-foods-equipamentos-app'
$syncFiles = @('index.html', 'manifest.json', 'sw.js', 'simulador-template.js', 'exceljs.min.js', 'xlsx.full.min.js', 'pdf-lib.min.js', 'mc00-template.xlsx', 'quebra-template.xlsx', 'icon-192.png', 'icon-512.png')

# Ponte instalada (LocalAppData): actualiza serve.ps1 a partir do main e reinicia.
# Assim o Display($false)/com-v4 chega sem voltar a correr o .bat.
if (
    $silent -and
    $env:DELTA_OUTLOOK_NO_UPDATE -ne '1' -and
    $env:DELTA_OUTLOOK_UPDATING -ne '1' -and
    $root -like '*\DeltaFoodsOutlookBridge'
) {
    try {
        $selfPath = $MyInvocation.MyCommand.Path
        $updUrl = 'https://raw.githubusercontent.com/CarlosCastro1979/delta-foods-equipamentos-app/main/serve.ps1'
        $updTmp = Join-Path $env:TEMP ('DeltaServeUpd_{0}.ps1' -f [guid]::NewGuid().ToString('N').Substring(0, 8))
        Invoke-WebRequest -UseBasicParsing -Uri $updUrl -OutFile $updTmp -TimeoutSec 20
        $newTxt = [IO.File]::ReadAllText($updTmp)
        $curTxt = [IO.File]::ReadAllText($selfPath)
        if ($newTxt -match "X-Delta-Outlook-Bridge.*=.*'com-v4'" -and $newTxt -ne $curTxt) {
            Copy-Item -LiteralPath $updTmp -Destination $selfPath -Force
            Remove-Item -LiteralPath $updTmp -Force -ErrorAction SilentlyContinue
            $env:DELTA_OUTLOOK_UPDATING = '1'
            Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
                '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $selfPath
            )
            exit 0
        }
        Remove-Item -LiteralPath $updTmp -Force -ErrorAction SilentlyContinue
    } catch { }
}

function Write-Info([string]$msg, [string]$color = 'Gray') {
    if ($silent) { return }
    if ($color -eq 'Gray') { Write-Host $msg -ForegroundColor DarkGray }
    elseif ($color -eq 'Green') { Write-Host $msg -ForegroundColor Green }
    elseif ($color -eq 'Cyan') { Write-Host $msg -ForegroundColor Cyan }
    elseif ($color -eq 'Yellow') { Write-Host $msg -ForegroundColor DarkYellow }
    elseif ($color -eq 'Red') { Write-Host $msg -ForegroundColor Red }
    else { Write-Host $msg }
}

function Sync-AppAssets {
    New-Item -ItemType Directory -Force -Path $appDir | Out-Null
    foreach ($f in $syncFiles) {
        $src = Join-Path $root $f
        if (-not (Test-Path $src)) { continue }
        $dst = Join-Path $appDir $f
        # Sempre copiar: uma pasta aninhada mais recente bloqueava o git pull
        # e o Outlook continuava a abrir o index.html antigo (Para: Carlos).
        Copy-Item $src $dst -Force
    }
}

function Get-Mc00EmailTo {
    $indexSrc = Join-Path $root 'index.html'
    if (-not (Test-Path $indexSrc)) { return 'index.html ausente' }
    $m = Select-String -Path $indexSrc -Pattern "const EMAIL_MC00_TO = '([^']+)'" | Select-Object -First 1
    if ($m) { return $m.Matches[0].Groups[1].Value }
    return 'AUSENTE — esta pasta ainda e o codigo antigo (Para: Carlos)'
}

Sync-AppAssets

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'application/javascript'
    '.json' = 'application/json'
    '.png'  = 'image/png'
    '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    '.eml'  = 'message/rfc822'
}

function Resolve-FilePath([string]$path) {
    $rel = $path.TrimStart('/').Replace('/', '\')
    if ([string]::IsNullOrEmpty($rel)) {
        $rel = 'delta-foods-equipamentos-app\index.html'
    }
    $file = Join-Path $root $rel
    if (Test-Path $file -PathType Leaf) { return $file }
    $subPrefix = 'delta-foods-equipamentos-app' + [IO.Path]::DirectorySeparatorChar
    if ($rel.StartsWith($subPrefix)) {
        $alt = Join-Path $root $rel.Substring($subPrefix.Length)
        if (Test-Path $alt -PathType Leaf) { return $alt }
    }
    if ($rel.EndsWith('\')) { $rel = $rel.TrimEnd('\') }
    $index = Join-Path $rel 'index.html'
    $file = Join-Path $root $index
    if (Test-Path $file -PathType Leaf) { return $file }
    return $null
}

function Start-AppListener([int]$port) {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Prefixes.Add("http://127.0.0.1:$port/")
    $listener.Start()
    return $listener
}

# Força janela Outlook à frente (ShellExecute .eml a partir deste processo
# não tem direito de foreground → Outlook fica na taskbar com toast "a abrir…").
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OutlookFg {
  public const int SW_RESTORE = 9;
  public const int SW_SHOW = 5;
  public const byte VK_MENU = 0x12;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  public static void BringToFront(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return;
    AllowSetForegroundWindow(-1);
    IntPtr fg = GetForegroundWindow();
    uint fgPid;
    uint fgTid = GetWindowThreadProcessId(fg, out fgPid);
    uint cur = GetCurrentThreadId();
    AttachThreadInput(cur, fgTid, true);
    // Alt + minimize/restore força o Windows a ceder o foreground
    keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
    ShowWindow(hWnd, SW_SHOW);
    if (IsIconic(hWnd)) ShowWindow(hWnd, SW_RESTORE);
    else {
      ShowWindow(hWnd, 6); // SW_MINIMIZE
      ShowWindow(hWnd, SW_RESTORE);
    }
    SwitchToThisWindow(hWnd, true);
    SetForegroundWindow(hWnd);
    keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    AttachThreadInput(cur, fgTid, false);
    SetForegroundWindow(hWnd);
  }
}
'@ -ErrorAction SilentlyContinue

function Get-OutlookInspectorCount($outlook) {
    if (-not $outlook) { return 0 }
    try { return [int]$outlook.Inspectors.Count } catch { return 0 }
}

function Activate-OutlookInspector($outlook, [int]$index1Based) {
    if (-not $outlook -or $index1Based -lt 1) { return $false }
    try {
        $insp = $outlook.Inspectors.Item($index1Based)
        $insp.Activate()
        try {
            $hwnd = [IntPtr]$insp.HWND
            if ($hwnd -ne [IntPtr]::Zero) { [OutlookFg]::BringToFront($hwnd) }
        } catch { }
        return $true
    } catch { return $false }
}

function Activate-OutlookForeground {
    # 1) Activar o último Inspector COM (janela do rascunho)
    try {
        $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
        $n = Get-OutlookInspectorCount $outlook
        if ($n -ge 1 -and (Activate-OutlookInspector $outlook $n)) { return $true }
    } catch { }

    # 2) Fallback: qualquer janela do processo OUTLOOK
    $procs = @(Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
        Sort-Object StartTime -Descending)
    foreach ($p in $procs) {
        try {
            [OutlookFg]::AllowSetForegroundWindow($p.Id)
            [OutlookFg]::BringToFront($p.MainWindowHandle)
            return $true
        } catch { }
    }
    return $false
}

function Test-ClassicOutlookExePath([string]$p) {
    if (-not $p) { return $false }
    if ($p -match '(?i)(olk\.exe|WindowsApps|OutlookForWindows|Microsoft\.OutlookForWindows)') { return $false }
    return (Test-Path -LiteralPath $p)
}

function Get-ClassicOutlookExe {
    # Preferir Office16\OUTLOOK.EXE clássico.
    # App Paths / outlook.exe no PATH muitas vezes aponta para o Outlook novo
    # (olk) que rejeita /eml com «O argumento de linha de comando não é válido».
    $candidates = @(
        "$env:ProgramFiles\Microsoft Office\root\Office16\OUTLOOK.EXE",
        "${env:ProgramFiles(x86)}\Microsoft Office\root\Office16\OUTLOOK.EXE",
        "$env:ProgramFiles\Microsoft Office\Office16\OUTLOOK.EXE",
        "${env:ProgramFiles(x86)}\Microsoft Office\Office16\OUTLOOK.EXE",
        "$env:ProgramFiles\Microsoft Office\root\Office15\OUTLOOK.EXE",
        "${env:ProgramFiles(x86)}\Microsoft Office\root\Office15\OUTLOOK.EXE"
    )
    try {
        $fromAppPaths = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\OUTLOOK.EXE' -ErrorAction Stop).'(default)'
        if ($fromAppPaths) { $candidates += $fromAppPaths }
    } catch { }
    foreach ($p in $candidates) {
        if (Test-ClassicOutlookExePath $p) { return $p }
    }
    $cmd = Get-Command outlook.exe -ErrorAction SilentlyContinue
    if ($cmd -and (Test-ClassicOutlookExePath $cmd.Source)) { return $cmd.Source }
    return $null
}

function Decode-OutlookSubject([string]$raw) {
    if (-not $raw) { return '' }
    $s = $raw.Trim()
    # =?UTF-8?B?...?=  /  =?UTF-8?Q?...?=
    if ($s -match '^=\?([^?]+)\?([BbQq])\?([^?]+)\?=') {
        $charset = $Matches[1]
        $enc = $Matches[2].ToUpperInvariant()
        $payload = $Matches[3]
        try {
            if ($enc -eq 'B') {
                $bytes = [Convert]::FromBase64String($payload)
                return [Text.Encoding]::GetEncoding($charset).GetString($bytes)
            }
            # Q-encoding simplificado
            $sb = New-Object Text.StringBuilder
            for ($i = 0; $i -lt $payload.Length; $i++) {
                $ch = $payload[$i]
                if ($ch -eq '_') { [void]$sb.Append(' ') }
                elseif ($ch -eq '=' -and ($i + 2) -lt $payload.Length) {
                    $hex = $payload.Substring($i + 1, 2)
                    [void]$sb.Append([char][Convert]::ToInt32($hex, 16))
                    $i += 2
                } else { [void]$sb.Append($ch) }
            }
            $bytes = [Text.Encoding]::GetEncoding('ISO-8859-1').GetBytes($sb.ToString())
            return [Text.Encoding]::GetEncoding($charset).GetString($bytes)
        } catch { return $s }
    }
    return $s
}

function Parse-DeltaEml([string]$emlPath) {
    # Formato gerado por outlookAbrirRascunho (multipart/mixed + HTML + anexos base64).
    $bytes = [IO.File]::ReadAllBytes($emlPath)
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    $norm = $text -replace "`r`n", "`n" -replace "`r", "`n"
    $headerEnd = $norm.IndexOf("`n`n")
    if ($headerEnd -lt 0) { throw "EML sem cabeçalhos" }
    $headerBlock = $norm.Substring(0, $headerEnd)
    $bodyAll = $norm.Substring($headerEnd + 2)

    $to = ''; $cc = ''; $subject = ''; $boundary = ''
    foreach ($line in ($headerBlock -split "`n")) {
        if ($line -match '^(?i)To:\s*(.*)$') { $to = $Matches[1].Trim() }
        elseif ($line -match '^(?i)Cc:\s*(.*)$') { $cc = $Matches[1].Trim() }
        elseif ($line -match '^(?i)Subject:\s*(.*)$') { $subject = Decode-OutlookSubject $Matches[1] }
        elseif ($line -match '(?i)boundary="([^"]+)"') { $boundary = $Matches[1] }
    }
    if (-not $boundary) { throw "EML sem boundary" }

    $sep = "--$boundary"
    $parts = $bodyAll -split [regex]::Escape($sep)
    $html = ''
    $attachments = New-Object System.Collections.Generic.List[object]
    foreach ($part in $parts) {
        $p = $part.Trim("`n", "`r", ' ')
        if (-not $p -or $p -eq '--') { continue }
        $pEnd = $p.IndexOf("`n`n")
        if ($pEnd -lt 0) { continue }
        $pHead = $p.Substring(0, $pEnd)
        $pBody = $p.Substring($pEnd + 2).TrimEnd("`n", "`r", ' ')
        if ($pBody.EndsWith('--')) { $pBody = $pBody.Substring(0, $pBody.Length - 2).TrimEnd() }

        if ($pHead -match '(?i)Content-Type:\s*text/html') {
            $html = $pBody
            continue
        }
        if ($pHead -match '(?i)Content-Disposition:\s*attachment' -or $pHead -match '(?i)name="([^"]+)"') {
            $fname = 'anexo.bin'
            if ($pHead -match '(?i)filename="([^"]+)"') { $fname = $Matches[1] }
            elseif ($pHead -match '(?i)name="([^"]+)"') { $fname = $Matches[1] }
            $b64 = ($pBody -replace '\s', '')
            try {
                $attBytes = [Convert]::FromBase64String($b64)
                $attachments.Add([pscustomobject]@{ Name = $fname; Bytes = $attBytes }) | Out-Null
            } catch {
                Write-Info "  WARN anexo base64: $fname" 'Yellow'
            }
        }
    }
    return [pscustomobject]@{
        To = $to; Cc = $cc; Subject = $subject; Html = $html; Attachments = $attachments
    }
}

function Add-OutlookRecipientList($mail, [string]$addrList, [int]$type) {
    # Nunca atribuir $mail.To / $mail.CC com lista (vírgula ou ;).
    # No Outlook PT-BR, a propriedade .CC com vários endereços cai em vírgulas
    # e o «Verificar nomes» pede ponto-e-vírgula. Recipients.Add evita isso.
    foreach ($raw in ($addrList -split '[,;]')) {
        $addr = ([string]$raw).Trim()
        if (-not $addr) { continue }
        $r = $mail.Recipients.Add($addr)
        $r.Type = $type # 1=olTo, 2=olCC, 3=olBCC
    }
}

function Open-EmlViaCom([string]$emlPath, $outlook = $null) {
    # Abre rascunho com CreateItem — sem argv /eml (evita «argumento inválido»
    # no Outlook novo / App Paths errado).
    # Display($false): modal ($true) bloqueava o HTTP 204 (timeout → downloads no
    # browser) e deixava o Outlook com «Há uma caixa de diálogo aberta».
    $parsed = Parse-DeltaEml $emlPath
    $created = $false
    if (-not $outlook) {
        try { $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') } catch { }
    }
    if (-not $outlook) {
        $outlook = New-Object -ComObject Outlook.Application
        $created = $true
    }

    $lastErr = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $mail = $null
        $tmpAtts = @()
        try {
            $mail = $outlook.CreateItem(0) # olMailItem
            if ($parsed.To) { Add-OutlookRecipientList $mail $parsed.To 1 }
            if ($parsed.Cc) { Add-OutlookRecipientList $mail $parsed.Cc 2 }
            if ($parsed.Subject) { $mail.Subject = $parsed.Subject }
            if ($parsed.Html) { $mail.HTMLBody = $parsed.Html }
            try { [void]$mail.Recipients.ResolveAll() } catch { }

            foreach ($att in $parsed.Attachments) {
                $safeName = ($att.Name -replace '[\\/:*?"<>|]', '_')
                if (-not $safeName) { $safeName = 'anexo.bin' }
                $tmp = Join-Path $env:TEMP ('DeltaAtt_{0}_{1}' -f [guid]::NewGuid().ToString('N').Substring(0, 8), $safeName)
                [IO.File]::WriteAllBytes($tmp, $att.Bytes)
                $tmpAtts += $tmp
                [void]$mail.Attachments.Add($tmp)
            }
            $mail.Display($false)
            return @{ Outlook = $outlook; Created = $created; TempAtts = $tmpAtts; Mail = $mail }
        } catch {
            $lastErr = $_
            $msg = [string]$_.Exception.Message
            foreach ($t in $tmpAtts) { try { Remove-Item -LiteralPath $t -Force -ErrorAction SilentlyContinue } catch { } }
            if ($msg -match '(?i)di[aá]logo|dialog|caixa' -or $attempt -lt 3) {
                Write-Info "  WARN Outlook COM (tentativa $attempt): $msg" 'Yellow'
                Start-Sleep -Milliseconds (500 * $attempt)
                continue
            }
            throw
        }
    }
    throw $lastErr
}

function Start-EmlDraft([string]$emlPath) {
    # SÓ COM CreateItem — nunca lançar outlook.exe com switches de linha de comando.
    # Lançar o exe com switch inválido NÃO falha no PowerShell: o Outlook abre o
    # diálogo «argumento de linha de comando não é válido» e o browser já recebeu 204.
    $before = 0
    $outlook = $null
    try {
        $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
        $before = Get-OutlookInspectorCount $outlook
    } catch { }

    $safePath = $emlPath
    try {
        $safePath = Join-Path $env:TEMP ('DeltaDraft_{0}.eml' -f [guid]::NewGuid().ToString('N').Substring(0, 8))
        Copy-Item -LiteralPath $emlPath -Destination $safePath -Force
    } catch {
        $safePath = $emlPath
    }

    $com = Open-EmlViaCom $safePath $outlook
    return @{
        Before = $before
        Outlook = $com.Outlook
        Method = 'com'
        TempAtts = $com.TempAtts
        Deferred = $false
    }
}

function Complete-EmlDraftFocus($state) {
    if (-not $state) {
        [void](Activate-OutlookForeground)
        return
    }
    $before = [int]$state.Before
    $outlook = $state.Outlook
    $activated = $false
    # Mais tempo: cold-start do Outlook após ShellExecute do .eml
    for ($i = 0; $i -lt 80; $i++) {
        Start-Sleep -Milliseconds 200
        try {
            if (-not $outlook) {
                try {
                    $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
                } catch {
                    # Só agora (depois do ShellExecute) — não bloqueia o HTTP 204
                    if ($i -ge 5) {
                        try { $outlook = New-Object -ComObject Outlook.Application } catch { }
                    }
                }
            }
            if (-not $outlook) { continue }
            $n = Get-OutlookInspectorCount $outlook
            if ($n -gt $before -or ($before -eq 0 -and $n -ge 1)) {
                [void](Activate-OutlookInspector $outlook $n)
                [void](Activate-OutlookForeground)
                $activated = $true
                # Retries — Windows por vezes ignora o 1.º SetForeground
                Start-Sleep -Milliseconds 200
                [void](Activate-OutlookInspector $outlook $n)
                [void](Activate-OutlookForeground)
                Start-Sleep -Milliseconds 350
                [void](Activate-OutlookForeground)
                return
            }
        } catch { }
    }
    if (-not $activated) {
        [void](Activate-OutlookForeground)
        Start-Sleep -Milliseconds 250
        [void](Activate-OutlookForeground)
    }
}

function Open-EmlDraft([string]$emlPath) {
    $st = Start-EmlDraft $emlPath
    Complete-EmlDraftFocus $st
}

function Set-CorsHeaders($res) {
    # GitHub Pages (HTTPS público) → localhost: Chrome exige Private Network Access
    $res.Headers['Access-Control-Allow-Origin'] = '*'
    $res.Headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS, GET'
    $res.Headers['Access-Control-Allow-Headers'] = 'Content-Type, Access-Control-Request-Private-Network'
    $res.Headers['Access-Control-Allow-Private-Network'] = 'true'
    $res.Headers['Access-Control-Expose-Headers'] = 'X-Delta-Outlook-Bridge'
    $res.Headers['Access-Control-Max-Age'] = '86400'
    # Versão da ponte: o browser recusa pontes antigas (Display modal / /eml).
    $res.Headers['X-Delta-Outlook-Bridge'] = 'com-v4'
}

$listener = $null
$port = $null
$portOrder = if ($silent) {
    @($preferred, 8090, 5505, 8088, 8080) | Select-Object -Unique
} else {
    @($preferred, 8088, 8080, 8090, 5505) | Select-Object -Unique
}
foreach ($tryPort in $portOrder) {
    try {
        $listener = Start-AppListener $tryPort
        $port = $tryPort
        break
    } catch {
        Write-Info "Porta $tryPort ocupada - a tentar outra..." 'Yellow'
    }
}
if (-not $listener) {
    throw "Nao foi possivel iniciar o servidor local (portas ocupadas). Fecha o processo na 8088/8080 ou define PORT."
}

Write-Info ''
Write-Info 'Delta Foods - Gestao de Equipamentos' 'Green'
Write-Info "Local:  http://localhost:$port/delta-foods-equipamentos-app/" 'Cyan'
Write-Info "MC00 Para (desta pasta): $(Get-Mc00EmailTo)" 'Cyan'
Write-Info 'O Outlook usa o Para/CC da PAGINA no browser, nao so desta pasta.' 'Yellow'
Write-Info 'github.io = main em producao. Sem o PR 73 no main, o site online continua Para: Carlos.' 'Yellow'
Write-Info 'API Outlook: POST /api/open-outlook-draft (CORS + Private Network)' 'Gray'
Write-Info 'Ctrl+C para parar' 'Gray'
Write-Info ''

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    $openEmlPath = $null
    $openEmlKb = 0
    $openEmlState = $null
    try {
        Sync-AppAssets
        $path = $ctx.Request.Url.LocalPath
        $method = $ctx.Request.HttpMethod
        $isOutlookPath = (
            $path -eq '/api/open-outlook-draft' -or
            $path -eq '/api/open-mc00-email' -or
            $path -eq '/delta-foods-equipamentos-app/api/open-outlook-draft' -or
            $path -eq '/delta-foods-equipamentos-app/api/open-mc00-email'
        )

        if ($isOutlookPath) {
            Set-CorsHeaders $res
            if ($method -eq 'OPTIONS' -or $method -eq 'GET') {
                # GET/OPTIONS = health-check do browser (outlookFindLiveApi), sem abrir Outlook
                $res.StatusCode = 204
                $res.ContentLength64 = 0
                Write-Info "  204  $method $path (CORS/health)" 'Gray'
            } elseif ($method -eq 'POST') {
                $ms = New-Object System.IO.MemoryStream
                $ctx.Request.InputStream.CopyTo($ms)
                $emlBytes = $ms.ToArray()
                if ($emlBytes.Length -lt 20 -or $emlBytes.Length -gt 25MB) {
                    $res.StatusCode = 400
                    $err = [Text.Encoding]::UTF8.GetBytes('Invalid draft')
                    $res.ContentLength64 = $err.Length
                    $res.OutputStream.Write($err, 0, $err.Length)
                    Write-Info "  400  POST $path (draft invalido)" 'Yellow'
                } else {
                    $tmp = Join-Path $env:TEMP ("MC00_draft_{0}.eml" -f [guid]::NewGuid().ToString('N'))
                    [IO.File]::WriteAllBytes($tmp, $emlBytes)
                    $openEmlPath = $tmp
                    $openEmlKb = [math]::Round($emlBytes.Length / 1KB)
                    # Se o Outlook clássico já corre: abrir já (foco do clique).
                    # Se não: responder 204 já e abrir COM depois — cold-start COM
                    # demora e o browser abortava o POST (timeout → fallback mau).
                    $outlookRunning = $false
                    try {
                        $null = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
                        $outlookRunning = $true
                    } catch { }
                    if ($outlookRunning) {
                        try {
                            $openEmlState = Start-EmlDraft $openEmlPath
                            $res.StatusCode = 204
                            $res.ContentLength64 = 0
                        } catch {
                            # Caixa de diálogo aberta no Outlook: NÃO mentir 204
                            # (o browser timeout/falha → Excel+.eml em Transferências).
                            Write-Info "  503  POST $path (Outlook: $($_.Exception.Message))" 'Yellow'
                            $res.StatusCode = 503
                            $err = [Text.Encoding]::UTF8.GetBytes('Outlook dialog open')
                            $res.ContentLength64 = $err.Length
                            $res.OutputStream.Write($err, 0, $err.Length)
                            try { Remove-Item -LiteralPath $openEmlPath -Force -ErrorAction SilentlyContinue } catch { }
                            $openEmlPath = $null
                            $openEmlState = $null
                        }
                    } else {
                        $openEmlState = @{ Deferred = $true; Path = $openEmlPath; Before = 0 }
                        $res.StatusCode = 204
                        $res.ContentLength64 = 0
                    }
                }
            } else {
                $res.StatusCode = 405
                $res.ContentLength64 = 0
            }
        } else {
            $file = Resolve-FilePath $path
            if ($null -eq $file) {
                $res.StatusCode = 404
                $body = [Text.Encoding]::UTF8.GetBytes('Not Found')
                $res.ContentLength64 = $body.Length
                $res.OutputStream.Write($body, 0, $body.Length)
            } else {
                $bytes = [System.IO.File]::ReadAllBytes($file)
                $ext = [System.IO.Path]::GetExtension($file).ToLower()
                if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] }
                if ($ext -in @('.html', '.js', '.json')) {
                    $res.Headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
                    $res.Headers['Pragma'] = 'no-cache'
                    $res.Headers['Expires'] = '0'
                }
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        }
    } catch {
        Write-Info "  ERR  $($_.Exception.Message)" 'Red'
        try { $res.StatusCode = 500 } catch { }
    }

    try { $res.Close() } catch { }

    # Abrir / focar Outlook depois do 204 (não bloqueia o browser)
    if ($openEmlPath) {
        try {
            if ($openEmlState -and $openEmlState.Deferred) {
                $pathOpen = if ($openEmlState.Path) { $openEmlState.Path } else { $openEmlPath }
                $openEmlState = Start-EmlDraft $pathOpen
            }
            Complete-EmlDraftFocus $openEmlState
            $method = if ($openEmlState -and $openEmlState.Method) { $openEmlState.Method } else { '?' }
            Write-Info "  204  POST -> Outlook ($openEmlKb KB, $method)" 'Gray'
        } catch {
            Write-Info "  WARN eml gravado mas Outlook nao abriu: $($_.Exception.Message)" 'Yellow'
        }
    }
}
