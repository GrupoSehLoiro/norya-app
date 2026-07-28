/**
 * WindowAggregator — pega o batch deduplicado da janela e produz o
 * `BatchAggregate` que alimenta o classificador (tier-1 + tier-2).
 *
 * Puro / sem efeitos colaterais. Recebe:
 *   - msgs únicas (de CopypastaDedup.unique)
 *   - groups (hash → count real) para ponderar o `totalMsgsWeighted`
 *   - sentimentHints por msg (do HeuristicClassifier, fase 4) para
 *     calcular `perUser`
 *   - flag adActive + source (do AdSegmentService, fase 3)
 *   - dicionário de emote para substituição (fase 2)
 *
 * Output → 7 insights vão ser computados em cima desse aggregate.
 */
import type { RawMessage } from '../ingestion/raw-message';
import type { EmoteDictionary } from '../ingestion/emote-dictionary';
import { findUnicodeEmoteCodes } from '../ingestion/emote-dictionary';
import type { BatchAggregate, PerUserStats, SentimentHint } from './types';
import { tokenize } from './text-normalizer';
import { isEmoteTokenArtifact, replaceEmotesInMessage } from './emote-token-replacer';

export interface WindowAggregatorInput {
  channelId: string;
  sessionId: string | null;
  windowStart: Date;
  windowEnd: Date;
  /** Msgs únicas (de CopypastaDedup.unique). */
  unique: ReadonlyArray<RawMessage>;
  /** Hash → count real (inclui copypasta reaparições). */
  groups: ReadonlyMap<string, number>;
  /**
   * Hint por msg.id — preenchido pelo tier-1 (fase 4). Pode estar incompleto
   * (msgs sem hint contam só em msgCount).
   */
  sentimentHints?: ReadonlyMap<string, SentimentHint>;
  /**
   * Peso por msg única (msg.id → ocorrências reais na janela, de
   * CopypastaDedup.countsByMsgId). Sem entrada/ausente → peso 1.
   * Pondera tokenFreq/emoteFreq/mentionFreq e sentimentWeighted.
   */
  msgWeights?: ReadonlyMap<string, number>;
  adActive?: boolean;
  adSource?: 'twitch' | 'manual' | null;
  emoteDictionary?: EmoteDictionary;
  /** Tamanho max do sample para o LLM. Default 30. */
  sampleSize?: number;
}

const TOP_TOKENS_LIMIT = 20;
const DEFAULT_SAMPLE = 30;

