/**
 * CryptoService — envelope AES-256-GCM para dados sensíveis at-rest (AUTH-02).
 *
 * CONTEXTO
 * ========
 * Tokens OAuth Twitch/Kick por canal vão ser persistidos no Mongo. Um leak
 * do backup (ou acesso não autorizado ao Atlas) NÃO pode resultar em tokens
 * válidos na mão do atacante. Por isso aplicamos envelope encryption:
 *   ciphertext-no-disco = encrypt(plaintext, CRYPTO_MASTER_KEY)
 *
 * ALGORITMO
 * =========
 * AES-256-GCM (authenticated encryption):
 *   - key  : 32 bytes (256 bits)
 *   - IV   : 12 bytes aleatórios (padrão recomendado para GCM; 96 bits)
 *   - tag  : 16 bytes (authenticated tag anti-tampering)
 *
 * FORMATO DO CIPHERTEXT
 * =====================
 *   v1:<base64(iv || authTag || cipherBytes)>
 *
 *   - prefix versionado permite migrar formato sem quebrar ciphertexts antigos
 *   - concatenar os 3 buffers em um único blob base64 simplifica parsing e
 *     deixa o shape em disco como uma string única (fácil index/search)
 *
 * ROTAÇÃO DE CHAVES
 * =================
 * `CRYPTO_PREV_KEYS` é CSV de base64, cada entrada uma chave de 32 bytes.
 *   - `encrypt` SEMPRE usa a chave corrente (`CRYPTO_MASTER_KEY`). Nunca prev.
 *   - `decrypt` tenta a chave corrente primeiro; em falha de authTag, tenta
 *     cada prev key em ordem. Se todas falharem, lança `CryptoError`.
 *   - Entradas inválidas em `CRYPTO_PREV_KEYS` (base64 ruim ou tamanho ≠ 32
 *     bytes) são PULADAS com um warning no stderr. Isso é intencional: uma
 *     rotação mal-copy-pasted não deve impedir a API de subir se a chave
 *     corrente estiver válida.
 *
 * SEGREDOS NOS LOGS
 * =================
 * A redact-list do pino (configurada no `LoggerModule`) já cobre os nomes
 * de campo `token`, `accessToken`, `refreshToken`. Este service reforça:
 * nunca logamos plaintext nem ciphertext — só contagens e flags booleanas.
 */
import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CryptoError } from './crypto-error';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const VERSION_PREFIX = 'v1:';

export interface CryptoServiceOptions {
  /** Chave corrente em base64 de 32 bytes. Obrigatória. */
  masterKeyBase64: string;
  /**
   * Chaves anteriores para tentativas de decrypt. CSV de base64, cada uma
   * 32 bytes. Opcional. Entradas inválidas são ignoradas (com warn).
   */
  prevKeysCsv?: string;
}

@Injectable()
export class CryptoService {
  private readonly currentKey: Buffer;
  private readonly prevKeys: readonly Buffer[];

  constructor(opts: CryptoServiceOptions) {
    const current = parseKey(opts.masterKeyBase64);
    if (!current) {
      // Em tese o Zod já barra no boot, mas defendemos aqui por segurança
      // — CryptoService pode ser instanciado direto em testes de unidade.
      throw new CryptoError('CRYPTO_MASTER_KEY inválida: precisa ser base64 de 32 bytes');
    }
    this.currentKey = current;
    this.prevKeys = parsePrevKeys(opts.prevKeysCsv);
  }

  /**
   * Encripta um plaintext usando a chave corrente.
   * Retorno: `v1:<base64(iv || tag || cipher)>`.
   *
   * Determinismo: NÃO. Cada chamada gera IV aleatório — ciphertexts do
   * mesmo plaintext diferem a cada invocação (propriedade desejada).
   */
  encrypt(plaintext: string): string {
    if (typeof plaintext !== 'string') {
      throw new CryptoError('encrypt: plaintext deve ser string');
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.currentKey, iv);
    const cipherBytes = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, authTag, cipherBytes]);
    return `${VERSION_PREFIX}${payload.toString('base64')}`;
  }

  /**
   * Decripta um ciphertext no formato `v1:<base64>`. Tenta a chave corrente
   * primeiro, depois cada prev key em ordem. Falha final vira `CryptoError`.
   */
  decrypt(ciphertext: string): string {
    if (typeof ciphertext !== 'string') {
      throw new CryptoError('decrypt: ciphertext deve ser string');
    }
    if (!ciphertext.startsWith(VERSION_PREFIX)) {
      throw new CryptoError('decrypt: formato inválido (prefixo v1: ausente)');
    }
    const raw = Buffer.from(ciphertext.slice(VERSION_PREFIX.length), 'base64');
    if (raw.length < IV_BYTES + TAG_BYTES) {
      throw new CryptoError('decrypt: payload muito curto');
    }
    const iv = raw.subarray(0, IV_BYTES);
    const authTag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const cipherBytes = raw.subarray(IV_BYTES + TAG_BYTES);

    const keys = [this.currentKey, ...this.prevKeys];
    let lastError: unknown;
    for (const key of keys) {
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        const plain = Buffer.concat([decipher.update(cipherBytes), decipher.final()]);
        return plain.toString('utf8');
      } catch (err) {
        // Em GCM, authTag inválido faz `final()` lançar. É exatamente o
        // sinal de "chave errada" — tentamos a próxima.
        lastError = err;
      }
    }
    throw new CryptoError('authentication failed', lastError);
  }

  /**
   * Variante null-safe para uso em schemas Mongoose: `null` e `undefined`
   * passam through sem processar. Usado no setter do plugin de encryption.
   */
  encryptField(plaintext: string | null | undefined): string | null {
    if (plaintext === null || plaintext === undefined) {
      return plaintext as null;
    }
    return this.encrypt(plaintext);
  }

  /**
   * Variante null-safe do decrypt. Usado no getter do plugin de encryption.
   *
   * Caso especial: se o valor NÃO tem prefixo `v1:`, assumimos que é
   * plaintext legado (doc escrito antes da migração de encryption) e
   * devolvemos inalterado. Isso é tolerância útil durante o rollout;
   * pode ser removido quando o backfill estiver completo.
   */
  decryptField(ciphertext: string | null | undefined): string | null {
    if (ciphertext === null || ciphertext === undefined) {
      return ciphertext as null;
    }
    if (!ciphertext.startsWith(VERSION_PREFIX)) {
      return ciphertext;
    }
    return this.decrypt(ciphertext);
  }
}

function parseKey(b64: string): Buffer | null {
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length === KEY_BYTES ? buf : null;
  } catch {
    return null;
  }
}

function parsePrevKeys(csv: string | undefined): Buffer[] {
  if (!csv) return [];
  const out: Buffer[] = [];
  const entries = csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const entry of entries) {
    const parsed = parseKey(entry);
    if (parsed) {
      out.push(parsed);
    } else {
      // Escrita direta em stderr em vez de logger para evitar dependência
      // circular (CryptoService é usado pelo PersistenceModule, que é
      // bootstrap). Nunca logamos o conteúdo da entry, só que foi ignorada.
      // eslint-disable-next-line no-console
      console.warn('[CryptoService] CRYPTO_PREV_KEYS continha entrada inválida (ignorada)');
    }
  }
  return out;
}
