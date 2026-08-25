#Requires -RunAsAdministrator
param([Parameter(Mandatory)][string]$ServiceAccount,[Parameter(Mandatory)][SecureString]$ServicePassword,[string]$NssmPath='nssm.exe')
$ErrorActionPreference='Stop'
$appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$node=(Get-Command node -ErrorAction Stop).Source
$nssm=(Get-Command $NssmPath -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $appRoot 'dist-server\server.js'))) { throw 'Execute npm run build antes de instalar.' }
& $nssm install MRLClientVault $node (Join-Path $appRoot 'dist-server\server.js')
& $nssm set MRLClientVault AppDirectory $appRoot
& $nssm set MRLClientVault ObjectName $ServiceAccount ([Net.NetworkCredential]::new('', $ServicePassword).Password)
& $nssm set MRLClientVault Start SERVICE_AUTO_START
& $nssm set MRLClientVault AppNoConsole 1
New-NetFirewallRule -DisplayName 'MRL Client Vault - bloquear entrada externa' -Direction Inbound -Program $node -Action Block -Profile Any -ErrorAction SilentlyContinue | Out-Null
Write-Host 'Servico instalado. Confirme que VAULT_BIND_HOST permanece 127.0.0.1 e inicie com Start-Service MRLClientVault.'
