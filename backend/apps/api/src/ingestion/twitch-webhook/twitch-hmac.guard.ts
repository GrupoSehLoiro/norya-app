/**
 * CON-04 · TwitchHmacGuard.
 *
 * Valida 3 propriedades de cada webhook EventSub recebido:
 *  1. Assinatura HMAC-SHA256 do payload bruto (body) com o
 *     `TWITCH_WEBHOOK_SECRET`. Header `Twitch-Eventsub-Message-Signature`
 *     no formato 'sha256=...'. Comparação em timingSafeEqual.
 *  2. Timestamp dentro de 10 minutos do agora — protege contra replay
 *     mesmo se um terceiro capturou a request inteira.
 *  3. message_id único nos últimos 15 minutos via NonceStore — protege
 *     contra reprocessamento da mesma mensagem (Twitch reenvia em
 *     timeouts ou ack atrasado).
 *
 * Body precisa estar como Buffer cru no request — o main.ts liga `rawBody:true`
 * para o handler de webhook, e os controllers usam `@Body() raw: Buffer`.
 *
 * Falhas:
 *  - assinatura inválida   → 403
 *  - timestamp antigo      → 403
 *  - nonce já visto        → 409
 *  - falta header / secret → 400
 */
import {
  BadRequestException,
  CanActivate,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { NONCE_STORE_TOKEN, NonceStore } from './nonce-store';
import { Inject } from '@nestjs/common';

export const MAX_TIMESTAMP_SKEW_MS = 10 * 60 * 1000;
export const NONCE_TTL_SECONDS = 15 * 60;

interface TwitchWebhookHeaders {
  'twitch-eventsub-message-id'?: string;
  'twitch-eventsub-message-signature'?: string;
  'twitch-eventsub-message-timestamp'?: string;
}

interface RawBodiedRequest {
  headers: TwitchWebhookHeaders;
  rawBody?: Buffer;
}

@Injectable()
export class TwitchHmacGuard implements CanActivate {
  private readonly logger = new Logger(TwitchHmacGuard.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(NONCE_STORE_TOKEN) private readonly nonceStore: NonceStore,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const secret = this.config.get<string>('TWITCH_WEBHOOK_SECRET');
    if (!secret) {
      throw new BadRequestException('TWITCH_WEBHOOK_SECRET não configurado');
    }

    const req = ctx.switchToHttp().getRequest<RawBodiedRequest>();
    const headers = req.headers ?? {};
    const messageId = headers['twitch-eventsub-message-id'];
    const signature = headers['twitch-eventsub-message-signature'];
    const timestamp = headers['twitch-eventsub-message-timestamp'];
    const rawBody = req.rawBody;

    if (!messageId || !signature || !timestamp) {
      throw new BadRequestException('Headers Twitch-Eventsub-* obrigatórios ausentes');
    }
    if (!rawBody) {
      throw new BadRequestException('Body cru ausente — webhook precisa de rawBody=true');
    }

    this._assertTimestamp(timestamp);
    this._assertSignature(secret, messageId, timestamp, rawBody, signature);
    await this._assertUniqueNonce(messageId);

    return true;
  }

  // ─── pieces ──────────────────────────────────────────────────────────────

  private _assertTimestamp(timestamp: string): void {
    const ts = Date.parse(timestamp);
    if (Number.isNaN(ts)) {
      throw new ForbiddenException('Timestamp inválido');
    }
    const skew = Math.abs(Date.now() - ts);
    if (skew > MAX_TIMESTAMP_SKEW_MS) {
      this.logger.warn(`Timestamp fora da janela (${skew}ms de skew)`);
      throw new ForbiddenException('Timestamp fora da janela aceita');
    }
  }

  private _assertSignature(
    secret: string,
    messageId: string,
    timestamp: string,
    body: Buffer,
    signature: string,
  ): void {
    const prefix = 'sha256=';
    if (!signature.startsWith(prefix)) {
      throw new ForbiddenException('Assinatura sem prefixo sha256=');
    }
    const received = signature.slice(prefix.length);

    const message = Buffer.concat([
      Buffer.from(messageId, 'utf8'),
      Buffer.from(timestamp, 'utf8'),
      body,
    ]);
    const expected = createHmac('sha256', secret).update(message).digest('hex');

    if (expected.length !== received.length) {
      throw new ForbiddenException('Assinatura inválida');
    }
    const ok = timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'));
    if (!ok) {
      throw new ForbiddenException('Assinatura inválida');
    }
  }

  private async _assertUniqueNonce(messageId: string): Promise<void> {
    const fresh = await this.nonceStore.setIfAbsent(messageId, NONCE_TTL_SECONDS);
    if (!fresh) {
      this.logger.warn(`message_id ${messageId} já visto — possível replay`);
      throw new ConflictException('message_id duplicado');
    }
  }
}
