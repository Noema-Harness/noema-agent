# Pick a reachable configured proxy before bypassing it for GitHub. On this
# machine the VPN resolves github.com to a fake IP, where direct TLS fails.
$taskProxyCandidates = @(
  $env:HTTPS_PROXY,
  $env:https_proxy,
  [Environment]::GetEnvironmentVariable('HTTPS_PROXY', 'User'),
  [Environment]::GetEnvironmentVariable('https_proxy', 'User'),
  $env:HTTP_PROXY,
  $env:http_proxy,
  [Environment]::GetEnvironmentVariable('HTTP_PROXY', 'User'),
  [Environment]::GetEnvironmentVariable('http_proxy', 'User')
) |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
  Select-Object -Unique

$taskProxy = $null
$taskProxyUri = $null
$taskPort = $null
$taskProxyAvailable = $false
foreach ($taskCandidate in $taskProxyCandidates) {
  try {
    $taskCandidateUri = [uri]$taskCandidate
    if (
      -not $taskCandidateUri.IsAbsoluteUri -or
      $taskCandidateUri.Scheme -notin @('http', 'https') -or
      -not $taskCandidateUri.Host
    ) {
      continue
    }

    $taskCandidatePort = if ($taskCandidateUri.Port -gt 0) {
      $taskCandidateUri.Port
    } elseif ($taskCandidateUri.Scheme -eq 'https') {
      443
    } else {
      80
    }
    $taskClient = [System.Net.Sockets.TcpClient]::new()
    try {
      $taskConnect = $taskClient.ConnectAsync(
        $taskCandidateUri.DnsSafeHost,
        $taskCandidatePort
      )
      $taskCandidateAvailable = $taskConnect.Wait(1200) -and $taskClient.Connected
    } finally {
      $taskClient.Dispose()
    }
    if ($taskCandidateAvailable) {
      $taskProxy = $taskCandidate
      $taskProxyUri = $taskCandidateUri
      $taskPort = $taskCandidatePort
      $taskProxyAvailable = $true
      break
    }
  } catch {
    continue
  }
}

$taskNoProxy = @(
  $env:NO_PROXY,
  [Environment]::GetEnvironmentVariable('NO_PROXY', 'User'),
  $env:no_proxy,
  [Environment]::GetEnvironmentVariable('no_proxy', 'User')
) |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
  ForEach-Object { $_ -split ',' } |
  ForEach-Object { $_.Trim() } |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

$taskGitHubHosts = @(
  'github.com', '.github.com', 'api.github.com',
  'githubusercontent.com', '.githubusercontent.com'
)

if ($taskProxyAvailable) {
  $taskNoProxy = $taskNoProxy | Where-Object {
    $_ -notin $taskGitHubHosts -and $_ -notmatch '^\*\.github(?:usercontent)?\.com$'
  }
  $env:HTTPS_PROXY = $taskProxy
  $env:HTTP_PROXY = $taskProxy
  $env:CODEX_GITHUB_PROXY = $taskProxy
  Write-Verbose "GitHub transport: configured proxy at $($taskProxyUri.Host):$taskPort"
} else {
  $taskNoProxy += $taskGitHubHosts
  Remove-Item Env:CODEX_GITHUB_PROXY -ErrorAction SilentlyContinue
  Write-Verbose 'GitHub transport: no configured proxy is reachable; trying direct access'
}

$env:NO_PROXY = ($taskNoProxy | Select-Object -Unique) -join ','
$env:no_proxy = $env:NO_PROXY
