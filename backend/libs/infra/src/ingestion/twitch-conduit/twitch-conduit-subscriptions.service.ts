/**
 * CON-02 · TwitchConduitSubscriptionsService.
 *
 * Quando um Channel novo entra ativo, criamos três subscriptions ligadas ao
 * conduit corrente — uma para receber mensagens (channel.chat.message) e
 * duas para o ciclo de vida da live (stream.online / stream.offline).
 *
 * Por que estas três: o pipeline de IA precisa de mensagens; o
 * MonitoringService (MON-03) precisa abrir/fechar LiveSession automaticamente
 * em resposta a online/offline. Demais tipos (channel.update, ban, etc) ficam
 * para milestones posteriores se virarem requisito.
 *
 * Idempotência:
 *  - subscribeChannel checa o registro local antes de POSTar.
 *  - Em 409 'subscription already exists' ainda persiste o registro local
 *    (releu via listActiveByChannel para descobrir o subscriptionId).
 *  - unsubscribeChannel é no-op quando não há registro.
 */
import axios, { AxiosError, AxiosInstance } from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import { Types, type Model } from 'mongoose';
import { TwitchHelixService } from '../twitch-irc/twitch-helix.service';
import {
  EventSubSubscriptionType,
  TwitchEventSubSubscriptionPersistence,
} from '../../persistence/mongoose/schemas/twitch-eventsub-subscription.schema';

const HELIX_BASE = 'https://api.twitch.tv/helix';

const SUBSCRIPTION_TYPES_VERSION: Record<EventSubSubscriptionType, string> = {
  'channel.chat.message': '1',
  'stream.online': '1',
  'stream.offline': '1',
  // Legacy feed
  'channel.ban': '1',
  'channel.chat.message_delete': '1',
  'channel.poll.end': '1',
  'channel.prediction.end': '1',
};

export interface SubscribeChannelArgs {
  channelId: Types.ObjectId | string;
  channelExternalId: string;
  conduitId: string;
  /**
   * user_id do bot que vai ler o chat (`channel.chat.message` exige).
   * Quando vazio/null, pulamos só essa subscription — `stream.online`
   * e `stream.offline` continuam sendo criadas (usam só app token, sem
   * scope de usuário). Útil pra setups que ainda não provisionaram a
   * conta-bot mas querem que o banner on/off automático funcione.
   */
  botUserId?: string | null;
}

interface HelixSubscriptionResponse {
  data: Array<{
    id: string;
    status: string;
    type: string;
    version: string;
  }>;
}

@Injectable()
export class TwitchConduitSubscriptionsService {
  private readonly logger = new Logger(TwitchConduitSubscriptionsService.name);
  private readonly http: AxiosInstance;

  constructor(
    private readonly helix: TwitchHelixService,
    private readonly clientId: string,
    private readonly model: Model<TwitchEventSubSubscriptionPersistence>,
  ) {
    this.http = axios.create({ baseURL: HELIX_BASE, timeout: 10_000 });
  }

  /**
   * Cria as três subscriptions para o canal. Retorna a lista persistida.
   * Idempotente — chamadas repetidas devolvem o estado atual sem duplicar.
   */
  async subscribeChannel(
    args: SubscribeChannelArgs,
  ): Promise<TwitchEventSubSubscriptionPersistence[]> {
    const channelObjectId = this._toObjectId(args.channelId);
    // stream.online/offline + bans/polls/predictions: usam só app token —
    // sempre subscrevíveis (broadcaster concede via OAuth do canal).
    // channel.chat.message + channel.chat.message_delete: exigem `user_id` do
    // bot moderador → só inclui quando botUserId está disponível.
    const types: EventSubSubscriptionType[] = [
      'stream.online',
      'stream.offline',
      'channel.ban',
      'channel.poll.end',
      'channel.prediction.end',
    ];
    if (args.botUserId) {
      types.unshift('channel.chat.message', 'channel.chat.message_delete');
    } else {
      this.logger.warn(
        `subscribeChannel(${args.channelExternalId}): botUserId vazio — ` +
          `pulando channel.chat.message + channel.chat.message_delete ` +
          `(chat virá só via IRC fallback).`,
      );
    }

    const existing = await this.model.find({ channelId: channelObjectId }).lean();
    const existingByType = new Map(existing.map((s) => [s.type, s]));

    const result: TwitchEventSubSubscriptionPersistence[] = [];

    for (const type of types) {
      const known = existingByType.get(type);
      if (known && known.status === 'enabled') {
        result.push(known);
        continue;
      }

      const subscriptionId = await this._createRemoteSubscription({
        type,
        args,
      });
      if (!subscriptionId) {
        // 409 caiu aqui mas não encontramos id — pula com warn.
        continue;
      }

      const upserted = await this.model.findOneAndUpdate(
        { channelId: channelObjectId, type },
        {
          $set: {
            channelId: channelObjectId,
            channelExternalId: args.channelExternalId,
            type,
            subscriptionId,
            conduitId: args.conduitId,
            status: 'enabled',
            revokedAt: null,
          },
        },
        { upsert: true, new: true, lean: true },
      );

      result.push(upserted as unknown as TwitchEventSubSubscriptionPersistence);
    }

    return result;
  }

