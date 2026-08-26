Add-Type -AssemblyName System.Security

function Assert-VaultServiceUsesCurrentIdentity {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$ServiceSid)

  if ([string]::IsNullOrWhiteSpace($ServiceSid)) {
    throw 'O SID da conta do servico esta vazio.'
  }
  $currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  if ($null -eq $currentIdentity.User -or [string]::IsNullOrWhiteSpace($currentIdentity.User.Value)) {
    throw 'A conta Windows atual nao possui SID.'
  }
  if (-not [string]::Equals($currentIdentity.User.Value, $ServiceSid, [StringComparison]::OrdinalIgnoreCase)) {
    throw "A conta atual ($($currentIdentity.Name)) e diferente da conta que executa MRLClientVault. Execute a migracao autenticado como a conta do servico."
  }
}

function Protect-VaultBytesCurrentUser {
  [CmdletBinding()]
  param([Parameter(Mandatory)][byte[]]$Bytes)
  return [Security.Cryptography.ProtectedData]::Protect($Bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
}

function Unprotect-VaultBytesCurrentUser {
  [CmdletBinding()]
  param([Parameter(Mandatory)][byte[]]$Bytes)
  return [Security.Cryptography.ProtectedData]::Unprotect($Bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
}

function Test-ByteArrayEqual {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][byte[]]$Expected,
    [Parameter(Mandatory)][byte[]]$Actual
  )
  if ($Expected.Length -ne $Actual.Length) { return $false }
  $difference = 0
  for ($index = 0; $index -lt $Expected.Length; $index++) {
    $difference = $difference -bor ($Expected[$index] -bxor $Actual[$index])
  }
  return $difference -eq 0
}

function Assert-PemPrivateKeyBytes {
  [CmdletBinding()]
  param([Parameter(Mandatory)][byte[]]$Bytes)

  if ($Bytes.Length -eq 0) { throw 'A chave privada esta vazia.' }
  $pem = [Text.Encoding]::UTF8.GetString($Bytes)
  if ($pem -notmatch '-----BEGIN (?:RSA )?PRIVATE KEY-----') {
    throw 'O conteudo protegido nao e uma chave privada PEM valida.'
  }
  $base64Body = ($pem -replace '-----BEGIN (?:RSA )?PRIVATE KEY-----', '' -replace '-----END (?:RSA )?PRIVATE KEY-----', '' -replace '\s', '')
  try { $decodedKey = [Convert]::FromBase64String($base64Body) } catch { throw 'A chave privada PEM possui codificacao invalida.' }
  if ($decodedKey.Length -eq 0) { throw 'A chave privada PEM esta vazia.' }
  $rsa = [Security.Cryptography.RSA]::Create()
  try {
    if ($rsa.PSObject.Methods.Name -contains 'ImportFromPem') {
      try { $rsa.ImportFromPem($pem) } catch { throw 'A chave privada PEM nao pode ser importada.' }
    }
  } finally { $rsa.Dispose() }
}

function Write-CurrentUserProtectedVaultKey {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][byte[]]$PlaintextBytes,
    [Parameter(Mandatory)][string]$DestinationPath
  )

  Assert-PemPrivateKeyBytes -Bytes $PlaintextBytes
  $directory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($DestinationPath))
  [IO.Directory]::CreateDirectory($directory) | Out-Null
  $temporaryPath = Join-Path $directory ('.vault-key-{0}.tmp' -f [Guid]::NewGuid().ToString('N'))
  try {
    $protectedBytes = Protect-VaultBytesCurrentUser -Bytes $PlaintextBytes
    $stream = [IO.FileStream]::new($temporaryPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough)
    try { $stream.Write($protectedBytes, 0, $protectedBytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }

    $verifiedBytes = Unprotect-VaultBytesCurrentUser -Bytes ([IO.File]::ReadAllBytes($temporaryPath))
    if (-not (Test-ByteArrayEqual -Expected $PlaintextBytes -Actual $verifiedBytes)) {
      throw 'A verificacao byte a byte da chave protegida falhou.'
    }
    Assert-PemPrivateKeyBytes -Bytes $verifiedBytes

    if (Test-Path -LiteralPath $DestinationPath -PathType Leaf) {
      [IO.File]::Replace($temporaryPath, $DestinationPath, $null, $true)
    } else {
      [IO.File]::Move($temporaryPath, $DestinationPath)
    }
  } catch {
    if (Test-Path -LiteralPath $temporaryPath) { [IO.File]::Delete($temporaryPath) }
    throw
  }
}

