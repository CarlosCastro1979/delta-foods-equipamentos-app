$port = if ($env:PORT) { [int]$env:PORT } else { 8080 }
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

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host 'Delta Foods · Gestao de Equipamentos'
Write-Host "Local:  http://localhost:$port/delta-foods-equipamentos-app/"
Write-Host "Online: https://carloscastro1979.github.io/delta-foods-equipamentos-app/"

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
        Sync-AppAssets
        $path = $ctx.Request.Url.LocalPath

        # Abre rascunho no Outlook (HTML no corpo + anexos) — sem download/colar
        if ($ctx.Request.HttpMethod -eq 'POST' -and (
            $path -eq '/api/open-outlook-draft' -or
            $path -eq '/api/open-mc00-email' -or
            $path -eq '/delta-foods-equipamentos-app/api/open-outlook-draft' -or
            $path -eq '/delta-foods-equipamentos-app/api/open-mc00-email'
        )) {
            $ms = New-Object System.IO.MemoryStream
            $ctx.Request.InputStream.CopyTo($ms)
            $emlBytes = $ms.ToArray()
            if ($emlBytes.Length -lt 20 -or $emlBytes.Length -gt 25MB) {
                $res.StatusCode = 400
                $err = [Text.Encoding]::UTF8.GetBytes('Invalid draft')
                $res.OutputStream.Write($err, 0, $err.Length)
                continue
            }
            $tmp = Join-Path $env:TEMP ("MC00_draft_{0}.eml" -f [guid]::NewGuid().ToString('N'))
            [IO.File]::WriteAllBytes($tmp, $emlBytes)
            Start-Process -FilePath $tmp | Out-Null
            $res.StatusCode = 204
            continue
        }

        $file = Resolve-FilePath $path
        if ($null -eq $file) {
            $res.StatusCode = 404
            $body = [Text.Encoding]::UTF8.GetBytes('Not Found')
            $res.OutputStream.Write($body, 0, $body.Length)
            continue
        }
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
    finally {
        $res.Close()
    }
}
