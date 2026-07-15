/**
 * Sanitização de payloads para o access log.
 *
 * O /logs mostra o que o usuário enviou e o que o servidor respondeu — mas
 * NUNCA segredos: chaves sensíveis (senha, tokens, OAuth code/state, etc.)
 * são substituídas por [REDACTED] em qualquer profundidade, e o payload é
 * truncado (profundidade, itens de array, strings e tamanho total) para um
 * doc de log não virar um dump de banco.
 */

const REDACTED = '[REDACTED]';

/** Comparação por chave normalizada (lowercase, sem _ e -). */
const SENSITIVE_KEYS = new Set([
  'password',
  'senha',
  'pass',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authorization',
  'cookie',
  'setcookie',
  'credential',
  'credentials',
  'apikey',
  'masterkey',
  'privatekey',
  'jwt',
  'code',
  'state',
  'otp',
  'hmac',
  'signature',
]);

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 512;
/** Teto do payload serializado; acima disso guarda só um preview. */
const MAX_SERIALIZED_BYTES = 8 * 1024;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''));
}

function clip(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}… (+${value.length - MAX_STRING_LENGTH} chars)`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((v) => clip(v, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`… (+${value.length - MAX_ARRAY_ITEMS} itens)`);
    return items;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? REDACTED : clip(v, depth + 1);
    }
    return out;
  }
  // function/symbol/bigint — sem representação útil num log JSON
  return String(value);
}

/**
 * Redige chaves sensíveis e trunca o payload. Retorna `undefined` para
 * payloads vazios (objeto sem chaves, string vazia) — o campo nem é gravado.
 */
export function sanitizeLogPayload(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.length === 0) return undefined;
  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 0
  ) {
    return undefined;
  }

  const clipped = clip(value, 0);

  let serialized: string;
  try {
    serialized = JSON.stringify(clipped) ?? '';
  } catch {
    return '[unserializable]';
  }
  if (serialized.length > MAX_SERIALIZED_BYTES) {
    return {
      __truncated: true,
      sizeBytes: serialized.length,
      preview: `${serialized.slice(0, 1024)}…`,
    };
  }
  return clipped;
}