function Test-CurrentUserProtectedVaultKey {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Chave DPAPI ausente: $Path" }
  $plaintextBytes = Unprotect-VaultBytesCurrentUser -Bytes ([IO.File]::ReadAllBytes($Path))
  Assert-PemPrivateKeyBytes -Bytes $plaintextBytes
  return $true
}

function Test-VaultCertificateRequiredFiles {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$CaCertificatePath,
    [Parameter(Mandatory)][string]$CaProtectedKeyPath,
    [Parameter(Mandatory)][string]$ServerCertificatePath,
    [Parameter(Mandatory)][string]$ServerProtectedKeyPath
  )
  return (Test-Path -LiteralPath $CaCertificatePath -PathType Leaf) `
    -and (Test-Path -LiteralPath $CaProtectedKeyPath -PathType Leaf) `
    -and (Test-Path -LiteralPath $ServerCertificatePath -PathType Leaf) `
    -and (Test-Path -LiteralPath $ServerProtectedKeyPath -PathType Leaf)
}

function Ensure-LegacyVaultKeyMigrated {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$LegacyPath,
    [Parameter(Mandatory)][string]$ProtectedPath,
    [Parameter(Mandatory)][string]$ServiceSid
  )

  Assert-VaultServiceUsesCurrentIdentity -ServiceSid $ServiceSid
  if (Test-Path -LiteralPath $ProtectedPath -PathType Leaf) {
    Test-CurrentUserProtectedVaultKey -Path $ProtectedPath | Out-Null
    return 'already-protected'
  }
  if (-not (Test-Path -LiteralPath $LegacyPath -PathType Leaf)) { return 'not-found' }

  $legacyBytes = [IO.File]::ReadAllBytes($LegacyPath)
  Write-CurrentUserProtectedVaultKey -PlaintextBytes $legacyBytes -DestinationPath $ProtectedPath
  Test-CurrentUserProtectedVaultKey -Path $ProtectedPath | Out-Null
  return 'migrated-pending-service-validation'
}

function Remove-LegacyVaultKeyAfterValidation {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$LegacyPath,
    [Parameter(Mandatory)][string]$ProtectedPath,
    [Parameter(Mandatory)][string]$ServiceSid
  )

  Assert-VaultServiceUsesCurrentIdentity -ServiceSid $ServiceSid
  Test-CurrentUserProtectedVaultKey -Path $ProtectedPath | Out-Null
  if (-not (Test-Path -LiteralPath $LegacyPath -PathType Leaf)) { return }

  $length = ([IO.FileInfo]::new($LegacyPath)).Length
  $stream = [IO.FileStream]::new($LegacyPath, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough)
  try {
    $buffer = [byte[]]::new(65536)
    $remaining = $length
    while ($remaining -gt 0) {
      $random = [Security.Cryptography.RandomNumberGenerator]::Create()
      try { $random.GetBytes($buffer) } finally { $random.Dispose() }
      $count = [Math]::Min($buffer.Length, $remaining)
      $stream.Write($buffer, 0, $count)
      $remaining -= $count
    }
    $stream.SetLength($length)
    $stream.Flush($true)
  } finally { $stream.Dispose() }
  [IO.File]::Delete($LegacyPath)
}
