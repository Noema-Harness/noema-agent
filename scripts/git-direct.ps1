param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$GitArgs
)

$gitCommand = Get-Command git -CommandType Application -ErrorAction SilentlyContinue
if (-not $gitCommand) {
  throw 'Git is not installed or is not on PATH.'
}

. (Join-Path $PSScriptRoot 'github-env.ps1')
& $gitCommand.Source @GitArgs
exit $LASTEXITCODE
