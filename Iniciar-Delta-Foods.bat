@echo off
chcp 65001 >nul
title Delta Foods - Gestao de Equipamentos
cd /d "%~dp0"

echo.
echo  Delta Foods - Gestao de Equipamentos
echo.
echo  Preferes nao fazer isto a cada sessao?
echo  Corre UMA VEZ: Instalar-Abertura-Automatica-Outlook.bat
echo  ^(arranca com o Windows, em silencio^)
echo.
echo  A iniciar servidor local agora...
echo  Deixa esta janela aberta enquanto usas a app.
echo.
echo  IMPORTANTE: o Outlook usa o email da pagina no BROWSER.
echo   Esta pasta  -^> http://localhost:8088/delta-foods-equipamentos-app/
echo   Site online -^> https://carloscastro1979.github.io/delta-foods-equipamentos-app/
echo   Se abrires o github.io, o rascunho MC00 continua Para: Carlos ate o PR 73
echo   estar no main. Para testar ESTA pasta, usa so o localhost:8088.
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8088/delta-foods-equipamentos-app/"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
if errorlevel 1 (
  echo.
  echo  Falhou a iniciar. Se a porta 8088 estiver ocupada, o script tenta outra.
  pause
)
