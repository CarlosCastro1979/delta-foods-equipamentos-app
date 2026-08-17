@echo off
chcp 65001 >nul
title Delta Foods - Gestao de Equipamentos
cd /d "%~dp0"

echo.
echo  Delta Foods - Gestao de Equipamentos
echo  A iniciar servidor local (Outlook + anexos)...
echo.
echo  Deixa esta janela aberta enquanto usas a app.
echo  Fecha com Ctrl+C ou fechando a janela.
echo.

REM Abre o browser após ~2s (serve.ps1 a arrancar)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8088/delta-foods-equipamentos-app/"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
if errorlevel 1 (
  echo.
  echo  Falhou a iniciar. Se a porta 8088 estiver ocupada, o script tenta outra.
  pause
)
