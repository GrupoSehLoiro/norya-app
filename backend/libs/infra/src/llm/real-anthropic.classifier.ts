/**
 * RealAnthropicClassifier — chama Haiku 4.5 via `@anthropic-ai/sdk`.
 *
 * Estratégia:
 *   1. Tenta passar breaker — se OPEN, deixa o LlmRouter decidir o
 *      fallback (não é resp do classifier).
 *   2. Monta `system[]` cacheado + `messages=[{ role:user, content: agg }]`
 *   3. `tool_choice: { type:'tool', name:'classify_batch' }` força JSON válido.
 *   4. Lê `tool_use.input` direto (sem parse manual de JSON livre).
 *   5. Métricas: cache_creation_input_tokens / cache_read_input_tokens.
 *   6. Em erro: recordFailure no breaker, propaga erro pro router fazer fallback.
 *
 * `@anthropic-ai/sdk` é importado dinâmico → se o pacote falhar, o
 * classifier ainda compila e o Mock continua o default.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { classifyFallback, type Tier2Output, type BrandHit } from '@sehloro/domain';
import { CircuitBreaker } from './circuit-breaker';
import { buildSystemBlocks, serializeAggregate } from './prompt-templates';
import { CLASSIFY_BATCH_TOOL } from './tool-schemas';
import type { LlmClassifier, LlmClassifierInput } from './llm-classifier.port';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Preço por 1M de tokens (USD) por modelo tier-2. Fonte: pricing oficial Anthropic.
 * Haiku 4.5: $1 input / $5 output. Cache write (TTL 5min) = 1.25× input;
 * cache read = 0.1× input. Default → Haiku se o modelo não estiver no mapa.
 */
const TOKEN_PRICING_USD_PER_M: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
};
const DEFAULT_PRICING = { input: 1.0, output: 5.0 };
const CACHE_WRITE_MULTIPLIER = 1.25; // write de cache (TTL 5min) custa 1.25× o input
const CACHE_READ_MULTIPLIER = 0.1; // read de cache custa 0.1× o input

