#Requires -Version 7.0
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ServerPrivateIp,
  [string]$DnsName = 'mrl-vault.local',
  [string]$OutputDirectory = 'C:\ProgramData\MRLTravel\Vault\certificates',
  [string]$ServiceSid = 'S-1-5-18',
  [int]$RenewBeforeDays = 30
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
. (Join-Path $PSScriptRoot 'vault-acl.ps1')
. (Join-Path $PSScriptRoot 'vault-key-protection.ps1')

function Test-PrivateIpv4([string]$Value) {
  $parsed = $null
  if (-not [Net.IPAddress]::TryParse($Value, [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
  $bytes = $parsed.GetAddressBytes()
  return $bytes[0] -eq 10 -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
}
function Protect-Machine([byte[]]$Bytes) { [Security.Cryptography.ProtectedData]::Protect($Bytes,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine) }
function Unprotect-Machine([byte[]]$Bytes) { [Security.Cryptography.ProtectedData]::Unprotect($Bytes,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine) }
function Set-PrivateAcl([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($ServiceSid)) { throw 'O SID do servico esta vazio. Nenhuma ACL foi alterada.' }
  $validatedServiceSid = [System.Security.Principal.SecurityIdentifier]::new($ServiceSid)
  Set-VaultDirectoryAcl -Paths @($Path) -ServiceSid $validatedServiceSid
}
function Test-RsaPublicKeyMatch([Security.Cryptography.RSA]$PrivateKey,[Security.Cryptography.RSA]$CertificateKey) {
  if ($null -eq $PrivateKey -or $null -eq $CertificateKey) { return $false }
  return Test-ByteArrayEqual -Expected ($PrivateKey.ExportSubjectPublicKeyInfo()) -Actual ($CertificateKey.ExportSubjectPublicKeyInfo())
}
function Get-CertificateSetValidation {
  param(
    [string]$CaCertificatePath,
    [string]$CaProtectedKeyPath,
    [string]$ServerCertificatePath,
    [string]$ServerProtectedKeyPath,
    [string]$RequiredIp,
    [int]$MinimumRemainingDays
  )
  $validation = [ordered]@{
    RequiredFilesPresent = $false
    CaKeyReadable = $false
    CaKeyMatchesCertificate = $false
    ServerKeyReadable = $false
    ServerKeyMatchesCertificate = $false
    SanMatches = $false
    CertificateValid = $false
    NotAfter = $null
    AllValid = $false
  }
  $validation.RequiredFilesPresent = Test-VaultCertificateRequiredFiles -CaCertificatePath $CaCertificatePath -CaProtectedKeyPath $CaProtectedKeyPath -ServerCertificatePath $ServerCertificatePath -ServerProtectedKeyPath $ServerProtectedKeyPath
  if (-not $validation.RequiredFilesPresent) { return [pscustomobject]$validation }

  try {
    $caCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($CaCertificatePath)
    $caPrivateKey = [Security.Cryptography.RSA]::Create()
    $caCertificateKey = $null
    try {
      $bytesRead = 0
      $caPrivateKey.ImportPkcs8PrivateKey((Unprotect-Machine ([IO.File]::ReadAllBytes($CaProtectedKeyPath))), [ref]$bytesRead) | Out-Null
      $validation.CaKeyReadable = $true
      $caCertificateKey = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($caCertificate)
      $validation.CaKeyMatchesCertificate = Test-RsaPublicKeyMatch -PrivateKey $caPrivateKey -CertificateKey $caCertificateKey
    } finally {
      if ($null -ne $caCertificateKey) { $caCertificateKey.Dispose() }
      $caPrivateKey.Dispose()
      $caCertificate.Dispose()
    }
  } catch {}

  try {
    $serverCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($ServerCertificatePath)
    $serverPrivateKey = [Security.Cryptography.RSA]::Create()
    $serverCertificateKey = $null
    try {
      $serverKeyBytes = Unprotect-VaultBytesCurrentUser -Bytes ([IO.File]::ReadAllBytes($ServerProtectedKeyPath))
      Assert-PemPrivateKeyBytes -Bytes $serverKeyBytes
      $serverPrivateKey.ImportFromPem([Text.Encoding]::UTF8.GetString($serverKeyBytes))
      $validation.ServerKeyReadable = $true
      $serverCertificateKey = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($serverCertificate)
      $validation.ServerKeyMatchesCertificate = Test-RsaPublicKeyMatch -PrivateKey $serverPrivateKey -CertificateKey $serverCertificateKey
      $sanExtension = $serverCertificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.17' } | Select-Object -First 1
      $validation.SanMatches = [bool]($sanExtension -and $sanExtension.Format($false) -match [regex]::Escape($RequiredIp))
      $validation.NotAfter = $serverCertificate.NotAfter
      $now = [DateTime]::UtcNow
      $validation.CertificateValid = $serverCertificate.NotBefore.ToUniversalTime() -le $now -and $serverCertificate.NotAfter.ToUniversalTime() -gt $now.AddDays($MinimumRemainingDays)
    } finally {
      if ($null -ne $serverCertificateKey) { $serverCertificateKey.Dispose() }
      $serverPrivateKey.Dispose()
      $serverCertificate.Dispose()
    }
  } catch {}

  $validation.AllValid = $validation.RequiredFilesPresent `
    -and $validation.CaKeyReadable `
    -and $validation.CaKeyMatchesCertificate `
    -and $validation.ServerKeyReadable `
    -and $validation.ServerKeyMatchesCertificate `
    -and $validation.SanMatches `
    -and $validation.CertificateValid
  return [pscustomobject]$validation
}
if (-not (Test-PrivateIpv4 $ServerPrivateIp)) { throw 'ServerPrivateIp deve ser um IPv4 privado RFC 1918.' }

$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
$backupDirectory = Join-Path $resolvedOutput 'previous'
[IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null
[IO.Directory]::CreateDirectory($backupDirectory) | Out-Null
$caCertPath = Join-Path $resolvedOutput 'mrl-vault-ca.crt'
$caKeyPath = Join-Path $resolvedOutput 'mrl-vault-ca.key.dpapi'
$serverCertPath = Join-Path $resolvedOutput 'vault.crt'
$serverKeyPath = Join-Path $resolvedOutput 'vault.key.dpapi'
$legacyKeyPath = Join-Path $resolvedOutput 'vault.key'

Assert-VaultServiceUsesCurrentIdentity -ServiceSid $ServiceSid
if (-not (Test-Path -LiteralPath $serverKeyPath -PathType Leaf) -and (Test-Path -LiteralPath $legacyKeyPath -PathType Leaf)) {
  Ensure-LegacyVaultKeyMigrated -LegacyPath $legacyKeyPath -ProtectedPath $serverKeyPath -ServiceSid $ServiceSid | Out-Null
}

$initialValidation = Get-CertificateSetValidation -CaCertificatePath $caCertPath -CaProtectedKeyPath $caKeyPath -ServerCertificatePath $serverCertPath -ServerProtectedKeyPath $serverKeyPath -RequiredIp $ServerPrivateIp -MinimumRemainingDays $RenewBeforeDays
if ($initialValidation.AllValid) {
  Write-Host "Certificado vigente ate $($initialValidation.NotAfter.ToString('dd/MM/yyyy'))."
  return
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ((Test-Path $caCertPath) -and (Test-Path $caKeyPath)) {
  $caCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($caCertPath)
  $caRsa = [Security.Cryptography.RSA]::Create()
  $bytesRead = 0
  $caRsa.ImportPkcs8PrivateKey((Unprotect-Machine ([IO.File]::ReadAllBytes($caKeyPath))), [ref]$bytesRead) | Out-Null
} else {
  if (Test-Path -LiteralPath $caCertPath -PathType Leaf) { Copy-Item -LiteralPath $caCertPath -Destination (Join-Path $backupDirectory "mrl-vault-ca-$stamp.crt") }
  if (Test-Path -LiteralPath $caKeyPath -PathType Leaf) { Copy-Item -LiteralPath $caKeyPath -Destination (Join-Path $backupDirectory "mrl-vault-ca-$stamp.key.dpapi") }
  $caRsa = [Security.Cryptography.RSA]::Create(4096)
  $caRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=MRL Travel Local Vault CA',$caRsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
  $caRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true))
  $caRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::CrlSign,$true))
  $caCertificate = $caRequest.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5),[DateTimeOffset]::Now.AddYears(10))
  [IO.File]::WriteAllText($caCertPath,$caCertificate.ExportCertificatePem())
  [IO.File]::WriteAllBytes($caKeyPath,(Protect-Machine $caRsa.ExportPkcs8PrivateKey()))
}

