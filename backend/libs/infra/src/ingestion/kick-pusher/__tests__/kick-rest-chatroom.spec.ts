/**
 * Cadeia de resolução do chatroomId (KCK):
 *   memória → override estático → store persistente → direto → proxies
 *   (ordem configurada, Jina SEMPRE por último).
 */
import {
  JINA_PROXY_TEMPLATE,
  KickRestClient,
  makeRedisChatroomIdStore,
  parseStaticChatroomIds,
  resolveProxyChain,
  type ChatroomIdStore,
} from '../kick-rest.client';

jest.mock('axios', () => {
  const get = jest.fn();
  const post = jest.fn();
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => ({ get: jest.fn() })),
      get,
      post,
      isAxiosError: jest.fn(() => false),
    },
  };
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- (import após jest.mock é intencional)
import axios from 'axios';

const axiosGet = (axios as unknown as { get: jest.Mock }).get;

/** Chama o método privado da cadeia direto — é a unidade sob teste. */
function resolve(client: KickRestClient, slug: string): Promise<number | null> {
  return (
    client as unknown as { _resolveChatroomId(s: string): Promise<number | null> }
  )._resolveChatroomId(slug);
}

function makeStore(initial: Record<string, number> = {}): ChatroomIdStore & {
  saved: Record<string, number>;
} {
  const saved: Record<string, number> = { ...initial };
  return {
    saved,
    get: jest.fn(async (slug: string) => saved[slug] ?? null),
    set: jest.fn(async (slug: string, id: number) => {
      saved[slug] = id;
    }),
  };
}

beforeEach(() => axiosGet.mockReset());

describe('resolveProxyChain', () => {
  it('sem config → só o Jina', () => {
    expect(resolveProxyChain(undefined)).toEqual([JINA_PROXY_TEMPLATE]);
    expect(resolveProxyChain('')).toEqual([JINA_PROXY_TEMPLATE]);
  });

  it('CSV preserva a ordem e apensa o Jina por último', () => {
    expect(resolveProxyChain('https://own.proxy/{url}, https://second/{url}')).toEqual([
      'https://own.proxy/{url}',
      'https://second/{url}',
      JINA_PROXY_TEMPLATE,
    ]);
  });

  it('não duplica o Jina se o operador já o listou', () => {
    const chain = resolveProxyChain(`${JINA_PROXY_TEMPLATE},https://own/{url}`);
    expect(chain.filter((p) => p === JINA_PROXY_TEMPLATE)).toHaveLength(1);
  });
});

describe('parseStaticChatroomIds', () => {
  it('parseia pares válidos, ignora lixo, normaliza slug', () => {
    expect(parseStaticChatroomIds('XQC:668, streamer:123, semid:, :5, ruim:abc')).toEqual({
      xqc: 668,
      streamer: 123,
    });
    expect(parseStaticChatroomIds(undefined)).toEqual({});
  });
});

describe('KickRestClient._resolveChatroomId — cadeia', () => {
  it('override estático vence tudo (nenhuma chamada HTTP)', async () => {
    const client = new KickRestClient({ staticChatroomIds: { xqc: 668 } });
    await expect(resolve(client, 'XQC')).resolves.toBe(668);
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it('store persistente responde antes de qualquer HTTP', async () => {
    const store = makeStore({ streamer: 42 });
    const client = new KickRestClient({ store });
    await expect(resolve(client, 'streamer')).resolves.toBe(42);
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it('endpoint direto resolve e persiste no store', async () => {
    const store = makeStore();
    const client = new KickRestClient({ store });
    axiosGet.mockResolvedValueOnce({ data: { id: 777 } });
    await expect(resolve(client, 'canal')).resolves.toBe(777);
    expect(store.set).toHaveBeenCalledWith('canal', 777);
  });

  it('direto bloqueado → proxies na ordem, Jina por último, resultado persistido', async () => {
    const store = makeStore();
    const client = new KickRestClient({
      chatroomProxy: 'https://own.proxy/{url}',
      store,
    });
    const urls: string[] = [];
    axiosGet.mockImplementation((url: string) => {
      urls.push(url);
      if (url.startsWith('https://r.jina.ai/')) {
        return Promise.resolve({ data: 'Markdown wrapper {"id": 555, "chatable_id": 1}' });
      }
      return Promise.reject(new Error('blocked'));
    });

    await expect(resolve(client, 'canal')).resolves.toBe(555);
    // Ordem: direto → proxy próprio → Jina (último).
    expect(urls[0]).toContain('kick.com/api/v2/channels/canal/chatroom');
    expect(urls[1]).toContain('own.proxy');
    expect(urls[2]).toContain('r.jina.ai');
    expect(store.set).toHaveBeenCalledWith('canal', 555);
  });

  it('cadeia inteira falha → null (sem estourar)', async () => {
    const client = new KickRestClient({ chatroomProxy: 'https://own.proxy/{url}' });
    axiosGet.mockRejectedValue(new Error('blocked'));
    await expect(resolve(client, 'canal')).resolves.toBeNull();
    // direto + 2 proxies (próprio e Jina)
    expect(axiosGet).toHaveBeenCalledTimes(3);
  });

  it('memória evita re-resolver (e o store só é lido uma vez)', async () => {
    const store = makeStore({ canal: 9 });
    const client = new KickRestClient({ store });
    await resolve(client, 'canal');
    await resolve(client, 'canal');
    expect(store.get).toHaveBeenCalledTimes(1);
  });
});

describe('makeRedisChatroomIdStore', () => {
  it('lê/grava com prefixo, ignora valor não-numérico', async () => {
    const kv = new Map<string, string>();
    const store = makeRedisChatroomIdStore({
      get: async (k) => kv.get(k) ?? null,
      set: async (k, v) => void kv.set(k, v),
    });
    await store.set('XQC', 668);
    expect(kv.get('kick:chatroomid:xqc')).toBe('668');
    await expect(store.get('xqc')).resolves.toBe(668);
    kv.set('kick:chatroomid:bad', 'not-a-number');
    await expect(store.get('bad')).resolves.toBeNull();
  });
});
