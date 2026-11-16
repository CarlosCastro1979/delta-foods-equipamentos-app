@echo off
chcp 65001 >nul
title Delta Foods - Actualizar ponte Outlook
cd /d "%~dp0"

echo.
echo  Actualiza a ponte Outlook (serve.ps1) nesta pasta.
echo  Fecha processos antigos nas portas 8088/8080/8090/5505.
echo.

REM Mata listeners nas portas da ponte (serve.ps1 antigo = erro «argumento inválido»)
for %%P in (8088 8080 8090 5505) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P" ^| findstr "LISTENING"') do (
    echo  A fechar PID %%A na porta %%P...
    taskkill /F /PID %%A >nul 2>&1
  )
)

echo  A descarregar serve.ps1 novo do GitHub...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/CarlosCastro1979/delta-foods-equipamentos-app/main/serve.ps1' -OutFile '%~dp0serve.ps1'; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  if exist "%~dp0.git" (
    echo  Download falhou — a tentar git pull...
    git -C "%~dp0" pull --ff-only
  ) else (
    echo  Falhou a descarregar serve.ps1. Verifica a internet.
    pause
    exit /b 1
  )
)


echo.
echo  A reiniciar Iniciar-Delta-Foods.bat...
echo  Deixa a janela do servidor aberta.
echo.
start "" "%~dp0Iniciar-Delta-Foods.bat"
exit /b 0
