/**
 * SocialListeningOrchestrator — junta as fases 1..5 em um tick periódico.
 *
 * Loop por canal a cada `SOCIAL_LISTENING_TICK_MS` (default 15s):
 *   1. drena ChatBuffer do canal (msgs da janela)
 *   2. CopypastaDedup → unique[] + groups
 *   3. classifyHeuristic por msg → sentimentHints
 *   4. WindowAggregator (com adActive de AdSegmentService) → BatchAggregate
 *   5. detectBrands(unique, brands de channel_brand) → BrandHit[]
 *   6. LlmClassifier.classify → Tier2Output (mock/real/fallback)
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
  REDIS_TOKEN,
} from '@sehloro/infra';
import { LLM_CLASSIFIER_TOKEN, type LlmClassifier, FallbackLlmClassifier } from '@sehloro/infra';
import { AdSegmentService } from './ad-segment.service';
import { ConfigsLoaderService } from '@sehloro/infra';
import { BatchAnalysisWriter } from './batch-analysis.writer';
import { PublishInsightService } from './publish-insight.service';
import { composeBatchAnalysis, type BatchAnalysis } from './batch-analysis.types';

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
    const [configs, adStatus, brands] = await Promise.all([
      this.configs.load(),
      this.ad.getAdActiveInWindow(channelId, windowStart, windowEnd),
      this.brandsRepo.listByChannel(channelId),
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
      adActive: adStatus.active,
      adSource: adStatus.source,
      emoteDictionary: this.emoteDictionary,
    });

    // 6. brands
    const brandHits = detectBrands(kept, brands);

    // 7. tier-2 (mock/real/fallback)
    // Downgrade dinâmico: se o classifier real lançar (sem créditos, 429,
    // rede, JSON inválido) caímos NA HORA na heurística — assim o batch é
    // sempre escrito (degradado), nunca perdido. O circuit breaker interno
    // do real ainda abre após N falhas e passa a curto-circuitar rápido.
    let tier2: Awaited<ReturnType<LlmClassifier['classify']>>;
    try {
      tier2 = await this.llm.classify({ aggregate: agg, configs, brandHits });
    } catch (err) {
      this.logger.warn(
        `LLM real falhou (canal=${channelId}) — fallback heurístico: ${(err as Error).message}`,
      );
      tier2 = await this.fallbackLlm.classify({ aggregate: agg, configs, brandHits });
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
}
