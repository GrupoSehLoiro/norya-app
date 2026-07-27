import { ConfigService } from '@nestjs/config';
import { RealAnthropicClassifier } from '../real-anthropic.classifier';
import { buildSystemBlocks } from '../prompt-templates';
import type { LlmClassifierInput } from '../llm-classifier.port';
import { emptyConfigs, type BatchAggregate } from '@sehloro/domain';

/**
 * Garante que o contexto de Treinamento IA entra como 4º bloco de system SEM
 * cache_control — e que sem contexto o system continua byte-idêntico ao atual
 * (prefixo cacheado preservado → hit rate do prompt-cache intacto).
 */

function makeAggregate(): BatchAggregate {
  return {
    channelId: 'chan-1',
    sessionId: null,
    windowStart: new Date('2026-05-19T12:00:00Z'),
    windowEnd: new Date('2026-05-19T12:00:15Z'),
    totalMsgs: 5,
    totalMsgsWeighted: 7,
    uniqueUsers: 4,
    isSubscriberRatio: 0.25,
    tokenFreq: new Map(),
    emoteFreq: new Map(),
    mentionFreq: new Map(),
    topTokens: [],
    perUser: [],
    adActive: false,
    adSource: null,
    sampleRawForLlm: [],
  };
}

function makeInput(aiContext?: string): LlmClassifierInput {
  return { aggregate: makeAggregate(), configs: emptyConfigs(), brandHits: [], aiContext };
}

function makeClassifierWithSpy() {
  const create = jest.fn<Promise<unknown>, [Record<string, unknown>]>(async () => ({
    content: [{ type: 'tool_use', name: 'classify_batch', input: {} }],
    usage: {},
  }));
  const clf = new RealAnthropicClassifier(new ConfigService({}));
  // Injeta o client fake antes do primeiro uso — _getClient devolve this.client quando setado.
  (clf as unknown as { client: unknown }).client = { messages: { create } };
  return { clf, create };
}

describe('RealAnthropicClassifier — contexto de Treinamento IA', () => {
  it('sem aiContext: system são exatamente os 3 blocos cacheados', async () => {
    const { clf, create } = makeClassifierWithSpy();
    await clf.classify(makeInput());
    const { system } = create.mock.calls[0]![0] as never as { system: unknown[] };
    expect(system).toEqual(buildSystemBlocks('v1'));
  });

  it('com aiContext: 4º bloco por último, sem cache_control; 3 primeiros intactos', async () => {
    const { clf, create } = makeClassifierWithSpy();
    await clf.classify(makeInput('Contexto do canal (curadoria): FPS/Valorant.'));
    const { system } = create.mock.calls[0]![0] as never as {
      system: Array<{ type: string; text: string; cache_control?: unknown }>;
    };
    expect(system).toHaveLength(4);
    expect(system.slice(0, 3)).toEqual(buildSystemBlocks('v1'));
    const extra = system[3]!;
    expect(extra.type).toBe('text');
    expect(extra.text).toContain('FPS/Valorant');
    expect(extra.cache_control).toBeUndefined();
  });
});
