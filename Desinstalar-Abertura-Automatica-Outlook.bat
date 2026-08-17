@echo off
chcp 65001 >nul
title Delta Foods - Desinstalar abertura automatica Outlook

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\DeltaFoods-Outlook-Bridge.vbs"

if exist "%VBS%" (
  del /f /q "%VBS%"
  echo Removido o arranque automatico: %VBS%
) else (
  echo Nao havia arranque automatico instalado.
)

echo.
echo Nota: se o serve.ps1 ja estiver a correr, fecha-o no Gestor de Tarefas
echo ^(powershell.exe com serve.ps1^) ou reinicia o PC.
echo.
pause
