/**
 * Persistence handler — extrai emojis de cada `chat.message` recebido via
 * conduit e grava na collection legada `emojis`.
 *
 * Estratégia: 1 documento por emote no msg. Para mensagens com vários emotes,
 * inserimos em batch via `insertMany`. Tradeoff: privilegia compat com o
 * shape legado (que esperava 1 row por emoji) em vez de agrupar.
 *
 * O Bot_SocialListening legado fazia o mesmo — `Emoji.create({ ... })` por
 * ocorrência. Aqui mantemos paridade.
 */
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  CHAT_MESSAGE_BUS_CHANNEL,
  EVENT_BUS_TOKEN,
  EventBus,
  RawMessage,
  Unsubscribe,
} from '@sehloro/domain';
import { ChatEmojiPersistence, ChatEmojiSchemaName } from '@sehloro/infra';

interface ChatMessagePayload {
  channelId: string;
  message: RawMessage;
}

@Injectable()
export class ChatEmojiHandler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ChatEmojiHandler.name);
  private unsubscribers: Unsubscribe[] = [];

  constructor(
    @Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus,
    @InjectModel(ChatEmojiSchemaName) private readonly emojis: Model<ChatEmojiPersistence>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.unsubscribers.push(
      await this.bus.subscribe<ChatMessagePayload>(CHAT_MESSAGE_BUS_CHANNEL, (payload) =>
        this._handle(payload).catch((err: unknown) =>
          this.logger.error(`Falha ao processar ${CHAT_MESSAGE_BUS_CHANNEL}`, err),
        ),
      ),
    );
    this.logger.log(`Subscrito em ${CHAT_MESSAGE_BUS_CHANNEL} → emojis (legacy)`);
  }

  async onApplicationShutdown(): Promise<void> {
    for (const unsub of this.unsubscribers) {
      try {
        await unsub();
      } catch {
        // best-effort
      }
    }
    this.unsubscribers = [];
  }

  private async _handle(payload: ChatMessagePayload): Promise<void> {
    const { message } = payload;
    if (!message.emotes || message.emotes.length === 0) return;

    const timestamp =
      message.receivedAt instanceof Date ? message.receivedAt : new Date(message.receivedAt);

    const docs = message.emotes.map((e) => ({
      channel: message.channelName,
      username: message.user?.username ?? '',
      message: message.text,
      emoji: e.code,
      timestamp,
    }));
    await this.emojis.insertMany(docs);
  }
}
