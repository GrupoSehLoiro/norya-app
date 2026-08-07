/**
 * SocialListeningOrchestrator — junta as fases 1..5 em um tick periódico.
 *
 * Loop por canal a cada `SOCIAL_LISTENING_TICK_MS` (default 15s):
 *   1. drena ChatBuffer do canal (msgs da janela)
 *   2. CopypastaDedup → unique[] + groups
 *   3. classifyHeuristic por msg → sentimentHints
 *   4. WindowAggregator (com adActive de AdSegmentService) → BatchAggregate
 *   5. detectBrands(unique, brands de channel_brand) → BrandHit[]
 *   6. LlmClassifier.classify → Tier2Output (mock/real/fallback), atrás de
 *      dois gates de custo: volume mínimo (SOCIAL_LISTENING_LLM_MIN_MSGS)
 *      e delta-gate (reuso quando a janela é similar à anterior — delta-gate.ts)
 *   7. composeBatchAnalysis → BatchAnalysis
 *   8. BatchAnalysisWriter (ClickHouse) + PublishInsightService (Redis pub/sub)
 *
 * Canais ativos: vêm da feature flag `ai.socialListening.enabled` (regras
 * `type:channel`) OU da env `SOCIAL_LISTENING_CHANNELS=csv`.
 *
 * Idempotência: drain consome o buffer; cada tick lê o que entrou desde
 * o último drain. Se o orchestrator cair, msgs do TTL Redis (60s) podem
 * ser drenadas pela próxima instância.
 */
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  CopypastaDedup,
  COPYPASTA_DEDUP_TOKEN,
  classifyHeuristic,
  aggregate as windowAggregate,
  detectBrands,
  TwitchEmoteDictionary,
  CHANNEL_REPOSITORY,
  type ChannelRepository,
  type RawMessage,
  type SentimentHint,
  type EmoteDictionary,
} from '@sehloro/domain';
import {
  ChatBufferService,
  ChannelBrandMongooseRepository,
  BatchMessagesMongooseRepository,
  LlmRateLimiterService,
  REDIS_TOKEN,
  type RateLimitReason,
} from '@sehloro/infra';
import { LLM_CLASSIFIER_TOKEN, type LlmClassifier, FallbackLlmClassifier } from '@sehloro/infra';
import { AdSegmentService } from './ad-segment.service';
import {
  AiContextResolverService,
  ConfigsLoaderService,
  LlmBudgetSettingsService,
} from '@sehloro/infra';
import { BatchAnalysisWriter } from './batch-analysis.writer';
import { PublishInsightService } from './publish-insight.service';
import { composeBatchAnalysis, type BatchAnalysis } from './batch-analysis.types';
import {
  DELTA_GATE_DEFAULTS,
  makeTier2Snapshot,
  reuseTier2,
  shouldReuseTier2,
  type DeltaGateOptions,
  type Tier2Snapshot,
} from './delta-gate';
import { estimateClassifyTokens } from './llm-budget.util';

const DEFAULT_TICK_MS = 15_000;
const DEFAULT_WINDOW_MS = 15_000;
/**
 * Gap mínimo de silêncio (sem novas msgs) pra considerar a "rajada"
 * fechada e drenar o buffer. Evita partir uma sequência de msgs em
 * batches consecutivos quando elas cruzam a fronteira do tick.
 *
 * Default 4s: rápido pra UI ainda parecer "near-realtime" mas grande
 * suficiente pra absorver pausas naturais de digitação no chat.
 */
const DEFAULT_IDLE_GAP_MS = 4_000;
/**
 * Teto absoluto da janela: se a atividade nunca para, dreno mesmo
 * assim depois disso (senão o buffer enche e a UI fica congelada).
 */
const DEFAULT_MAX_WINDOW_MS = 60_000;
/**
 * Gate de custo: janelas com menos msgs "kept" que isso não justificam o
 * prompt inteiro do LLM (~1.5k tokens de overhead) — a heurística (tier 0)
 * resolve e o batch continua sendo escrito/publicado normalmente.
 */
const DEFAULT_LLM_MIN_MSGS = 8;

