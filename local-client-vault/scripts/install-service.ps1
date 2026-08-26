[CmdletBinding()]
param([string]$ExpectedServerIp='192.168.0.25',[string[]]$AllowedRemoteAddress=@('LocalSubnet'),[switch]$NonInteractive)
$arguments=@{ExpectedServerIp=$ExpectedServerIp;AllowedRemoteAddress=$AllowedRemoteAddress;NonInteractive=$NonInteractive}
& (Join-Path $PSScriptRoot 'start-vault.ps1') @arguments
exit $LASTEXITCODE
