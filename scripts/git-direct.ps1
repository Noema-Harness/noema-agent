param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$GitArgs
)

$gitCommand = Get-Command git -CommandType Application -ErrorAction SilentlyContinue
if (-not $gitCommand) {
  throw 'Git is not installed or is not on PATH.'
}

. (Join-Path $PSScriptRoot 'github-env.ps1')
if ($env:CODEX_GITHUB_PROXY) {
  & $gitCommand.Source -c "http.proxy=$env:CODEX_GITHUB_PROXY" -c 'http.sslBackend=openssl' -c 'http.version=HTTP/2' @GitArgs
} else {
  & $gitCommand.Source @GitArgs
}
exit $LASTEXITCODE
