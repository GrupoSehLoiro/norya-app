/**
 * ChatIngestService (CH-03 / PIPE-01) — persiste cada msg de chat no
 * ClickHouse `chat_messages`, decorada com a heurística tier-1.
 *
 * Assina o canal `chat.message` do EventBus — o mesmo que o
 * TwitchEventSubBridge e o KickIngestionService publicam — então cobre as
 * duas plataformas sem acoplar no provider. Mensagens dropadas pelo tier-1
 * (comando, bot, curta demais...) TAMBÉM são persistidas (a tabela é
 * append-only de todas as msgs); apenas ficam sem sentiment/category hint.
 *
 * Batching: acumula em memória e flusha a cada FLUSH_INTERVAL_MS ou quando
 * o buffer atinge MAX_PENDING — o que vier primeiro. O insert já usa
 * async_insert do ClickHouse (ver ClickHouseClient), então o custo por
 * flush é um único POST. Perda aceitável: um crash do worker perde no
 * máximo um flush-window de mensagens analíticas (fonte de verdade do
 * texto por batch é o Mongo batch_messages, escrito pelo orchestrator).
 *
 * Sem ClickHouse configurado (CLICKHOUSE_URL ausente) o serviço loga um
 * warn e fica inerte — o worker continua servindo o conduit normalmente.
 */
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import {
  CHAT_MESSAGE_BUS_CHANNEL,
  classifyHeuristic,
  EVENT_BUS_TOKEN,
  type EventBus,
  type RawMessage,
  type Unsubscribe,
} from '@sehloro/domain';
import { ClickHouseClient, ConfigsLoaderService } from '@sehloro/infra';

export const CHAT_INGEST_FLUSH_INTERVAL_MS = 5_000;
export const CHAT_INGEST_MAX_PENDING = 500;

export interface ChatMessageBusPayload {
  channelId: string;
  message: RawMessage;
}

interface ChatMessageRow extends Record<string, unknown> {
  channel_id: string;
  platform: string;
  message_id: string;
  username: string;
  is_subscriber: 0 | 1;
  is_mod: 0 | 1;
  text: string;
  emotes: string[];
  sentiment_heuristic: string;
  category_heuristic: string;
  session_id: null;
  received_at: string;
}

@Injectable()
export class ChatIngestService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ChatIngestService.name);
  private readonly pending: ChatMessageRow[] = [];
  private unsubscribe: Unsubscribe | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private droppedRows = 0;

  constructor(
    @Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus,
    private readonly configsLoader: ConfigsLoaderService,
    // @Inject explícito: o tipo `ClickHouseClient | null` é união e o
    // emitDecoratorMetadata do TS emite `Object` como token → sem @Inject o
    // Nest não resolve e @Optional injeta null (chat ingest morto). Ver o
    // mesmo padrão em orchestrator.chatBuffer e bridge.accessLog.
    @Optional()
    @Inject(ClickHouseClient)
    private readonly clickhouse: ClickHouseClient | null,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.clickhouse) {
      this.logger.warn(
        'ClickHouse não configurado (CLICKHOUSE_URL ausente) — chat ingest desativado',
      );
      return;
    }
    this.unsubscribe = await this.bus.subscribe<ChatMessageBusPayload>(
      CHAT_MESSAGE_BUS_CHANNEL,
      (payload) => {
        void this._handle(payload).catch((err: Error) => {
          this.logger.error(`Falha ao enfileirar chat_message: ${err.message}`);
        });
      },
    );
    this.timer = setInterval(() => {
      void this.flushNow();
    }, CHAT_INGEST_FLUSH_INTERVAL_MS);
    // Não segura o event loop vivo só pelo flush — shutdown limpo.
    this.timer.unref?.();
    this.logger.log(
      `Chat ingest ativo — flush a cada ${CHAT_INGEST_FLUSH_INTERVAL_MS}ms ou ${CHAT_INGEST_MAX_PENDING} msgs`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
    await this.flushNow();
  }

  /** Drena o buffer para o ClickHouse. Público para specs e shutdown. */
  async flushNow(): Promise<void> {
    if (!this.clickhouse || this.pending.length === 0) return;
    const rows = this.pending.splice(0, this.pending.length);
    try {
      await this.clickhouse.insert('chat_messages', rows);
    } catch (err) {
      // Não re-enfileira: melhor perder um flush analítico que crescer
      // sem limite quando o ClickHouse está fora. Conta para diagnóstico.
      this.droppedRows += rows.length;
      this.logger.error(
        `Falha no insert de ${rows.length} chat_messages (total perdido=${this.droppedRows}): ${(err as Error).message}`,
      );
    }
  }

  private async _handle(payload: ChatMessageBusPayload): Promise<void> {
    if (!payload?.channelId || !payload.message?.id) return;
    const msg = _reviveDates(payload.message);

    let sentiment = '';
    let category = '';
    try {
      const configs = await this.configsLoader.load();
      const result = classifyHeuristic({ msg, configs });
      if (result.kind === 'keep') {
        sentiment = result.sentimentHint ?? '';
        category = result.categoryHint ?? '';
      }
    } catch (err) {
      // Heurística é decoração — nunca bloqueia a persistência da msg.
      this.logger.warn(`classifyHeuristic falhou: ${(err as Error).message}`);
    }

    this.pending.push({
      channel_id: payload.channelId,
      platform: msg.platform,
      message_id: msg.id,
      username: msg.user?.username ?? '',
      is_subscriber: msg.user?.isSubscriber ? 1 : 0,
      is_mod: msg.user?.isMod ? 1 : 0,
      text: msg.text ?? '',
      emotes: (msg.emotes ?? []).map((e) => e.code),
      sentiment_heuristic: sentiment,
      category_heuristic: category,
      session_id: null,
      received_at: _dt(msg.receivedAt),
    });

    if (this.pending.length >= CHAT_INGEST_MAX_PENDING) {
      await this.flushNow();
    }
  }
}

/**
 * O payload atravessa o bus como JSON (RedisEventBus) — Date vira string.
 * Reidrata `receivedAt` para os consumidores tipados.
 */
function _reviveDates(message: RawMessage): RawMessage {
  const receivedAt =
    message.receivedAt instanceof Date ? message.receivedAt : new Date(message.receivedAt);
  return { ...message, receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt };
}

/** ClickHouse DateTime64(3) aceita 'YYYY-MM-DD HH:mm:ss.SSS'. */
function _dt(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '');
}
