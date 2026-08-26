[CmdletBinding()]
param([string]$ExpectedServerIp='192.168.0.25')
$ErrorActionPreference='Continue'

$serviceName='MRLClientVault'
$firewallName='MRL Client Vault LAN 7443'
$appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$logRoot='C:\ProgramData\MRLTravel\Vault\logs'
$failures=[Collections.Generic.List[string]]::new()

function Check([bool]$Condition,[string]$Message){if(-not$Condition){$failures.Add($Message);Write-Warning $Message}}

$service=Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue
Check ($null-ne$service) 'Servico nao instalado.'
if($service){Check ($service.State-eq'Running') 'Servico parado.';Check ($service.StartMode-eq'Auto') 'Inicializacao nao automatica.'}

$connection=Get-NetTCPConnection -LocalPort 7443 -State Listen -ErrorAction SilentlyContinue
Check ([bool]($connection|Where-Object { $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq $ExpectedServerIp -or $_.LocalAddress -eq '::' })) "A porta 7443 nao esta escutando em todas as interfaces ou no IP $ExpectedServerIp."

$network=Get-NetConnectionProfile -ErrorAction SilentlyContinue|Where-Object NetworkCategory -eq'Private'|Select-Object -First 1
Check ($null-ne$network) 'Nenhuma rede com perfil Private foi encontrada.'

$firewall=Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue
Check ($null-ne$firewall) 'Regra de firewall ausente.'
if($firewall){
  Check ($firewall.Profile.ToString()-match'Private') 'Firewall fora do perfil Private.'
  $port=$firewall|Get-NetFirewallPortFilter
  $address=$firewall|Get-NetFirewallAddressFilter
  Check ($port.Protocol -eq 'TCP' -and $port.LocalPort -eq '7443') 'Firewall nao esta limitado a TCP 7443.'
  Check ($address.RemoteAddress -contains '192.168.0.0/24') 'Firewall nao esta limitado a 192.168.0.0/24.'
  Check (-not($address.RemoteAddress -contains 'Any')) 'Firewall permite origem Any.'
}

Check (Test-Path (Join-Path $appRoot 'dist-server\server.js')) 'Build do servidor ausente.'
Check (Test-Path (Join-Path $appRoot 'dist\index.html')) 'Build do frontend ausente.'

foreach($path in @('C:\ProgramData\MRLTravel\Vault',$logRoot)){
  if(Test-Path $path){$acl=Get-Acl $path;Check $acl.AreAccessRulesProtected "Revise a heranca de permissoes em $path."}
}

$health=$false
try{
  $result=Invoke-RestMethod -Uri 'http://127.0.0.1:7443/api/health' -TimeoutSec 3
  $health=$result.status-eq'ok' -and $result.transport-eq'http'
}catch{}
Check $health 'Endpoint de saude HTTP indisponivel.'

Write-Host ''
Write-Host 'Ultimas linhas dos logs (conteudo sensivel sanitizado):'
Get-ChildItem $logRoot -Filter '*.log' -ErrorAction SilentlyContinue|ForEach-Object{
  Write-Host "[$($_.Name)]"
  Get-Content $_.FullName -Tail 12|ForEach-Object{$_-replace'(?i)(password|token|cookie|secret|key)\s*[:=]\s*\S+','$1=[REDACTED]'}
}

Write-Host ''
Write-Host 'Cofre Local MRL Travel'
Write-Host "Servidor: $ExpectedServerIp"
Write-Host 'Porta: 7443'
Write-Host "Servico: $(if($service.State-eq'Running'){'em execucao'}else{'indisponivel'})"
Write-Host "Inicializacao: $(if($service.StartMode-eq'Auto'){'automatica'}else{'requer correcao'})"
Write-Host "Rede: $(if($network){'privada'}else{'requer correcao'})"
Write-Host "HTTP: $(if($health){'respondendo'}else{'indisponivel'})"
Write-Host "Endereco: http://${ExpectedServerIp}:7443"
if($failures.Count){Write-Host '';Write-Warning "$($failures.Count) verificacao(oes) requerem atencao. Execute INICIAR-COFRE.cmd para reparar. Logs: $logRoot";exit 1}
