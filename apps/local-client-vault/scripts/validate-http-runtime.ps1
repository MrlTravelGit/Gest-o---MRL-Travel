[CmdletBinding()]
param([int]$Port = 17443,[switch]$KeepRunning)
$ErrorActionPreference = 'Stop'
$testRoot = Join-Path $env:TEMP ('mrl-vault-http-validation-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$stdoutPath = Join-Path $testRoot 'stdout.log'
$stderrPath = Join-Path $testRoot 'stderr.log'
$testPassword = 'Runtime-validation-2026'
$process = $null

try {
  $env:VAULT_DATA_DIR = $testRoot
  $env:VAULT_BIND_HOST = '127.0.0.1'
  $env:VAULT_PORT = [string]$Port
  $env:VAULT_PUBLIC_URL = "http://127.0.0.1:$Port"
  & node --input-type=module --eval "const {createFirstAdmin}=await import('./dist-server/auth.js');await createFirstAdmin('runtime-admin','$testPassword');"
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar o usuario temporario.' }

  $process = Start-Process -FilePath node -ArgumentList @('dist-server/server.js') -WorkingDirectory (Get-Location) -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -WindowStyle Hidden -PassThru
  $healthUrl = "http://127.0.0.1:$Port/api/health"
  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      $health = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
      if ($health.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
  }
  if (-not $ready) { throw 'Servidor temporario nao respondeu.' }

  $loginBody = @{username='runtime-admin';password=$testPassword} | ConvertTo-Json -Compress
  $login = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/auth/login" -Method Post -ContentType 'application/json' -Body $loginBody -UseBasicParsing -SessionVariable vaultWebSession
  $cookie = [string]$login.Headers['Set-Cookie']
  if ($cookie -notmatch 'HttpOnly' -or $cookie -notmatch 'SameSite=Strict' -or $cookie -match '(^|;\s*)Secure(;|$)') { throw 'Cookie de sessao invalido.' }
  $loginData = $login.Content | ConvertFrom-Json
  $session = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/auth/session" -WebSession $vaultWebSession -UseBasicParsing
  if ($session.StatusCode -ne 200) { throw 'Sessao temporaria invalida.' }
  $sessionData = $session.Content | ConvertFrom-Json
  $clients = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/clients" -WebSession $vaultWebSession -UseBasicParsing
  if ($clients.StatusCode -ne 200) { throw 'Lista local de clientes indisponivel.' }
  $clientsData = $clients.Content | ConvertFrom-Json
  if ($null -eq $clientsData.items -or $clientsData.total -ne 0) { throw 'Estado vazio da lista local invalido.' }
  $logout = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/auth/logout" -Method Post -ContentType 'application/json' -Body '{}' -Headers @{'X-Vault-CSRF'=$sessionData.csrf} -WebSession $vaultWebSession -UseBasicParsing
  if ($logout.StatusCode -ne 200) { throw 'Logout temporario falhou.' }

  $externalBlocked = $false
  try { Invoke-WebRequest -Uri $healthUrl -Headers @{Origin='http://example.com'} -UseBasicParsing | Out-Null }
  catch { $externalBlocked = $_.Exception.Response.StatusCode.value__ -eq 403 }
  if (-not $externalBlocked) { throw 'Origem externa nao foi bloqueada.' }

  $logs = ((Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue))
  if ($logs -match [regex]::Escape($testPassword)) { throw 'Senha encontrada nos logs.' }
  Write-Output 'RUNTIME_HTTP=PASS'
  Write-Output "HEALTH_STATUS=$($health.StatusCode)"
  Write-Output 'LOGIN_SESSION_LOGOUT=PASS'
  Write-Output 'CLIENTS_EMPTY_STATE_API=PASS'
  Write-Output 'COOKIE=HttpOnly;SameSite=Strict;Secure=false'
  Write-Output 'EXTERNAL_ORIGIN=403'
  Write-Output "TEMP_DATA_PRESERVED=$testRoot"
  if ($KeepRunning) { Write-Output "SERVER_PID=$($process.Id)" }
} finally {
  if (-not $KeepRunning -and $process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  Remove-Item Env:VAULT_DATA_DIR,Env:VAULT_BIND_HOST,Env:VAULT_PORT,Env:VAULT_PUBLIC_URL -ErrorAction SilentlyContinue
}
