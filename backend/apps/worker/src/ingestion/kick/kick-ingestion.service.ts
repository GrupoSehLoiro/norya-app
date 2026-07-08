/**
 * KickIngestionService — lê o chat dos canais Kick logados e alimenta o
 * mesmo pipeline de IA que o Twitch.
 *
 * Kick não tem EventSub/Conduit: o chat chega por Pusher Channels. Este
 * serviço é o análogo do TwitchEventSubBridge para Kick — a peça que faz
 * "WS-de-fora" virar "RawMessage no buffer":
 *
 *   KickPusherProvider.onMessage(raw)
 *     → ChatBufferService.push(channelId, raw)         (RED-01, drenado pelo
 *        SocialListeningOrchestrator na API → batch_analysis no ClickHouse)
 *     → EventBus.publish('chat.message', { channelId, message })  (consumers:
 *        legacy emoji handler etc.)
 *
 * Descoberta: a cada `KICK_RECONCILE_MS` (default 15s) lista os canais
 * `platform='kick'` ACTIVE com externalId (criados via /api/v2/channels +
 * OAuth) e mantém um provider conectado por canal — start nos novos, stop
 * nos que sumiram. Mesma semântica de discovery do orchestrator
 * (findAllActive + externalId).
 *
 * chatroomId: resolvido via KickRestClient.getChannel(slug) (campo
 * chatroom.id). Sem chatroomId não dá para assinar `chatrooms.{id}.v2`.
 *
 * Auth: assina a chatroom pública (sem token). Chat de Kick é legível
 * publicamente — o OAuth do canal habilita features privadas (futuro:
 * passar KickOAuthService como tokenService + apiBaseUrl do auth endpoint).
 */
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatBufferService, KickRestClient } from '@sehloro/infra';
import {
  CHANNEL_REPOSITORY,
  CHAT_MESSAGE_BUS_CHANNEL,
  EVENT_BUS_TOKEN,
  type Channel,
  type ChannelRepository,
  type ChatProvider,
  type EventBus,
  type LifecycleEvent,
  type RawMessage,
} from '@sehloro/domain';
import { KICK_PROVIDER_CREATOR, type KickProviderCreator } from './kick-ingestion.tokens';

const DEFAULT_RECONCILE_MS = 15_000;

interface RunningProvider {
  provider: ChatProvider;
  unsubMessage: () => void;
  unsubLifecycle: () => void;
}

@Injectable()
export class KickIngestionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(KickIngestionService.name);
  private readonly running = new Map<string, RunningProvider>();
  private timer: NodeJS.Timeout | null = null;
  private reconciling = false;
  private readonly reconcileMs: number;

  constructor(
    @Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus,
    private readonly chatBuffer: ChatBufferService,
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    private readonly rest: KickRestClient,
    @Inject(KICK_PROVIDER_CREATOR) private readonly createProvider: KickProviderCreator,
    config: ConfigService,
  ) {
    this.reconcileMs = Number(config.get('KICK_RECONCILE_MS') ?? DEFAULT_RECONCILE_MS);
  }

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log(`KickIngestion iniciando — reconcile=${this.reconcileMs}ms`);
    await this.reconcile().catch((err) =>
      this.logger.error('reconcile inicial falhou', (err as Error).stack),
    );
    this.timer = setInterval(() => {
      this.reconcile().catch((err) => this.logger.error('reconcile falhou', (err as Error).stack));
    }, this.reconcileMs);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const ids = [...this.running.keys()];
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  /**
   * Sincroniza providers em execução com os canais Kick ativos. Idempotente:
   * starta os novos, para os que saíram. Protegido contra reentrância (um
   * tick lento não dispara o próximo em cima).
   */
  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const page = await this.channels.findMany({
        platform: 'kick',
        active: true,
        pageSize: 500,
      });
      const wanted = page.channels.filter((c) => Boolean(c.getExternalId()));
      const wantedIds = new Set(wanted.map((c) => c.getId()));

      for (const channel of wanted) {
        if (!this.running.has(channel.getId())) {
          await this.start(channel).catch((err) =>
            this.logger.error(`start canal=${channel.getName()} falhou: ${(err as Error).message}`),
          );
        }
      }

      for (const id of [...this.running.keys()]) {
        if (!wantedIds.has(id)) {
          await this.stop(id);
        }
      }
    } finally {
      this.reconciling = false;
    }
  }

  private async start(channel: Channel): Promise<void> {
    const slug = channel.getName();
    const info = await this.rest.getChannel(slug).catch(() => null);
    if (!info?.chatroomId) {
      this.logger.warn(`chatroomId não resolvido para Kick "${slug}" — pulando`);
      return;
    }

    const channelId = channel.getId();
    const provider = this.createProvider(channel, String(info.chatroomId));

    const unsubMessage = provider.onMessage((msg: RawMessage) => {
      void this.chatBuffer
        .push(channelId, msg)
        .catch((err) =>
          this.logger.warn(`buffer.push falhou canal=${channelId}: ${(err as Error).message}`),
        );
      void this.bus
        .publish(CHAT_MESSAGE_BUS_CHANNEL, { channelId, message: msg })
        .catch(() => undefined);
    });

    const unsubLifecycle = provider.onLifecycle((evt: LifecycleEvent) => {
      this.logger.debug?.(
        `canal=${slug} lifecycle=${evt.type}${evt.reason ? ` (${evt.reason})` : ''}`,
      );
    });

    await provider.connect();
    this.running.set(channelId, { provider, unsubMessage, unsubLifecycle });
    this.logger.log(`Kick conectado: ${slug} (chatroom ${info.chatroomId})`);
  }

  private async stop(channelId: string): Promise<void> {
    const entry = this.running.get(channelId);
    if (!entry) return;
    this.running.delete(channelId);
    entry.unsubMessage();
    entry.unsubLifecycle();
    await entry.provider
      .disconnect()
      .catch((err) =>
        this.logger.warn(`disconnect falhou canal=${channelId}: ${(err as Error).message}`),
      );
    this.logger.log(`Kick desconectado: canal=${channelId}`);
  }

  /** Exposto para testes/healthcheck — canais com provider ativo. */
  activeChannelIds(): string[] {
    return [...this.running.keys()];
  }
}
