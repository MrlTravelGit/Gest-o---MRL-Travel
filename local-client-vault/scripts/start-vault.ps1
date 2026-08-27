[CmdletBinding()]
param(
  [string]$ExpectedServerIp = '192.168.0.25',
  [string[]]$AllowedRemoteAddress = @('192.168.0.0/24'),
  [switch]$NonInteractive
)
$ErrorActionPreference = 'Stop'

$serviceName = 'MRLClientVault'
$firewallName = 'MRL Client Vault LAN 7443'
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$logRoot = 'C:\ProgramData\MRLTravel\Vault\logs'
$dataRoot = 'C:\ProgramData\MRLTravel\Vault'
$node = 'C:\Program Files\nodejs\node.exe'
. (Join-Path $PSScriptRoot 'vault-acl.ps1')

function Test-Administrator {
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
  $arguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"","-ExpectedServerIp",$ExpectedServerIp)
  if ($NonInteractive) { $arguments += '-NonInteractive' }
  if ($AllowedRemoteAddress.Count) { $arguments += '-AllowedRemoteAddress'; $arguments += $AllowedRemoteAddress }
  $elevated = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  exit $elevated.ExitCode
}

function Test-PrivateCidr([string]$Value) {
  if ($Value -notmatch '^(\d{1,3}\.){3}\d{1,3}/(2[4-9]|3[0-2])$') { return $false }
  $ip = $Value.Split('/')[0]
  $parsed = $null
  if (-not [Net.IPAddress]::TryParse($ip, [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
  $b = $parsed.GetAddressBytes()
  return $b[0] -eq 10 -or ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) -or ($b[0] -eq 192 -and $b[1] -eq 168)
}

function Resolve-Nssm {
  $fixed = 'D:\Michael\Tools\NSSM\nssm.exe'
  if (Test-Path -LiteralPath $fixed -PathType Leaf) { return $fixed }
  if ($env:NSSM_PATH -and (Test-Path -LiteralPath $env:NSSM_PATH -PathType Leaf)) { return $env:NSSM_PATH }
  $fromPath = Get-Command nssm.exe -ErrorAction SilentlyContinue
  if ($fromPath) { return $fromPath.Source }
  throw 'NSSM nao encontrado. Configure NSSM_PATH ou instale em D:\Michael\Tools\NSSM\nssm.exe.'
}

function Set-EnvValue([string]$Path,[string]$Name,[string]$Value) {
  $lines = if (Test-Path -LiteralPath $Path) { [Collections.Generic.List[string]](Get-Content -LiteralPath $Path) } else { [Collections.Generic.List[string]]::new() }
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^$([regex]::Escape($Name))=") {
      $lines[$i] = "$Name=$Value"
      $found = $true
    }
  }
  if (-not $found) { $lines.Add("$Name=$Value") }
  [IO.File]::WriteAllLines($Path, $lines, [Text.UTF8Encoding]::new($false))
}

function Remove-EnvValue([string]$Path,[string[]]$Names) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $namePattern = '^(' + (($Names | ForEach-Object { [regex]::Escape($_) }) -join '|') + ')='
  $lines = Get-Content -LiteralPath $Path | Where-Object { $_ -notmatch $namePattern }
  [IO.File]::WriteAllLines($Path, [string[]]$lines, [Text.UTF8Encoding]::new($false))
}

function Test-NeedNpmInstall {
  $nodeModules = Join-Path $appRoot 'node_modules'
  if (-not (Test-Path -LiteralPath $nodeModules -PathType Container)) { return $true }
  $lock = Join-Path $appRoot 'package-lock.json'
  $installedLock = Join-Path $nodeModules '.package-lock.json'
  if ((Test-Path -LiteralPath $lock -PathType Leaf) -and (Test-Path -LiteralPath $installedLock -PathType Leaf)) {
    return (Get-Item -LiteralPath $lock).LastWriteTimeUtc -gt (Get-Item -LiteralPath $installedLock).LastWriteTimeUtc
  }
  return $false
}

function Show-FailureLogs {
  Write-Host ''
  Write-Warning 'Falha ao iniciar o cofre. Ultimas linhas dos logs:'
  Get-ChildItem -LiteralPath $logRoot -Filter '*.log' -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "[$($_.Name)]"
    Get-Content -LiteralPath $_.FullName -Tail 80 -ErrorAction SilentlyContinue | ForEach-Object {
      $_ -replace '(?i)(password|token|cookie|secret|key)\s*[:=]\s*\S+', '$1=[REDACTED]'
    }
  }
}

if ($AllowedRemoteAddress.Count -ne 1 -or $AllowedRemoteAddress[0] -ne '192.168.0.0/24') {
  throw 'A regra de firewall permitida para esta implantacao deve ser exatamente 192.168.0.0/24.'
}
if (-not (Test-PrivateCidr $AllowedRemoteAddress[0])) { throw 'A faixa remota do firewall deve ser uma rede privada.' }
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw "Node.js nao encontrado em $node." }

$nssm = Resolve-Nssm
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$envPath = Join-Path $appRoot '.env'

