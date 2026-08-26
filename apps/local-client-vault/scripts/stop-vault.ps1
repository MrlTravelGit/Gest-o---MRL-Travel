#Requires -RunAsAdministrator
[CmdletBinding()]
param([switch]$Force)
$ErrorActionPreference='Stop'
$serviceName='MRLClientVault'
$service=Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if(-not$service){throw 'O servico MRLClientVault nao esta instalado.'}
Write-Warning 'O Cofre Local ficara indisponivel para todos os computadores da rede.'
if(-not$Force-and(Read-Host 'Digite PARAR para confirmar')-ne'PARAR'){Write-Host 'Operacao cancelada.';exit 0}
if($service.Status-ne'Stopped'){Stop-Service -Name $serviceName -ErrorAction Stop; $service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30))}
Write-Host 'Somente o servico MRLClientVault foi parado. Banco, documentos, chave mestra, usuarios, credenciais e logs foram preservados.'
