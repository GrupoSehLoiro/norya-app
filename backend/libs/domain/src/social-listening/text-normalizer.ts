/**
 * TextNormalizer — limpa o texto antes do classificador (M4 / PIPE-03).
 *
 * Padrão:
 *   - lowercase
 *   - trim + collapse whitespace
 *   - remove URLs
 *   - remove @mentions (capturadas em outro lugar)
 *   - opcionalmente remove emotes do dicionário
 *   - opcionalmente remove stopwords pt-BR
 *   - NÃO remove acentos por default ('não' precisa virar 'não', não 'nao',
 *     senão perdemos negação)
 */
import { isStopword } from './stopwords-pt-br';

export interface NormalizeOptions {
  lowercase?: boolean; // default true
  collapseWhitespace?: boolean; // default true
  stripUrls?: boolean; // default true
  stripMentions?: boolean; // default true
  stripEmotes?: boolean; // default false (mantém emote codes p/ EmoteTokenReplacer)
  stripStopwords?: boolean; // default true
  stripAccents?: boolean; // default false
  emoteDictionary?: ReadonlySet<string>;
}

const DEFAULT_OPTS: Required<Omit<NormalizeOptions, 'emoteDictionary'>> = {
  lowercase: true,
  collapseWhitespace: true,
  stripUrls: true,
  stripMentions: true,
  stripEmotes: false,
  stripStopwords: true,
  stripAccents: false,
};

const URL_RE = /\bhttps?:\/\/\S+/g;
const MENTION_RE = /@[\w-]+/g;

/** Normaliza retornando string (para uso em hash de copypasta, etc). */
export function normalizeText(text: string, opts?: NormalizeOptions): string {
  const o = { ...DEFAULT_OPTS, ...opts };
  let out = text;
  if (o.lowercase) out = out.toLowerCase();
  if (o.stripUrls) out = out.replace(URL_RE, ' ');
  if (o.stripMentions) out = out.replace(MENTION_RE, ' ');
  if (o.stripAccents) out = out.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (o.collapseWhitespace) out = out.replace(/\s+/g, ' ').trim();
  return out;
}

/**
 * Tokeniza para o classificador heurístico / WindowAggregator.
 * Aplica `normalizeText` + filtros de stopword e emote.
 */
export function tokenize(text: string, opts?: NormalizeOptions): string[] {
  const o = { ...DEFAULT_OPTS, ...opts };
  const normalized = normalizeText(text, opts);
  const emoteDict = opts?.emoteDictionary;
  const raw = normalized.split(/\s+/).filter((t) => t.length > 0);
  const out: string[] = [];
  for (const tok of raw) {
    // remove pontuação de borda (deixa caracteres com acento e dígitos)
    const stripped = tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (stripped.length === 0) continue;
    if (stripped.length < 2) continue;
    if (o.stripEmotes && emoteDict?.has(tok)) continue;
    if (o.stripStopwords && isStopword(stripped)) continue;
    out.push(stripped);
  }
  return out;
}

/**
 * Colapsa repetições que só mudam a INTENSIDADE do texto, não o significado,
 * para que variantes caiam no MESMO hash de copypasta (o volume real fica
 * preservado na contagem do grupo):
 *   - risadas (kkk/haha/rsrs/hue, qualquer comprimento) → token canônico [laugh]
 *   - runs de 3+ do mesmo caractere (incl. emoji) → 2 ("goool" → "gool",
 *     "!!!!!" → "!!")
 */
export function collapseRepetitions(text: string): string {
  return text
    .replace(/k{3,}/gi, '[laugh]')
    .replace(/(?:ha){2,}h?/gi, '[laugh]') // hahaha, hahah
    .replace(/ha{2,}/gi, '[laugh]') // haaa
    .replace(/(?:rs){2,}/gi, '[laugh]')
    .replace(/(?:hue){2,}/gi, '[laugh]')
    .replace(/\[laugh\](?:\s*\[laugh\])+/g, '[laugh]')
    .replace(/(.)\1{2,}/gsu, '$1$1');
}

/** Hash determinístico para uso no dedup de copypasta. */
export function copypastaKey(text: string, opts?: NormalizeOptions): string {
  return collapseRepetitions(
    normalizeText(text, {
      ...opts,
      stripUrls: true,
      stripMentions: true,
      stripEmotes: true,
      stripStopwords: false, // hash do TEXTO, não dos tokens
      lowercase: true,
      collapseWhitespace: true,
    }),
  );
}
