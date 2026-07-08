/**
 * Persistence handler para `channel.chat.message_delete` EventSub.
 *
 * Grava cada mensagem deletada na collection legada `messagedeleteds`,
 * mantendo o shape antigo (`channel`, `username`, `deletedMessage`, `timestamp`).
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
  EVENT_BUS_TOKEN,
  EventBus,
  TWITCH_CHANNEL_MESSAGE_DELETE_CHANNEL,
  TwitchChannelMessageDeletePayload,
  Unsubscribe,
} from '@sehloro/domain';
import { MessageDeletedPersistence, MessageDeletedSchemaName } from '@sehloro/infra';

@Injectable()
export class MessageDeleteHandler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MessageDeleteHandler.name);
  private unsubscribers: Unsubscribe[] = [];

  constructor(
    @Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus,
    @InjectModel(MessageDeletedSchemaName)
    private readonly removed: Model<MessageDeletedPersistence>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.unsubscribers.push(
      await this.bus.subscribe<TwitchChannelMessageDeletePayload>(
        TWITCH_CHANNEL_MESSAGE_DELETE_CHANNEL,
        (payload) =>
          this._handle(payload).catch((err: unknown) =>
            this.logger.error(`Falha ao processar ${TWITCH_CHANNEL_MESSAGE_DELETE_CHANNEL}`, err),
          ),
      ),
    );
    this.logger.log(`Subscrito em ${TWITCH_CHANNEL_MESSAGE_DELETE_CHANNEL} → messagedeleteds`);
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

  private async _handle(p: TwitchChannelMessageDeletePayload): Promise<void> {
    await this.removed.create({
      channel: p.broadcasterUserLogin,
      username: p.targetUserLogin,
      deletedMessage: p.messageBody || '',
      timestamp: new Date(p.observedAt),
    });
  }
}
