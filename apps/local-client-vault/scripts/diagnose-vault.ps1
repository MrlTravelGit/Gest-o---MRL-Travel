[CmdletBinding()]
param([string]$ExpectedServerIp='192.168.0.25')
$ErrorActionPreference='Continue'
$serviceName='MRLClientVault';$firewallName='MRL Client Vault LAN 7443';$appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'));$logRoot='C:\ProgramData\MRLTravel\Vault\logs';$failures=[Collections.Generic.List[string]]::new()
function Check([bool]$Condition,[string]$Message){if(-not$Condition){$failures.Add($Message);Write-Warning $Message}}
$service=Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue
Check ($null-ne$service) 'Servico nao instalado.'
if($service){Check ($service.State-eq'Running') 'Servico parado.';Check ($service.StartMode-eq'Auto') 'Inicializacao nao automatica.'}
$connection=Get-NetTCPConnection -LocalPort 7443 -State Listen -ErrorAction SilentlyContinue
Check ([bool]($connection|Where-Object {$_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq $ExpectedServerIp})) 'A porta 7443 nao esta escutando na rede local.'
$network=Get-NetConnectionProfile -ErrorAction SilentlyContinue|Where-Object NetworkCategory -eq'Private'|Select-Object -First 1
Check ($null-ne$network) 'Nenhuma rede com perfil Private foi encontrada.'
$firewall=Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue
Check ($null-ne$firewall) 'Regra de firewall ausente.'
if($firewall){Check ($firewall.Profile.ToString()-match'Private') 'Firewall fora do perfil Private.';$address=$firewall|Get-NetFirewallAddressFilter;Check ($address.RemoteAddress -contains '192.168.0.0/255.255.255.0' -or $address.RemoteAddress -contains '192.168.0.0/24') 'Firewall nao esta limitado a 192.168.0.0/24.'}
Check (Test-Path (Join-Path $appRoot 'dist-server\server.js')) 'Build do servidor ausente.';Check (Test-Path (Join-Path $appRoot 'dist\index.html')) 'Build do frontend ausente.'
$health=$false;try{$result=Invoke-RestMethod -Uri 'http://127.0.0.1:7443/api/health' -TimeoutSec 3;$health=$result.status-eq'ok'}catch{};Check $health 'Endpoint de saude indisponivel.'
Write-Host '';Write-Host 'Ultimas linhas dos logs (conteudo sensivel sanitizado):'
Get-ChildItem $logRoot -Filter '*.log' -ErrorAction SilentlyContinue|ForEach-Object{Write-Host "[$($_.Name)]";Get-Content $_.FullName -Tail 12|ForEach-Object{$_-replace'(?i)(password|senha|token|cookie|secret|segredo|key|chave)\s*[:=]\s*\S+','$1=[REDACTED]'}}
Write-Host '';Write-Host 'Cofre Local MRL Travel';Write-Host "Servidor: $ExpectedServerIp";Write-Host 'Porta: 7443';Write-Host "Servico: $(if($service.State-eq'Running'){'em execucao'}else{'indisponivel'})";Write-Host "Rede: $(if($network){'privada'}else{'requer correcao'})";Write-Host 'Transporte: HTTP na rede local';Write-Host "Endereco: http://${ExpectedServerIp}:7443"
if($failures.Count){Write-Host '';Write-Warning "$($failures.Count) verificacao(oes) requerem atencao. Execute INICIAR-COFRE.cmd para reparar. Logs: $logRoot";exit 1}
