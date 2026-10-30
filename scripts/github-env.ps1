# Shared transport environment for GitHub CLI and Git. This bypasses the local
# proxy for GitHub hosts; it does not attribute all transport failures to it.
$taskGitHubBypass = @(
  $env:NO_PROXY,
  [Environment]::GetEnvironmentVariable('NO_PROXY', 'User'),
  'github.com', '.github.com', 'api.github.com',
  'githubusercontent.com', '.githubusercontent.com'
) |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
  ForEach-Object { $_ -split ',' } |
  ForEach-Object { $_.Trim() } |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
  Select-Object -Unique
$env:NO_PROXY = $taskGitHubBypass -join ','
