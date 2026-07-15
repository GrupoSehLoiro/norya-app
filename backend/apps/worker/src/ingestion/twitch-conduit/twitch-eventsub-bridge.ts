/**
 * Worker bridge: traduz notifications EventSub para o event bus + chat buffer.
 *
 * O TwitchEventSubWsClient (CON-03) entrega payloads brutos do EventSub.
 * Esta classe é o ponto onde "WS-de-fora" vira "evento-de-domínio":
 *
 *  - channel.chat.message → RawMessage no chat buffer (RED-01) + publish
 *    no canal `chat.message` do bus (consumer: pipeline IA do M4).
 *  - stream.online        → publish em STREAM_ONLINE_CHANNEL (consumer:
 *    MON-03 na API).
 *  - stream.offline       → publish em STREAM_OFFLINE_CHANNEL (consumer:
 *    MON-03 na API).
 *
 * Revocation: marca a subscription como `revoked` no Mongo via
 * TwitchConduitSubscriptionsService.markRevoked — CON-05 vai relê esses
 * registros para recriar.
 *
 * Mapeamento channel.chat.message → RawMessage: simplificado, sem
 * enriquecimento de emote semantic (isso fica no pipeline downstream, junto
 * com o EmoteDictionary do TwitchMessageMapper). Aqui só normalizamos shape.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  AccessLogService,
  ChatBufferService,
  TwitchConduitSubscriptionsService,
} from '@sehloro/infra';
import {
  CHAT_MESSAGE_BUS_CHANNEL,
  EVENT_BUS_TOKEN,
  EventBus,
  RawMessage,
  RawMessageEmote,
  RawMessageMention,
  STREAM_OFFLINE_CHANNEL,
  STREAM_ONLINE_CHANNEL,
  TwitchStreamOfflinePayload,
  TwitchStreamOnlinePayload,
  TWITCH_CHANNEL_BAN_CHANNEL,
  TWITCH_CHANNEL_MESSAGE_DELETE_CHANNEL,
  TWITCH_CHANNEL_POLL_END_CHANNEL,
  TWITCH_CHANNEL_PREDICTION_END_CHANNEL,
  TwitchChannelBanPayload,
  TwitchChannelMessageDeletePayload,
  TwitchChannelPollEndPayload,
  TwitchChannelPredictionEndPayload,
} from '@sehloro/domain';
import type {
  TwitchEventSubNotification,
  TwitchEventSubRevocation,
} from './twitch-eventsub-ws.client';

interface ChannelLookup {
  /** channelExternalId → channelId interno do Mongo. */
  resolveExternalId(externalId: string): Promise<string | null>;
}

@Injectable()
export class TwitchEventSubBridge {
  private readonly logger = new Logger(TwitchEventSubBridge.name);

  // Cache message_id → texto das mensagens vistas, para enriquecer o
  // `channel.chat.message_delete` (que NÃO carrega o corpo). FIFO simples
  // (Map preserva ordem de inserção); cap evita crescer sem limite.
  private readonly recentBodies = new Map<string, string>();
  private static readonly RECENT_BODIES_CAP = 5000;

  constructor(
    @Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus,
    private readonly chatBuffer: ChatBufferService,
    private readonly subscriptions: TwitchConduitSubscriptionsService,
    private readonly lookup: ChannelLookup,
    // @Inject explícito: `AccessLogService | null` é união → metadata emite
    // `Object` → sem @Inject o access-log do worker fica sempre null (silencioso).
    @Optional()
    @Inject(AccessLogService)
    private readonly accessLog: AccessLogService | null = null,
  ) {}