export function aggregate(input: WindowAggregatorInput): BatchAggregate {
  const {
    channelId,
    sessionId,
    windowStart,
    windowEnd,
    unique,
    groups,
    sentimentHints,
    msgWeights,
    adActive = false,
    adSource = null,
    emoteDictionary,
    sampleSize = DEFAULT_SAMPLE,
  } = input;

  const tokenFreq = new Map<string, number>();
  const emoteFreq = new Map<string, number>();
  const mentionFreq = new Map<string, number>();
  const perUserMap = new Map<string, PerUserStats>();
  let subscribers = 0;

  // Soma do groups → totalMsgsWeighted; se groups vazio, usa unique.length.
  let totalMsgsWeighted = 0;
  for (const cnt of groups.values()) totalMsgsWeighted += cnt;
  if (totalMsgsWeighted === 0) totalMsgsWeighted = unique.length;

  const sentimentWeighted = { pos: 0, neu: 0, neg: 0 };

  for (const msg of unique) {
    if (msg.user.isSubscriber) subscribers++;
    // Peso da msg = nº real de ocorrências do grupo copypasta nesta janela.
    const w = msgWeights?.get(msg.id) ?? 1;

    // Tokens — usa texto pós-substituição de emote → token semântico
    const textForTokens = emoteDictionary ? replaceEmotesInMessage(msg, emoteDictionary) : msg.text;
    const toks = tokenize(textForTokens, { emoteDictionary: undefined });
    for (const t of toks) {
      // Tokens semânticos de emote ("neutral_mid") não são vocabulário — o
      // emoji real já conta em emoteFreq logo abaixo.
      if (isEmoteTokenArtifact(t)) continue;
      tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + w);
    }

    // Emotes literais (pré-replace) → emoteFreq
    for (const e of msg.emotes) {
      emoteFreq.set(e.code, (emoteFreq.get(e.code) ?? 0) + w);
    }
    // Emojis Unicode conhecidos (não vêm em msg.emotes) → emoteFreq
    if (emoteDictionary) {
      for (const code of findUnicodeEmoteCodes(msg.text, emoteDictionary)) {
        emoteFreq.set(code, (emoteFreq.get(code) ?? 0) + w);
      }
    }

    // Mentions
    for (const m of msg.mentions) {
      const u = m.username.toLowerCase();
      mentionFreq.set(u, (mentionFreq.get(u) ?? 0) + w);
    }

    // Per-user — SEM peso de copypasta: o hash agrupa msgs idênticas de
    // usuários DIFERENTES, então atribuir o peso do grupo ao primeiro autor
    // distorceria msgCount e o ranking de toxicidade.
    const uname = msg.user.username.toLowerCase();
    let stats = perUserMap.get(uname);
    if (!stats) {
      stats = {
        username: uname,
        isSubscriber: msg.user.isSubscriber,
        isMod: msg.user.isMod,
        msgCount: 0,
        posCount: 0,
        neuCount: 0,
        negCount: 0,
      };
      perUserMap.set(uname, stats);
    }
    stats.msgCount++;
    const hint = sentimentHints?.get(msg.id);
    if (hint === 'positive') stats.posCount++;
    else if (hint === 'negative') stats.negCount++;
    else if (hint === 'neutral') stats.neuCount++;

    // Tally global ponderado: o burst inteiro conta no sentimento da janela.
    if (hint === 'positive') sentimentWeighted.pos += w;
    else if (hint === 'negative') sentimentWeighted.neg += w;
    else if (hint === 'neutral') sentimentWeighted.neu += w;
  }

  const topTokens = Array.from(tokenFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_TOKENS_LIMIT)
    .map(([t]) => t);

  const perUser = Array.from(perUserMap.values());

  const sampleRawForLlm = pickSample([...unique], sampleSize);

  return {
    channelId,
    sessionId,
    windowStart,
    windowEnd,
    totalMsgs: unique.length,
    totalMsgsWeighted,
    uniqueUsers: perUserMap.size,
    isSubscriberRatio: unique.length === 0 ? 0 : subscribers / unique.length,
    tokenFreq,
    emoteFreq,
    mentionFreq,
    topTokens,
    perUser,
    sentimentWeighted,
    adActive,
    adSource,
    sampleRawForLlm,
  };
}

/**
 * Heurística simples de amostragem: prioriza msgs de mods/subs e
 * diversifica usuários. Determinístico (não usa Math.random).
 */
function pickSample(msgs: RawMessage[], n: number): RawMessage[] {
  if (msgs.length <= n) return [...msgs];
  const seen = new Set<string>();
  const result: RawMessage[] = [];

  // 1) mods primeiro (1 por user)
  for (const m of msgs) {
    if (result.length >= n) break;
    if (m.user.isMod && !seen.has(m.user.username)) {
      result.push(m);
      seen.add(m.user.username);
    }
  }
  // 2) subs (1 por user)
  for (const m of msgs) {
    if (result.length >= n) break;
    if (m.user.isSubscriber && !seen.has(m.user.username)) {
      result.push(m);
      seen.add(m.user.username);
    }
  }
  // 3) restantes diversificando user
  for (const m of msgs) {
    if (result.length >= n) break;
    if (!seen.has(m.user.username)) {
      result.push(m);
      seen.add(m.user.username);
    }
  }
  // 4) preencher com qualquer um
  for (const m of msgs) {
    if (result.length >= n) break;
    result.push(m);
  }
  return result;
}
