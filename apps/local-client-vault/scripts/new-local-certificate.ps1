#Requires -Version 7.0
param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\data\certificates'))
$ErrorActionPreference = 'Stop'
$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null
$rsa = [Security.Cryptography.RSA]::Create(3072)
$request = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=MRL Local Client Vault',$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
$san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddDnsName('localhost'); $san.AddIpAddress([Net.IPAddress]::Loopback)
$request.CertificateExtensions.Add($san.Build())
$certificate = $request.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5),[DateTimeOffset]::Now.AddYears(2))
[IO.File]::WriteAllText((Join-Path $resolvedOutput 'vault.crt'),$certificate.ExportCertificatePem())
[IO.File]::WriteAllText((Join-Path $resolvedOutput 'vault.key'),$rsa.ExportPkcs8PrivateKeyPem())
$store = [Security.Cryptography.X509Certificates.X509Store]::new('Root','CurrentUser'); $store.Open('ReadWrite'); $store.Add($certificate); $store.Close()
Write-Host "Certificado local criado e confiado para o usuario atual em $resolvedOutput"
