/**
 * CON-04 · TwitchWebhookController.
 *
 * Endpoint público (sem JWT) para receber notifications EventSub via webhook
 * — protegido pela HMAC guard.
 *
 * Tipos atendidos:
 *  - webhook_callback_verification → responde 200 com o challenge no body
 *  - notification                  → publica no event bus por tipo de subscription
 *  - revocation                    → loga e marca a subscription como revogada
 *
 * Outros tipos são logados e ignorados — Twitch garante backwards-compat ao
 * adicionar novos tipos de transport_callback.
 *
 * Body é Buffer cru (necessário pra HMAC). Parseamos JSON manualmente após o guard.
 */
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  EVENT_BUS_TOKEN,
  EventBus,
  STREAM_OFFLINE_CHANNEL,
  STREAM_ONLINE_CHANNEL,
  TwitchStreamOfflinePayload,
  TwitchStreamOnlinePayload,
} from '@sehloro/domain';
import { TwitchConduitSubscriptionsService } from '@sehloro/infra';
import { Public } from '../../identity/auth/decorators/public.decorator';
import { TwitchHmacGuard } from './twitch-hmac.guard';

interface WebhookEnvelope {
  subscription: {
    id: string;
    type: string;
    status: string;
    condition?: Record<string, unknown>;
  };
  event?: Record<string, unknown>;
  challenge?: string;
}

@Public()
@Controller('v2/ingestion/twitch')
@UseGuards(TwitchHmacGuard)
export class TwitchWebhookController {
  private readonly logger = new Logger(TwitchWebhookController.name);

  constructor(
    @Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus,
    private readonly subscriptions: TwitchConduitSubscriptionsService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Body() rawBody: Buffer,
    @Headers('twitch-eventsub-message-type') messageType: string,
    @Res() res: Response,
  ): Promise<void> {
    const envelope = parseEnvelope(rawBody);

    switch (messageType) {
      case 'webhook_callback_verification':
        if (!envelope.challenge) {
          res.status(HttpStatus.BAD_REQUEST).send('challenge ausente');
          return;
        }
        res.setHeader('Content-Type', 'text/plain');
        res.status(HttpStatus.OK).send(envelope.challenge);
        return;

      case 'notification':
        await this._dispatchNotification(envelope);
        res.status(HttpStatus.NO_CONTENT).send();
        return;

      case 'revocation':
        await this._dispatchRevocation(envelope);
        res.status(HttpStatus.NO_CONTENT).send();
        return;

      default:
        this.logger.warn(`message_type desconhecido: ${messageType}`);
        res.status(HttpStatus.NO_CONTENT).send();
    }
  }

  // ─── dispatchers ─────────────────────────────────────────────────────────

  private async _dispatchNotification(envelope: WebhookEnvelope): Promise<void> {
    const type = envelope.subscription.type;
    const event = (envelope.event ?? {}) as Record<string, unknown>;

    switch (type) {
      case 'stream.online': {
        const payload: TwitchStreamOnlinePayload = {
          channelExternalId: String(event['broadcaster_user_id'] ?? ''),
          broadcasterUserLogin: String(event['broadcaster_user_login'] ?? ''),
          startedAt: String(event['started_at'] ?? new Date().toISOString()),
          streamType: event['type'] ? String(event['type']) : undefined,
        };
        if (payload.channelExternalId) {
          await this.bus.publish(STREAM_ONLINE_CHANNEL, payload);
        }
        return;
      }
      case 'stream.offline': {
        const payload: TwitchStreamOfflinePayload = {
          channelExternalId: String(event['broadcaster_user_id'] ?? ''),
          broadcasterUserLogin: String(event['broadcaster_user_login'] ?? ''),
          observedAt: new Date().toISOString(),
        };
        if (payload.channelExternalId) {
          await this.bus.publish(STREAM_OFFLINE_CHANNEL, payload);
        }
        return;
      }
      case 'channel.chat.message':
        // No webhook transport ainda não há mapper acoplado — o WS bridge cobre
        // este tipo. Quem quiser ativar via webhook precisa portar o mapper.
        this.logger.log(`[skip] channel.chat.message via webhook ainda não suportado`);
        return;
      default:
        this.logger.warn(`Notification de tipo não tratado: ${type}`);
    }
  }

  private async _dispatchRevocation(envelope: WebhookEnvelope): Promise<void> {
    const id = envelope.subscription?.id;
    const status = envelope.subscription?.status ?? 'unknown';
    if (!id) return;
    await this.subscriptions.markRevoked(id, status);
  }
}

function parseEnvelope(raw: Buffer): WebhookEnvelope {
  try {
    return JSON.parse(raw.toString('utf-8')) as WebhookEnvelope;
  } catch {
    return { subscription: { id: '', type: '', status: '' } };
  }
}
