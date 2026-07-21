$preferred = if ($env:PORT) { [int]$env:PORT } else { 8088 }
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $root 'delta-foods-equipamentos-app'
$syncFiles = @('index.html', 'manifest.json', 'sw.js', 'simulador-template.js', 'mc00-template.xlsx', 'icon-192.png', 'icon-512.png')

function Sync-AppAssets {
    New-Item -ItemType Directory -Force -Path $appDir | Out-Null
    foreach ($f in $syncFiles) {
        $src = Join-Path $root $f
        if (-not (Test-Path $src)) { continue }
        $dst = Join-Path $appDir $f
        if (-not (Test-Path $dst) -or (Get-Item $src).LastWriteTimeUtc -gt (Get-Item $dst).LastWriteTimeUtc) {
            Copy-Item $src $dst -Force
        }
    }
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

function Start-EmlDraft([string]$emlPath) {
    # Contar inspectors + ShellExecute já (antes de fechar HTTP → melhor chance de foco)
    $before = 0
    $outlook = $null
    try {
        $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
        $before = Get-OutlookInspectorCount $outlook
    } catch {
        try {
            $outlook = New-Object -ComObject Outlook.Application
            $before = Get-OutlookInspectorCount $outlook
        } catch { }
    }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $emlPath
    $psi.UseShellExecute = $true
    [void][System.Diagnostics.Process]::Start($psi)
    return @{ Before = $before; Outlook = $outlook }
}

function Complete-EmlDraftFocus($state) {
    if (-not $state) {
        [void](Activate-OutlookForeground)
        return
    }
    $before = [int]$state.Before
    $outlook = $state.Outlook
    $activated = $false
    for ($i = 0; $i -lt 50; $i++) {
        Start-Sleep -Milliseconds 160
        try {
            if (-not $outlook) {
                $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
            }
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
    # Permite GitHub Pages / outro host chamar a API local para abrir o Outlook
    $res.Headers['Access-Control-Allow-Origin'] = '*'
    $res.Headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS, GET'
    $res.Headers['Access-Control-Allow-Headers'] = 'Content-Type'
    $res.Headers['Access-Control-Max-Age'] = '86400'
}

$listener = $null
$port = $null
foreach ($tryPort in @($preferred, 8088, 8080, 8090, 5505)) {
    try {
        $listener = Start-AppListener $tryPort
        $port = $tryPort
        break
    } catch {
        Write-Host "Porta $tryPort ocupada - a tentar outra..." -ForegroundColor DarkYellow
    }
}
if (-not $listener) {
    throw "Nao foi possivel iniciar o servidor local (portas ocupadas). Fecha o processo na 8088/8080 ou define PORT."
}

Write-Host ''
Write-Host 'Delta Foods - Gestao de Equipamentos' -ForegroundColor Green
Write-Host "Local:  http://localhost:$port/delta-foods-equipamentos-app/" -ForegroundColor Cyan
Write-Host 'API Outlook: POST /api/open-outlook-draft (CORS activo)' -ForegroundColor DarkGray
Write-Host 'Online: https://carloscastro1979.github.io/delta-foods-equipamentos-app/' -ForegroundColor DarkGray
Write-Host 'Ctrl+C para parar' -ForegroundColor DarkGray
Write-Host ''

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
            if ($method -eq 'OPTIONS') {
                $res.StatusCode = 204
                $res.ContentLength64 = 0
                Write-Host "  204  OPTIONS $path (CORS)" -ForegroundColor DarkGray
            } elseif ($method -eq 'POST') {
                $ms = New-Object System.IO.MemoryStream
                $ctx.Request.InputStream.CopyTo($ms)
                $emlBytes = $ms.ToArray()
                if ($emlBytes.Length -lt 20 -or $emlBytes.Length -gt 25MB) {
                    $res.StatusCode = 400
                    $err = [Text.Encoding]::UTF8.GetBytes('Invalid draft')
                    $res.ContentLength64 = $err.Length
                    $res.OutputStream.Write($err, 0, $err.Length)
                    Write-Host "  400  POST $path (draft invalido)" -ForegroundColor Yellow
                } else {
                    $tmp = Join-Path $env:TEMP ("MC00_draft_{0}.eml" -f [guid]::NewGuid().ToString('N'))
                    [IO.File]::WriteAllBytes($tmp, $emlBytes)
                    $openEmlPath = $tmp
                    $openEmlKb = [math]::Round($emlBytes.Length / 1KB)
                    # ShellExecute ANTES do 204 — preserva melhor a cadeia de foco do clique
                    try { $openEmlState = Start-EmlDraft $openEmlPath } catch {
                        Write-Host "  WARN Start-EmlDraft: $($_.Exception.Message)" -ForegroundColor Yellow
                    }
                    $res.StatusCode = 204
                    $res.ContentLength64 = 0
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
        Write-Host "  ERR  $($_.Exception.Message)" -ForegroundColor Red
        try { $res.StatusCode = 500 } catch { Write-Host '' }
    }

    try { $res.Close() } catch { Write-Host '' }

    # Trazer Outlook à frente depois do 204 (retries sem bloquear o browser)
    if ($openEmlPath) {
        try {
            Complete-EmlDraftFocus $openEmlState
            Write-Host "  204  POST -> Outlook ($openEmlKb KB)" -ForegroundColor DarkGray
        } catch {
            Write-Host "  WARN eml gravado mas Outlook nao abriu: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}
