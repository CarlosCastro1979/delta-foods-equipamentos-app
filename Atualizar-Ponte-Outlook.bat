@echo off
setlocal EnableExtensions
title Delta Foods - Ponte Outlook (uma vez)

REM ASCII + CRLF. Run once from Downloads OK.
REM Installs serve.ps1 in LocalAppData + Startup (silent). No need to keep a window open.

set "DFDIR=%LOCALAPPDATA%\DeltaFoodsOutlookBridge"
set "SERVE=%DFDIR%\serve.ps1"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\DeltaFoods-Outlook-Bridge.vbs"

if not exist "%DFDIR%" mkdir "%DFDIR%"
if not exist "%STARTUP%" mkdir "%STARTUP%"

echo.
echo  Delta Foods - ponte Outlook (instalacao unica)
echo  Pasta: %DFDIR%
echo.

echo  [1/4] A libertar portas 8088/8080/8090/5505 (e fechar pontes antigas)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports=8088,8080,8090,5505; foreach($p in $ports){ try { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $procId=$_.OwningProcess; if($procId -and $procId -gt 0){ Write-Host ('      PID '+$procId+' porta '+$p); Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } } } catch {} };" ^
  "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and ($_.CommandLine -like '*serve.ps1*' -or $_.CommandLine -like '*DeltaFoodsOutlookBridge*') } | ForEach-Object { Write-Host ('      kill serve PID '+$_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };" ^
  "Start-Sleep -Seconds 1"

echo  [2/4] A descarregar serve.ps1...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/CarlosCastro1979/delta-foods-equipamentos-app/main/serve.ps1' -OutFile (Join-Path $env:LOCALAPPDATA 'DeltaFoodsOutlookBridge\serve.ps1')"
if not exist "%SERVE%" (
  echo.
  echo  FALHOU o download. Verifica a internet.
  pause
  exit /b 1
)

echo  [3/4] A instalar no arranque do Windows...
> "%VBS%" echo Set sh = CreateObject("WScript.Shell")
>>"%VBS%" echo sh.Environment("Process")("DELTA_OUTLOOK_SILENT") = "1"
>>"%VBS%" echo sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""%SERVE%""", 0, False

echo  [4/4] A iniciar agora em segundo plano...
wscript //B "%VBS%"
timeout /t 5 /nobreak >nul

echo  A verificar se a ponte responde (X-Delta-Outlook-Bridge com-v4)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; foreach($p in 8090,5505,8088,8080){ try { $r=Invoke-WebRequest -UseBasicParsing -Method OPTIONS -Uri ('http://127.0.0.1:'+$p+'/api/open-outlook-draft') -TimeoutSec 3; $h=$r.Headers['X-Delta-Outlook-Bridge']; if($h -match '^com-v[3-9]'){ Write-Host ('  OK porta '+$p+' ('+$h+')'); $ok=$true; break } } catch {} }; if(-not $ok){ Write-Host '  AVISO: ainda nao respondeu - espera 5s e exporta outra vez.'; Write-Host '  Se a consola do Chrome mostrar CORS em 8088/8080, outro programa voltou a ocupar a porta.'; exit 2 }"

echo.
echo  Pronto. A ponte corre ESCONDIDA (nao precisas de janela aberta).
echo  - Arranca sozinha com o Windows
echo  - Nao precisas de voltar a correr este .bat a cada export
echo  - So volta a correr se o anexo deixar de funcionar
echo.
echo  Agora: Ctrl+F5 na app e exporta de novo (Horeca / Ecommerce / Varejo / Dist).
echo.
pause
endlocal
exit /b 0
