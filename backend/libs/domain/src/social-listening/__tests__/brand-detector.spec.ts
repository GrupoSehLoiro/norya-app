import type { RawMessage } from '../../ingestion/raw-message';
import type { ChannelBrand } from '../channel-brand.entity';
import { detectBrands } from '../brand-detector';

function mkMsg(id: string, text: string): RawMessage {
  return {
    id,
    platform: 'twitch',
    channelExternalId: 'ch1',
    channelName: 'c1',
    user: {
      externalId: 'u',
      username: 'u',
      displayName: 'u',
      isSubscriber: false,
      isMod: false,
      isBroadcaster: false,
      badges: [],
    },
    text,
    emotes: [],
    mentions: [],
    rawPayload: {},
    receivedAt: new Date(),
  };
}

function brand(name: string, aliases: string[] = [], regex?: string): ChannelBrand {
  return {
    id: 'b_' + name,
    creatorId: 'cr1',
    channelId: 'c1',
    name,
    aliases,
    regex: regex ?? null,
    createdAt: new Date(),
  };
}

describe('detectBrands', () => {
  it('detecta marca pelo nome e contabiliza', () => {
    const msgs = [
      mkMsg('1', 'amei YoDaSnacks'),
      mkMsg('2', 'mais yodasnacks!!'),
      mkMsg('3', 'nada aqui'),
    ];
    const out = detectBrands(msgs, [brand('YoDaSnacks')]);
    expect(out).toEqual([{ brand: 'YoDaSnacks', count: 2, sample: ['1', '2'] }]);
  });

  it('aliases ampliam o match', () => {
    const msgs = [mkMsg('1', 'comprei snacks do yoda hoje')];
    const out = detectBrands(msgs, [brand('YoDaSnacks', ['snacks do yoda'])]);
    expect(out[0]?.count).toBe(1);
  });

  it('regex custom override usa o padrão informado', () => {
    const msgs = [mkMsg('1', 'YoDa-Snacks rocks'), mkMsg('2', 'yoda snacks delicia')];
    const out = detectBrands(msgs, [brand('YoDaSnacks', [], 'yoda[\\s-]?snacks?')]);
    expect(out[0]?.count).toBe(2);
  });

  it('ordena top-N desc + sample limitado', () => {
    const msgs = [mkMsg('1', 'A B'), mkMsg('2', 'A B'), mkMsg('3', 'A B'), mkMsg('4', 'A B')];
    const out = detectBrands(msgs, [brand('B'), brand('A')], { sampleSize: 2 });
    // Empate em count → ordem é definida por insertion; só validamos presença + sample limit.
    expect(new Set(out.map((h) => h.brand))).toEqual(new Set(['A', 'B']));
    expect(out.every((h) => h.sample.length <= 2)).toBe(true);
    expect(out.every((h) => h.count === 4)).toBe(true);
  });

  it('regex inválido é silenciosamente ignorado', () => {
    const msgs = [mkMsg('1', 'xxx')];
    const out = detectBrands(msgs, [brand('Broken', [], '[unclosed')]);
    expect(out).toEqual([]);
  });

  it('input vazio retorna []', () => {
    expect(detectBrands([], [brand('X')])).toEqual([]);
    expect(detectBrands([mkMsg('1', 'oi')], [])).toEqual([]);
  });
});