  async handleNotification(payload: TwitchEventSubNotification): Promise<void> {
    const type = payload.subscription?.type;
    if (!type) return;

    // Observabilidade: loga TODA notification recebida (tipo + broadcaster).
    // Sem isto o handling bem-sucedido é silencioso e não dá pra diagnosticar
    // "o evento chegou?" vs "o downstream falhou?".
    const ev = (payload.event ?? {}) as Record<string, unknown>;
    this.logger.log(
      `EventSub recebido: ${type} (broadcaster=${String(ev['broadcaster_user_id'] ?? '?')})`,
    );

    // Access log consultável (página /logs). chat.message fica de fora —
    // seria um doc por mensagem de chat; o destino analítico dele é o
    // ClickHouse via ChatIngestService.
    if (type !== 'channel.chat.message') {
      this.accessLog?.record({
        service: 'worker',
        method: 'EVENT',
        path: `/eventsub/${type}`,
        statusCode: 200,
        userAgent: `broadcaster=${String(ev['broadcaster_user_login'] ?? ev['broadcaster_user_id'] ?? '?')}`,
        // O payload do evento é o "request" aqui — é o que se quer inspecionar
        // na página /logs (sanitizado/truncado pelo AccessLogService).
        requestBody: payload.event,
      });
    }

    try {
      switch (type) {
        case 'channel.chat.message':
          return await this._handleChatMessage(payload);
        case 'stream.online':
          return await this._handleStreamOnline(payload);
        case 'stream.offline':
          return await this._handleStreamOffline(payload);
        case 'channel.ban':
          return await this._handleChannelBan(payload);
        case 'channel.chat.message_delete':
          return await this._handleMessageDelete(payload);
        case 'channel.poll.end':
          return await this._handlePollEnd(payload);
        case 'channel.prediction.end':
          return await this._handlePredictionEnd(payload);
        default:
          this.logger.warn(`Notification de tipo não tratado: ${type}`);
      }
    } catch (err) {
      this.logger.error(`Falha ao processar notification ${type}`, (err as Error).stack);
    }
  }

  async handleRevocation(payload: TwitchEventSubRevocation): Promise<void> {
    const sub = payload.subscription;
    if (!sub?.id) return;
    this.accessLog?.record({
      service: 'worker',
      method: 'EVENT',
      path: `/eventsub/revocation/${sub.type ?? 'unknown'}`,
      statusCode: 410,
      userAgent: `status=${sub.status ?? 'unknown'}`,
      requestBody: payload.subscription,
    });
    await this.subscriptions.markRevoked(sub.id, sub.status ?? 'unknown');
  }

  // ─── handlers ────────────────────────────────────────────────────────────

  private async _handleChatMessage(payload: TwitchEventSubNotification): Promise<void> {
    const event = payload.event as Record<string, unknown>;
    const broadcasterExternalId = String(event['broadcaster_user_id'] ?? '');
    if (!broadcasterExternalId) {
      this.logger.warn('channel.chat.message sem broadcaster_user_id');
      return;
    }

    const channelId = await this.lookup.resolveExternalId(broadcasterExternalId);
    if (!channelId) {
      this.logger.warn(`Channel local não encontrado para externalId=${broadcasterExternalId}`);
      return;
    }

    const message = toRawMessage(event);
    if (!message) return;

    this._rememberBody(message.id, message.text);
    await this.chatBuffer.push(channelId, message);
    await this.bus.publish(CHAT_MESSAGE_BUS_CHANNEL, { channelId, message });
  }

  private _rememberBody(id: string, text: string): void {
    if (!id) return;
    this.recentBodies.set(id, text);
    if (this.recentBodies.size > TwitchEventSubBridge.RECENT_BODIES_CAP) {
      const oldest = this.recentBodies.keys().next().value;
      if (oldest !== undefined) this.recentBodies.delete(oldest);
    }
  }

  private _recallBody(id: string): string {
    if (!id) return '';
    const body = this.recentBodies.get(id) ?? '';
    this.recentBodies.delete(id);
    return body;
  }

  private async _handleStreamOnline(payload: TwitchEventSubNotification): Promise<void> {
    const event = payload.event as Record<string, unknown>;
    const data: TwitchStreamOnlinePayload = {
      channelExternalId: String(event['broadcaster_user_id'] ?? ''),
      broadcasterUserLogin: String(event['broadcaster_user_login'] ?? ''),
      startedAt: String(event['started_at'] ?? new Date().toISOString()),
      streamType: event['type'] ? String(event['type']) : undefined,
    };
    if (!data.channelExternalId) return;
    await this.bus.publish(STREAM_ONLINE_CHANNEL, data);
  }

  private async _handleStreamOffline(payload: TwitchEventSubNotification): Promise<void> {
    const event = payload.event as Record<string, unknown>;
    const data: TwitchStreamOfflinePayload = {
      channelExternalId: String(event['broadcaster_user_id'] ?? ''),
      broadcasterUserLogin: String(event['broadcaster_user_login'] ?? ''),
      observedAt: new Date().toISOString(),
    };
    if (!data.channelExternalId) return;
    await this.bus.publish(STREAM_OFFLINE_CHANNEL, data);
  }

