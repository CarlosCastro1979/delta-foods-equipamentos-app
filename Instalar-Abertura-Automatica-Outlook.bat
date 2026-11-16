@echo off
setlocal EnableExtensions
title Delta Foods - Instalar ponte Outlook automatica

REM Redirects to the same one-shot updater (LocalAppData + Startup).
set "UPD=%~dp0Atualizar-Ponte-Outlook.bat"
if exist "%UPD%" (
  call "%UPD%"
  exit /b %ERRORLEVEL%
)

echo  Nao encontrei Atualizar-Ponte-Outlook.bat nesta pasta.
echo  Descarrega:
echo  https://carloscastro1979.github.io/delta-foods-equipamentos-app/Atualizar-Ponte-Outlook.bat
echo.
pause
exit /b 1
