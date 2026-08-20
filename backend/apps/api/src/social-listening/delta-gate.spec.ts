import type { BatchAggregate, Tier2Output } from '@sehloro/domain';
import {
  inheritCategories,
  DELTA_GATE_DEFAULTS,
  jaccard,
  makeTier2Snapshot,
  reuseTier2,
  sentimentDistribution,
  shouldReuseTier2,
  type Tier2Snapshot,
} from './delta-gate';

function makeAggregate(over: Partial<BatchAggregate> = {}): BatchAggregate {
  return {
    channelId: 'chan-1',
    sessionId: null,
    windowStart: new Date('2026-05-19T12:00:00Z'),
    windowEnd: new Date('2026-05-19T12:00:15Z'),
    totalMsgs: 20,
    totalMsgsWeighted: 25,
    uniqueUsers: 10,
    isSubscriberRatio: 0.2,
    tokenFreq: new Map(),
    emoteFreq: new Map(),
    mentionFreq: new Map(),
    topTokens: ['pog', 'letsgo', 'hype', 'gg'],
    perUser: [],
    sentimentWeighted: { pos: 18, neu: 5, neg: 2 },
    adActive: false,
    adSource: null,
    sampleRawForLlm: [],
    ...over,
  };
}

function makeTier2(over: Partial<Tier2Output> = {}): Tier2Output {
  return {
    sentiment: { pos: 0.7, neg: 0.1, neu: 0.2 },
    topCategories: [
      { category: 'hype', count: 12 },
      { category: 'gameplay', count: 5 },
    ],
    topToxicUsers: [],
    leastToxicUser: null,
    mentionedBrands: [],
    adSentiment: null,
    confidence: 0.9,
    needsEscalation: false,
    reasoning: 'ok',
    dominantCategoryContext: 'Chat vibra com a vitória no ranqueado',
    llmTier: 2,
    llmModel: 'claude-haiku-4-5-20251001',
    llmCostUsd: 0.001,
    llmLatencyMs: 800,
    llmCacheHitRate: 0.9,
    ...over,
  };
}

function makeSnap(over: Partial<Tier2Snapshot> = {}): Tier2Snapshot {
  return { ...makeTier2Snapshot(makeAggregate(), makeTier2()), ...over };
}

describe('jaccard', () => {
  it('conjuntos iguais → 1; disjuntos → 0; vazios → 1', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
    expect(jaccard(new Set(), new Set())).toBe(1);
  });

  it('sobreposição parcial', () => {
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBeCloseTo(0.5);
  });
});

describe('sentimentDistribution', () => {
  it('normaliza o tally ponderado', () => {
    const d = sentimentDistribution(
      makeAggregate({ sentimentWeighted: { pos: 8, neu: 1, neg: 1 } }),
    );
    expect(d.pos).toBeCloseTo(0.8);
  });

  it('sem hints → neutro conservador', () => {
    expect(sentimentDistribution(makeAggregate({ sentimentWeighted: undefined }))).toEqual({
      pos: 0,
      neg: 0,
      neu: 1,
    });
  });
});

