$ErrorActionPreference = 'Stop'

$desktopRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repositoryRoot = (Resolve-Path (Join-Path $desktopRoot '..\..')).Path
$manifestPath = Join-Path $desktopRoot 'package.json'
$manifestText = Get-Content -LiteralPath $manifestPath -Raw
$manifest = $manifestText | ConvertFrom-Json
$initialVersion = [string]$manifest.version
if ($initialVersion -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
  throw "Installer smoke requires a stable semver version, received '$initialVersion'."
}
$parts = $initialVersion.Split('.')
$upgradeVersion = '{0}.{1}.{2}' -f $parts[0], $parts[1], ([int]$parts[2] + 1)

$makeDirectory = Join-Path $desktopRoot 'out\make\squirrel.windows\x64'
$initialSetup = Join-Path $makeDirectory "Noema-$initialVersion Setup.exe"
$upgradeSetup = Join-Path $makeDirectory "Noema-$upgradeVersion Setup.exe"
$runnerTemp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$smokeRoot = Join-Path $runnerTemp "noema-installer-lifecycle-$([guid]::NewGuid().ToString('N'))"
$initialSetupCopy = Join-Path $smokeRoot "Noema-$initialVersion Setup.exe"
$upgradeSetupCopy = Join-Path $smokeRoot "Noema-$upgradeVersion Setup.exe"
$appDataPath = Join-Path $smokeRoot 'app-data'
$userDataPath = Join-Path $appDataPath 'Noema'
$loadedMarker = Join-Path $smokeRoot 'renderer-loaded.json'
$startupLog = Join-Path $smokeRoot 'startup.jsonl'
$sentinelPath = Join-Path $userDataPath 'install-lifecycle-sentinel.txt'
$installRoot = Join-Path $env:LOCALAPPDATA 'noema_desktop'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\noema_desktop'
$completed = $false

if (-not (Test-Path -LiteralPath $initialSetup -PathType Leaf)) {
  throw "Initial Squirrel installer is missing: $initialSetup"
}
if (Test-Path -LiteralPath $installRoot) {
  throw "Refusing installer smoke because the CI user already has a Noema installation: $installRoot"
}

$environmentNames = @(
  'NOEMA_SMOKE_TEST',
  'NOEMA_SMOKE_USER_DATA_DIR',
  'NOEMA_SMOKE_TEST_FILE',
  'NOEMA_SMOKE_LOG_FILE',
  'NOEMA_SMOKE_SESSION_DATA_DIR',
  'NOEMA_FREELLMAPI_API_KEY',
  'NOEMA_FREELLMAPI_BASE_URL',
  'APPDATA'
)
$originalEnvironment = @{}
foreach ($name in $environmentNames) {
  $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Invoke-CheckedProcess([string]$FilePath, [string[]]$ArgumentList, [int]$TimeoutSeconds = 180) {
  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -PassThru -WindowStyle Hidden
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    try { $process.Kill($true) } catch { }
    throw "Timed out running '$FilePath $($ArgumentList -join ' ')'."
  }
  $process.Refresh()
  if ($process.ExitCode -ne 0) {
    throw "Process '$FilePath $($ArgumentList -join ' ')' exited with $($process.ExitCode)."
  }
}

function Wait-ForInstalledApp([string]$Version) {
  $executable = Join-Path $installRoot "app-$Version\Noema.exe"
  $deadline = [DateTime]::UtcNow.AddMinutes(3)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $executable -PathType Leaf) { return $executable }
    Start-Sleep -Milliseconds 500
  }
  throw "Squirrel did not install Noema $Version under '$installRoot'."
}

