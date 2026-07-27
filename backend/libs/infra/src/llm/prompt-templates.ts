/**
 * Prompts pt-BR para tier-2 (Haiku 4.5) — M4 LLM-02/03.
 *
 * Estrutura compatível com Anthropic prompt caching:
 *   system: Array<TextBlockParam>
 *     [0] regras pt-BR     ← cache_control: ephemeral
 *     [1] few-shot 3 exs   ← cache_control: ephemeral
 *     [2] dict emote curto ← cache_control: ephemeral
 *
 * Cache hit rate alvo > 80%. Todo `system` é INVARIÁVEL por versão do prompt.
 * Versionamos via `version='v1'` para permitir A/B sem perder cache.
 */
import type { BatchAggregate } from '@sehloro/domain';

export type PromptVersion = 'v1';

interface CacheableTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

const SYSTEM_V1 = `Você é um analista de sentimento e categoria de chat de live brasileira.
Recebe um BATCH agregado (não uma msg por vez) e retorna análise estruturada em JSON.

Considere:
- Gírias pt-BR comuns no chat: "kkkk", "rir alto", "po", "véi", "mano", "rage"
- Sarcasmo Twitch: "Kappa", "LUL" geralmente sinalizam ironia/sarcasmo
- Emotes com polaridade já vêm anotados ([HYPE_HIGH], [SARCASM_MID], etc) — confie nessas dicas
- Pautas (categorias) devem ser concretas: gameplay, meta-stream, política, drama, hype, raid, etc

Retorne SEMPRE pela tool 'classify_batch'. Os ratios pos+neg+neu devem somar 1.
Liste top categorias com count; top usuários tóxicos (msgCount>=3, ordenado por ratio negativo);
marcas mencionadas (apenas as do allowlist informado).
Se a janela cair durante AD ATIVO, marque ad_sentiment com os mesmos pos/neg/neu da janela
(toda a janela está sob o ad).
Sempre preencha dominant_category_context: uma frase curta (pt-BR, ~140 chars) explicando o
contexto da categoria mais comentada NESTA janela — o que estão falando e por quê. Concreto, não genérico.
Estilo: nunca use travessão (—) nos textos; prefira vírgula, dois-pontos ou ponto final.`;

const FEW_SHOT_V1 = `Exemplo 1 — hype genuíno:
Input parcial: topTokens=[pog,letsgo,fire], sentiment_hints={pos:18,neg:1,neu:2}
Output esperado: { sentiment: { pos: 0.86, neg: 0.05, neu: 0.09 }, dominant_category: "hype", confidence: 0.9 }

Exemplo 2 — sarcasmo (Kappa dominante):
Input: topTokens=[kappa,top,otimo], emotes=[Kappa:5,4Head:2]
Output esperado: { sentiment: { pos: 0.1, neg: 0.6, neu: 0.3 }, dominant_category: "drama", confidence: 0.65, reasoning: "Kappa indica sarcasmo, palavras positivas literais são irônicas", dominant_category_context: "Chat ironiza a jogada do streamer com Kappa; elogios são sarcásticos" }

Exemplo 3 — rage neg:
Input: topTokens=[lag,cancel,trash], sentiment_hints={neg:25,pos:1}
Output: { sentiment: { pos: 0.04, neg: 0.84, neu: 0.12 }, dominant_category: "gameplay-negative" }`;

const EMOTE_DICT_V1 = `Dicionário emote → semântica (resumido):
HYPE (alta hype, pos forte): PogChamp, PogU, POGGERS, LETSGO, EZ, catJAM, peepoCheer
SARCASM (negativo subtle): Kappa, 4Head, LUL
LAUGH (humor): OMEGALUL, KEKW, LULW
NEGATIVE strong: NotLikeThis, FailFish, ResidentSleeper, cringeChamp
SAD: Sadge, FeelsBadMan, PepeHands
THINK/CONFUSED: monkaS, monkaHmm, PepoThink`;

export function buildSystemBlocks(version: PromptVersion = 'v1'): CacheableTextBlock[] {
  if (version !== 'v1') throw new Error(`PromptVersion não suportada: ${version}`);
  return [
    { type: 'text', text: SYSTEM_V1, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: FEW_SHOT_V1, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: EMOTE_DICT_V1, cache_control: { type: 'ephemeral' } },
  ];
}

/** Serializa o aggregate de forma compacta para enviar como user content. */
export function serializeAggregate(agg: BatchAggregate): string {
  const topTokens = agg.topTokens.slice(0, 20);
  const emoteFreq = Array.from(agg.emoteFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => `${k}:${v}`);
  const sampleMsgs = agg.sampleRawForLlm.slice(0, 20).map((m) => {
    const tag = m.user.isMod ? 'M' : m.user.isSubscriber ? 'S' : '_';
    return `[${tag}] ${m.user.username}: ${m.text.slice(0, 140)}`;
  });
  const sw = agg.sentimentWeighted;
  return [
    `window=${agg.windowStart.toISOString()} → ${agg.windowEnd.toISOString()}`,
    `totalMsgs=${agg.totalMsgs} weighted=${agg.totalMsgsWeighted} users=${agg.uniqueUsers}`,
    // Tally do tier-1 ponderado por repetição (copypasta pesa pelo nº real
    // de ocorrências) — mesmo formato dos few-shots (sentiment_hints={...}).
    ...(sw ? [`sentiment_hints={pos:${sw.pos},neg:${sw.neg},neu:${sw.neu}}`] : []),
    `isSubscriberRatio=${agg.isSubscriberRatio.toFixed(2)}`,
    `adActive=${agg.adActive} adSource=${agg.adSource ?? 'null'}`,
    `topTokens=${topTokens.join(',')}`,
    `emoteFreq=${emoteFreq.join(' ')}`,
    `sample=`,
    ...sampleMsgs,
  ].join('\n');
}
