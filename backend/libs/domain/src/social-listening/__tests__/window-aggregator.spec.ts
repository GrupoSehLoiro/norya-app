import type { RawMessage } from '../../ingestion/raw-message';
import { TwitchEmoteDictionary } from '../../ingestion/emote-dictionary';
import { aggregate } from '../window-aggregator.service';

function mkMsg(
  id: string,
  username: string,
  text: string,
  opts?: Partial<{ isSubscriber: boolean; isMod: boolean }>,
): RawMessage {
  return {
    id,
    platform: 'twitch',
    channelExternalId: 'ch1',
    channelName: 'channel1',
    user: {
      externalId: 'u_' + username,
      username,
      displayName: username,
      isSubscriber: opts?.isSubscriber ?? false,
      isMod: opts?.isMod ?? false,
      isBroadcaster: false,
      badges: [],
    },
    text,
    emotes: [],
    mentions: [],
    rawPayload: {},
    receivedAt: new Date('2026-05-19T12:00:00Z'),
  };
}

describe('WindowAggregator', () => {
  const t0 = new Date('2026-05-19T12:00:00Z');
  const t1 = new Date('2026-05-19T12:00:15Z');

  it('calcula totalMsgs / uniqueUsers / isSubscriberRatio', () => {
    const msgs = [
      mkMsg('m1', 'alice', 'pog cara'),
      mkMsg('m2', 'bob', 'lag triste', { isSubscriber: true }),
      mkMsg('m3', 'alice', 'top demais'),
    ];
    const agg = aggregate({
      channelId: 'c1',
      sessionId: 's1',
      windowStart: t0,
      windowEnd: t1,
      unique: msgs,
      groups: new Map(),
    });
    expect(agg.totalMsgs).toBe(3);
    expect(agg.uniqueUsers).toBe(2);
    expect(agg.isSubscriberRatio).toBeCloseTo(1 / 3, 3);
  });

  it('totalMsgsWeighted soma groups quando presente', () => {
    const msgs = [mkMsg('m1', 'alice', 'copypasta!')];
    const agg = aggregate({
      channelId: 'c1',
      sessionId: null,
      windowStart: t0,
      windowEnd: t1,
      unique: msgs,
      groups: new Map([['hash1', 50]]),
    });
    expect(agg.totalMsgs).toBe(1);
    expect(agg.totalMsgsWeighted).toBe(50);
  });

  it('tokenFreq + topTokens calculados (stopwords removidas)', () => {
    const msgs = [mkMsg('m1', 'a', 'pog pog cara'), mkMsg('m2', 'b', 'pog top')];
    const agg = aggregate({
      channelId: 'c1',
      sessionId: null,
      windowStart: t0,
      windowEnd: t1,
      unique: msgs,
      groups: new Map(),
    });
    expect(agg.tokenFreq.get('pog')).toBe(3);
    expect(agg.topTokens[0]).toBe('pog');
  });

  it('perUser preenche pos/neg/neu por sentimentHints', () => {
    const msgs = [
      mkMsg('m1', 'alice', 'top'),
      mkMsg('m2', 'alice', 'rage'),
      mkMsg('m3', 'bob', 'meh'),
    ];
    const hints = new Map<string, 'positive' | 'negative' | 'neutral'>([
      ['m1', 'positive'],
      ['m2', 'negative'],
      ['m3', 'neutral'],
    ]);
    const agg = aggregate({
      channelId: 'c1',
      sessionId: null,
      windowStart: t0,
      windowEnd: t1,
      unique: msgs,
      groups: new Map(),
      sentimentHints: hints,
    });
    const alice = agg.perUser.find((u) => u.username === 'alice')!;
    expect(alice.posCount).toBe(1);
    expect(alice.negCount).toBe(1);
    expect(alice.msgCount).toBe(2);
    const bob = agg.perUser.find((u) => u.username === 'bob')!;
    expect(bob.neuCount).toBe(1);
  });

  it('janela vazia retorna ratios zeros e arrays vazios', () => {
    const agg = aggregate({
      channelId: 'c1',
      sessionId: null,
      windowStart: t0,
      windowEnd: t1,
      unique: [],
      groups: new Map(),
    });
    expect(agg.totalMsgs).toBe(0);
    expect(agg.totalMsgsWeighted).toBe(0);
    expect(agg.isSubscriberRatio).toBe(0);
    expect(agg.topTokens).toEqual([]);
    expect(agg.perUser).toEqual([]);
  });

  it('msgWeights pondera tokenFreq e sentimentWeighted, mas NÃO perUser', () => {
    // Burst: "pog demais" apareceu 20x (dedup deixou 1 única com peso 20);
    // "ok" apareceu 1x. Média ponderada deve dar 20 pos vs 1 neu.
    const msgs = [mkMsg('m1', 'alice', 'pog demais'), mkMsg('m2', 'bob', 'ok entendi')];
    const agg = aggregate({
      channelId: 'c1',
      sessionId: null,
      windowStart: t0,
      windowEnd: t1,
      unique: msgs,
      groups: new Map([
        ['h1', 20],
        ['h2', 1],
      ]),
      msgWeights: new Map([['m1', 20]]),
      sentimentHints: new Map([
        ['m1', 'positive' as const],
        ['m2', 'neutral' as const],
      ]),
    });
    expect(agg.tokenFreq.get('pog')).toBe(20);
    expect(agg.sentimentWeighted).toEqual({ pos: 20, neu: 1, neg: 0 });
    // Atribuição por autor continua não ponderada (o grupo copypasta pode
    // conter msgs de outros usuários).
    const alice = agg.perUser.find((u) => u.username === 'alice')!;
    expect(alice.msgCount).toBe(1);
    expect(alice.posCount).toBe(1);
  });

  it('sem msgWeights, sentimentWeighted iguala o tally simples', () => {
    const msgs = [mkMsg('m1', 'a', 'pog demais'), mkMsg('m2', 'b', 'lag ruim')];
    const agg = aggregate({
      channelId: 'c1',
      sessionId: null,
      windowStart: t0,
      windowEnd: t1,
      unique: msgs,
      groups: new Map(),
      sentimentHints: new Map([
        ['m1', 'positive' as const],
        ['m2', 'negative' as const],
      ]),
    });
    expect(agg.sentimentWeighted).toEqual({ pos: 1, neu: 0, neg: 1 });
  });

  it('emoji Unicode conhecido entra em emoteFreq e vira token semântico', () => {
    const dict = new TwitchEmoteDictionary();
    const msgs = [mkMsg('m1', 'a', '😂😂😂 top demais')];
    const agg = aggregate({
      channelId: 'c1',
      sessionId: null,
      windowStart: t0,
      windowEnd: t1,
      unique: msgs,
      groups: new Map(),
      emoteDictionary: dict,
    });
    expect(agg.emoteFreq.get('😂')).toBe(3);
    // O run de emoji vira um único token [POSITIVE_HIGH] → tokenize → positive_high
    expect(agg.tokenFreq.get('positive_high')).toBe(1);
  });

  it('sampleRawForLlm prioriza mods e diversifica', () => {
    const msgs = [
      mkMsg('m1', 'a', 'x', { isMod: true }),
      mkMsg('m2', 'b', 'x', { isSubscriber: true }),
      mkMsg('m3', 'a', 'x', { isMod: true }),
      mkMsg('m4', 'c', 'x'),
    ];
    const agg = aggregate({
      channelId: 'c1',
      sessionId: null,
      windowStart: t0,
      windowEnd: t1,
      unique: msgs,
      groups: new Map(),
      sampleSize: 3,
    });
    expect(agg.sampleRawForLlm.length).toBe(3);
    const usernames = agg.sampleRawForLlm.map((m) => m.user.username);
    // mod 'a' antes do sub 'b'; user duplicado 'a' não entra antes de outros
    expect(usernames[0]).toBe('a');
    expect(usernames[1]).toBe('b');
  });
});
