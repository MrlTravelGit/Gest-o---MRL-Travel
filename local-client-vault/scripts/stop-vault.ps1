#Requires -RunAsAdministrator
[CmdletBinding()]
param([switch]$Force)
$ErrorActionPreference='Stop'
$serviceName='MRLClientVault'
function Resolve-Nssm {
  $fixed='D:\Michael\Tools\NSSM\nssm.exe'
  if(Test-Path -LiteralPath $fixed -PathType Leaf){return $fixed}
  if($env:NSSM_PATH -and (Test-Path -LiteralPath $env:NSSM_PATH -PathType Leaf)){return $env:NSSM_PATH}
  $fromPath=Get-Command nssm.exe -ErrorAction SilentlyContinue
  if($fromPath){return $fromPath.Source}
  return $null
}
$service=Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if(-not$service){throw 'O servico MRLClientVault nao esta instalado.'}
Write-Warning 'O Cofre Local ficara indisponivel para todos os computadores da rede.'
if(-not$Force-and(Read-Host 'Digite PARAR para confirmar')-ne'PARAR'){Write-Host 'Operacao cancelada.';exit 0}
$nssm=Resolve-Nssm
if($service.Status-ne'Stopped'){
  if($nssm){& $nssm stop $serviceName | Out-Null}else{Stop-Service -Name $serviceName -ErrorAction Stop}
  $service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30))
}
Write-Host 'Somente o servico MRLClientVault foi parado. Dados, documentos e logs foram preservados.'
