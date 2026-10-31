const CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|$)/giu,
  /\bsk-(?:ant-)?[a-z0-9_-]{16,}\b/giu,
  /\bAIza[a-z0-9_-]{30,}\b/giu,
  /\bgh[pousr]_[a-z0-9_]{20,}\b/giu,
  /\bgithub_pat_[a-z0-9_]{20,}\b/giu,
  /\bxox[baprs]-[a-z0-9-]{16,}\b/giu,
  /\bfla_[a-z0-9]{16,}\b/giu,
  /\bBearer\s+[a-z0-9._~+/-]{16,}=*/giu,
  /\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/giu,
  /"(?:api[\s_-]?key|access[\s_-]?token|secret|password|passwd)"\s*:\s*"[^"]{6,}"/giu,
  /((?:api[\s_-]?key|access[\s_-]?token|secret|password|passwd|密钥|密码|口令)\s*(?::|：|=|\bis\b|为|是)\s*["'`]?)[^\s,，。;；"'`]{6,}/giu,
];

export function redactSensitiveText(text) {
  let redacted = false;
  const sanitized = CREDENTIAL_PATTERNS.reduce(
    (content, pattern) =>
      content.replace(pattern, (...args) => {
        if (args[0].includes('[已隐藏疑似凭据]')) return args[0];
        redacted = true;
        if (typeof args[1] === 'string') {
          return `${args[1]}[已隐藏疑似凭据]`;
        }
        return '[已隐藏疑似凭据]';
      }),
    String(text ?? ''),
  );
  return { snippet: sanitized, redacted };
}
