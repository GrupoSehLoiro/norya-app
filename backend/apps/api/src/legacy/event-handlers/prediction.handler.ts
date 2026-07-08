/**
 * Persistence handler para `channel.prediction.end` EventSub.
 *
 * Grava na collection `predictions` mapeando outcomes EventSub para o shape
 * legado (`options[].totalBetAmount`, `topBetters[]`).
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
  TWITCH_CHANNEL_PREDICTION_END_CHANNEL,
  TwitchChannelPredictionEndPayload,
  Unsubscribe,
} from '@sehloro/domain';
import { PredictionPersistence, PredictionSchemaName } from '@sehloro/infra';

@Injectable()
export class PredictionHandler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PredictionHandler.name);
  private unsubscribers: Unsubscribe[] = [];

  constructor(
    @Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus,
    @InjectModel(PredictionSchemaName) private readonly predictions: Model<PredictionPersistence>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.unsubscribers.push(
      await this.bus.subscribe<TwitchChannelPredictionEndPayload>(
        TWITCH_CHANNEL_PREDICTION_END_CHANNEL,
        (payload) =>
          this._handle(payload).catch((err: unknown) =>
            this.logger.error(`Falha ao processar ${TWITCH_CHANNEL_PREDICTION_END_CHANNEL}`, err),
          ),
      ),
    );
    this.logger.log(`Subscrito em ${TWITCH_CHANNEL_PREDICTION_END_CHANNEL} → predictions`);
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

  private async _handle(p: TwitchChannelPredictionEndPayload): Promise<void> {
    await this.predictions.create({
      predictionId: p.predictionId,
      channel: p.broadcasterUserLogin,
      title: p.title,
      winningOutcome: p.winningOutcomeId,
      created_at: p.createdAt ? new Date(p.createdAt) : undefined,
      ended_at: new Date(p.endedAt),
      locked_at: p.lockedAt ? new Date(p.lockedAt) : undefined,
      options: p.outcomes.map((o) => ({
        id: o.id,
        title: o.title,
        totalBetAmount: o.totalChannelPoints,
        users: o.users,
        topBetters: o.topPredictors.map((tp) => ({
          userName: tp.userLogin,
          amount: tp.channelPointsUsed,
        })),
      })),
    });
  }
}
