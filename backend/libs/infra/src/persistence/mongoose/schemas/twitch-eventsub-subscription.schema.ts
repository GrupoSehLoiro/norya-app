/**
 * CON-02 · twitch_eventsub_subscriptions — registro local das subscriptions criadas.
 *
 * A Twitch é a fonte de verdade real (a Helix exporta a lista atual), mas
 * persistir aqui nos dá:
 *  - lookup rápido por channelId em handlers de ciclo de vida (un/subscribe)
 *  - histórico de quando cada subscription foi criada / revogada
 *  - cobertura ao bug ocasional em que a Helix devolve listas paginadas
 *    inconsistentes durante deploys
 *
 * Índice composto único em (channelId, type) garante idempotência —
 * subscribeChannel chamado duas vezes não duplica.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type TwitchEventSubSubscriptionDocument =
  HydratedDocument<TwitchEventSubSubscriptionPersistence>;

export const TwitchEventSubSubscriptionSchemaName = 'TwitchEventSubSubscription';

export type EventSubSubscriptionStatus =
  | 'enabled'
  | 'webhook_callback_verification_pending'
  | 'authorization_revoked'
  | 'user_removed'
  | 'notification_failures_exceeded'
  | 'revoked';

export type EventSubSubscriptionType =
  | 'channel.chat.message'
  | 'stream.online'
  | 'stream.offline'
  // Legacy feed (Fase 5: ligar conduit às collections legadas)
  | 'channel.ban'
  | 'channel.chat.message_delete'
  | 'channel.poll.end'
  | 'channel.prediction.end';

@Schema({
  collection: 'twitch_eventsub_subscriptions',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  versionKey: false,
})
export class TwitchEventSubSubscriptionPersistence {
  declare _id: Types.ObjectId;

  /**
   * Referência para o documento Channel local. Aceita tanto ObjectId
   * (canais legacy/seed) quanto String UUID (canais criados via OAuth flow).
   * Mongoose.Mixed armazena qualquer forma; queries por valor exato funcionam.
   */
  @Prop({ type: SchemaTypes.Mixed, required: true, index: true })
  declare channelId: Types.ObjectId | string;

  /** broadcaster_user_id da Twitch (id externo). */
  @Prop({ type: String, required: true })
  declare channelExternalId: string;

  @Prop({ type: String, required: true })
  declare type: EventSubSubscriptionType;

  /** ID da subscription retornado pelo POST /eventsub/subscriptions. */
  @Prop({ type: String, required: true, unique: true })
  declare subscriptionId: string;

  @Prop({ type: String, required: true })
  declare conduitId: string;

  @Prop({ type: String, required: true, default: 'enabled' })
  declare status: EventSubSubscriptionStatus;

  @Prop({ type: Date })
  declare revokedAt?: Date | null;

  @Prop({ type: Date })
  declare createdAt?: Date;

  @Prop({ type: Date })
  declare updatedAt?: Date;
}

export const TwitchEventSubSubscriptionSchema = SchemaFactory.createForClass(
  TwitchEventSubSubscriptionPersistence,
);

// Uma subscription por (channelId, type) — chamadas repetidas de subscribeChannel
// não devem duplicar.
TwitchEventSubSubscriptionSchema.index({ channelId: 1, type: 1 }, { unique: true });