function Invoke-InstalledStartupSmoke {
  if (Test-Path -LiteralPath $loadedMarker) { Remove-Item -LiteralPath $loadedMarker -Force }
  $updateExe = Join-Path $installRoot 'Update.exe'
  Invoke-CheckedProcess $updateExe @('--processStart', 'Noema.exe')

  $deadline = [DateTime]::UtcNow.AddMinutes(3)
  while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $loadedMarker -PathType Leaf)) {
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path -LiteralPath $loadedMarker -PathType Leaf)) {
    $log = if (Test-Path -LiteralPath $startupLog) { Get-Content -LiteralPath $startupLog -Raw } else { '<no startup log>' }
    throw "Installed Noema did not load its renderer. Startup log: $log"
  }

  $loaded = Get-Content -LiteralPath $loadedMarker -Raw | ConvertFrom-Json
  if (-not $loaded.packaged -or -not $loaded.rootStateLoaded -or $loaded.socialChat.agentIds -join ',' -ne 'noema') {
    throw "Installed Noema startup smoke returned an invalid renderer marker: $($loadedMarker)"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $userDataPath 'noema.sqlite3') -PathType Leaf)) {
    throw 'Installed Noema did not persist its database under the isolated test user-data path.'
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  while ([DateTime]::UtcNow -lt $deadline) {
    $running = Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq 'Noema.exe' -and
      $_.ExecutablePath -and
      $_.ExecutablePath.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase)
    }
    if (-not $running) { return }
    Start-Sleep -Milliseconds 250
  }
  throw 'Installed Noema did not exit after its Squirrel lifecycle startup smoke.'
}

function Stop-InstalledAppProcesses {
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $deadline) {
    $running = @(
      Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and
        $_.ExecutablePath.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase) -and
        $_.Name -notin @('Update.exe', 'Squirrel.exe')
      }
    )
    if ($running.Count -eq 0) { return }
    foreach ($process in $running) {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Installed Noema still has app processes before uninstall: $($running.Name -join ', ')"
}