describe('shouldReuseTier2', () => {
  const now = Date.now();

  it('janela similar → reusa', () => {
    expect(shouldReuseTier2(makeAggregate(), makeSnap(), now)).toBe(true);
  });

  it('sem memória → LLM', () => {
    expect(shouldReuseTier2(makeAggregate(), undefined, now)).toBe(false);
  });

  it('memória velha → LLM', () => {
    const snap = makeSnap({ at: now - DELTA_GATE_DEFAULTS.maxAgeMs - 1 });
    expect(shouldReuseTier2(makeAggregate(), snap, now)).toBe(false);
  });

  it('re-âncora após maxReuse reusos', () => {
    const snap = makeSnap({ reuseCount: DELTA_GATE_DEFAULTS.maxReuse });
    expect(shouldReuseTier2(makeAggregate(), snap, now)).toBe(false);
  });

  it('snapshot que não veio do LLM (tier != 2) → LLM', () => {
    const snap = makeSnap({ tier2: makeTier2({ llmTier: 0 }) });
    expect(shouldReuseTier2(makeAggregate(), snap, now)).toBe(false);
  });

  it('needsEscalation no snapshot → LLM', () => {
    const snap = makeSnap({ tier2: makeTier2({ needsEscalation: true }) });
    expect(shouldReuseTier2(makeAggregate(), snap, now)).toBe(false);
  });

  it('estado de AD mudou → LLM', () => {
    expect(
      shouldReuseTier2(makeAggregate({ adActive: true, adSource: 'twitch' }), makeSnap(), now),
    ).toBe(false);
  });

  it('spike de volume → LLM', () => {
    const agg = makeAggregate({ totalMsgsWeighted: 25 * DELTA_GATE_DEFAULTS.maxVolumeRatio + 10 });
    expect(shouldReuseTier2(agg, makeSnap(), now)).toBe(false);
  });

  it('queda brusca de volume → LLM (a pauta do chat cheio não vale pro vazio)', () => {
    const agg = makeAggregate({ totalMsgsWeighted: 25 / DELTA_GATE_DEFAULTS.maxVolumeRatio - 1 });
    expect(shouldReuseTier2(agg, makeSnap(), now)).toBe(false);
  });

  it('variação de volume dentro da banda ainda reusa', () => {
    const agg = makeAggregate({ totalMsgsWeighted: 25 * 1.5 });
    expect(shouldReuseTier2(agg, makeSnap(), now)).toBe(true);
  });

  it('tokens divergiram → LLM', () => {
    const agg = makeAggregate({ topTokens: ['lag', 'trash', 'cancel', 'rage'] });
    expect(shouldReuseTier2(agg, makeSnap(), now)).toBe(false);
  });

  it('sentimento virou → LLM', () => {
    const agg = makeAggregate({ sentimentWeighted: { pos: 2, neu: 5, neg: 18 } });
    expect(shouldReuseTier2(agg, makeSnap(), now)).toBe(false);
  });
});

describe('reuseTier2', () => {
  it('números frescos da base + semântica do snapshot, tier 1 e custo zero', () => {
    const base = makeTier2({
      llmTier: 0,
      llmModel: 'fallback',
      sentiment: { pos: 0.5, neg: 0.2, neu: 0.3 },
      topCategories: [{ category: 'other', count: 3 }],
      dominantCategoryContext: '',
    });
    const snap = makeSnap();
    const agg = makeAggregate({ totalMsgsWeighted: 50 }); // 2× o volume do snapshot
    const out = reuseTier2(base, snap, agg);

    expect(out.sentiment).toEqual(base.sentiment); // fresco da janela atual
    expect(out.topCategories[0]).toEqual({ category: 'hype', count: 24 }); // 12 × 2
    expect(out.dominantCategoryContext).toBe('Chat vibra com a vitória no ranqueado');
    expect(out.llmTier).toBe(1);
    expect(out.llmModel).toContain('+reuso');
    expect(out.llmCostUsd).toBe(0);
    expect(out.confidence).toBeLessThan(snap.tier2.confidence);
  });
});

describe('inheritCategories (tier 0, janela pequena)', () => {
  const now = Date.now();
  const base = makeTier2({
    topCategories: [],
    dominantCategoryContext: undefined,
    llmTier: 0,
    llmModel: 'heuristic',
  });

  it('sem memória → base intacta', () => {
    expect(inheritCategories(base, undefined, makeAggregate(), now)).toBe(base);
  });

  it('memória recente da IA → herda categorias e contexto, mantém sentimento', () => {
    const snap = makeSnap();
    const out = inheritCategories(base, snap, makeAggregate(), now);
    expect(out.topCategories.map((c) => c.category)).toEqual(
      snap.tier2.topCategories.map((c) => c.category),
    );
    expect(out.dominantCategoryContext).toBe(snap.tier2.dominantCategoryContext);
    expect(out.sentiment).toEqual(base.sentiment);
    expect(out.llmTier).toBe(0);
    expect(out.llmModel).toContain('pauta-herdada');
    expect(snap.reuseCount).toBe(0);
  });

  it('memória velha → base intacta', () => {
    const snap = makeSnap({ at: now - 10 * 60_000 });
    expect(inheritCategories(base, snap, makeAggregate(), now)).toBe(base);
  });

  it('memória que não veio do LLM → base intacta', () => {
    const snap = makeSnap({ tier2: makeTier2({ llmTier: 1 }) });
    expect(inheritCategories(base, snap, makeAggregate(), now)).toBe(base);
  });
});
