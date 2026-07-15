import { sanitizeLogPayload } from '../access-log-payload';

describe('sanitizeLogPayload', () => {
  it('retorna undefined para payloads vazios', () => {
    expect(sanitizeLogPayload(undefined)).toBeUndefined();
    expect(sanitizeLogPayload(null)).toBeUndefined();
    expect(sanitizeLogPayload({})).toBeUndefined();
    expect(sanitizeLogPayload('')).toBeUndefined();
  });

  it('preserva payloads simples', () => {
    expect(sanitizeLogPayload({ name: 'canal', active: true, n: 3 })).toEqual({
      name: 'canal',
      active: true,
      n: 3,
    });
  });

  it('redige chaves sensíveis em qualquer profundidade e variação de caixa', () => {
    const out = sanitizeLogPayload({
      email: 'a@b.com',
      password: 'hunter2',
      nested: { access_token: 'abc', Refresh_Token: 'def', ok: 1 },
      code: '123456',
      state: 'xyz',
    }) as Record<string, unknown>;

    expect(out.email).toBe('a@b.com');
    expect(out.password).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).access_token).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).Refresh_Token).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
    expect(out.code).toBe('[REDACTED]');
    expect(out.state).toBe('[REDACTED]');
  });

  it('trunca strings longas, arrays grandes e profundidade excessiva', () => {
    const out = sanitizeLogPayload({
      long: 'x'.repeat(2000),
      list: Array.from({ length: 50 }, (_, i) => i),
      deep: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } },
    }) as Record<string, unknown>;

    expect((out.long as string).length).toBeLessThan(600);
    expect((out.list as unknown[]).length).toBe(21); // 20 itens + marcador
    expect(JSON.stringify(out.deep)).toContain('[…]');
  });

  it('colapsa payloads acima do teto serializado em um preview', () => {
    const big = { rows: Array.from({ length: 20 }, () => ({ text: 'y'.repeat(500) })) };
    const out = sanitizeLogPayload(big) as Record<string, unknown>;
    expect(out.__truncated).toBe(true);
    expect(typeof out.preview).toBe('string');
  });
});
