param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$GitArgs
)

$gitCommand = Get-Command git -CommandType Application -ErrorAction SilentlyContinue
if (-not $gitCommand) {
  throw 'Git is not installed or is not on PATH.'
}

# Keep the process and user bypass lists together; the Codex parent process can
# retain a stale NO_PROXY value after the user environment has been updated.
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
& $gitCommand.Source @GitArgs
exit $LASTEXITCODE
