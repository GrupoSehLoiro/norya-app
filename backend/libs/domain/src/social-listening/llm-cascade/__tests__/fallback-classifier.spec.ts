import { classifyFallback } from '../fallback-classifier';
import { emptyConfigs } from '../types';
import type { BatchAggregate } from '../../types';

function mkAgg(over: Partial<BatchAggregate>): BatchAggregate {
  return {
    channelId: 'c1',
    sessionId: null,
    windowStart: new Date('2026-05-19T12:00:00Z'),
    windowEnd: new Date('2026-05-19T12:00:15Z'),
    totalMsgs: 0,
    totalMsgsWeighted: 0,
    uniqueUsers: 0,
    isSubscriberRatio: 0,
    tokenFreq: new Map(),
    emoteFreq: new Map(),
    mentionFreq: new Map(),
    topTokens: [],
    perUser: [],
    adActive: false,
    adSource: null,
    sampleRawForLlm: [],
    ...over,
  };
}

describe('classifyFallback — sentimentWeighted (copypasta pondera)', () => {
  it('usa o tally ponderado quando presente e a confiança usa o volume real', () => {
    // 20 "KKKK" (1 única com peso 20, positive) + 1 "ok" (neutral).
    const agg = mkAgg({
      totalMsgs: 2,
      totalMsgsWeighted: 21,
      sentimentWeighted: { pos: 20, neu: 1, neg: 0 },
      perUser: [
        {
          username: 'a',
          isSubscriber: false,
          isMod: false,
          msgCount: 1,
          posCount: 1,
          neuCount: 0,
          negCount: 0,
        },
        {
          username: 'b',
          isSubscriber: false,
          isMod: false,
          msgCount: 1,
          posCount: 0,
          neuCount: 1,
          negCount: 0,
        },
      ],
    });
    const out = classifyFallback({ aggregate: agg, configs: emptyConfigs(), brandHits: [] });
    expect(out.sentiment.pos).toBeCloseTo(20 / 21, 3);
    expect(out.sentiment.neu).toBeCloseTo(1 / 21, 3);
    expect(out.confidence).toBeCloseTo(1, 3);
  });
});

describe('classifyFallback — sentimentos do perUser', () => {
  it('ratios pos/neg/neu somando 1', () => {
    const agg = mkAgg({
      totalMsgs: 10,
      perUser: [
        {
          username: 'a',
          isSubscriber: false,
          isMod: false,
          msgCount: 4,
          posCount: 3,
          neuCount: 0,
          negCount: 1,
        },
        {
          username: 'b',
          isSubscriber: false,
          isMod: false,
          msgCount: 6,
          posCount: 2,
          neuCount: 2,
          negCount: 2,
        },
      ],
    });
    const out = classifyFallback({ aggregate: agg, configs: emptyConfigs(), brandHits: [] });
    const total = out.sentiment.pos + out.sentiment.neg + out.sentiment.neu;
    expect(total).toBeCloseTo(1, 3);
    expect(out.sentiment.pos).toBeCloseTo(5 / 10, 3);
  });

  it('agg sem hints → ratios zero, confidence=0', () => {
    const agg = mkAgg({ totalMsgs: 5 });
    const out = classifyFallback({ aggregate: agg, configs: emptyConfigs(), brandHits: [] });
    expect(out.sentiment).toEqual({ pos: 0, neg: 0, neu: 0 });
    expect(out.confidence).toBe(0);
  });
});

describe('classifyFallback — toxic ranking', () => {
  it('ordena por negCount/msgCount com filtro min 3 msgs', () => {
    const agg = mkAgg({
      totalMsgs: 20,
      perUser: [
        {
          username: 'troll',
          isSubscriber: false,
          isMod: false,
          msgCount: 6,
          posCount: 0,
          neuCount: 1,
          negCount: 5,
        },
        {
          username: 'doce',
          isSubscriber: false,
          isMod: false,
          msgCount: 8,
          posCount: 7,
          neuCount: 1,
          negCount: 0,
        },
        {
          username: 'pouco',
          isSubscriber: false,
          isMod: false,
          msgCount: 2,
          posCount: 0,
          neuCount: 0,
          negCount: 2,
        }, // ignorado
      ],
    });
    const out = classifyFallback({ aggregate: agg, configs: emptyConfigs(), brandHits: [] });
    expect(out.topToxicUsers[0]?.username).toBe('troll');
    expect(out.topToxicUsers[0]?.ratio).toBeCloseTo(5 / 6, 3);
    expect(out.topToxicUsers.some((u) => u.username === 'pouco')).toBe(false);
    expect(out.leastToxicUser?.username).toBe('doce');
  });

  it('sem nenhum user com pos → leastToxicUser=null', () => {
    const agg = mkAgg({
      perUser: [
        {
          username: 'a',
          isSubscriber: false,
          isMod: false,
          msgCount: 5,
          posCount: 0,
          neuCount: 5,
          negCount: 0,
        },
      ],
    });
    const out = classifyFallback({ aggregate: agg, configs: emptyConfigs(), brandHits: [] });
    expect(out.leastToxicUser).toBeNull();
  });
});

describe('classifyFallback — categorias', () => {
  it('soma tokenFreq por keyword da categoria e ordena desc', () => {
    const cfg = {
      ...emptyConfigs(),
      categories: new Map([
        ['game', new Set(['valorant', 'rank'])],
        ['meta', new Set(['stream'])],
      ]),
    };
    const agg = mkAgg({
      tokenFreq: new Map([
        ['valorant', 10],
        ['rank', 5],
        ['stream', 2],
      ]),
    });
    const out = classifyFallback({ aggregate: agg, configs: cfg, brandHits: [] });
    expect(out.topCategories[0]?.category).toBe('game');
    expect(out.topCategories[0]?.count).toBe(15);
    expect(out.topCategories[1]?.category).toBe('meta');
  });
});

describe('classifyFallback — AD sentiment', () => {
  it('adSentiment preenchido quando adActive=true', () => {
    const agg = mkAgg({
      totalMsgs: 10,
      adActive: true,
      adSource: 'twitch',
      perUser: [
        {
          username: 'a',
          isSubscriber: false,
          isMod: false,
          msgCount: 5,
          posCount: 1,
          neuCount: 0,
          negCount: 4,
        },
      ],
    });
    const out = classifyFallback({ aggregate: agg, configs: emptyConfigs(), brandHits: [] });
    expect(out.adSentiment?.active).toBe(true);
    expect(out.adSentiment?.source).toBe('twitch');
    expect(out.adSentiment?.neg).toBe(4);
  });

  it('adSentiment=null quando adActive=false', () => {
    const agg = mkAgg({ totalMsgs: 5, adActive: false });
    const out = classifyFallback({ aggregate: agg, configs: emptyConfigs(), brandHits: [] });
    expect(out.adSentiment).toBeNull();
  });
});

describe('classifyFallback — telemetria', () => {
  it('reporta llmTier=0, custo zero, modelo fallback', () => {
    const out = classifyFallback({
      aggregate: mkAgg({}),
      configs: emptyConfigs(),
      brandHits: [],
    });
    expect(out.llmTier).toBe(0);
    expect(out.llmCostUsd).toBe(0);
    expect(out.llmModel).toBe('fallback-keyword');
  });

  it('llmTier=1 quando passado explicitamente', () => {
    const out = classifyFallback({
      aggregate: mkAgg({}),
      configs: emptyConfigs(),
      brandHits: [],
      llmTier: 1,
    });
    expect(out.llmTier).toBe(1);
  });
});
