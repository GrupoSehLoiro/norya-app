/**
 * TWI-02 · EmoteDictionary — interface + implementação TwitchEmoteDictionary.
 *
 * Mapeia códigos de emote para semântica estruturada. Usado pelo mapper de
 * mensagens para enriquecer RawMessageEmote[] antes de entrar no pipeline de IA.
 */
import seedData from './data/twitch-emotes-seed.json';

export type EmoteSemantic =
  | 'HYPE'
  | 'BORING'
  | 'SARCASM'
  | 'SAD'
  | 'ANGRY'
  | 'NEUTRAL'
  | 'POSITIVE'
  | 'NEGATIVE';

export type EmoteIntensity = 'low' | 'mid' | 'high';

export interface EmoteEntry {
  semantic: EmoteSemantic;
  /** Polaridade afetiva no intervalo [-1, 1]. Negativo = negativo, positivo = positivo. */
  polarity: number;
  intensity: EmoteIntensity;
}

export interface EmoteDictionary {
  get(code: string): EmoteEntry | undefined;
  has(code: string): boolean;
  entries(): IterableIterator<[string, EmoteEntry]>;
  readonly size: number;
}

type SeedShape = Record<
  string,
  { semantic: EmoteSemantic; polarity: number; intensity: EmoteIntensity }
>;

export class TwitchEmoteDictionary implements EmoteDictionary {
  private readonly map: Map<string, EmoteEntry>;

  constructor(extraEntries?: Record<string, EmoteEntry>) {
    const seed = seedData as SeedShape;
    this.map = new Map<string, EmoteEntry>(Object.entries(seed));
    if (extraEntries) {
      for (const [code, entry] of Object.entries(extraEntries)) {
        this.map.set(code, entry);
      }
    }
  }

  get(code: string): EmoteEntry | undefined {
    return this.map.get(code);
  }

  has(code: string): boolean {
    return this.map.has(code);
  }

  entries(): IterableIterator<[string, EmoteEntry]> {
    return this.map.entries();
  }

  get size(): number {
    return this.map.size;
  }

  /** Retorna um Set com todos os códigos de emote — compatível com RawMessage.isEmoteOnly(). */
  toCodeSet(): ReadonlySet<string> {
    return new Set(this.map.keys());
  }
}

// ─── slangNormalize ──────────────────────────────────────────────────────────

/**
 * Normaliza gírias e expressões pt-BR para tokens semânticos.
 * Usado na Camada 1 do pipeline LLM (M4) para pré-processar texto.
 *
 * Substitui padrões de gíria por tokens neutros que o LLM interpreta
 * consistentemente, independente de ortografia variante (kkk, kkkkk, kkkk).
 */
export function slangNormalize(text: string): string {
  return (
    text
      // Risadas — kkk (3+), haha, rsrs
      .replace(/k{3,}/gi, '[LAUGH]')
      .replace(/ha{2,}h?a*/gi, '[LAUGH]')
      .replace(/(rs){1,}/gi, '[LAUGH_MID]')
      .replace(/hue{2,}/gi, '[LAUGH_MID]')
      // Hype / surpresa
      .replace(/uepa+/gi, '[HYPE_LOW]')
      .replace(/uau+/gi, '[HYPE_LOW]')
      .replace(/caramba+/gi, '[HYPE_LOW]')
      .replace(/nossa+/gi, '[HYPE_LOW]')
      // Afirmação entusiasmada
      .replace(/\bsim+\b/gi, '[YES]')
      .replace(/\bé+\b/gi, '[YES]')
      // Negação ênfase
      .replace(/\bnão+\b/gi, '[NO]')
      .replace(/\bnao+\b/gi, '[NO]')
      // Elogios
      .replace(/\bshow+\b/gi, '[POSITIVE]')
      .replace(/\bmaravilh\w+/gi, '[POSITIVE]')
      .replace(/\bperfeito\b/gi, '[POSITIVE]')
      // Xingamentos leves (mascarados para o pipeline)
      .replace(/\bputa\b/gi, '[EXPLETIVE]')
      .replace(/\bporra\b/gi, '[EXPLETIVE]')
      .replace(/\bcaralho\b/gi, '[EXPLETIVE]')
      .replace(/\bmerda\b/gi, '[EXPLETIVE]')
      // Jargão de chat de live
      .replace(/\bpog\b/gi, '[HYPE]')
      .replace(/\bpica\b/gi, '[POSITIVE_STRONG]')
      .replace(/\bmaneiro\b/gi, '[POSITIVE]')
      .replace(/\bsinistro\b/gi, '[POSITIVE_STRONG]')
      .replace(/\bsinistr[oa]\b/gi, '[POSITIVE_STRONG]')
      // Suspeita de trapaça — sinal para pipeline de moderação
      .replace(/cheat\w*/gi, '[CHEAT_SUSPECT]')
      .replace(/hack\w*/gi, '[CHEAT_SUSPECT]')
      .replace(/trapac\w*/gi, '[CHEAT_SUSPECT]')
  );
}
