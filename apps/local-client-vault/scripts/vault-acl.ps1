function ConvertTo-QualifiedWindowsAccount {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$AccountName,
    [string]$ComputerName = [Environment]::MachineName
  )

  $trimmedAccount = $AccountName.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmedAccount)) {
    throw 'A conta do servico esta vazia.'
  }
  if ($trimmedAccount.StartsWith('.\', [StringComparison]::Ordinal)) {
    if ([string]::IsNullOrWhiteSpace($ComputerName)) {
      throw 'COMPUTERNAME indisponivel para resolver a conta local do servico.'
    }
    return "$ComputerName\$($trimmedAccount.Substring(2))"
  }
  return $trimmedAccount
}

function Resolve-VaultServiceSid {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$ServiceAccount,
    [Parameter(Mandatory)][System.Security.Principal.WindowsIdentity]$CurrentIdentity,
    [string]$ComputerName = [Environment]::MachineName
  )

  if ($ServiceAccount -in @('LocalSystem', 'NT AUTHORITY\SYSTEM')) {
    return [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  }

  $qualifiedAccount = ConvertTo-QualifiedWindowsAccount -AccountName $ServiceAccount -ComputerName $ComputerName
  $qualifiedCurrentAccount = ConvertTo-QualifiedWindowsAccount -AccountName $CurrentIdentity.Name -ComputerName $ComputerName
  if ([string]::Equals($qualifiedAccount, $qualifiedCurrentAccount, [StringComparison]::OrdinalIgnoreCase)) {
    if ($null -eq $CurrentIdentity.User -or [string]::IsNullOrWhiteSpace($CurrentIdentity.User.Value)) {
      throw "A identidade Windows atual nao possui SID: $qualifiedCurrentAccount"
    }
    return $CurrentIdentity.User
  }

  $account = [System.Security.Principal.NTAccount]::new($qualifiedAccount)
  $resolvedSid = $account.Translate([System.Security.Principal.SecurityIdentifier])
  if ($null -eq $resolvedSid -or [string]::IsNullOrWhiteSpace($resolvedSid.Value)) {
    throw "Nao foi possivel resolver o SID da conta do servico: $qualifiedAccount"
  }
  return $resolvedSid
}

function Invoke-IcaclsChecked {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$IcaclsPath,
    [Parameter(Mandatory)][string[]]$Arguments
  )

  foreach ($argument in $Arguments) {
    if ($argument.StartsWith('*:', [StringComparison]::Ordinal) -or $argument.StartsWith('*(', [StringComparison]::Ordinal)) {
      throw 'Execucao do icacls bloqueada porque foi recebido um SID vazio.'
    }
  }

  & $IcaclsPath @Arguments | Out-Null
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "icacls falhou com codigo $exitCode. Argumentos: $($Arguments -join ' ')"
  }
}

function Restore-VaultAclSnapshot {
  [CmdletBinding()]
  param([Parameter(Mandatory)][object[]]$Snapshots)

  $restoreErrors = [Collections.Generic.List[string]]::new()
  foreach ($snapshot in $Snapshots) {
    try {
      $previousAcl = [System.Security.AccessControl.DirectorySecurity]::new()
      $previousAcl.SetSecurityDescriptorSddlForm($snapshot.Sddl, [System.Security.AccessControl.AccessControlSections]::All)
      Set-Acl -LiteralPath $snapshot.Path -AclObject $previousAcl -ErrorAction Stop
    } catch {
      $restoreErrors.Add("$($snapshot.Path): $($_.Exception.Message)")
    }
  }
  return $restoreErrors
}

function Set-VaultDirectoryAcl {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string[]]$Paths,
    [Parameter(Mandatory)][System.Security.Principal.SecurityIdentifier]$ServiceSid
  )

  $icacls = (Get-Command icacls.exe -ErrorAction Stop).Source
  $systemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $administratorsSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $requiredSids = @($systemSid, $administratorsSid, $ServiceSid)

  # Nenhuma ACL pode ser alterada antes de todas as identidades estarem resolvidas.
  foreach ($sid in $requiredSids) {
    if ($null -eq $sid -or [string]::IsNullOrWhiteSpace($sid.Value)) {
      throw 'Uma identidade obrigatoria nao possui SID. Nenhuma ACL foi alterada.'
    }
  }

  $snapshots = [Collections.Generic.List[object]]::new()
  foreach ($securedPath in $Paths) {
    [IO.Directory]::CreateDirectory($securedPath) | Out-Null
    $currentAcl = Get-Acl -LiteralPath $securedPath -ErrorAction Stop
    $snapshots.Add([pscustomobject]@{ Path = $securedPath; Sddl = $currentAcl.Sddl })
  }

  $grants = [Collections.Generic.List[object]]::new()
  $grants.Add([pscustomobject]@{ Sid = $systemSid; Rights = '(OI)(CI)F' })
  $grants.Add([pscustomobject]@{ Sid = $administratorsSid; Rights = '(OI)(CI)F' })
  if ($ServiceSid.Value -notin @($systemSid.Value, $administratorsSid.Value)) {
    $grants.Add([pscustomobject]@{ Sid = $ServiceSid; Rights = '(OI)(CI)M' })
  }

  try {
    # Primeiro cria ACEs explicitas validas, mantendo a heranca e o acesso atual.
    foreach ($securedPath in $Paths) {
      foreach ($grant in $grants) {
        $sidValue = $grant.Sid.Value
        if ([string]::IsNullOrWhiteSpace($sidValue)) {
          throw 'Execucao do icacls bloqueada porque foi recebido um SID vazio.'
        }
        $grantArgument = '*{0}:{1}' -f $sidValue, $grant.Rights
        Invoke-IcaclsChecked -IcaclsPath $icacls -Arguments @($securedPath, '/grant:r', $grantArgument)
      }
    }

    # A heranca so e removida depois que todas as concessoes foram concluidas.
    foreach ($securedPath in $Paths) {
      Invoke-IcaclsChecked -IcaclsPath $icacls -Arguments @($securedPath, '/inheritance:r')
    }
  } catch {
    $aclError = $_
    $restoreErrors = Restore-VaultAclSnapshot -Snapshots $snapshots.ToArray()
    if ($restoreErrors.Count -gt 0) {
      throw "Falha ao aplicar ACL e ao restaurar a ACL anterior. Erro original: $($aclError.Exception.Message). Restauracao: $($restoreErrors -join '; ')"
    }
    throw "Falha ao aplicar ACL; a ACL anterior foi restaurada. $($aclError.Exception.Message)"
  }
}
