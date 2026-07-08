/**
 * EmoteTokenReplacer — converte emotes literais em tokens semânticos.
 *
 *   "Kappa que joguinho PogChamp PogChamp"
 *   → "[SARCASM_MID] que joguinho [HYPE_HIGH] [HYPE_HIGH]"
 *
 * Por que: reduz variedade de vocabulário e guia o classificador (heurístico
 * ou LLM) à nuance emocional sem precisar memorizar cada emote. Tokens
 * `[CAT_INTENSITY]` viram features estáveis.
 *
 * Estratégia:
 *   - Se `emotes` (ranges do payload) está presente, substitui por posição
 *     (preserva ordem do texto original; única passada com sort por start).
 *   - Caso contrário, faz word-replace consultando o dicionário (case-sensitive
 *     porque PogChamp != pogchamp no Twitch).
 */
import type { RawMessage, RawMessageEmote } from '../ingestion/raw-message';
import type {
  EmoteDictionary,
  EmoteEntry,
  EmoteSemantic,
  EmoteIntensity,
} from '../ingestion/emote-dictionary';

function tokenFor(
  semantic: EmoteSemantic | undefined,
  intensity: EmoteIntensity | undefined,
): string {
  const sem = (semantic ?? 'neutral').toUpperCase();
  const intens = (intensity ?? 'mid').toUpperCase();
  return `[${sem}_${intens}]`;
}

/**
 * Substitui emotes pelo token semântico equivalente. Se nenhum emote
 * conhecido encontrado, retorna o texto original.
 *
 * Aceita ranges do payload (`msg.emotes`) E/OU consulta o dicionário
 * por palavra — para cobrir bots que não preenchem ranges.
 */
export function replaceEmotes(
  text: string,
  emotes: ReadonlyArray<RawMessageEmote>,
  dictionary?: EmoteDictionary,
): string {
  // Caminho 1: ranges presentes → substituição por índice.
  if (emotes.length > 0) {
    const sorted = [...emotes].sort((a, b) => a.start - b.start);
    let out = '';
    let cursor = 0;
    for (const e of sorted) {
      if (e.start < cursor) continue; // overlap defensivo
      out += text.slice(cursor, e.start);
      out += tokenFor(e.semantic, e.intensity);
      cursor = e.end + 1;
    }
    out += text.slice(cursor);
    return out;
  }

  // Caminho 2: word-replace via dicionário.
  if (!dictionary || dictionary.size === 0) return text;
  const tokens = text.split(/(\s+)/);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    const entry: EmoteEntry | undefined = dictionary.get(tok);
    if (entry) {
      tokens[i] = tokenFor(entry.semantic, entry.intensity);
    }
  }
  return tokens.join('');
}

/** Conveniência: opera sobre uma RawMessage. */
export function replaceEmotesInMessage(msg: RawMessage, dictionary?: EmoteDictionary): string {
  return replaceEmotes(msg.text, msg.emotes, dictionary);
}
