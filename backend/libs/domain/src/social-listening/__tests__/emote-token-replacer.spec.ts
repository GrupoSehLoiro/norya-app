import type { RawMessageEmote } from '../../ingestion/raw-message';
import type { EmoteDictionary } from '../../ingestion/emote-dictionary';
import { TwitchEmoteDictionary } from '../../ingestion/emote-dictionary';
import { replaceEmotes } from '../emote-token-replacer';

describe('replaceEmotes — caminho por ranges', () => {
  it('substitui Kappa por token semântico mantendo o resto', () => {
    const emotes: RawMessageEmote[] = [
      { code: 'Kappa', start: 0, end: 4, semantic: 'SARCASM', intensity: 'mid' },
    ];
    expect(replaceEmotes('Kappa esse', emotes)).toBe('[SARCASM_MID] esse');
  });

  it('múltiplos emotes preservam ordem e espaçamento', () => {
    const emotes: RawMessageEmote[] = [
      { code: 'Kappa', start: 0, end: 4, semantic: 'SARCASM', intensity: 'low' },
      { code: 'Pog', start: 13, end: 15, semantic: 'HYPE', intensity: 'high' },
    ];
    expect(replaceEmotes('Kappa o jogo Pog', emotes)).toBe('[SARCASM_LOW] o jogo [HYPE_HIGH]');
  });

  it('sem emotes nem dicionário → texto inalterado', () => {
    expect(replaceEmotes('texto cru', [])).toBe('texto cru');
  });
});

describe('replaceEmotes — caminho por dicionário', () => {
  const m = new Map([
    ['PogChamp', { semantic: 'HYPE' as const, polarity: 0.8, intensity: 'high' as const }],
    ['Kappa', { semantic: 'SARCASM' as const, polarity: -0.2, intensity: 'mid' as const }],
  ]);
  const dict: EmoteDictionary = {
    get: (k) => m.get(k),
    has: (k) => m.has(k),
    entries: () => m.entries(),
    get size(): number {
      return m.size;
    },
  };

  it('substitui via dicionário quando sem ranges', () => {
    expect(replaceEmotes('Kappa esse PogChamp', [], dict)).toBe('[SARCASM_MID] esse [HYPE_HIGH]');
  });

  it('emote desconhecido fica literal', () => {
    expect(replaceEmotes('xxxUnknownEmote yy', [], dict)).toBe('xxxUnknownEmote yy');
  });
});

describe('replaceEmotes — emojis Unicode', () => {
  const dict = new TwitchEmoteDictionary();

  it('run do mesmo emoji vira UM token (espelha kkkk → [LAUGH])', () => {
    expect(replaceEmotes('😂😂😂 top', [], dict)).toBe('[POSITIVE_HIGH] top');
  });

  it('emojis diferentes viram tokens distintos', () => {
    expect(replaceEmotes('🔥 🤡', [], dict)).toBe('[HYPE_HIGH] [NEGATIVE_HIGH]');
  });

  it('emoji também é substituído no caminho por ranges', () => {
    const emotes: RawMessageEmote[] = [
      { code: 'Kappa', start: 0, end: 4, semantic: 'SARCASM', intensity: 'mid' },
    ];
    expect(replaceEmotes('Kappa 😂😂', emotes, dict)).toBe('[SARCASM_MID] [POSITIVE_HIGH]');
  });

  it('emoji desconhecido fica literal', () => {
    expect(replaceEmotes('🦖 oi mano', [], dict)).toBe('🦖 oi mano');
  });
});
