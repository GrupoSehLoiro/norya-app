/**
 * Testes unitários do CryptoService.
 *
 * Casos cobertos:
 *  1. encrypt produz ciphertext diferente a cada chamada (IV aleatório).
 *  2. encrypt → decrypt roundtrip preserva o plaintext (UTF-8 incluído).
 *  3. Tamper no authTag → CryptoError.
 *  4. Tamper no ciphertext → CryptoError.
 *  5. Construção sem chave válida → CryptoError.
 *  6. Rotação: ciphertexts da prev key ainda decriptam; encrypt nova usa
 *     sempre a corrente.
 *  7. encryptField/decryptField: null/undefined passam through.
 *  8. decryptField: valor sem prefixo `v1:` → passa through (tolerância a
 *     docs legados não-migrados).
 *  9. CRYPTO_PREV_KEYS com entrada inválida: ignora sem falhar.
 */
import { randomBytes } from 'node:crypto';
import { CryptoService } from '../crypto.service';
import { CryptoError } from '../crypto-error';

function freshKeyBase64(): string {
  return randomBytes(32).toString('base64');
}

describe('CryptoService', () => {
  const KEY_A = freshKeyBase64();
  const KEY_B = freshKeyBase64();

  describe('construção', () => {
    it('rejeita master key de tamanho incorreto', () => {
      expect(
        () =>
          new CryptoService({
            masterKeyBase64: Buffer.from('short').toString('base64'),
          }),
      ).toThrow(CryptoError);
    });

    it('rejeita master key base64 inválida (na prática cai no tamanho)', () => {
      expect(
        () =>
          new CryptoService({
            masterKeyBase64: '!!!nao-eh-base64!!!',
          }),
      ).toThrow(CryptoError);
    });
  });

  describe('encrypt', () => {
    const svc = new CryptoService({ masterKeyBase64: KEY_A });

    it('retorna string com prefixo v1:', () => {
      const out = svc.encrypt('hello');
      expect(out.startsWith('v1:')).toBe(true);
    });

    it('gera ciphertexts diferentes para o mesmo plaintext (IV aleatório)', () => {
      const a = svc.encrypt('mesmo-plaintext');
      const b = svc.encrypt('mesmo-plaintext');
      expect(a).not.toBe(b);
    });
  });

  describe('decrypt (roundtrip)', () => {
    const svc = new CryptoService({ masterKeyBase64: KEY_A });

    it('preserva plaintext ASCII', () => {
      const plain = 'access-token-abc123';
      expect(svc.decrypt(svc.encrypt(plain))).toBe(plain);
    });

    it('preserva UTF-8 multibyte', () => {
      const plain = 'tóken com açentos — 日本語 🔐';
      expect(svc.decrypt(svc.encrypt(plain))).toBe(plain);
    });

    it('preserva string vazia', () => {
      expect(svc.decrypt(svc.encrypt(''))).toBe('');
    });
  });

  describe('tamper detection', () => {
    const svc = new CryptoService({ masterKeyBase64: KEY_A });

    it('falha em authTag adulterado', () => {
      const ct = svc.encrypt('payload');
      const raw = Buffer.from(ct.slice(3), 'base64');
      // Flip 1 bit dentro do authTag (bytes 12..27)
      raw[15] = raw[15]! ^ 0x01;
      const tampered = 'v1:' + raw.toString('base64');
      expect(() => svc.decrypt(tampered)).toThrow(CryptoError);
    });

    it('falha em cipher bytes adulterados', () => {
      const ct = svc.encrypt('payload');
      const raw = Buffer.from(ct.slice(3), 'base64');
      // Flip 1 bit nos cipher bytes (após iv+tag)
      raw[28] = raw[28]! ^ 0x01;
      const tampered = 'v1:' + raw.toString('base64');
      expect(() => svc.decrypt(tampered)).toThrow(CryptoError);
    });

    it('falha em payload sem prefixo v1:', () => {
      expect(() => svc.decrypt('abc123')).toThrow(CryptoError);
    });

    it('falha em payload truncado', () => {
      expect(() => svc.decrypt('v1:' + Buffer.from('x').toString('base64'))).toThrow(CryptoError);
    });
  });

  describe('rotação de chaves', () => {
    it('decripta ciphertexts antigos com prev key', () => {
      // Cenário: antes tinhamos KEY_B como corrente. Agora rotacionamos
      // para KEY_A e movemos KEY_B para prev keys.
      const oldSvc = new CryptoService({ masterKeyBase64: KEY_B });
      const oldCipher = oldSvc.encrypt('token-antigo');

      const newSvc = new CryptoService({
        masterKeyBase64: KEY_A,
        prevKeysCsv: KEY_B,
      });

      expect(newSvc.decrypt(oldCipher)).toBe('token-antigo');
    });

    it('encrypt novo sempre usa a chave corrente (não a prev)', () => {
      // Se encryptássemos com a prev, um service só-com-KEY_A não
      // conseguiria decriptar.
      const rotatingSvc = new CryptoService({
        masterKeyBase64: KEY_A,
        prevKeysCsv: KEY_B,
      });
      const newCipher = rotatingSvc.encrypt('token-novo');

      const onlyCurrentSvc = new CryptoService({ masterKeyBase64: KEY_A });
      expect(onlyCurrentSvc.decrypt(newCipher)).toBe('token-novo');
    });

    it('falha quando nenhuma chave (corrente + prev) consegue decriptar', () => {
      const svcX = new CryptoService({ masterKeyBase64: KEY_A });
      const cipherX = svcX.encrypt('segredo');

      const svcY = new CryptoService({
        masterKeyBase64: KEY_B,
        prevKeysCsv: freshKeyBase64(),
      });

      expect(() => svcY.decrypt(cipherX)).toThrow(CryptoError);
    });

    it('ignora entradas inválidas em CRYPTO_PREV_KEYS sem falhar a construção', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const svc = new CryptoService({
        masterKeyBase64: KEY_A,
        prevKeysCsv: `invalid-stuff,${KEY_B},also-bad`,
      });
      // Confirma que a boa (KEY_B) foi aceita: ciphertext de KEY_B decripta
      const oldCipher = new CryptoService({ masterKeyBase64: KEY_B }).encrypt('x');
      expect(svc.decrypt(oldCipher)).toBe('x');
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('encryptField / decryptField (null-safe)', () => {
    const svc = new CryptoService({ masterKeyBase64: KEY_A });

    it('encryptField(null) => null', () => {
      expect(svc.encryptField(null)).toBeNull();
    });

    it('encryptField(undefined) => undefined', () => {
      expect(svc.encryptField(undefined)).toBeUndefined();
    });

    it('decryptField(null) => null', () => {
      expect(svc.decryptField(null)).toBeNull();
    });

    it('decryptField(undefined) => undefined', () => {
      expect(svc.decryptField(undefined)).toBeUndefined();
    });

    it('roundtrip via encryptField/decryptField', () => {
      const ct = svc.encryptField('hello');
      expect(ct).not.toBeNull();
      expect(svc.decryptField(ct!)).toBe('hello');
    });

    it('decryptField passa through valores sem prefixo v1: (legado)', () => {
      expect(svc.decryptField('legacy-plaintext')).toBe('legacy-plaintext');
    });
  });
});
