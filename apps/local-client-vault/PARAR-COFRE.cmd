@echo off
setlocal
echo.
echo *** ATENCAO: Esta pasta (apps\local-client-vault) e obsoleta. ***
echo *** Use o arquivo PARAR-COFRE.cmd da pasta correta:           ***
echo *** D:\Michael\Sistema Gestao - (Servidor Local)\local-client-vault\PARAR-COFRE.cmd ***
echo.

set "CORRECT_LAUNCHER=D:\Michael\Sistema Gestão - (Servidor Local)\local-client-vault\PARAR-COFRE.cmd"

if exist "%CORRECT_LAUNCHER%" (
  echo Redirecionando automaticamente para o local correto...
  echo.
  call "%CORRECT_LAUNCHER%"
) else (
  echo ERRO: O arquivo correto nao foi encontrado em:
  echo %CORRECT_LAUNCHER%
  pause
  exit /b 1
)
endlocal
