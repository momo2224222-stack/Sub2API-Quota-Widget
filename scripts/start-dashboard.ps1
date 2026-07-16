$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Port = if ($env:ACCOUNT_DASHBOARD_PORT) { [int]$env:ACCOUNT_DASHBOARD_PORT } else { 3847 }
$Url = "http://127.0.0.1:$Port/"

function Start-HiddenProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FileName,
    [string]$Arguments = "",
    [string]$WorkingDirectory = ""
  )

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FileName
  $psi.Arguments = $Arguments
  if ($WorkingDirectory) {
    $psi.WorkingDirectory = $WorkingDirectory
  }
  $psi.UseShellExecute = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  [System.Diagnostics.Process]::Start($psi) | Out-Null
}

function Open-LocalUrl {
  param([Parameter(Mandatory = $true)][string]$TargetUrl)

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $TargetUrl
  $psi.UseShellExecute = $true
  [System.Diagnostics.Process]::Start($psi) | Out-Null
}

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $existing) {
  $node = (Get-Command node -ErrorAction Stop).Source
  Start-HiddenProcess -FileName $node -Arguments "server\index.mjs" -WorkingDirectory $ProjectRoot
  Start-Sleep -Seconds 1
}

Open-LocalUrl $Url
