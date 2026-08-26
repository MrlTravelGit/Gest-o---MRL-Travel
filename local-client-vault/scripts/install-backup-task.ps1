#Requires -RunAsAdministrator
param([Parameter(Mandatory)][string]$ServiceAccount,[Parameter(Mandatory)][SecureString]$ServicePassword)
$appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')); $node=(Get-Command node -ErrorAction Stop).Source
$action=New-ScheduledTaskAction -Execute $node -Argument '--env-file-if-exists=.env dist-server/cli.js backup' -WorkingDirectory $appRoot
$trigger=New-ScheduledTaskTrigger -Daily -At '02:30'
$password=[Net.NetworkCredential]::new('', $ServicePassword).Password
Register-ScheduledTask -TaskName 'MRL Vault Backup' -Action $action -Trigger $trigger -User $ServiceAccount -Password $password -RunLevel Highest -Force | Out-Null
Write-Host 'Backup diario configurado; a retencao automatica mantem 7 diarios, 4 semanais e 12 mensais.'
