import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { api, ApiError, getToken, setToken, clearToken } from '@/lib/api-client';

describe('ApiClient — token storage', () => {
  beforeEach(() => {
    clearToken();
  });

  it('setToken + getToken round-trip', () => {
    setToken('xyz');
    expect(getToken()).toBe('xyz');
  });

  it('clearToken zera', () => {
    setToken('xyz');
    clearToken();
    expect(getToken()).toBeNull();
  });
});

describe('ApiClient — fetch behavior', () => {
  let originalFetch: typeof globalThis.fetch;
  const calls: Array<[string | URL | Request, RequestInit | undefined]> = [];
  let nextResponses: Response[] = [];

  beforeEach(() => {
    clearToken();
    calls.length = 0;
    nextResponses = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      calls.push([input, init]);
      const next = nextResponses.shift();
      return Promise.resolve(next ?? new Response('{}', { status: 200 }));
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function queue(res: Response) { nextResponses.push(res); }

  it('inclui Authorization quando token presente', async () => {
    setToken('abc');
    queue(new Response('{}', { status: 200 }));
    await api.get('/api/v2/anything');
    const headers = calls[0]![1]!.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer abc');
  });

  it('não inclui Authorization quando anonymous=true', async () => {
    setToken('abc');
    queue(new Response('{"token":"t"}', { status: 200 }));
    await api.post('/api/users/login', { email: 'x', password: 'y' }, { anonymous: true });
    const headers = calls[0]![1]!.headers as Headers;
    expect(headers.get('Authorization')).toBeNull();
  });

  it('lança ApiError em 4xx com mensagem do payload', async () => {
    queue(new Response(JSON.stringify({ message: 'Token inválido' }), { status: 401 }));
    await expect(
      api.get('/api/v2/protected', { noAuthRedirect: true }),
    ).rejects.toMatchObject({ status: 401, message: 'Token inválido' });
  });

  it('decoda JSON corretamente', async () => {
    queue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const r = await api.get<{ ok: boolean }>('/api/v2/x');
    expect(r).toEqual({ ok: true });
  });

  it('ApiError carrega payload original', async () => {
    queue(new Response(JSON.stringify({ message: 'oops', detail: 'x' }), { status: 500 }));
    try {
      await api.get('/api/v2/x', { noAuthRedirect: true });
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).payload).toMatchObject({ detail: 'x' });
    }
  });
});
