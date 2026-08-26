#Requires -RunAsAdministrator
[CmdletBinding()]
param([switch]$NonInteractive)

$ErrorActionPreference = 'Stop'
$serviceName = 'MRLClientVault'
$firewallName = 'MRL Client Vault LAN 7443'
$serverIp = '192.168.0.25'
$allowedSubnet = '192.168.0.0/24'
$expectedAppRoot = 'D:\Michael\Sistema Gestão - (Servidor Local)\local-client-vault'
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$logRoot = 'C:\ProgramData\MRLTravel\Vault\logs'
$node = 'C:\Program Files\nodejs\node.exe'

function Get-NssmPath {
  $fixedPath = 'D:\Michael\Tools\NSSM\nssm.exe'
  if (Test-Path -LiteralPath $fixedPath -PathType Leaf) { return $fixedPath }
  if (-not [string]::IsNullOrWhiteSpace($env:NSSM_PATH) -and (Test-Path -LiteralPath $env:NSSM_PATH -PathType Leaf)) { return [IO.Path]::GetFullPath($env:NSSM_PATH) }
  $command = Get-Command nssm.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw 'NSSM nao encontrado. Verifique D:\Michael\Tools\NSSM\nssm.exe, NSSM_PATH ou o PATH.'
}

function Invoke-Nssm([string[]]$Arguments) {
  & $script:nssm @Arguments
  if ($LASTEXITCODE -ne 0) { throw "NSSM falhou (codigo $LASTEXITCODE): $($Arguments -join ' ')" }
}

function Set-EnvValue([string]$Path,[string]$Name,[string]$Value) {
  $lines = if (Test-Path -LiteralPath $Path) { [Collections.Generic.List[string]](Get-Content -LiteralPath $Path) } else { [Collections.Generic.List[string]]::new() }
  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match "^$([regex]::Escape($Name))=") { $lines[$index] = "$Name=$Value"; $found = $true }
  }
  if (-not $found) { $lines.Add("$Name=$Value") }
  [IO.File]::WriteAllLines($Path,$lines,[Text.UTF8Encoding]::new($false))
}

function Show-SanitizedLogs {
  Get-ChildItem -LiteralPath $logRoot -Filter '*.log' -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "[$($_.Name)]"
    Get-Content -LiteralPath $_.FullName -Tail 40 | ForEach-Object {
      $_ -replace '(?i)(password|senha|token|cookie|secret|segredo|key|chave)\s*[:=]\s*\S+','$1=[REDACTED]'
    }
  }
}

function Remove-PortFirewallRules {
  Get-NetFirewallRule -Direction Inbound -ErrorAction SilentlyContinue | ForEach-Object {
    $rule = $_
    $filters = $rule | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
    if ($filters | Where-Object { $_.Protocol -eq 'TCP' -and (($_.LocalPort -split ',') -contains '7443') }) {
      Remove-NetFirewallRule -InputObject $rule
    }
  }
}

if (-not [StringComparer]::OrdinalIgnoreCase.Equals($appRoot,$expectedAppRoot)) {
  throw "Repositorio de implantacao incorreto. Esperado: $expectedAppRoot. Atual: $appRoot"
}
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw "Node.js nao encontrado em $node." }
$npmCommand = Get-Command npm.cmd -ErrorAction Stop
$script:nssm = Get-NssmPath

$envPath = Join-Path $appRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) { Copy-Item -LiteralPath (Join-Path $appRoot '.env.example') -Destination $envPath }
Set-EnvValue $envPath 'VAULT_BIND_HOST' '0.0.0.0'
Set-EnvValue $envPath 'VAULT_PORT' '7443'
Set-EnvValue $envPath 'VAULT_PUBLIC_URL' "http://${serverIp}:7443"

if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'node_modules'))) {
  & $npmCommand.Source ci --prefix $appRoot
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependencias com npm ci.' }
}
& $npmCommand.Source run build --prefix $appRoot
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar o build do Cofre Local.' }

[IO.Directory]::CreateDirectory($logRoot) | Out-Null
$stdoutPath = Join-Path $logRoot 'stdout.log'
$stderrPath = Join-Path $logRoot 'stderr.log'
$service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue

if ($service) {
  Invoke-Nssm @('set',$serviceName,'Application',$node)
  Invoke-Nssm @('set',$serviceName,'AppDirectory',$expectedAppRoot)
  Invoke-Nssm @('set',$serviceName,'AppParameters','--env-file-if-exists=.env dist-server/server.js')
  Invoke-Nssm @('set',$serviceName,'AppStdout',$stdoutPath)
  Invoke-Nssm @('set',$serviceName,'AppStderr',$stderrPath)
  Invoke-Nssm @('set',$serviceName,'AppRestartDelay','10000')
} else {
  if ($NonInteractive) { throw 'O servico ainda nao existe; a primeira instalacao exige a senha da conta Windows atual.' }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $servicePassword = Read-Host "Senha Windows de $($identity.Name) para instalar o servico" -AsSecureString
  $plainPassword = [Net.NetworkCredential]::new('', $servicePassword).Password
  try {
    Invoke-Nssm @('install',$serviceName,$node,'--env-file-if-exists=.env','dist-server/server.js')
    Invoke-Nssm @('set',$serviceName,'ObjectName',$identity.Name,$plainPassword)
    Invoke-Nssm @('set',$serviceName,'Application',$node)
    Invoke-Nssm @('set',$serviceName,'AppDirectory',$expectedAppRoot)
    Invoke-Nssm @('set',$serviceName,'AppParameters','--env-file-if-exists=.env dist-server/server.js')
    Invoke-Nssm @('set',$serviceName,'AppStdout',$stdoutPath)
    Invoke-Nssm @('set',$serviceName,'AppStderr',$stderrPath)
    Invoke-Nssm @('set',$serviceName,'AppRestartDelay','10000')
    Invoke-Nssm @('set',$serviceName,'Start','SERVICE_AUTO_START')
    Invoke-Nssm @('set',$serviceName,'AppExit','Default','Restart')
  } finally {
    $plainPassword = $null
    $servicePassword = $null
  }
}

Remove-PortFirewallRules
New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Protocol TCP -LocalPort 7443 -RemoteAddress $allowedSubnet -Profile Private -Action Allow | Out-Null

$currentStatus = (Get-Service -Name $serviceName -ErrorAction Stop).Status
if ($currentStatus -eq 'Paused' -or $currentStatus -eq 'Running') { Invoke-Nssm @('stop',$serviceName) }
Invoke-Nssm @('start',$serviceName)

$ready = $false
$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:7443/api/health' -TimeoutSec 2
    if ($health.status -eq 'ok') { $ready = $true }
  } catch {}
} until ($ready -or [DateTime]::UtcNow -ge $deadline)

if (-not $ready) {
  $failedStatus = (Get-Service -Name $serviceName -ErrorAction SilentlyContinue).Status
  if ($failedStatus -eq 'Paused') { Invoke-Nssm @('stop',$serviceName) }
  Write-Host 'O Cofre Local nao respondeu em 15 segundos. Ultimas linhas dos logs:'
  Show-SanitizedLogs
  throw 'Falha ao validar GET /api/health.'
}

Write-Host 'Cofre iniciado com sucesso.'
Write-Host 'Acesso local: http://127.0.0.1:7443'
Write-Host 'Acesso pela rede: http://192.168.0.25:7443'
