/**
 * TWI-02 · EmoteDictionary — interface + implementação TwitchEmoteDictionary.
 *
 * Mapeia códigos de emote para semântica estruturada. Usado pelo mapper de
 * mensagens para enriquecer RawMessageEmote[] antes de entrar no pipeline de IA.
 */
import seedData from './data/twitch-emotes-seed.json';
import emojiSeedData from './data/unicode-emojis-seed.json';

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
    // Emojis Unicode entram no mesmo dicionário: mensagens só-de-emoji
    // ganham hint no tier-1 e viram tokens semânticos no replacer.
    // A curadoria do seed segue o uso corrente em chat pt-BR (ex.: caveira
    // como riso, palhaço como deboche; emojis ambíguos com polaridade suave).
    const emojiSeed = emojiSeedData as SeedShape;
    this.map = new Map<string, EmoteEntry>([...Object.entries(seed), ...Object.entries(emojiSeed)]);
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

// ─── Emojis Unicode ──────────────────────────────────────────────────────────

const EMOJI_CHAR_RE = /\p{Extended_Pictographic}/u;

export interface EmojiMatchers {
  /** Sem flag g — seguro para `.test()` (não guarda lastIndex). */
  single: RegExp;
  /** Flag g — uma ocorrência por match (para matchAll/replace). */
  global: RegExp;
  /** Flag g — run consecutivo do mesmo emoji num match só. */
  run: RegExp;
}

const matchersCache = new WeakMap<EmoteDictionary, EmojiMatchers | null>();

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regexes das chaves do dicionário que são emoji Unicode (não códigos de
 * emote tipo "PogChamp"). Cacheado por instância de dicionário — o
 * orchestrator usa uma instância só, então compila uma vez.
 * Retorna null se o dicionário não tem nenhum emoji.
 */
export function getEmojiMatchers(dictionary: EmoteDictionary): EmojiMatchers | null {
  const cached = matchersCache.get(dictionary);
  if (cached !== undefined) return cached;
  const keys = [...dictionary.entries()]
    .map(([code]) => code)
    .filter((code) => EMOJI_CHAR_RE.test(code))
    // Mais longos primeiro: sequência com variation selector (VS16) deve
    // ganhar de um prefixo dela.
    .sort((a, b) => b.length - a.length);
  let matchers: EmojiMatchers | null = null;
  if (keys.length > 0) {
    const src = keys.map(escapeRe).join('|');
    matchers = {
      single: new RegExp(src, 'u'),
      global: new RegExp(src, 'gu'),
      run: new RegExp(`(${src})(?:\\s*\\1)*`, 'gu'),
    };
  }
  matchersCache.set(dictionary, matchers);
  return matchers;
}

/** Todas as ocorrências de emojis conhecidos no texto (na ordem, com repetição). */
export function findUnicodeEmoteCodes(text: string, dictionary: EmoteDictionary): string[] {
  const matchers = getEmojiMatchers(dictionary);
  if (!matchers || !matchers.single.test(text)) return [];
  return [...text.matchAll(matchers.global)].map((m) => m[0]);
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
      // Risadas — kkk (3+), hahaha, haaa, rsrs, huehue
      .replace(/k{3,}/gi, '[LAUGH]')
      .replace(/(?:ha){2,}h?/gi, '[LAUGH]')
      .replace(/ha{2,}/gi, '[LAUGH]')
      .replace(/(?:rs){2,}/gi, '[LAUGH_MID]')
      .replace(/(?:hue){2,}/gi, '[LAUGH_MID]')
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