  // ─── legacy feed (Fase 5: conduit → collections legadas) ──────────────────

  private async _handleChannelBan(payload: TwitchEventSubNotification): Promise<void> {
    const event = payload.event as Record<string, unknown>;
    const channelExternalId = String(event['broadcaster_user_id'] ?? '');
    if (!channelExternalId) return;
    const data: TwitchChannelBanPayload = {
      channelExternalId,
      broadcasterUserLogin: String(event['broadcaster_user_login'] ?? ''),
      userExternalId: String(event['user_id'] ?? ''),
      userLogin: String(event['user_login'] ?? ''),
      moderatorUserLogin: String(event['moderator_user_login'] ?? ''),
      reason: String(event['reason'] ?? ''),
      isPermanent: Boolean(event['is_permanent']),
      bannedAt: String(event['banned_at'] ?? new Date().toISOString()),
      endsAt: event['ends_at'] ? String(event['ends_at']) : null,
    };
    await this.bus.publish(TWITCH_CHANNEL_BAN_CHANNEL, data);
  }

  private async _handleMessageDelete(payload: TwitchEventSubNotification): Promise<void> {
    const event = payload.event as Record<string, unknown>;
    const channelExternalId = String(event['broadcaster_user_id'] ?? '');
    if (!channelExternalId) return;
    const data: TwitchChannelMessageDeletePayload = {
      channelExternalId,
      broadcasterUserLogin: String(event['broadcaster_user_login'] ?? ''),
      targetUserLogin: String(event['target_user_login'] ?? ''),
      messageId: String(event['message_id'] ?? ''),
      // EventSub não manda o corpo no delete — recupera do cache (msg vista antes).
      messageBody:
        String(event['message_body'] ?? '') || this._recallBody(String(event['message_id'] ?? '')),
      observedAt: new Date().toISOString(),
    };
    await this.bus.publish(TWITCH_CHANNEL_MESSAGE_DELETE_CHANNEL, data);
  }

  private async _handlePollEnd(payload: TwitchEventSubNotification): Promise<void> {
    const event = payload.event as Record<string, unknown>;
    const channelExternalId = String(event['broadcaster_user_id'] ?? '');
    if (!channelExternalId) return;
    const choicesRaw = (event['choices'] as Array<Record<string, unknown>>) ?? [];
    const choices = choicesRaw.map((c) => ({
      id: String(c['id'] ?? ''),
      title: String(c['title'] ?? ''),
      votes: Number(c['votes'] ?? 0),
      channelPointsVotes: Number(c['channel_points_votes'] ?? 0),
      bitsVotes: Number(c['bits_votes'] ?? 0),
    }));
    const bitsVoting = (event['bits_voting'] as Record<string, unknown>) ?? {};
    const cpVoting = (event['channel_points_voting'] as Record<string, unknown>) ?? {};
    const data: TwitchChannelPollEndPayload = {
      channelExternalId,
      broadcasterUserLogin: String(event['broadcaster_user_login'] ?? ''),
      pollId: String(event['id'] ?? ''),
      title: String(event['title'] ?? ''),
      startedAt: String(event['started_at'] ?? ''),
      endedAt: String(event['ended_at'] ?? new Date().toISOString()),
      status: String(event['status'] ?? ''),
      choices,
      bitsVotingEnabled: Boolean(bitsVoting['is_enabled']),
      bitsPerVote: Number(bitsVoting['amount_per_vote'] ?? 0),
      channelPointsVotingEnabled: Boolean(cpVoting['is_enabled']),
      channelPointsPerVote: Number(cpVoting['amount_per_vote'] ?? 0),
    };
    await this.bus.publish(TWITCH_CHANNEL_POLL_END_CHANNEL, data);
  }