  /**
   * Remove as subscriptions do canal: DELETE no Helix por cada subscriptionId
   * conhecido + remove docs locais. Tolerante a 404 (já sumiu).
   */
  async unsubscribeChannel(channelId: Types.ObjectId | string): Promise<void> {
    const channelObjectId = this._toObjectId(channelId);
    const docs = await this.model.find({ channelId: channelObjectId }).lean();
    if (docs.length === 0) return;

    for (const doc of docs) {
      await this._deleteRemoteSubscription(doc.subscriptionId);
    }
    await this.model.deleteMany({ channelId: channelObjectId });
  }

  /** Subscriptions persistidas localmente — útil para painel admin. */
  async listActive(): Promise<TwitchEventSubSubscriptionPersistence[]> {
    return this.model.find({ status: 'enabled' }).lean() as Promise<
      TwitchEventSubSubscriptionPersistence[]
    >;
  }

  async listActiveByChannel(
    channelId: Types.ObjectId | string,
  ): Promise<TwitchEventSubSubscriptionPersistence[]> {
    const channelObjectId = this._toObjectId(channelId);
    return this.model.find({ channelId: channelObjectId, status: 'enabled' }).lean() as Promise<
      TwitchEventSubSubscriptionPersistence[]
    >;
  }

  /**
   * Marca uma subscription como revogada — chamado pelo handler de revocation
   * (do EventSub WS) ou pelo renewer (CON-05) ao detectar status != enabled.
   */
  async markRevoked(subscriptionId: string, reason: string): Promise<void> {
    await this.model.updateOne(
      { subscriptionId },
      {
        $set: {
          status: 'revoked',
          revokedAt: new Date(),
        },
      },
    );
    this.logger.warn(`Subscription ${subscriptionId} revogada: ${reason}`);
  }

  // ─── helpers privados ────────────────────────────────────────────────────

  private async _createRemoteSubscription(input: {
    type: EventSubSubscriptionType;
    args: SubscribeChannelArgs;
  }): Promise<string | null> {
    const token = await this.helix.getAppAccessToken();
    const condition = this._conditionFor(input.type, input.args);

    try {
      const resp = await this.http.post<HelixSubscriptionResponse>(
        '/eventsub/subscriptions',
        {
          type: input.type,
          version: SUBSCRIPTION_TYPES_VERSION[input.type],
          condition,
          transport: { method: 'conduit', conduit_id: input.args.conduitId },
        },
        {
          headers: {
            'Client-Id': this.clientId,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      const created = resp.data?.data?.[0];
      return created?.id ?? null;
    } catch (err) {
      const ax = err as AxiosError;
      if (ax.response?.status === 409) {
        // Já existe lá no Helix — tenta descobrir o id via list.
        const remote = await this._findRemoteSubscription(input.type, input.args.channelExternalId);
        if (remote) return remote;
        this.logger.warn(
          `Subscription ${input.type} para ${input.args.channelExternalId} retornou 409 mas não foi achada no list`,
        );
        return null;
      }
      throw err;
    }
  }

  private async _deleteRemoteSubscription(subscriptionId: string): Promise<void> {
    const token = await this.helix.getAppAccessToken();
    try {
      await this.http.delete('/eventsub/subscriptions', {
        params: { id: subscriptionId },
        headers: {
          'Client-Id': this.clientId,
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (err) {
      const ax = err as AxiosError;
      if (ax.response?.status !== 404) throw err;
      // 404 = já não existe no Helix; segue.
    }
  }

  private async _findRemoteSubscription(
    type: EventSubSubscriptionType,
    broadcasterUserId: string,
  ): Promise<string | null> {
    const token = await this.helix.getAppAccessToken();
    const resp = await this.http.get<HelixSubscriptionResponse>('/eventsub/subscriptions', {
      params: { type, user_id: broadcasterUserId },
      headers: {
        'Client-Id': this.clientId,
        Authorization: `Bearer ${token}`,
      },
    });
    const match = resp.data?.data?.find((s) => s.type === type);
    return match?.id ?? null;
  }

  private _conditionFor(
    type: EventSubSubscriptionType,
    args: SubscribeChannelArgs,
  ): Record<string, string> {
    switch (type) {
      case 'channel.chat.message':
        if (!args.botUserId) {
          // Defesa em profundidade: subscribeChannel já filtra esse tipo
          // quando botUserId está vazio; nunca deveria cair aqui.
          throw new Error('channel.chat.message exige botUserId em SubscribeChannelArgs');
        }
        return { broadcaster_user_id: args.channelExternalId, user_id: args.botUserId };
      case 'channel.chat.message_delete':
        if (!args.botUserId) {
          throw new Error('channel.chat.message_delete exige botUserId em SubscribeChannelArgs');
        }
        return { broadcaster_user_id: args.channelExternalId, user_id: args.botUserId };
      case 'stream.online':
      case 'stream.offline':
      case 'channel.ban':
      case 'channel.poll.end':
      case 'channel.prediction.end':
        return { broadcaster_user_id: args.channelExternalId };
    }
  }

  /**
   * Aceita 3 formatos de channelId:
   *  - ObjectId (canais legacy do seed M2)
   *  - String hex 24 chars (ObjectId serializado)
   *  - String UUID (canais criados via OAuth flow no v2)
   *
   * Quando é UUID, retorna a string como-está — o schema agora tem
   * `channelId: Mixed`, então query/insert funciona com qualquer um.
   */
  private _toObjectId(id: Types.ObjectId | string): Types.ObjectId | string {
    if (typeof id !== 'string') return id;
    // Tenta ObjectId; se não bater no formato 24-hex, mantém como string UUID.
    if (/^[0-9a-fA-F]{24}$/.test(id)) {
      return new Types.ObjectId(id);
    }
    return id;
  }
}
