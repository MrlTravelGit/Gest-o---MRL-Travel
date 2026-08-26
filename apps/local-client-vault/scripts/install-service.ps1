[CmdletBinding()]
param([switch]$NonInteractive)
& (Join-Path $PSScriptRoot 'start-vault.ps1') -NonInteractive:$NonInteractive
exit $LASTEXITCODE
