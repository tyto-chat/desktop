param([Parameter(Mandatory, ValueFromRemainingArguments)][string[]]$Paths)

$failed = $false
foreach ($path in $Paths) {
  $signature = Get-AuthenticodeSignature -FilePath $path
  if ($signature.Status -eq "Valid") {
    Write-Host "$path is signed by $($signature.SignerCertificate.Subject)"
  } else {
    Write-Error "$path is not validly signed: $($signature.Status) $($signature.StatusMessage)"
    $failed = $true
  }
}
if ($failed) { exit 1 }