@Injectable()
export class SocialListeningOrchestrator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SocialListeningOrchestrator.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly tickMs: number;
  private readonly windowMs: number;
  private readonly idleGapMs: number;
  private readonly maxWindowMs: number;
  private readonly envChannels: string[];
  private readonly emoteDictionary: EmoteDictionary;
  /** Cache de discovery: { channels, lastFetch } */
  private channelsCache: { ids: string[]; at: number } = { ids: [], at: 0 };
  private static readonly CHANNELS_CACHE_TTL_MS = 60_000;

  /** Gate de volume: mínimo de msgs kept pra justificar chamada de LLM. */
  private readonly llmMinMsgs: number;
  /** Delta-gate ligado? (env SOCIAL_LISTENING_DELTA_GATE, default true). */
  private readonly deltaGateEnabled: boolean;
  private readonly deltaGateOpts: DeltaGateOptions;
  /** Último tier-2 REAL por canal — assinatura da janela + análise (delta-gate). */
  private readonly tier2Memory = new Map<string, Tier2Snapshot>();
  /**
   * Último motivo de bloqueio de budget por canal — só loga na TRANSIÇÃO
   * (liberado→bloqueado e vice-versa) pra não poluir o log a cada tick.
   * Além dos motivos do limiter, 'paused' cobre a pausa do painel admin.
   */
  private readonly budgetBlockReason = new Map<string, RateLimitReason | 'paused'>();

  /** Logado uma vez quando o pipeline fica idle por falta de Redis. */
  private warnedNoBuffer = false;

  constructor(
    private readonly config: ConfigService,
    // Null quando EVENT_BUS_DRIVER != redis (CacheModule não instancia o
    // buffer sem Redis). O pipeline ao vivo depende do buffer de chat, então
    // sem ele o orchestrator fica idle — mesma degradação graciosa do
    // heartbeat `redis` abaixo, em vez de estourar a cada tick.
    // @Inject explícito obrigatório: `ChatBufferService | null` é união →
    // metadata emite `Object` como token → sem @Inject o Nest injeta null
    // SEMPRE (mesmo com Redis presente), deixando o pipeline ao vivo sem chat.
    @Optional()
    @Inject(ChatBufferService)
    private readonly chatBuffer: ChatBufferService | null,
    @Inject(COPYPASTA_DEDUP_TOKEN) private readonly dedup: CopypastaDedup,
    @Inject(LLM_CLASSIFIER_TOKEN) private readonly llm: LlmClassifier,
    // Fallback heurístico p/ degradar suave quando o LLM real falha
    // (sem créditos, 429, rede, resposta inválida) — nenhum batch é perdido.
    private readonly fallbackLlm: FallbackLlmClassifier,
    private readonly configs: ConfigsLoaderService,
    private readonly aiContext: AiContextResolverService,
    private readonly brandsRepo: ChannelBrandMongooseRepository,
    private readonly ad: AdSegmentService,
    private readonly writer: BatchAnalysisWriter,
    private readonly publisher: PublishInsightService,
    @Inject(CHANNEL_REPOSITORY)
    private readonly channelsRepo: ChannelRepository,
    private readonly batchMessages: BatchMessagesMongooseRepository,
    // Heartbeat de "canal ao vivo" — escrito a cada batch processado; o
    // monitoring lê pra reportar online por ATIVIDADE (cobre o caso da live
    // já estar no ar antes de qualquer evento stream.online). Null quando
    // EVENT_BUS_DRIVER != redis (sem Redis) → degrada pro modo só-sessão.
    @Optional()
    @Inject(REDIS_TOKEN)
    private readonly redis: {
      set: (key: string, value: string, mode: string, ttl: number) => Promise<unknown>;
    } | null,
    // Teto de tokens por canal (mensal + por minuto, Redis/Lua). Null sem
    // Redis → sem enforcement (dev). Bloqueado → batch degrada pra heurística.
    @Optional()
    @Inject(LlmRateLimiterService)
    private readonly llmBudget: LlmRateLimiterService | null,
    // Tetos/pausa editáveis pelo admin (painel /ai-budget) — cache 45s.
    private readonly budgetSettings: LlmBudgetSettingsService,
  ) {
    this.tickMs = Number(config.get('SOCIAL_LISTENING_TICK_MS') ?? DEFAULT_TICK_MS);
    this.windowMs = Number(config.get('SOCIAL_LISTENING_WINDOW_MS') ?? DEFAULT_WINDOW_MS);
    this.idleGapMs = Number(config.get('SOCIAL_LISTENING_IDLE_GAP_MS') ?? DEFAULT_IDLE_GAP_MS);
    this.maxWindowMs = Number(
      config.get('SOCIAL_LISTENING_MAX_WINDOW_MS') ?? DEFAULT_MAX_WINDOW_MS,
    );
    const raw = config.get<string>('SOCIAL_LISTENING_CHANNELS') ?? '';
    this.envChannels = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.emoteDictionary = new TwitchEmoteDictionary();
    this.llmMinMsgs = Number(config.get('SOCIAL_LISTENING_LLM_MIN_MSGS') ?? DEFAULT_LLM_MIN_MSGS);
    this.deltaGateEnabled =
      (config.get<string>('SOCIAL_LISTENING_DELTA_GATE') ?? 'true') !== 'false';
    this.deltaGateOpts = {
      ...DELTA_GATE_DEFAULTS,
      maxReuse: Number(
        config.get('SOCIAL_LISTENING_LLM_REUSE_MAX') ?? DELTA_GATE_DEFAULTS.maxReuse,
      ),
    };
  }

  onModuleInit(): void {
    this.logger.log(
      `Orchestrator iniciando — tick=${this.tickMs}ms envChannels=[${this.envChannels.join(',')}] + auto-discovery`,
    );
    this.timer = setInterval(() => this.runOnceForAll().catch(() => undefined), this.tickMs);
  }

  /**
   * Lista canais a serem processados: união de env CSV + canais ACTIVE
   * com externalId (criados via OAuth). Cache 60s pra não pesar Mongo.
   */
  private async getActiveChannels(): Promise<string[]> {
    if (Date.now() - this.channelsCache.at < SocialListeningOrchestrator.CHANNELS_CACHE_TTL_MS) {
      return this.channelsCache.ids;
    }
    const all = await this.channelsRepo.findAllActive();
    const discovered = all
      .filter((c) => Boolean(c.getExternalId())) // só OAuth'd têm externalId
      .map((c) => c.getId());
    const ids = Array.from(new Set([...this.envChannels, ...discovered]));
    this.channelsCache = { ids, at: Date.now() };
    return ids;
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Roda 1 ciclo em todos os canais habilitados. Exposto para testes
   * (sem precisar esperar o setInterval).
   */
  async runOnceForAll(): Promise<BatchAnalysis[]> {
    // Sem buffer de chat (Redis ausente) não há pipeline ao vivo — fica idle
    // em vez de estourar por tick. Loga só uma vez para não poluir.
    if (!this.chatBuffer) {
      if (!this.warnedNoBuffer) {
        this.logger.warn(
          'ChatBufferService ausente (sem Redis) — pipeline de social-listening idle',
        );
        this.warnedNoBuffer = true;
      }
      return [];
    }
    const channels = await this.getActiveChannels();
    if (channels.length === 0) return [];
    const out: BatchAnalysis[] = [];
    for (const ch of channels) {
      const r = await this.runOnce(ch).catch((err) => {
        this.logger.error(`tick canal=${ch} falhou: ${(err as Error).message}`);
        return null;
      });
      if (r) out.push(r);
    }
    return out;
  }

  async runOnce(channelId: string): Promise<BatchAnalysis | null> {
    // Sem buffer (Redis ausente) não há o que processar — ver runOnceForAll.
    if (!this.chatBuffer) return null;
    const windowEnd = new Date();

    // 0. Gap-of-silence gate.
    // Em vez de drenar a cada tick (que parte rajadas que cruzam o
    // boundary), só drenamos quando:
    //   (a) a janela está aberta há mais que `maxWindowMs` (cap absoluto), ou
    //   (b) não chegou msg nova há `idleGapMs` (rajada terminou).
    // Caso contrário pulamos esse tick — as msgs ficam no buffer pro
    // próximo. Buffer TTL é 60s, então não acumula indefinidamente.
    const boundaries = await this.chatBuffer.peekBoundaries(channelId);
    if (!boundaries) return null;
    const nowMs = windowEnd.getTime();
    const newestAgeMs = nowMs - boundaries.newest.receivedAt.getTime();
    const oldestAgeMs = nowMs - boundaries.oldest.receivedAt.getTime();
    const stillBuffering = newestAgeMs < this.idleGapMs && oldestAgeMs < this.maxWindowMs;
    if (stillBuffering) {
      this.logger.debug?.(
        `canal=${channelId} mantendo buffer aberto (idle=${newestAgeMs}ms < gap=${this.idleGapMs}ms, ` +
          `window=${oldestAgeMs}ms < max=${this.maxWindowMs}ms)`,
      );
      return null;
    }

    // 1. drain — janela = (oldest..newest) real das msgs, não wall-clock
    // do tick; isso faz o batch refletir o BURSTING real do chat.
    const msgs = await this.chatBuffer.drain(channelId);
    if (msgs.length === 0) return null;
    const windowStart = msgs[0]?.receivedAt
      ? new Date(msgs[0].receivedAt)
      : new Date(windowEnd.getTime() - this.windowMs);

    // 2. dedup
    const deduped = await this.dedup.process(msgs);

    // 3. configs + AD status + brands (paralelo)
    // A allowlist é do CRIADOR: resolvemos o creator do canal e carregamos as
    // marcas dele (marca por canal vazava entre donos que reaproveitam a conta).
    const channelForBrands = await this.channelsRepo.findById(channelId).catch(() => null);
    const creatorId = channelForBrands?.getCreatorId();
    const [configs, adStatus, brands] = await Promise.all([
      this.configs.load(),
      this.ad.getAdActiveInWindow(channelId, windowStart, windowEnd),
      creatorId ? this.brandsRepo.listByCreator(creatorId) : Promise.resolve([]),
    ]);

    // 4. heuristic per msg → hints
    const hints = new Map<string, SentimentHint>();
    const kept: RawMessage[] = [];
    for (const m of deduped.unique) {
      const r = classifyHeuristic({
        msg: m,
        configs,
        emoteDictionary: this.emoteDictionary,
      });
      if (r.kind === 'keep') {
        kept.push(m);
        if (r.sentimentHint) hints.set(m.id, r.sentimentHint);
      }
    }

    // 5. aggregate (com adActive)
    const agg = windowAggregate({
      channelId,
      sessionId: null,
      windowStart,
      windowEnd,
      unique: kept,
      groups: deduped.groups,
      sentimentHints: hints,
      // Peso por-janela do grupo copypasta: pondera sentimento e topTokens.
      msgWeights: deduped.countsByMsgId,
      adActive: adStatus.active,
      adSource: adStatus.source,
      emoteDictionary: this.emoteDictionary,
    });

    // 6. brands
    const brandHits = detectBrands(kept, brands);

    // 7. tier-2 (mock/real/fallback) — com dois gates de CUSTO antes do LLM:
    //   (a) volume mínimo: janela pequena não justifica os ~1.5k tokens de
    //       overhead do prompt — heurística resolve (tier 0);
    //   (b) delta-gate: janela "mais do mesmo" (tokens + sentimento próximos
    //       da última que passou pelo LLM) reaproveita a análise semântica
    //       anterior com números recalculados da janela atual (tier 1), com
    //       re-âncora no LLM após N reusos consecutivos. Ver delta-gate.ts.
    // Em ambos os gates o batch É escrito e publicado normalmente — a
    // ingestão e o feed não mudam, só a origem da análise.
    // Downgrade dinâmico continua: se o classifier real lançar (sem créditos,
    // 429, rede, JSON inválido) caímos NA HORA na heurística — assim o batch
    // é sempre escrito (degradado), nunca perdido. O circuit breaker interno
    // do real ainda abre após N falhas e passa a curto-circuitar rápido.
    let tier2: Awaited<ReturnType<LlmClassifier['classify']>>;
    const snapshot = this.tier2Memory.get(channelId);
    if (kept.length < this.llmMinMsgs) {
      tier2 = await this.fallbackLlm.classify({ aggregate: agg, configs, brandHits });
      this.logger.debug?.(
        `canal=${channelId} volume baixo (kept=${kept.length} < ${this.llmMinMsgs}) — tier 0 heurístico, sem LLM`,
      );
    } else if (
      this.deltaGateEnabled &&
      shouldReuseTier2(agg, snapshot, Date.now(), this.deltaGateOpts)
    ) {
      const base = await this.fallbackLlm.classify({ aggregate: agg, configs, brandHits });
      tier2 = reuseTier2(base, snapshot!, agg);
      snapshot!.reuseCount += 1;
      this.logger.debug?.(
        `canal=${channelId} delta-gate: reuso ${snapshot!.reuseCount}/${this.deltaGateOpts.maxReuse} do tier-2 anterior — sem LLM`,
      );
    } else {
      // Contexto de "Treinamento IA" do canal (cache 60s no resolver) — só
      // resolvido quando o LLM vai mesmo ser chamado.
      const aiContext = (await this.aiContext.resolveForChannel(channelId)) ?? undefined;
      // Teto de custo por canal: débito PRÉ-PAGO da estimativa de tokens.
      // Estourou (mês ou minuto) → heurística até liberar; batch nunca é
      // perdido. Sem Redis / erro no limiter → fail-open (não bloqueia).
      if (!(await this._acquireLlmBudget(channelId, agg, aiContext))) {
        tier2 = await this.fallbackLlm.classify({ aggregate: agg, configs, brandHits, aiContext });
      } else {
        try {
          tier2 = await this.llm.classify({ aggregate: agg, configs, brandHits, aiContext });
          // Memória do delta-gate: só análises que vieram do LLM (tier 2).
          if (tier2.llmTier === 2) this.tier2Memory.set(channelId, makeTier2Snapshot(agg, tier2));
        } catch (err) {
          this.logger.warn(
            `LLM real falhou (canal=${channelId}) — fallback heurístico: ${(err as Error).message}`,
          );
          tier2 = await this.fallbackLlm.classify({
            aggregate: agg,
            configs,
            brandHits,
            aiContext,
          });
        }
      }
    }

    // 8. compose + persist + publish
    const analysis = composeBatchAnalysis({
      batchId: randomUUID(),
      channelId,
      sessionId: null,
      windowStart,
      windowEnd,
      totalMsgs: agg.totalMsgs,
      totalMsgsWeighted: agg.totalMsgsWeighted,
      uniqueUsers: agg.uniqueUsers,
      isSubscriberRatio: agg.isSubscriberRatio,
      topTokens: agg.topTokens,
      tier2,
    });

    // Persiste cópia das msgs do batch — viewer page (/batches) consome.
    // Fire-and-forget; falha aqui não derruba o tick.
    void this.batchMessages
      .save({
        batchId: analysis.batchId,
        channelId,
        windowStart,
        windowEnd,
        messages: kept,
        sentimentHints: hints,
      })
      .catch((err) =>
        this.logger.warn(
          `batchMessages.save falhou batch=${analysis.batchId}: ${(err as Error).message}`,
        ),
      );

    await this.writer.write(analysis);
    await this.publisher.publish(analysis);

    // Heartbeat de atividade (TTL 180s) — monitoring usa pra "online".
    try {
      await this.redis?.set(`sl:live:${channelId}`, String(Date.now()), 'EX', 180);
    } catch {
      /* heartbeat é best-effort; nunca derruba o tick */
    }

    this.logger.log(
      `tick canal=${channelId} msgs=${msgs.length} unique=${deduped.unique.length} ` +
        `kept=${kept.length} tier=${analysis.llmTier} cost=${analysis.llmCostUsd}`,
    );
    return analysis;
  }

  /**
   * Debita a estimativa de tokens do budget do canal (LlmRateLimiterService,
   * mensal + por minuto, atômico via Lua). Retorna false quando bloqueado —
   * o caller degrada pra heurística sem perder o batch.
   *
   * Os TETOS vêm do painel admin (LlmBudgetSettingsService: override do
   * canal → global → env), passados por chamada ao limiter — mudança do
   * admin vale em <1min, sem restart. `paused` (canal ou global) pula o LLM
   * direto, custo zero imediato.
   *
   * Fail-open por design: sem limiter (Redis ausente) ou erro no Redis, a
   * chamada segue. O log só marca TRANSIÇÕES (bloqueou/liberou) pra não
   * poluir a cada tick durante um mês estourado.
   */
  private async _acquireLlmBudget(
    channelId: string,
    agg: Parameters<typeof estimateClassifyTokens>[0],
    aiContext?: string,
  ): Promise<boolean> {
    const prev = this.budgetBlockReason.get(channelId) ?? null;
    try {
      const settings = await this.budgetSettings.getEffective(channelId);
      if (settings.paused) {
        if (prev !== 'paused') {
          this.budgetBlockReason.set(channelId, 'paused');
          this.logger.warn(
            `IA PAUSADA pelo admin canal=${channelId} — batches seguem via heurística (tier 0)`,
          );
        }
        return false;
      }
      if (!this.llmBudget) {
        this._markBudgetFree(channelId, prev);
        return true;
      }
      const cost = estimateClassifyTokens(agg, aiContext);
      const verdict = await this.llmBudget.tryAcquire(channelId, cost, new Date(), {
        monthlyBudget: settings.monthlyTokens,
        tokensPerMinute: settings.tokensPerMinute,
      });
      if (!verdict.allowed) {
        if (prev !== verdict.reason) {
          this.budgetBlockReason.set(channelId, verdict.reason);
          this.logger.warn(
            `budget de LLM BLOQUEADO canal=${channelId} motivo=${verdict.reason} ` +
              `teto=${settings.monthlyTokens} (${settings.source}) ` +
              `restanteMes=${verdict.remainingMonthly} reset=${verdict.resetAt?.toISOString() ?? '?'} ` +
              `— batches seguem via heurística (tier 0)`,
          );
        }
        return false;
      }
      this._markBudgetFree(channelId, prev);
      return true;
    } catch (err) {
      this.logger.warn(
        `limiter de LLM falhou (canal=${channelId}): ${(err as Error).message} — fail-open`,
      );
      return true;
    }
  }

  private _markBudgetFree(channelId: string, prev: string | null): void {
    if (prev !== null) {
      this.budgetBlockReason.set(channelId, null);
      this.logger.log(`budget de LLM liberado canal=${channelId} — voltando ao tier-2`);
    }
  }
}
