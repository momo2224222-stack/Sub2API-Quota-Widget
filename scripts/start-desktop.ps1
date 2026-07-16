$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$NodeModules = Join-Path $ProjectRoot "node_modules"
$ElectronExe = Join-Path $ProjectRoot "node_modules\electron\dist\electron.exe"

if (-not (Test-Path $NodeModules) -or -not (Test-Path $ElectronExe)) {
  $Npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  Push-Location $ProjectRoot
  try {
    $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
    & $Npm install
    if (-not (Test-Path $ElectronExe)) {
      & node "node_modules\electron\install.js"
    }
  } finally {
    Pop-Location
  }
}

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $ElectronExe
$psi.Arguments = "."
$psi.WorkingDirectory = $ProjectRoot
$psi.UseShellExecute = $true
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
[System.Diagnostics.Process]::Start($psi) | Out-Null
