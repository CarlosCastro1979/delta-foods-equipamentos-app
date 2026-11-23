#Requires -Version 5.1
<#
.SYNOPSIS
  Instala a ponte Outlook (serve.ps1) em LocalAppData + Startup — silencioso.

.DESCRIPTION
  Para TODOS os PCs de uma vez (Intune / GPO / script de logon), NÃO precisas
  de correr o .bat em cada secretária. Este script é idempotente: podes
  republicar sempre; só actualiza ficheiros e reinicia a ponte.

  Intune (script de utilizador) ou GPO Logon:
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File \\servidor\share\Instalar-Ponte-Outlook-Todos.ps1

  Ou one-liner (utilizador com internet):
    irm https://raw.githubusercontent.com/CarlosCastro1979/delta-foods-equipamentos-app/main/Instalar-Ponte-Outlook-Todos.ps1 | iex

  Depois da 1.ª instalação, serve.ps1 actualiza-se sozinho a partir do main.
#>
[CmdletBinding()]
param(
    [switch]$Interactive
)

$ErrorActionPreference = 'Continue'
$serveUrl = 'https://raw.githubusercontent.com/CarlosCastro1979/delta-foods-equipamentos-app/main/serve.ps1'
$dfDir = Join-Path $env:LOCALAPPDATA 'DeltaFoodsOutlookBridge'
$serve = Join-Path $dfDir 'serve.ps1'
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$vbs = Join-Path $startup 'DeltaFoods-Outlook-Bridge.vbs'
$ports = @(8090, 5505, 8088, 8080)

function Write-Step([string]$msg) {
    if ($Interactive) { Write-Host $msg }
}

try {
    New-Item -ItemType Directory -Force -Path $dfDir | Out-Null
    New-Item -ItemType Directory -Force -Path $startup | Out-Null

    Write-Step '[1/4] A libertar portas e pontes antigas...'
    foreach ($p in $ports) {
        try {
            Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
                ForEach-Object {
                    $procId = $_.OwningProcess
                    if ($procId -and $procId -gt 0) {
                        Write-Step ("      PID $procId porta $p")
                        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                    }
                }
        } catch { }
    }
    try {
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.CommandLine -and (
                    $_.CommandLine -like '*serve.ps1*' -or
                    $_.CommandLine -like '*DeltaFoodsOutlookBridge*'
                )
            } |
            ForEach-Object {
                Write-Step ("      kill serve PID $($_.ProcessId)")
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
    } catch { }
    Start-Sleep -Seconds 1

    Write-Step '[2/4] A descarregar serve.ps1...'
    $tmp = Join-Path $env:TEMP ("DeltaServe_{0}.ps1" -f [guid]::NewGuid().ToString('N').Substring(0, 8))
    Invoke-WebRequest -UseBasicParsing -Uri $serveUrl -OutFile $tmp -TimeoutSec 60
    if (-not (Test-Path -LiteralPath $tmp)) { throw 'Download serve.ps1 falhou' }
    Copy-Item -LiteralPath $tmp -Destination $serve -Force
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue

    Write-Step '[3/4] A instalar no arranque do Windows...'
    $vbsBody = @(
        'Set sh = CreateObject("WScript.Shell")'
        'sh.Environment("Process")("DELTA_OUTLOOK_SILENT") = "1"'
        ('sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{0}""", 0, False' -f $serve)
    ) -join "`r`n"
    [IO.File]::WriteAllText($vbs, $vbsBody, [Text.Encoding]::ASCII)

    Write-Step '[4/4] A iniciar a ponte...'
    $env:DELTA_OUTLOOK_SILENT = '1'
    Start-Process -FilePath 'wscript.exe' -ArgumentList @('//B', $vbs) -WindowStyle Hidden
    Start-Sleep -Seconds 5

    $ok = $false
    $okPort = $null
    foreach ($p in $ports) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Method OPTIONS `
                -Uri ("http://127.0.0.1:{0}/api/open-outlook-draft" -f $p) -TimeoutSec 3
            $h = [string]$r.Headers['X-Delta-Outlook-Bridge']
            if ($h -match '^com-v[3-9]') {
                $ok = $true
                $okPort = $p
                Write-Step ("  OK porta $p ($h)")
                break
            }
        } catch { }
    }

    if (-not $ok) {
        Write-Step '  AVISO: ponte ainda nao respondeu — espera 5s e exporta na app.'
        if ($Interactive) { exit 2 }
        exit 0  # GPO: nao falhar o logon; a ponte pode atrasar no cold-start
    }

    Write-Step "Pronto. Ponte em 127.0.0.1:$okPort (arranca com o Windows)."
    exit 0
} catch {
    Write-Step ("FALHOU: " + $_.Exception.Message)
    if ($Interactive) { exit 1 }
    exit 1
}
