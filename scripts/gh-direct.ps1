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

. (Join-Path $PSScriptRoot 'github-env.ps1')
& $ghPath @GitHubArgs
exit $LASTEXITCODE
