@echo off
setlocal
cd /d "%~dp0"
fltmc >nul 2>&1
if not "%errorlevel%"=="0" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-vault.ps1" -Force
if errorlevel 1 (
  echo.
  echo Falha ao parar o cofre.
  pause
  exit /b 1
)
echo.
echo Cofre parado com sucesso.
endlocal
