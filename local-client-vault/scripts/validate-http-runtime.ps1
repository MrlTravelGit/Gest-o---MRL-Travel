[CmdletBinding()]
param([int]$Port=17443,[switch]$KeepRunning)
$ErrorActionPreference='Stop'
$testRoot=Join-Path $env:TEMP ('mrl-vault-http-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot|Out-Null
$stdout=Join-Path $testRoot 'stdout.log';$stderr=Join-Path $testRoot 'stderr.log';$process=$null
try{
  $env:VAULT_DATA_DIR=$testRoot;$env:VAULT_BIND_HOST='127.0.0.1';$env:VAULT_PORT=[string]$Port;$env:VAULT_PUBLIC_URL="http://127.0.0.1:$Port"
  & node --input-type=module --eval "const {createFirstAdmin}=await import('./dist-server/auth.js');await createFirstAdmin('runtime-admin','Runtime-validation-2026');"
  if($LASTEXITCODE-ne 0){throw 'Falha ao preparar usuario temporario.'}
  & node --input-type=module --eval "const {recordSyncEvent}=await import('./dist-server/vault-service.js');recordSyncEvent({eventId:'40000000-0000-4000-8000-000000000001',clientId:'30000000-0000-4000-8000-000000000001',displayName:'Cliente aguardando',contractStartDate:'2026-08-01',contractEndDate:'2027-07-31',eventType:'client_vault_create'});"
  if($LASTEXITCODE-ne 0){throw 'Falha ao preparar cadastro pendente temporario.'}
  $process=Start-Process node -ArgumentList @('dist-server/server.js') -WorkingDirectory (Get-Location) -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
  $health=$null
  for($attempt=0;$attempt-lt 20;$attempt++){Start-Sleep -Milliseconds 250;try{$health=Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2;if($health.StatusCode-eq 200){break}}catch{}}
  if($null-eq$health-or$health.StatusCode-ne 200){throw 'Servidor HTTP temporario indisponivel.'}
  $body=@{username='runtime-admin';password='Runtime-validation-2026'}|ConvertTo-Json -Compress
  $login=Invoke-WebRequest "http://127.0.0.1:$Port/api/auth/login" -Method Post -ContentType 'application/json' -Body $body -SessionVariable webSession -UseBasicParsing
  $cookie=[string]$login.Headers['Set-Cookie'];if($cookie-notmatch'HttpOnly'-or$cookie-notmatch'SameSite=Strict'-or$cookie-match'(^|;\s*)Secure(;|$)'){throw 'Cookie HTTP invalido.'}
  $session=Invoke-WebRequest "http://127.0.0.1:$Port/api/auth/session" -WebSession $webSession -UseBasicParsing
  $sessionData=$session.Content|ConvertFrom-Json
  $clients=Invoke-WebRequest "http://127.0.0.1:$Port/api/clients" -WebSession $webSession -UseBasicParsing
  $clientsData=$clients.Content|ConvertFrom-Json;if($clientsData.total-ne 1-or$clientsData.items[0].syncStatus-ne'pending'){throw 'Lista de clientes pendentes invalida.'}
  $pending=Invoke-WebRequest "http://127.0.0.1:$Port/api/clients/30000000-0000-4000-8000-000000000001" -WebSession $webSession -UseBasicParsing
  $pendingData=$pending.Content|ConvertFrom-Json;if($pendingData.localDataAvailable-ne$false-or$pendingData.displayName-ne'Cliente aguardando'){throw 'Placeholder de sincronizacao invalido.'}
  $blocked=$false;try{Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -Headers @{Origin='https://example.com'} -UseBasicParsing|Out-Null}catch{$blocked=$_.Exception.Response.StatusCode.value__-eq 403}
  if(-not$blocked){throw 'Origem externa nao foi bloqueada.'}
  Invoke-WebRequest "http://127.0.0.1:$Port/api/auth/logout" -Method Post -ContentType 'application/json' -Body '{}' -Headers @{'X-Vault-CSRF'=$sessionData.csrf} -WebSession $webSession -UseBasicParsing|Out-Null
  $logs=((Get-Content $stdout -Raw -ErrorAction SilentlyContinue)+(Get-Content $stderr -Raw -ErrorAction SilentlyContinue));if($logs-match'Runtime-validation-2026'){throw 'Senha apareceu nos logs.'}
  Write-Output 'RUNTIME_HTTP=PASS';Write-Output 'HEALTH=200';Write-Output 'LOGIN_LIST_PENDING_LOGOUT=PASS';Write-Output 'COOKIE=HttpOnly;SameSite=Strict;Secure=false';Write-Output 'EXTERNAL_ORIGIN=403';Write-Output "TEMP_DATA=$testRoot"
  if($KeepRunning){Write-Output "SERVER_PID=$($process.Id)"}
}finally{
  if(-not$KeepRunning-and$process-and-not$process.HasExited){Stop-Process -Id $process.Id -Force}
  Remove-Item Env:VAULT_DATA_DIR,Env:VAULT_BIND_HOST,Env:VAULT_PORT,Env:VAULT_PUBLIC_URL -ErrorAction SilentlyContinue
}
