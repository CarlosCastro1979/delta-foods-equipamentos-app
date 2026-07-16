$preferred = if ($env:PORT) { [int]$env:PORT } else { 8080 }
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

function Open-EmlDraft([string]$emlPath) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $emlPath
    $psi.UseShellExecute = $true
    [void][System.Diagnostics.Process]::Start($psi)
}

$listener = $null
$port = $null
foreach ($tryPort in @($preferred, 8080, 8088, 8090, 5505)) {
    try {
        $listener = Start-AppListener $tryPort
        $port = $tryPort
        break
    } catch {
        Write-Host "Porta $tryPort ocupada - a tentar outra..." -ForegroundColor DarkYellow
    }
}
if (-not $listener) {
    throw "Nao foi possivel iniciar o servidor local (portas ocupadas). Fecha o processo na 8080/8090 ou define PORT."
}

Write-Host ''
Write-Host 'Delta Foods - Gestao de Equipamentos' -ForegroundColor Green
Write-Host "Local:  http://localhost:$port/delta-foods-equipamentos-app/" -ForegroundColor Cyan
Write-Host 'API Outlook: POST /api/open-outlook-draft' -ForegroundColor DarkGray
Write-Host 'Online: https://carloscastro1979.github.io/delta-foods-equipamentos-app/' -ForegroundColor DarkGray
Write-Host 'Ctrl+C para parar' -ForegroundColor DarkGray
Write-Host ''

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    $openEmlPath = $null
    $openEmlKb = 0
    try {
        Sync-AppAssets
        $path = $ctx.Request.Url.LocalPath
        $isOutlookApi = ($ctx.Request.HttpMethod -eq 'POST') -and (
            $path -eq '/api/open-outlook-draft' -or
            $path -eq '/api/open-mc00-email' -or
            $path -eq '/delta-foods-equipamentos-app/api/open-outlook-draft' -or
            $path -eq '/delta-foods-equipamentos-app/api/open-mc00-email'
        )

        if ($isOutlookApi) {
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
                $res.StatusCode = 204
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

    # Abrir Outlook so depois de fechar a resposta HTTP (evita hang no browser).
    if ($openEmlPath) {
        try {
            Open-EmlDraft $openEmlPath
            Write-Host "  204  POST -> Outlook ($openEmlKb KB)" -ForegroundColor DarkGray
        } catch {
            Write-Host "  WARN eml gravado mas Outlook nao abriu: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}
