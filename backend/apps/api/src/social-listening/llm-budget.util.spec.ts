import type { BatchAggregate, RawMessage } from '@sehloro/domain';
import { estimateClassifyTokens, LLM_OUTPUT_TOKEN_ALLOWANCE } from './llm-budget.util';

function mkMsg(id: string, text: string): RawMessage {
  return {
    id,
    channelId: 'c1',
    text,
    user: { username: 'alice', displayName: 'alice', isSubscriber: false, isMod: false },
    emotes: [],
    mentions: [],
    receivedAt: new Date('2026-05-19T12:00:00Z'),
  } as unknown as RawMessage;
}

function makeAggregate(over: Partial<BatchAggregate> = {}): BatchAggregate {
  return {
    channelId: 'c1',
    sessionId: null,
    windowStart: new Date('2026-05-19T12:00:00Z'),
    windowEnd: new Date('2026-05-19T12:00:15Z'),
    totalMsgs: 2,
    totalMsgsWeighted: 2,
    uniqueUsers: 1,
    isSubscriberRatio: 0,
    tokenFreq: new Map(),
    emoteFreq: new Map(),
    mentionFreq: new Map(),
    topTokens: ['gg'],
    perUser: [],
    adActive: false,
    adSource: null,
    sampleRawForLlm: [mkMsg('m1', 'primeira mensagem'), mkMsg('m2', 'segunda mensagem')],
    ...over,
  };
}

describe('estimateClassifyTokens', () => {
  it('sempre inclui a franquia de saída', () => {
    expect(estimateClassifyTokens(makeAggregate())).toBeGreaterThan(LLM_OUTPUT_TOKEN_ALLOWANCE);
  });

  it('cresce com o tamanho do sample', () => {
    const small = estimateClassifyTokens(makeAggregate());
    const big = estimateClassifyTokens(
      makeAggregate({
        sampleRawForLlm: Array.from({ length: 12 }, (_, i) =>
          mkMsg(`m${i}`, 'mensagem bem mais comprida do chat para engordar o sample '.repeat(2)),
        ),
      }),
    );
    expect(big).toBeGreaterThan(small);
  });

  it('aiContext é cobrado integral (o prefixo não cacheia — ver llm-budget.util.ts)', () => {
    const agg = makeAggregate();
    const without = estimateClassifyTokens(agg);
    const ctx = 'x'.repeat(4000);
    const withCtx = estimateClassifyTokens(agg, ctx);
    // 4000 chars / 4 = ~1000 tokens extras — e NÃO ~100 (que seria cache read).
    expect(withCtx - without).toBeGreaterThanOrEqual(950);
    expect(withCtx - without).toBeLessThanOrEqual(1050);
  });

  it('a franquia cobre o prefixo fixo tools+system enviado a preço cheio', () => {
    // Sem essa margem o teto mensal seria furado em ~2,2k tokens por chamada.
    expect(LLM_OUTPUT_TOKEN_ALLOWANCE).toBeGreaterThanOrEqual(2195 + 600);
  });
});
