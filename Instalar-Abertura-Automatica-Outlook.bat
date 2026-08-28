@echo off
chcp 65001 >nul
title Delta Foods - Instalar abertura automatica Outlook
cd /d "%~dp0"

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\DeltaFoods-Outlook-Bridge.vbs"
set "SERVE=%~dp0serve.ps1"

if not exist "%SERVE%" (
  echo Nao encontrei serve.ps1 nesta pasta.
  echo Corre este instalador de dentro da pasta delta-foods-equipamentos-app.
  pause
  exit /b 1
)

echo.
echo  Instala a ponte Outlook para arrancar com o Windows
echo  ^(uma vez por PC — depois nao precisas de clicar em nada^)
echo.
echo  Pasta: %~dp0
echo.

> "%VBS%" echo Set sh = CreateObject("WScript.Shell")
>>"%VBS%" echo sh.Environment("Process")("DELTA_OUTLOOK_SILENT") = "1"
>>"%VBS%" echo sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""%SERVE%""", 0, False

echo  Criado: %VBS%
echo  A iniciar agora em segundo plano...
echo.

wscript //B "%VBS%"
timeout /t 2 /nobreak >nul

echo  Pronto. A partir de agora:
echo   - A ponte so ABRE o rascunho no Outlook (nao escolhe o Para)
echo   - O Para/CC vem da pagina que o browser tem aberta
echo.
echo  Site online (main / GitHub Pages):
echo   https://carloscastro1979.github.io/delta-foods-equipamentos-app/
echo  Teste local DESTA pasta (depois de git pull da branch certa):
echo   http://localhost:8088/delta-foods-equipamentos-app/
echo.
pause
