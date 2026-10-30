param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$GitHubArgs
)

$ghPath = Join-Path $env:LOCALAPPDATA 'Programs\GitHubCLI\bin\gh.exe'
if (-not (Test-Path -LiteralPath $ghPath)) {
  $ghCommand = Get-Command gh -CommandType Application -ErrorAction SilentlyContinue
  if ($ghCommand) {
    $ghPath = $ghCommand.Source
  } else {
    throw 'GitHub CLI (gh) is not installed.'
  }
}

# Long-running Codex processes can retain an older process-level NO_PROXY even
# after the user environment has been corrected. Preserve both lists and make
# GitHub API/repository hosts bypass the local proxy that has returned EOFs.
$noProxyEntries = @(
  $env:NO_PROXY,
  [Environment]::GetEnvironmentVariable('NO_PROXY', 'User'),
  'github.com',
  '.github.com',
  'api.github.com',
  'githubusercontent.com',
  '.githubusercontent.com'
) |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
  ForEach-Object { $_ -split ',' } |
  ForEach-Object { $_.Trim() } |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
  Select-Object -Unique

$env:NO_PROXY = $noProxyEntries -join ','
& $ghPath @GitHubArgs
exit $LASTEXITCODE
