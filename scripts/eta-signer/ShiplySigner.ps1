<#
  Shiply e-invoice signer. Runs on the finance PC where the company's e-signature USB token
  is plugged in. It asks Shiply for invoices waiting for a signature, signs each one with
  the token (CAdES-BES, as the Egyptian Tax Authority requires), and sends the signatures
  back. Shiply then submits them to the tax authority by itself.

  First time:   powershell -ExecutionPolicy Bypass -File ShiplySigner.ps1 -ListCertificates
  Every run:    powershell -ExecutionPolicy Bypass -File ShiplySigner.ps1
  Keep running: powershell -ExecutionPolicy Bypass -File ShiplySigner.ps1 -Every 10

  Settings live in signer.json next to this file:
    { "server": "https://your-shiply-address", "key": "snsk_...", "thumbprint": "AB12..." }
  The key comes from Finance, Company tax details, "New signing key" (admin).
  Windows asks for the token PIN the first time it is used.
#>
param(
  [switch]$ListCertificates,
  # Minutes between runs; 0 runs once.
  [int]$Every = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if ($ListCertificates) {
  Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.HasPrivateKey } |
    Format-Table Thumbprint, Subject, NotAfter -AutoSize
  return
}

$config = Get-Content (Join-Path $PSScriptRoot 'signer.json') -Raw | ConvertFrom-Json
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq $config.thumbprint }
if (-not $cert) { throw "Certificate $($config.thumbprint) not found. Run with -ListCertificates." }

# The signing-certificate-v2 attribute (RFC 5035), built the way the tax authority's own
# sample builds it: SEQUENCE { SEQUENCE { ESSCertIDv2 { AlgorithmIdentifier, certHash } } }.
function SigningCertificateV2([Security.Cryptography.X509Certificates.X509Certificate2]$c) {
  $hash = [Security.Cryptography.SHA256]::Create().ComputeHash($c.RawData)
  $alg = [byte[]](0x30, 0x0D, 0x06, 0x0B, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x09, 0x10, 0x02, 0x2F)
  $certHash = [byte[]](0x04, 0x20) + $hash
  $essCertId = [byte[]](0x30, ($alg.Length + $certHash.Length)) + $alg + $certHash
  $certs = [byte[]](0x30, $essCertId.Length) + $essCertId
  return [byte[]](0x30, $certs.Length) + $certs
}

function Sign([string]$canonical) {
  $data = [Text.Encoding]::UTF8.GetBytes($canonical)
  $content = New-Object Security.Cryptography.Pkcs.ContentInfo((New-Object Security.Cryptography.Oid '1.2.840.113549.1.7.5'), $data)
  $cms = New-Object Security.Cryptography.Pkcs.SignedCms($content, $true)
  $signer = New-Object Security.Cryptography.Pkcs.CmsSigner($cert)
  $signer.DigestAlgorithm = New-Object Security.Cryptography.Oid '2.16.840.1.101.3.4.2.1'
  $signer.IncludeOption = [Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly
  [void]$signer.SignedAttributes.Add((New-Object Security.Cryptography.Pkcs.Pkcs9SigningTime([DateTime]::UtcNow)))
  $attr = New-Object Security.Cryptography.AsnEncodedData((New-Object Security.Cryptography.Oid '1.2.840.113549.1.9.16.2.47'), (SigningCertificateV2 $cert))
  [void]$signer.SignedAttributes.Add($attr)
  $cms.ComputeSignature($signer)
  return [Convert]::ToBase64String($cms.Encode())
}

function RunOnce {
  $headers = @{ 'x-signer-key' = $config.key }
  $base = $config.server.TrimEnd('/') + '/api/eta-signer'
  $waiting = Invoke-RestMethod -Uri "$base/documents" -Headers $headers -Method Get
  if (-not $waiting.ready) {
    Write-Host "Not ready in Shiply: $($waiting.missing -join ', ') $($waiting.missingCodes -join ', ')"
    return
  }
  foreach ($b in $waiting.blocked) { Write-Host "Waiting: $($b.internalId) ($($b.reason))" }
  if ($waiting.documents.Count -eq 0) { Write-Host "$(Get-Date -Format 'HH:mm') nothing to sign"; return }
  $signatures = @()
  foreach ($doc in $waiting.documents) {
    $signatures += @{ id = $doc.id; signature = (Sign $doc.canonical) }
    Write-Host "Signed $($doc.internalId)"
  }
  $body = @{ signatures = $signatures } | ConvertTo-Json -Depth 4
  $result = Invoke-RestMethod -Uri "$base/signatures" -Headers $headers -Method Post `
    -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
  Write-Host "Sent $($result.saved) signatures to Shiply"
}

do {
  try { RunOnce } catch { Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red }
  if ($Every -gt 0) { Start-Sleep -Seconds ($Every * 60) }
} while ($Every -gt 0)