  private async _handlePredictionEnd(payload: TwitchEventSubNotification): Promise<void> {
    const event = payload.event as Record<string, unknown>;
    const channelExternalId = String(event['broadcaster_user_id'] ?? '');
    if (!channelExternalId) return;
    const outcomesRaw = (event['outcomes'] as Array<Record<string, unknown>>) ?? [];
    const outcomes = outcomesRaw.map((o) => {
      const topPredictorsRaw = (o['top_predictors'] as Array<Record<string, unknown>>) ?? [];
      return {
        id: String(o['id'] ?? ''),
        title: String(o['title'] ?? ''),
        totalChannelPoints: Number(o['channel_points'] ?? 0),
        users: Number(o['users'] ?? 0),
        topPredictors: topPredictorsRaw.map((p) => ({
          userLogin: String(p['user_login'] ?? ''),
          channelPointsUsed: Number(p['channel_points_used'] ?? 0),
        })),
      };
    });
    const data: TwitchChannelPredictionEndPayload = {
      channelExternalId,
      broadcasterUserLogin: String(event['broadcaster_user_login'] ?? ''),
      predictionId: String(event['id'] ?? ''),
      title: String(event['title'] ?? ''),
      winningOutcomeId: event['winning_outcome_id'] ? String(event['winning_outcome_id']) : null,
      createdAt: String(event['started_at'] ?? ''),
      endedAt: String(event['ended_at'] ?? new Date().toISOString()),
      lockedAt: event['locked_at'] ? String(event['locked_at']) : null,
      outcomes,
    };
    await this.bus.publish(TWITCH_CHANNEL_PREDICTION_END_CHANNEL, data);
  }
}

// ─── mapper local ──────────────────────────────────────────────────────────

interface EventSubChatBadge {
  set_id?: string;
  id?: string;
  info?: string;
}

interface EventSubChatFragment {
  type?: 'text' | 'emote' | 'cheermote' | 'mention';
  text?: string;
  emote?: { id?: string };
  mention?: { user_login?: string };
}

interface EventSubChatMessage {
  text?: string;
  fragments?: EventSubChatFragment[];
}

function toRawMessage(event: Record<string, unknown>): RawMessage | null {
  const messageId = event['message_id'] as string | undefined;
  const message = event['message'] as EventSubChatMessage | undefined;
  const text = message?.text ?? '';
  if (!messageId) return null;

  const badges = ((event['badges'] as EventSubChatBadge[]) ?? [])
    .filter((b) => b.set_id)
    .map((b) => `${b.set_id}/${b.id ?? '1'}`);
  const isModerator = badges.some((b) => b.startsWith('moderator/'));
  const isBroadcaster = badges.some((b) => b.startsWith('broadcaster/'));
  const isSubscriber = badges.some((b) => b.startsWith('subscriber/') || b.startsWith('founder/'));

  return {
    id: messageId,
    platform: 'twitch',
    channelExternalId: String(event['broadcaster_user_id'] ?? ''),
    channelName: String(event['broadcaster_user_login'] ?? ''),
    user: {
      externalId: String(event['chatter_user_id'] ?? ''),
      username: String(event['chatter_user_login'] ?? ''),
      displayName: String(event['chatter_user_name'] ?? event['chatter_user_login'] ?? ''),
      isSubscriber,
      isMod: isModerator,
      isBroadcaster,
      badges,
    },
    text,
    emotes: extractEmotes(text, message?.fragments ?? []),
    mentions: extractMentions(message?.fragments ?? []),
    rawPayload: event,
    receivedAt: new Date(),
  };
}

function extractEmotes(text: string, fragments: EventSubChatFragment[]): RawMessageEmote[] {
  const result: RawMessageEmote[] = [];
  let cursor = 0;
  for (const frag of fragments) {
    const fragText = frag.text ?? '';
    if (frag.type === 'emote' && fragText) {
      const start = cursor;
      const end = cursor + fragText.length - 1;
      result.push({ code: fragText, start, end, provider: 'twitch' });
    }
    cursor += fragText.length;
  }
  if (result.length === 0 && fragments.length === 0) {
    // Fallback: nenhuma fragmentação — não há como mapear emotes.
    return [];
  }
  // Sanidade: se o cursor não bateu com o tamanho do texto, ainda devolvemos
  // o que encontramos (melhor que nada).
  void text;
  return result;
}

function extractMentions(fragments: EventSubChatFragment[]): RawMessageMention[] {
  return fragments
    .filter((f) => f.type === 'mention' && f.mention?.user_login)
    .map((f) => ({ username: f.mention!.user_login! }));
}
