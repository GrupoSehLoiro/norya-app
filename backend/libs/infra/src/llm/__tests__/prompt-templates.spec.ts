import { buildSystemBlocks, serializeAggregate } from '../prompt-templates';
import type { BatchAggregate } from '@sehloro/domain';

describe('prompt-templates', () => {
  it('buildSystemBlocks v1 retorna 3 blocos com cache_control', () => {
    const blocks = buildSystemBlocks('v1');
    expect(blocks.length).toBe(3);
    for (const b of blocks) {
      expect(b.type).toBe('text');
      expect(b.cache_control).toEqual({ type: 'ephemeral' });
      expect(typeof b.text).toBe('string');
      expect(b.text.length).toBeGreaterThan(10);
    }
  });

  it('serializeAggregate inclui campos críticos', () => {
    const a: BatchAggregate = {
      channelId: 'c',
      sessionId: null,
      windowStart: new Date('2026-05-19T12:00:00Z'),
      windowEnd: new Date('2026-05-19T12:00:15Z'),
      totalMsgs: 5,
      totalMsgsWeighted: 7,
      uniqueUsers: 4,
      isSubscriberRatio: 0.25,
      tokenFreq: new Map(),
      emoteFreq: new Map([
        ['Kappa', 3],
        ['Pog', 2],
      ]),
      mentionFreq: new Map(),
      topTokens: ['rage', 'lag', 'pog'],
      perUser: [],
      adActive: true,
      adSource: 'twitch',
      sampleRawForLlm: [],
    };
    const s = serializeAggregate(a);
    expect(s).toContain('totalMsgs=5');
    expect(s).toContain('adActive=true');
    expect(s).toContain('adSource=twitch');
    expect(s).toContain('topTokens=rage,lag,pog');
    expect(s).toContain('Kappa:3');
  });
});
