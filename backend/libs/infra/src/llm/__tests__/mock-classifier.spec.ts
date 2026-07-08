import { MockLlmClassifier } from '../mock-anthropic.classifier';
import { FallbackLlmClassifier } from '../fallback-llm.classifier';
import { emptyConfigs } from '@sehloro/domain';
import type { BatchAggregate } from '@sehloro/domain';

function agg(over: Partial<BatchAggregate>): BatchAggregate {
  return {
    channelId: 'c',
    sessionId: null,
    windowStart: new Date(),
    windowEnd: new Date(),
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

describe('MockLlmClassifier', () => {
  it('reporta llmTier=2 + modelo mock', async () => {
    const mock = new MockLlmClassifier();
    const out = await mock.classify({
      aggregate: agg({}),
      configs: emptyConfigs(),
      brandHits: [],
    });
    expect(out.llmTier).toBe(2);
    expect(out.llmModel).toBe('mock-haiku-4-5');
    expect(out.llmCostUsd).toBe(0);
  });

  it('produz mesmo shape do fallback (compatível com 7 insights)', async () => {
    const mock = new MockLlmClassifier();
    const out = await mock.classify({
      aggregate: agg({
        totalMsgs: 5,
        perUser: [
          {
            username: 'a',
            isSubscriber: false,
            isMod: false,
            msgCount: 5,
            posCount: 4,
            neuCount: 1,
            negCount: 0,
          },
        ],
      }),
      configs: emptyConfigs(),
      brandHits: [{ brand: 'XYZ', count: 3, sample: ['m1'] }],
    });
    expect(out.sentiment.pos).toBeCloseTo(4 / 5);
    expect(out.mentionedBrands[0]?.brand).toBe('XYZ');
  });
});

describe('FallbackLlmClassifier', () => {
  it('llmTier=0 sempre', async () => {
    const fb = new FallbackLlmClassifier();
    const out = await fb.classify({
      aggregate: agg({}),
      configs: emptyConfigs(),
      brandHits: [],
    });
    expect(out.llmTier).toBe(0);
    expect(out.llmModel).toBe('fallback-keyword');
  });
});
