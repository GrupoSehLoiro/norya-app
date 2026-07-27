/**
 * HeuristicClassifier (tier-1) — M4 LLM-01.
 *
 * Roda POR MSG e classifica em `keep | drop_*`. Quando `keep`, anexa
 * sentimentHint + categoryHint usando matchings de palavra-chave que
 * já existem nas collections Mongo `sentimentConfiguration` /
 * `categoryConfiguration` (configs injetadas via `ClassifierConfigs`).
 *
 * Alvo: 85-92% das msgs caem em algum `drop_*` ou recebem hint definitivo
 * → não precisam ir pro LLM.
 *
 * Função pura — não toca DB nem Redis. O orchestrator carrega configs
 * uma vez por janela e chama por msg.
 */
import type { RawMessage } from '../../ingestion/raw-message';
import type { EmoteDictionary } from '../../ingestion/emote-dictionary';
import { getEmojiMatchers, findUnicodeEmoteCodes } from '../../ingestion/emote-dictionary';
import { RawMessage as RawMessageNs } from '../../ingestion/raw-message';
import type { HeuristicResult, SentimentHint } from '../types';
import { tokenize } from '../text-normalizer';
import type { ClassifierConfigs } from './types';

const MIN_TEXT_LEN = 3;
const COMMAND_PREFIX_RE = /^[!/]/;
const MENTION_ONLY_RE = /^(\s*@[\w-]+)+\s*$/;

export interface HeuristicInput {
  msg: RawMessage;
  configs: ClassifierConfigs;
  emoteDictionary?: EmoteDictionary;
}

export function classifyHeuristic({
  msg,
  configs,
  emoteDictionary,
}: HeuristicInput): HeuristicResult {
  const u = msg.user.username.toLowerCase();

  // 1. Bot allowlist
  if (configs.botUsers.has(u)) {
    return { kind: 'drop_bot', reason: 'username in botUsers allowlist' };
  }

  // 2. blockedUsers (moderation)
  if (configs.blockedUsers.has(u)) {
    return { kind: 'drop_moderation', reason: 'blockedUsers match' };
  }

  const text = msg.text.trim();
  const emojiMatchers = emoteDictionary ? getEmojiMatchers(emoteDictionary) : null;
  const hasKnownEmoji = emojiMatchers ? emojiMatchers.single.test(text) : false;

  // 3. Command (starts with ! or /)
  if (COMMAND_PREFIX_RE.test(text)) {
    return { kind: 'drop_command', reason: text.slice(0, 1) };
  }

  // 4. Muito curta. Um único emoji tem length < 3 em UTF-16 mas carrega
  // sentimento — emoji conhecido segue para o check emote-only abaixo.
  if (text.length < MIN_TEXT_LEN && !hasKnownEmoji) {
    return { kind: 'drop_short' };
  }

  // 5. Só @mention (nada mais)
  if (MENTION_ONLY_RE.test(text)) {
    return { kind: 'drop_mention_only' };
  }

  // 6. blockedWords (moderation)
  const lower = text.toLowerCase();
  for (const word of configs.blockedWords) {
    if (lower.includes(word.toLowerCase())) {
      return { kind: 'drop_moderation', reason: `blockedWord: ${word}` };
    }
  }

  // 7. Só emotes → keep com hint do emote dominante (polarity)
  const emoteOnly = RawMessageNs.isEmoteOnly(
    msg,
    emoteDictionary ? new Set([...emoteDictionary.entries()].map(([k]) => k)) : undefined,
  );
  // 7b. Só emojis Unicode conhecidos — isEmoteOnly não cobre porque runs
  // colados (sem espaço entre emojis) não batem no split por whitespace.
  const emojiOnly =
    !emoteOnly &&
    hasKnownEmoji &&
    emojiMatchers !== null &&
    text.replace(emojiMatchers.global, '').trim() === '';
  if (emoteOnly || emojiOnly) {
    const hint = emoteSentimentHint(msg, emoteDictionary);
    return { kind: 'keep', sentimentHint: hint, categoryHint: 'emote_only' };
  }

  // 8. Tokenize e bate contra sentimentConfiguration / categoryConfiguration
  const tokens = tokenize(text);
  const sentimentHint = matchSentiment(tokens, configs);
  const categoryHint = matchCategory(tokens, configs);

  return {
    kind: 'keep',
    sentimentHint,
    categoryHint,
  };
}

function emoteSentimentHint(
  msg: RawMessage,
  dictionary: EmoteDictionary | undefined,
): SentimentHint | undefined {
  // Polaridade média dos emotes presentes
  const polarities: number[] = [];
  for (const e of msg.emotes) {
    if (typeof e.polarity === 'number') polarities.push(e.polarity);
    else if (dictionary) {
      const entry = dictionary.get(e.code);
      if (entry) polarities.push(entry.polarity);
    }
  }
  // Emojis Unicode não vêm em msg.emotes (ranges são só de emote de
  // plataforma) — extrai do texto.
  if (dictionary) {
    for (const code of findUnicodeEmoteCodes(msg.text, dictionary)) {
      const entry = dictionary.get(code);
      if (entry) polarities.push(entry.polarity);
    }
  }
  if (polarities.length === 0) return undefined;
  const avg = polarities.reduce((a, b) => a + b, 0) / polarities.length;
  if (avg > 0.2) return 'positive';
  if (avg < -0.2) return 'negative';
  return 'neutral';
}

function matchSentiment(
  tokens: ReadonlyArray<string>,
  cfg: ClassifierConfigs,
): SentimentHint | undefined {
  let pos = 0;
  let neg = 0;
  let neu = 0;
  for (const t of tokens) {
    if (cfg.sentiment.positive.has(t)) pos++;
    else if (cfg.sentiment.negative.has(t)) neg++;
    else if (cfg.sentiment.neutral.has(t)) neu++;
  }
  if (pos === 0 && neg === 0 && neu === 0) return undefined;
  if (pos >= neg && pos >= neu) return 'positive';
  if (neg >= pos && neg >= neu) return 'negative';
  return 'neutral';
}

function matchCategory(tokens: ReadonlyArray<string>, cfg: ClassifierConfigs): string | undefined {
  const counts = new Map<string, number>();
  for (const t of tokens) {
    for (const [cat, kws] of cfg.categories) {
      if (kws.has(t)) {
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
    }
  }
  if (counts.size === 0) return undefined;
  let best: string | undefined;
  let bestC = 0;
  for (const [cat, c] of counts) {
    if (c > bestC) {
      best = cat;
      bestC = c;
    }
  }
  return best;
}
