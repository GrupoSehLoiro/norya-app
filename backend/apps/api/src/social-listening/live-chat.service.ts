/**
 * LiveChatService — feed de chat CRU, mensagem-a-mensagem, em tempo real.
 *
 * Ao contrário do pipeline de batch (orchestrator → batch_messages → poll REST),
 * este serviço repassa cada `RawMessage` assim que ela entra no bus
 * (`chat.message`, publicado pelo worker a cada evento de chat). Nada é
 * persistido aqui — o feed é efêmero. Backfill de reconexão vem do
 * ChatBuffer (Redis, TTL 60s), que o worker já popula.
 *
 * O único enriquecimento é o `sentiment` (dot colorido do feed), computado
 * inline pela heurística tier-1 (função pura, configs com cache 60s). Se a
 * heurística falhar por qualquer motivo, cai em `neutral` — o feed cru nunca
 * pode quebrar por causa da cor.
 *
 * IMPORTANTE: não filtramos mensagens (comando, bot, curtas, etc.). Um feed
 * "igual ao chat da Twitch" mostra TUDO; os `drop_*` da heurística só existem
 * pra decidir o que vai pra análise, não pra esconder do feed.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  EVENT_BUS_TOKEN,
  type EventBus,
  type Unsubscribe,
  classifyHeuristic,
  TwitchEmoteDictionary,
  CHAT_MESSAGE_BUS_CHANNEL,
  type RawMessage,
  type EmoteDictionary,
} from '@sehloro/domain';
import { ChatBufferService, ConfigsLoaderService } from '@sehloro/infra';

/** Espelha `MessageHit` do front (norya-front/src/lib/analytics.ts). */
export interface LiveChatMessage {
  messageId: string;
  username: string;
  text: string;
  isMod: boolean;
  isSubscriber: boolean;
  sentiment: 'positive' | 'negative' | 'neutral';
  receivedAt: string;
}

interface ChatBusPayload {
  channelId: string;
  message: RawMessage;
}

@Injectable()
export class LiveChatService {
  private readonly logger = new Logger(LiveChatService.name);
  private readonly emoteDictionary: EmoteDictionary = new TwitchEmoteDictionary();

  constructor(
    @Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus,
    // Null quando EVENT_BUS_DRIVER != redis (sem buffer). O stream ao vivo
    // ainda funciona (via bus), só perde o backfill de reconexão.
    @Optional()
    @Inject(ChatBufferService)
    private readonly chatBuffer: ChatBufferService | null,
    private readonly configs: ConfigsLoaderService,
  ) {}

  /**
   * Backfill de reconexão: as últimas `n` mensagens do buffer Redis (TTL 60s),
   * em ordem cronológica (antiga → nova) pra o cliente renderizar de cima pra
   * baixo. Vazio quando não há buffer/Redis.
   */
  async recent(channelId: string, n = 80): Promise<LiveChatMessage[]> {
    if (!this.chatBuffer) return [];
    // peek devolve da mais recente pra mais antiga (LPUSH) — inverter.
    const msgs = await this.chatBuffer.peek(channelId, n);
    const chrono = [...msgs].reverse();
    const out: LiveChatMessage[] = [];
    for (const m of chrono) out.push(await this.toLive(m));
    return out;
  }

  /**
   * Assina o bus de chat e chama `cb` para cada mensagem NOVA do canal.
   * Devolve o unsubscribe pra o controller fechar quando o SSE cair.
   */
  async subscribe(channelId: string, cb: (m: LiveChatMessage) => void): Promise<Unsubscribe> {
    return this.bus.subscribe<ChatBusPayload>(CHAT_MESSAGE_BUS_CHANNEL, (payload) => {
      if (!payload || payload.channelId !== channelId) return;
      this.toLive(payload.message)
        .then(cb)
        .catch((err) =>
          this.logger.warn(`toLive falhou no stream ao vivo: ${(err as Error).message}`),
        );
    });
  }

  private async toLive(msg: RawMessage): Promise<LiveChatMessage> {
    let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
    try {
      const configs = await this.configs.load();
      const r = classifyHeuristic({ msg, configs, emoteDictionary: this.emoteDictionary });
      if (r.kind === 'keep' && r.sentimentHint) sentiment = r.sentimentHint;
    } catch {
      // sentiment neutro — a cor do dot nunca derruba o feed
    }
    const received = msg.receivedAt instanceof Date ? msg.receivedAt : new Date(msg.receivedAt);
    return {
      messageId: msg.id,
      username: msg.user.username,
      text: msg.text,
      isMod: msg.user.isMod,
      isSubscriber: msg.user.isSubscriber,
      sentiment,
      receivedAt: (Number.isNaN(received.getTime()) ? new Date() : received).toISOString(),
    };
  }
}
