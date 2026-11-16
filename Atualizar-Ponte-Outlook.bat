@echo off
setlocal EnableExtensions
title Delta Foods - Actualizar ponte Outlook

REM ASCII only + CRLF. Works from Downloads or any folder.
REM Installs bridge under %%LOCALAPPDATA%%\DeltaFoodsOutlookBridge

set "DFDIR=%LOCALAPPDATA%\DeltaFoodsOutlookBridge"
if not exist "%DFDIR%" mkdir "%DFDIR%"
cd /d "%DFDIR%"

echo.
echo  Delta Foods - ponte Outlook
echo  Pasta: %DFDIR%
echo.

echo  A fechar pontes antigas (8088/8080/8090/5505)...
for %%P in (8088 8080 8090 5505) do (
  for /f "tokens=5" %%A in ('netstat -ano 2^>nul ^| findstr ":%%P" ^| findstr "LISTENING"') do (
    echo  PID %%A porta %%P
    taskkill /F /PID %%A >nul 2>&1
  )
)

echo  A descarregar serve.ps1 do GitHub...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/CarlosCastro1979/delta-foods-equipamentos-app/main/serve.ps1' -OutFile (Join-Path $env:LOCALAPPDATA 'DeltaFoodsOutlookBridge\serve.ps1')"
if not exist "%DFDIR%\serve.ps1" (
  echo.
  echo  FALHOU o download de serve.ps1. Verifica a internet / proxy.
  echo.
  pause
  exit /b 1
)

echo  Download OK.
echo  A iniciar a ponte. Deixa esta janela / a do PowerShell aberta.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%DFDIR%\serve.ps1"
if errorlevel 1 (
  echo.
  echo  serve.ps1 saiu com erro.
  pause
  exit /b 1
)
endlocal
exit /b 0
