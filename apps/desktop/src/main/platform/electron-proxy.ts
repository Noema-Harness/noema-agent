const proxyVariables = {
  http: ['HTTP_PROXY', 'http_proxy'],
  https: ['HTTPS_PROXY', 'https_proxy'],
};

function readProxy(
  environment: Record<string, string | undefined>,
  names: string[],
) {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value) return value;
  }
  return null;
}

function parseProxyEndpoint(value: string) {
  const proxy = new URL(value);
  if (
    !['http:', 'https:'].includes(proxy.protocol) ||
    !proxy.hostname ||
    proxy.username ||
    proxy.password
  )
    throw new TypeError('Unsupported proxy URL');
  return `${proxy.protocol}//${proxy.host}`;
}

export function resolveElectronProxy(environment = process.env) {
  const httpValue = readProxy(environment, proxyVariables.http);
  const httpsValue = readProxy(environment, proxyVariables.https);
  if (!httpValue && !httpsValue) return { config: null, invalid: false };

  try {
    const http = (httpValue ?? httpsValue) as string;
    const https = (httpsValue ?? httpValue) as string;
    return {
      config: {
        mode: 'fixed_servers' as const,
        proxyRules: `http=${parseProxyEndpoint(http)};https=${parseProxyEndpoint(https)}`,
      },
      invalid: false,
    };
  } catch {
    return { config: null, invalid: true };
  }
}
