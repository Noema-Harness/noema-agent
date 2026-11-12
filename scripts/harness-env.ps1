# Prepends the DSH-side tool locations to the current process PATH.
# Dot-source it at the start of a shell session that needs the portable tools:
#   . .\scripts\harness-env.ps1
# It only edits $env:PATH for the current process; it never writes machine state.
$toolRoot = Join-Path $env:LOCALAPPDATA 'NoemaTools'
$candidates = @(
  (Join-Path $toolRoot 'git\cmd'),
  (Join-Path $toolRoot 'dsh'),
  (Join-Path $toolRoot 'node-v24.21.0'),
  (Join-Path $env:LOCALAPPDATA 'Programs\GitHubCLI\bin'),
  (Join-Path $env:LOCALAPPDATA 'Programs\openspec')
)
foreach ($candidate in $candidates) {
  if (-not (Test-Path -LiteralPath $candidate)) { continue }
  if (($env:PATH -split ';') -contains $candidate) { continue }
  $env:PATH = "$candidate;$env:PATH"
}
if (-not $env:GIT_PAGER) { $env:GIT_PAGER = 'cat' }
