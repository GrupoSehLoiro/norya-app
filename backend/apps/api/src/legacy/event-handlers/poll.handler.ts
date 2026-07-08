/**
 * Persistence handler para `channel.poll.end` EventSub.
 *
 * Grava na collection `polls` preservando shape legado (`pollId`, `channel`,
 * `title`, `choices[]` com `channel_points_votes`/`bits_votes`).
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
  TWITCH_CHANNEL_POLL_END_CHANNEL,
  TwitchChannelPollEndPayload,
  Unsubscribe,
} from '@sehloro/domain';
import { PollPersistence, PollSchemaName } from '@sehloro/infra';

@Injectable()
export class PollHandler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PollHandler.name);
  private unsubscribers: Unsubscribe[] = [];

  constructor(
    @Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus,
    @InjectModel(PollSchemaName) private readonly polls: Model<PollPersistence>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.unsubscribers.push(
      await this.bus.subscribe<TwitchChannelPollEndPayload>(
        TWITCH_CHANNEL_POLL_END_CHANNEL,
        (payload) =>
          this._handle(payload).catch((err: unknown) =>
            this.logger.error(`Falha ao processar ${TWITCH_CHANNEL_POLL_END_CHANNEL}`, err),
          ),
      ),
    );
    this.logger.log(`Subscrito em ${TWITCH_CHANNEL_POLL_END_CHANNEL} → polls`);
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

  private async _handle(p: TwitchChannelPollEndPayload): Promise<void> {
    const startedAt = p.startedAt ? new Date(p.startedAt) : undefined;
    const endedAt = new Date(p.endedAt);
    const duration = startedAt
      ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
      : undefined;

    await this.polls.create({
      pollId: p.pollId,
      channel: p.broadcasterUserLogin,
      title: p.title,
      created_at: startedAt,
      ended_at: endedAt,
      duration,
      choices: p.choices.map((c) => ({
        id: c.id,
        title: c.title,
        votes: c.votes,
        channel_points_votes: c.channelPointsVotes,
        bits_votes: c.bitsVotes,
      })),
      bits_voting_enabled: p.bitsVotingEnabled,
      bits_per_vote: p.bitsPerVote,
      channel_points_voting_enabled: p.channelPointsVotingEnabled,
      channel_points_per_vote: p.channelPointsPerVote,
    });
  }
}