interface ToolUseBlock {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicResponse {
  content: Array<ToolUseBlock | { type: 'text'; text: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/** Superfície mínima do client Anthropic usada aqui (lazy import do SDK). */
interface AnthropicClientLike {
  messages: { create(args: Record<string, unknown>): Promise<unknown> };
}

/** Shape esperado do JSON do tool_use tier-2 — cada campo é validado defensivamente. */
interface Tier2RawJson {
  sentiment?: { pos?: unknown; neg?: unknown; neu?: unknown };
  top_categories?: Array<{ category?: unknown; count?: unknown }>;
  top_toxic_users?: Array<{ username?: unknown; ratio?: unknown; msg_count?: unknown }>;
  least_toxic_user?: { username?: unknown; ratio?: unknown; msg_count?: unknown } | null;
  ad_sentiment?: { pos?: unknown; neg?: unknown; neu?: unknown } | null;
  confidence?: unknown;
  needs_escalation?: unknown;
  reasoning?: unknown;
  dominant_category_context?: unknown;
}

@Injectable()
export class RealAnthropicClassifier implements LlmClassifier {
  private readonly logger = new Logger(RealAnthropicClassifier.name);
  private readonly breaker = new CircuitBreaker();
  private client: AnthropicClientLike | null = null;
  private readonly model: string;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    this.model = config.get<string>('LLM_MODEL_TIER2') ?? HAIKU_MODEL;
  }

  async classify(input: LlmClassifierInput): Promise<Tier2Output> {
    if (!this.breaker.allow()) {
      this.logger.warn('Breaker OPEN — caindo para fallback heurístico');
      return classifyFallback({
        aggregate: input.aggregate,
        configs: input.configs,
        brandHits: input.brandHits,
        llmTier: 0,
      });
    }

    const start = Date.now();
    try {
      const client = await this._getClient();
      // Contexto de treinamento por canal: SEMPRE por último e SEM
      // cache_control — o prefixo cacheado (3 blocos fixos) fica
      // byte-idêntico entre canais e o hit rate >80% é preservado.
      const system = input.aiContext
        ? [...buildSystemBlocks('v1'), { type: 'text' as const, text: input.aiContext }]
        : buildSystemBlocks('v1');
      const response = (await client.messages.create({
        model: this.model,
        max_tokens: 600,
        system,
        tools: [CLASSIFY_BATCH_TOOL],
        tool_choice: { type: 'tool', name: 'classify_batch' },
        messages: [{ role: 'user', content: serializeAggregate(input.aggregate) }],
      })) as AnthropicResponse;

      const latencyMs = Date.now() - start;
      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      const cacheRead = response.usage?.cache_read_input_tokens ?? 0;
      const cacheCreate = response.usage?.cache_creation_input_tokens ?? 0;
      const cacheHitRate =
        cacheRead + cacheCreate === 0 ? 0 : cacheRead / (cacheRead + cacheCreate);
      const costUsd = this._computeCostUsd({ inputTokens, outputTokens, cacheCreate, cacheRead });

      const toolBlock = response.content.find(
        (b): b is ToolUseBlock => b.type === 'tool_use' && b.name === 'classify_batch',
      );
      if (!toolBlock) {
        throw new Error('Resposta Anthropic sem tool_use block');
      }

      this.breaker.recordSuccess();
      return this._toTier2Output({
        raw: toolBlock.input,
        latencyMs,
        cacheHitRate,
        costUsd,
        brandHits: input.brandHits,
        adActive: input.aggregate.adActive,
        adSource: input.aggregate.adSource,
      });
    } catch (err) {
      this.breaker.recordFailure();
      this.logger.error(`Anthropic falhou: ${(err as Error).message}`);
      throw err;
    }
  }

  private async _getClient(): Promise<AnthropicClientLike> {
    if (this.client) return this.client;
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada para LLM_DRIVER=real');
    const mod = await import('@anthropic-ai/sdk');
    const Anthropic = (mod as { default?: unknown }).default ?? mod;
    // @ts-expect-error — SDK runtime
    this.client = new Anthropic({ apiKey });
    return this.client!;
  }

  /**
   * Custo real da chamada em USD a partir dos tokens de `usage`.
   * input/output ao preço do modelo; cache write a 1.25× input; cache read a 0.1× input.
   */
  private _computeCostUsd(args: {
    inputTokens: number;
    outputTokens: number;
    cacheCreate: number;
    cacheRead: number;
  }): number {
    const price = TOKEN_PRICING_USD_PER_M[this.model] ?? DEFAULT_PRICING;
    const perToken = (perMillion: number) => perMillion / 1_000_000;
    const cost =
      args.inputTokens * perToken(price.input) +
      args.outputTokens * perToken(price.output) +
      args.cacheCreate * perToken(price.input * CACHE_WRITE_MULTIPLIER) +
      args.cacheRead * perToken(price.input * CACHE_READ_MULTIPLIER);
    // Decimal(18,6) no ClickHouse — arredonda pra 6 casas pra não estourar a escala.
    return Math.round(cost * 1_000_000) / 1_000_000;
  }

  private _toTier2Output(args: {
    raw: Record<string, unknown>;
    latencyMs: number;
    cacheHitRate: number;
    costUsd: number;
    brandHits: BrandHit[];
    adActive: boolean;
    adSource: 'twitch' | 'manual' | null;
  }): Tier2Output {
    const r = args.raw as Tier2RawJson;
    const sentiment = r.sentiment ?? { pos: 0, neg: 0, neu: 0 };
    const topCategories = Array.isArray(r.top_categories) ? r.top_categories : [];
    const topToxic = Array.isArray(r.top_toxic_users) ? r.top_toxic_users : [];
    return {
      sentiment: {
        pos: Number(sentiment.pos ?? 0),
        neg: Number(sentiment.neg ?? 0),
        neu: Number(sentiment.neu ?? 0),
      },
      topCategories: topCategories.map((c) => ({
        category: String(c.category),
        count: Number(c.count ?? 0),
      })),
      topToxicUsers: topToxic.map((t) => ({
        username: String(t.username),
        ratio: Number(t.ratio ?? 0),
        msgCount: Number(t.msg_count ?? 0),
        negCount: Math.round(Number(t.ratio ?? 0) * Number(t.msg_count ?? 0)),
      })),
      leastToxicUser: r.least_toxic_user
        ? {
            username: String(r.least_toxic_user.username),
            ratio: Number(r.least_toxic_user.ratio ?? 0),
            msgCount: Number(r.least_toxic_user.msg_count ?? 0),
            posCount: Math.round(
              Number(r.least_toxic_user.ratio ?? 0) * Number(r.least_toxic_user.msg_count ?? 0),
            ),
          }
        : null,
      mentionedBrands: args.brandHits, // brand allowlist é fonte de verdade
      adSentiment:
        args.adActive && r.ad_sentiment
          ? {
              active: true,
              source: args.adSource,
              pos: Math.round(Number(r.ad_sentiment.pos ?? 0) * 100),
              neg: Math.round(Number(r.ad_sentiment.neg ?? 0) * 100),
              neu: Math.round(Number(r.ad_sentiment.neu ?? 0) * 100),
              sampleSize: 0,
            }
          : null,
      confidence: Number(r.confidence ?? 0.5),
      needsEscalation: Boolean(r.needs_escalation ?? false),
      reasoning: typeof r.reasoning === 'string' ? r.reasoning.slice(0, 400) : '',
      dominantCategoryContext:
        typeof r.dominant_category_context === 'string'
          ? r.dominant_category_context.slice(0, 160)
          : '',
      llmTier: 2,
      llmModel: this.model,
      llmCostUsd: args.costUsd, // custo real calculado dos tokens de usage × pricing
      llmLatencyMs: args.latencyMs,
      llmCacheHitRate: args.cacheHitRate,
    };
  }
}
