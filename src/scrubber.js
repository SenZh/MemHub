/**
 * Secret Scrubbing Pipeline
 * 自动识别并脱敏敏感凭据，防止泄漏到全局知识库中
 */

const SECRET_PATTERNS = [
  // OpenAI API Key
  /sk-[a-zA-Z0-9_-]{20,}/g,
  // Anthropic API Key
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  // GitHub Personal Access Token
  /gh[pousr]-[a-zA-Z0-9]{36,}/g,
  // AWS Access Key ID
  /AKIA[0-9A-Z]{16}/g,
  // JWT Token
  /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
  // Private Key Block
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[a-zA-Z0-9\/\+=\s]*-----END [A-Z ]*PRIVATE KEY-----/g,
  // Connection String password: mongodb://user:pass@host or postgres://user:pass@host
  /(:\/\/[^:]+:)([^@\s]+)(@)/g,
  // Generic password / token key-value pairs
  /(["']?(?:password|passwd|secret|api_?key|token|access_?token)["']?\s*[:=]\s*["'])([^"'\s]{6,})(["'])/gi
];

export function scrubSecrets(text) {
  if (typeof text !== 'string') return text;
  let cleaned = text;

  cleaned = cleaned.replace(/(:\/\/[^:]+:)([^@\s]+)(@)/g, '$1***REDACTED***$3');
  cleaned = cleaned.replace(/(["']?(?:password|passwd|secret|api_?key|token|access_?token)["']?\s*[:=]\s*["'])([^"'\s]{6,})(["'])/gi, '$1***REDACTED***$3');

  for (const pattern of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, '***REDACTED***');
  }

  return cleaned;
}