if (Test-Path $serverCertPath) { Copy-Item -LiteralPath $serverCertPath -Destination (Join-Path $backupDirectory "vault-$stamp.crt"); if(Test-Path $serverKeyPath){Copy-Item -LiteralPath $serverKeyPath -Destination (Join-Path $backupDirectory "vault-$stamp.key.dpapi")} }
$serverRsa = [Security.Cryptography.RSA]::Create(3072)
$request = [Security.Cryptography.X509Certificates.CertificateRequest]::new("CN=$ServerPrivateIp",$serverRsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
$san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddDnsName('localhost'); $san.AddDnsName($DnsName); $san.AddIpAddress([Net.IPAddress]::Loopback); $san.AddIpAddress([Net.IPAddress]::Parse($ServerPrivateIp))
$request.CertificateExtensions.Add($san.Build())
$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment,$true))
$serverAuthOids = [Security.Cryptography.OidCollection]::new(); $serverAuthOids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1')) | Out-Null
$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($serverAuthOids,$false))
$issuer = if($caCertificate.HasPrivateKey){$caCertificate}else{$caCertificate.CopyWithPrivateKey($caRsa)}
$issued = $request.Create($issuer,[DateTimeOffset]::Now.AddMinutes(-5),[DateTimeOffset]::Now.AddYears(2),[Security.Cryptography.RandomNumberGenerator]::GetBytes(16))
[IO.File]::WriteAllText($serverCertPath,$issued.ExportCertificatePem())
$serverKeyPemBytes = [Text.Encoding]::UTF8.GetBytes($serverRsa.ExportPkcs8PrivateKeyPem())
Write-CurrentUserProtectedVaultKey -PlaintextBytes $serverKeyPemBytes -DestinationPath $serverKeyPath
Set-PrivateAcl $resolvedOutput

$finalValidation = Get-CertificateSetValidation -CaCertificatePath $caCertPath -CaProtectedKeyPath $caKeyPath -ServerCertificatePath $serverCertPath -ServerProtectedKeyPath $serverKeyPath -RequiredIp $ServerPrivateIp -MinimumRemainingDays $RenewBeforeDays
if (-not $finalValidation.AllValid) {
  $failedChecks = @($finalValidation.PSObject.Properties | Where-Object { $_.Name -notin @('NotAfter','AllValid') -and $_.Value -ne $true } | ForEach-Object Name)
  throw "O conjunto de certificados permaneceu invalido apos a renovacao: $($failedChecks -join ', '). O NSSM nao sera iniciado."
}

$rootStore = [Security.Cryptography.X509Certificates.X509Store]::new('Root','LocalMachine')
$rootStore.Open('ReadWrite')
try { if (-not ($rootStore.Certificates | Where-Object Thumbprint -eq $caCertificate.Thumbprint)) { $rootStore.Add($caCertificate) } } finally { $rootStore.Close() }
Write-Host "Certificado emitido para localhost, 127.0.0.1, $DnsName e $ServerPrivateIp. Distribua somente mrl-vault-ca.crt."