[IO.Directory]::CreateDirectory($dataRoot) | Out-Null
[IO.Directory]::CreateDirectory($logRoot) | Out-Null
if (-not (Test-Path -LiteralPath $envPath)) { Copy-Item -LiteralPath (Join-Path $appRoot '.env.example') -Destination $envPath }
Remove-EnvValue $envPath @('VAULT_CERT_PATH','VAULT_KEY_PATH','VAULT_PUBLIC_ORIGIN','VAULT_MAIN_APP_ORIGIN')
Set-EnvValue $envPath 'VAULT_BIND_HOST' '0.0.0.0'
Set-EnvValue $envPath 'VAULT_PORT' '7443'
Set-EnvValue $envPath 'VAULT_PUBLIC_URL' "http://${ExpectedServerIp}:7443"

if (Test-NeedNpmInstall) {
  & $npm install --prefix $appRoot
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependencias.' }
}
& $npm run build --prefix $appRoot
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar o build.' }

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
$newService = -not $service
if ($newService) {
  if ($NonInteractive) { throw 'A primeira instalacao do servico exige execucao interativa para definir a conta do Windows.' }
  $currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $servicePassword = Read-Host "Senha Windows de $currentIdentity (usada somente agora pelo gerenciador de servico)" -AsSecureString
  $plainPassword = [Net.NetworkCredential]::new('', $servicePassword).Password
  & $nssm install $serviceName $node '--env-file-if-exists=.env' 'dist-server/server.js'
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar o servico no NSSM.' }
  & $nssm set $serviceName ObjectName $currentIdentity $plainPassword
  $plainPassword = $null
  & $nssm set $serviceName Start SERVICE_AUTO_START
  & $nssm set $serviceName AppExit Default Restart
  & $nssm set $serviceName AppThrottle 15000
  & $nssm set $serviceName AppRotateFiles 1
  & $nssm set $serviceName AppRotateOnline 1
  & $nssm set $serviceName AppRotateBytes 10485760
  Set-Service -Name $serviceName -StartupType Automatic
}

& $nssm set $serviceName Application $node
& $nssm set $serviceName AppDirectory $appRoot
& $nssm set $serviceName AppParameters '--env-file-if-exists=.env dist-server/server.js'
& $nssm set $serviceName AppStdout (Join-Path $logRoot 'stdout.log')
& $nssm set $serviceName AppStderr (Join-Path $logRoot 'stderr.log')
& $nssm set $serviceName AppRestartDelay 10000

# Resolve todas as identidades antes de alterar qualquer ACL. A rotina conserva
# um snapshot e restaura as permissoes anteriores se alguma concessao falhar.
$configuredService = Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction Stop
$currentWindowsIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$serviceSid = Resolve-VaultServiceSid -ServiceAccount $configuredService.StartName -CurrentIdentity $currentWindowsIdentity
Set-VaultDirectoryAcl -Paths @($dataRoot,$logRoot) -ServiceSid $serviceSid

Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
$oldRules = Get-NetFirewallRule -Direction Inbound -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'MRL Client Vault*' -or $_.DisplayName -eq 'MRL Client Vault, Rede Privada' }
foreach ($rule in $oldRules) {
  $ports = $rule | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
  if ($ports.Protocol -eq 'TCP' -and $ports.LocalPort -eq '7443') {
    $rule | Remove-NetFirewallRule
  }
}
New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Protocol TCP -LocalPort 7443 -Program $node -RemoteAddress '192.168.0.0/24' -Profile Private -Action Allow | Out-Null

$service = Get-Service -Name $serviceName -ErrorAction Stop
if ($service.Status -eq 'Paused') {
  & $nssm stop $serviceName | Out-Null
  Start-Sleep -Seconds 2
  $service = Get-Service -Name $serviceName -ErrorAction Stop
}
if ($service.Status -eq 'Running') {
  & $nssm restart $serviceName | Out-Null
} else {
  & $nssm start $serviceName | Out-Null
}

$ready = $false
for ($attempt = 0; $attempt -lt 15; $attempt++) {
  Start-Sleep -Seconds 1
  try {
    $result = Invoke-RestMethod -Uri 'http://127.0.0.1:7443/api/health' -TimeoutSec 2
    if ($result.status -eq 'ok' -and $result.transport -eq 'http') { $ready = $true; break }
  } catch {}
}
if (-not $ready) {
  Show-FailureLogs
  throw 'O servico iniciou, mas /api/health nao respondeu em ate 15 segundos.'
}

$state = Get-Service -Name $serviceName -ErrorAction Stop
if ($state.Status -eq 'Paused') { throw 'O servico ficou Paused apos a inicializacao.' }
Write-Host ''
Write-Host 'Cofre Local MRL Travel'
Write-Host "Servidor: $ExpectedServerIp"
Write-Host 'Porta: 7443'
Write-Host "Servico: $($state.Status)"
Write-Host 'Transporte: HTTP local sem TLS'
Write-Host "Endereco: http://${ExpectedServerIp}:7443"
