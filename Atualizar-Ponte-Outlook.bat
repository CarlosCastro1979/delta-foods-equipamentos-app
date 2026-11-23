@echo off
setlocal EnableExtensions
title Delta Foods - Ponte Outlook (uma vez)

REM ASCII + CRLF. Run once from Downloads OK.
REM Wrapper: logica em Instalar-Ponte-Outlook-Todos.ps1 (GPO/Intune/manual).
REM O .ps1 corre a partir de %%TEMP%% — NUNCA de DeltaFoodsOutlookBridge
REM (senao o cleanup matava o proprio instalador → Codigo -1).

set "PS1=%TEMP%\Instalar-Ponte-Outlook-Todos.ps1"
set "PS1_URL=https://raw.githubusercontent.com/CarlosCastro1979/delta-foods-equipamentos-app/main/Instalar-Ponte-Outlook-Todos.ps1"

echo.
echo  Delta Foods - ponte Outlook
echo  (mesmo instalador dos PCs em massa / Intune / GPO)
echo.

echo  A descarregar instalador...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '%PS1_URL%' -OutFile (Join-Path $env:TEMP 'Instalar-Ponte-Outlook-Todos.ps1')"
if not exist "%PS1%" (
  echo.
  echo  FALHOU o download. Verifica a internet.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Interactive
set "ERR=%ERRORLEVEL%"

echo.
if "%ERR%"=="0" (
  echo  Pronto. Ctrl+F5 na app e exporta de novo.
) else if "%ERR%"=="2" (
  echo  Ponte instalada mas ainda a arrancar — espera 5s e exporta.
) else (
  echo  Instalacao com erro. Codigo %ERR%.
  echo  Se voltar a falhar: fecha o Outlook, corre outra vez.
)
echo.
pause
endlocal
exit /b %ERR%