try {
  New-Item -ItemType Directory -Path $smokeRoot -Force | Out-Null
  Copy-Item -LiteralPath $initialSetup -Destination $initialSetupCopy

  $manifest.version = $upgradeVersion
  $manifest | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
  Push-Location $repositoryRoot
  try {
    npm run package:desktop
    if ($LASTEXITCODE -ne 0) { throw "Building the upgrade package failed with exit code $LASTEXITCODE." }
    npm run make:desktop
    if ($LASTEXITCODE -ne 0) { throw "Building the upgrade installer failed with exit code $LASTEXITCODE." }
  }
  finally {
    Pop-Location
    Set-Content -LiteralPath $manifestPath -Value $manifestText -Encoding utf8NoBOM
  }

  if (-not (Test-Path -LiteralPath $upgradeSetup -PathType Leaf)) {
    throw "Upgrade Squirrel installer is missing: $upgradeSetup"
  }
  Copy-Item -LiteralPath $upgradeSetup -Destination $upgradeSetupCopy

  $env:NOEMA_SMOKE_TEST = '1'
  $env:NOEMA_SMOKE_USER_DATA_DIR = $userDataPath
  $env:NOEMA_SMOKE_TEST_FILE = $loadedMarker
  $env:NOEMA_SMOKE_LOG_FILE = $startupLog
  $env:APPDATA = $appDataPath
  New-Item -ItemType Directory -Path $appDataPath -Force | Out-Null
  Remove-Item Env:NOEMA_SMOKE_SESSION_DATA_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:NOEMA_FREELLMAPI_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:NOEMA_FREELLMAPI_BASE_URL -ErrorAction SilentlyContinue

  Invoke-CheckedProcess $initialSetupCopy @()
  Wait-ForInstalledApp $initialVersion | Out-Null
  Invoke-InstalledStartupSmoke

  New-Item -ItemType Directory -Path $userDataPath -Force | Out-Null
  $sentinel = [guid]::NewGuid().ToString('N')
  Set-Content -LiteralPath $sentinelPath -Value $sentinel -Encoding utf8NoBOM

  Invoke-CheckedProcess $upgradeSetupCopy @()
  Wait-ForInstalledApp $upgradeVersion | Out-Null
  Invoke-InstalledStartupSmoke
  if ((Get-Content -LiteralPath $sentinelPath -Raw).Trim() -ne $sentinel) {
    throw 'The user-data sentinel changed or disappeared during Squirrel upgrade.'
  }

  $installedUpgradeDirectory = Join-Path $installRoot "app-$upgradeVersion"
  $repairProbeDirectory = Join-Path $smokeRoot "repair-probe-$upgradeVersion"
  Move-Item -LiteralPath $installedUpgradeDirectory -Destination $repairProbeDirectory
  if (-not (Test-Path -LiteralPath $repairProbeDirectory -PathType Container)) {
    throw 'Could not preserve the moved application folder for installer recovery.'
  }
  Invoke-CheckedProcess $upgradeSetupCopy @()
  Wait-ForInstalledApp $upgradeVersion | Out-Null
  Invoke-InstalledStartupSmoke
  if ((Get-Content -LiteralPath $sentinelPath -Raw).Trim() -ne $sentinel) {
    throw 'The user-data sentinel changed or disappeared during installer recovery.'
  }
  if (Test-Path -LiteralPath $repairProbeDirectory) {
    Remove-Item -LiteralPath $repairProbeDirectory -Recurse -Force
  }

  Stop-InstalledAppProcesses
  Invoke-CheckedProcess (Join-Path $installRoot 'Update.exe') @('--uninstall')
  $uninstallDeadline = [DateTime]::UtcNow.AddSeconds(90)
  do {
    $remainingAppDirectories = @(
      Get-ChildItem -LiteralPath $installRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object Name -Like 'app-*'
    )
    $registryEntryRemains = Test-Path -LiteralPath $uninstallKey
    if ($remainingAppDirectories.Count -eq 0 -and -not $registryEntryRemains) { break }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $uninstallDeadline)
  if ($remainingAppDirectories.Count -gt 0) {
    $remainingNames = $remainingAppDirectories.Name -join ', '
    throw "Squirrel uninstall left Noema application version directories installed: $remainingNames."
  }
  if (-not (Test-Path -LiteralPath $sentinelPath -PathType Leaf) -or
      (Get-Content -LiteralPath $sentinelPath -Raw).Trim() -ne $sentinel) {
    throw 'Squirrel uninstall removed or changed retained user data.'
  }
  if ($registryEntryRemains) {
    throw 'Squirrel uninstall left the Noema uninstall registry entry behind.'
  }

  Push-Location $repositoryRoot
  try {
    npm run package:desktop
    if ($LASTEXITCODE -ne 0) { throw "Restoring the release-version package failed with exit code $LASTEXITCODE." }
    npm run smoke:package
    if ($LASTEXITCODE -ne 0) { throw "Restored release-version package smoke failed with exit code $LASTEXITCODE." }
  }
  finally {
    Pop-Location
  }

  $completed = $true
  Write-Host "Squirrel lifecycle smoke passed: install $initialVersion, upgrade to $upgradeVersion, recover a missing app folder, uninstall, and retain user data."
}
finally {
  foreach ($name in $environmentNames) {
    $value = $originalEnvironment[$name]
    if ($null -eq $value) {
      [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    else {
      [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
  }
  if ($completed) {
    $localAppDataRoot = [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\') + '\'
    $installRootFull = [IO.Path]::GetFullPath($installRoot)
    if (-not $installRootFull.StartsWith($localAppDataRoot, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $installRootFull) -ne 'noema_desktop') {
      throw "Refusing to clean an unexpected Squirrel install path: $installRootFull"
    }
    if (Test-Path -LiteralPath $installRootFull) {
      Remove-Item -LiteralPath $installRootFull -Recurse -Force
    }
    Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  elseif ($env:GITHUB_ACTIONS -eq 'true') {
    Write-Warning "Installer smoke left a CI installation after failure. Inspect '$installRoot' and '$smokeRoot'."
  }
}
