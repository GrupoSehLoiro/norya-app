/**
 * Tipos canônicos do pipeline de social listening (M4 IA core).
 * Vivem em @sehloro/domain porque são contratos puros — não dependem
 * de framework nem de infra.
 */
import type { RawMessage } from '../ingestion/raw-message';

/** Estatística por usuário dentro de uma janela. */
export interface PerUserStats {
  username: string;
  isSubscriber: boolean;
  isMod: boolean;
  msgCount: number;
  posCount: number;
  neuCount: number;
  negCount: number;
}

/** Resultado da classificação heurística (tier-1) de UMA msg. */
export type SentimentHint = 'positive' | 'neutral' | 'negative';

export interface HeuristicResult {
  kind:
    | 'keep'
    | 'drop_bot'
    | 'drop_command'
    | 'drop_short'
    | 'drop_copypasta'
    | 'drop_mention_only'
    | 'drop_moderation'
    | 'drop_trivial';
  reason?: string;
  sentimentHint?: SentimentHint;
  categoryHint?: string;
}

/** Output do WindowAggregator — input do classificador tier-2. */
export interface BatchAggregate {
  channelId: string;
  /** ID lógico da sessão monitorada (LiveSession do M3). */
  sessionId: string | null;
  windowStart: Date;
  windowEnd: Date;

  /** Volume único pós-dedup (cada hash de copypasta conta 1). */
  totalMsgs: number;
  /**
   * Volume real ponderado (inclui ocorrências de copypasta).
   * Quando dedup não rodou (msgs.length === unique.length), iguala totalMsgs.
   */
  totalMsgsWeighted: number;

  uniqueUsers: number;
  isSubscriberRatio: number;

  /** token → contagem na janela (pós-normalização). */
  tokenFreq: Map<string, number>;
  /** emote code → contagem na janela. */
  emoteFreq: Map<string, number>;
  /** username mencionado → contagem. */
  mentionFreq: Map<string, number>;

  /** Top 20 tokens por frequência desc — derivado de tokenFreq. */
  topTokens: string[];

  /** Estatística por usuário (baseada em sentimentHint do tier-1). */
  perUser: PerUserStats[];

  /**
   * Tally de sentimentHints ponderado por `msgWeights`: cada grupo de
   * copypasta conta pelo nº real de ocorrências na janela. Sem pesos,
   * iguala a soma dos counts de perUser. Opcional por compat com
   * aggregates construídos à mão em testes.
   */
  sentimentWeighted?: { pos: number; neu: number; neg: number };

  /** Sinal de AD ativa na janela (preenchido pelo orchestrator). */
  adActive: boolean;
  adSource: 'twitch' | 'manual' | null;

  /**
   * Sample representativo p/ enviar ao LLM (≤ N msgs). Heurística:
   * preferir mods/subs, diversidade de usuários.
   */
  sampleRawForLlm: RawMessage[];
}

/** Saída do dedup de copypasta. */
export interface DedupResult {
  /** Msgs únicas (primeira ocorrência de cada hash). */
  unique: RawMessage[];
  /** Hash → contagem real (inclui re-aparições dentro do TTL). */
  groups: Map<string, number>;
  /**
   * msg.id (das únicas) → nº de ocorrências DENTRO deste batch. Difere de
   * `groups` (contagem Redis no TTL, cruza batches): este mapa é o peso
   * por-janela que o WindowAggregator usa (`msgWeights`).
   */
  countsByMsgId: Map<string, number>;
  /** Quantas msgs foram suprimidas (input.length - unique.length). */
  dedupCount: number;
}
