@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: Verifica se ja eh administrador
fltmc >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Solicitando permissao de administrador...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c \"%~f0\"' -Verb RunAs -Wait"
  exit /b
)

echo ==========================================================
echo   MRL Travel - Iniciar Cofre Local
echo ==========================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-vault.ps1"
set PS_EXIT=%errorlevel%

echo.
if %PS_EXIT% neq 0 (
  echo *** FALHA ao iniciar o Cofre Local. Codigo: %PS_EXIT% ***
  echo Verifique as mensagens acima para identificar o problema.
) else (
  echo Cofre iniciado com sucesso.
  echo Acesso local:   http://127.0.0.1:7443
  echo Acesso na rede: http://192.168.0.25:7443
  echo.
  start "" "http://127.0.0.1:7443"
)

echo.
echo Pressione qualquer tecla para fechar esta janela...
pause >nul
endlocal
