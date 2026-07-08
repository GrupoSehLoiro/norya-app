/**
 * TwitchOAuthController — fluxo OAuth do streamer (M4 + extensão UX).
 *
 * Rotas (prefixo global `/api`):
 *   GET    /api/v2/auth/twitch/start              → redirect p/ id.twitch.tv
 *   GET    /api/v2/auth/twitch/callback           → exchange code, cria channel, persiste token
 *   GET    /api/v2/auth/twitch/integrations       → lista integrações DO usuário logado
 *   DELETE /api/v2/auth/twitch/integrations/:id   → revoga (apaga token + desativa channel)
 *
 * Por que o `start` aceita JWT via query `?token=`:
 *   Browsers não enviam headers customizados em navegação top-level (link/click),
 *   então o frontend coloca o JWT na URL. O controller valida com o mesmo
 *   `JwtService` da identity, extrai o `userId` e cifra-o dentro do `state` HMAC.
 *
 * Tokens nunca aparecem em URL, log ou response — só o `state` opaco.
 */
import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Logger,
  Param,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import {
  CHANNEL_OAUTH_TOKEN_REPOSITORY,
  CHANNEL_REPOSITORY,
  Channel,
  type ChannelOAuthTokenRepository,
  type ChannelRepository,
} from '@sehloro/domain';
import {
  TwitchConduitService,
  TwitchConduitSubscriptionsService,
  TwitchOAuthService,
} from '@sehloro/infra';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AppConfig } from '../../config/config.schema';

const TWITCH_AUTH_URL = 'https://id.twitch.tv/oauth2/authorize';
/**
 * Scopes pedidos ao streamer no consent screen.
 *  - `channel:bot` + `user:read:chat`: pro EventSub `channel.chat.message`
 *    via conduit. Twitch exige `channel:bot` do broadcaster +
 *    `user:bot` do bot (env do operador).
 *  - `channel:read:ads`: `channel.ad_break.begin` (auto AD)
 *  - `channel:read:subscriptions` + `moderator:read:followers`: insights extras
 *  - `chat:read`: fallback IRC se conduit não estiver disponível
 */
/**
 * Mesma lista pedida tanto pro streamer quanto pra conta-bot:
 *  - `user:bot`: do bot — exigido pra channel.chat.message via app token.
 *    Streamer concede também (sem efeito prático).
 *  - `channel:bot`: do broadcaster — exigido pra mesma subscription.
 *  - resto: insights por canal + chat IRC fallback.
 *
 * Twitch lida bem com scopes "extras" — só ignora os que o user_type
 * não pode conceder. Mantemos lista única pra simplicidade do OAuth flow.
 */
const TWITCH_SCOPES = [
  'user:read:email',
  'user:bot',
  'user:read:chat',
  'channel:bot',
  'chat:read',
  'channel:read:ads',
  'channel:read:subscriptions',
  'moderator:read:followers',
  // Legacy feed (Fase 5: conduit → collections legadas)
  // channel:moderate cobre bans + timeouts (channel.ban EventSub)
  // moderator:read:chat_messages é exigido por channel.chat.message_delete
  // channel:read:polls e channel:read:predictions habilitam end events
  'channel:moderate',
  'moderator:read:chat_messages',
  'channel:read:polls',
  'channel:read:predictions',
].join(' ');

/**
 * Shape do principal extraído pelo `@CurrentUser()` — vem do
 * `JwtStrategy.validate()` que normaliza tanto tokens novos quanto
 * legados para `{ sub, username, email, role }`.
 */
interface JwtPayload {
  sub: string;
  username: string;
  email: string;
  role: string;
}

@Controller('v2/auth/twitch')
export class TwitchOAuthController {
  private readonly logger = new Logger(TwitchOAuthController.name);

  constructor(
    private readonly twitchOAuth: TwitchOAuthService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(CHANNEL_REPOSITORY)
    private readonly channels: ChannelRepository,
    @Inject(CHANNEL_OAUTH_TOKEN_REPOSITORY)
    private readonly tokens: ChannelOAuthTokenRepository,
    private readonly conduit: TwitchConduitService,
    private readonly subscriptions: TwitchConduitSubscriptionsService,
  ) {}

  // ── /start  (precisa de auth — JWT via header OU ?token=) ─────────────────

  @Get('start')
  @Public()
  start(
    @Query('token') queryToken: string | undefined,
    @Query('redirect') redirect: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    const userId = this._extractUserId(req, queryToken);
    const clientId = this.config.get('TWITCH_CLIENT_ID', { infer: true });
    if (!clientId) {
      throw new BadRequestException('TWITCH_CLIENT_ID não configurado no backend');
    }
    const state = this.twitchOAuth.generateState(userId, redirect);
    const url = new URL(TWITCH_AUTH_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', this._redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', TWITCH_SCOPES);
    url.searchParams.set('state', state);
    // `force_verify=true` força a Twitch a mostrar o consent screen mesmo
    // se o usuário já autorizou o app antes — assim ele consegue escolher
    // (ou logar com) uma conta DIFERENTE pra adicionar como segundo canal.
    // Com `false`, a Twitch reusa silenciosamente a conta já logada e o
    // fluxo só reconecta a mesma — bloqueando multi-conta.
    url.searchParams.set('force_verify', 'true');
    res.redirect(url.toString());
  }

  // ── /callback  (público; auth via state) ──────────────────────────────────

  @Get('callback')
  @Public()
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const consoleUrl = this._consoleUrl();
    if (error) {
      const msg = errorDescription || error;
      return res.redirect(`${consoleUrl}/integrations/twitch?error=${encodeURIComponent(msg)}`);
    }
    if (!code || !state) {
      return res.redirect(`${consoleUrl}/integrations/twitch?error=missing_code_or_state`);
    }
    try {
      const { userId, redirect } = this.twitchOAuth.verifyState(state);
      const { token, user } = await this.twitchOAuth.exchangeCode({
        code,
        redirectUri: this._redirectUri(),
      });

      // Cria ou recupera o Channel do streamer (twitch user_id).
      // Reconexão: se já existe, reativa + transfere ownerId pro user
      // atual (caso o seed/recriação tenha mudado o _id do user).
      const existing = await this.channels.findByName(user.login);
      const channel = existing
        ? await this.channels.save(
            Channel.reconstitute({
              id: existing.getId(),
              name: existing.getName(),
              platform: existing.getPlatform(),
              active: true,
              createdAt: existing.getCreatedAt(),
              externalId: user.id,
              displayName: user.display_name,
              ownerId: userId,
              flags: existing.getFlags(),
            }),
          )
        : await this.channels.save(
            Channel.create({
              name: user.login,
              platform: 'twitch',
              externalId: user.id,
              displayName: user.display_name,
              ownerId: userId,
            }),
          );

      // Persiste o token cifrado vinculado ao channel.
      await this.twitchOAuth.storeToken({
        channelId: channel.getId(),
        token,
      });

      // Ativa o pipeline conduit pra esse canal. O service decide quais
      // subscriptions cria com base em `botUserId`:
      //   - vazio → só `stream.online` + `stream.offline` (banner on/off
      //     automático funciona; chat só por IRC fallback)
      //   - presente → as 3 (inclui `channel.chat.message` via conduit)
      // Erro aqui NÃO derruba o OAuth — token já salvo, redirect com aviso.
      const botUserId = this.config.get('TWITCH_BOT_USER_ID', { infer: true });
      const subWarning: string[] = [];
      try {
        const { conduitId } = await this.conduit.ensureConduit();
        const subs = await this.subscriptions.subscribeChannel({
          channelId: channel.getId(),
          channelExternalId: user.id,
          conduitId,
          botUserId: botUserId || null,
        });
        this.logger.log(
          `Conduit subscriptions ok channel=${channel.getId()} count=${subs.length} chat=${botUserId ? 'on' : 'off'}`,
        );
        if (!botUserId) subWarning.push('chatViaIrcOnly');
      } catch (e) {
        this.logger.error(
          `subscribeChannel falhou (chat/lifecycle continuam degradados): ${(e as Error).message}`,
        );
        subWarning.push('subscribeFailed');
      }

      this.logger.log(
        `OAuth concluído user=${userId} twitch=${user.login} (channelId=${channel.getId()})`,
      );
      const qs = new URLSearchParams({ connected: '1' });
      if (subWarning.length) qs.set('warning', subWarning.join(','));
      const target = redirect || `${consoleUrl}/integrations/twitch?${qs.toString()}`;
      return res.redirect(target.startsWith('http') ? target : `${consoleUrl}${target}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`OAuth callback falhou: ${msg}`);
      return res.redirect(`${consoleUrl}/integrations/twitch?error=${encodeURIComponent(msg)}`);
    }
  }

  // ── listagem das integrações do user logado ──────────────────────────────

  @Get('integrations')
  async list(@CurrentUser() user: JwtPayload) {
    const all = await this.channels.findAllActive();
    const mine = all.filter((c) => c.getPlatform() === 'twitch' && c.getOwnerId() === user.sub);
    const integrations = await Promise.all(
      mine.map(async (c) => {
        const token = await this.tokens.findByChannelId(c.getId(), 'twitch');
        return {
          channelId: c.getId(),
          name: c.getName(),
          displayName: c.getDisplayName(),
          externalId: c.getExternalId() ?? '',
          scope: token?.getScope() ?? '',
          expiresAt: token?.getExpiresAt().toISOString() ?? '',
          invalidated: token?.isInvalidated() ?? true,
          createdAt: c.getCreatedAt()?.toISOString(),
        };
      }),
    );
    return { integrations };
  }

  // ── revogar / desconectar ────────────────────────────────────────────────

  @Delete('integrations/:channelId')
  async disconnect(
    @Param('channelId') channelId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ ok: true }> {
    const ch = await this.channels.findById(channelId);
    if (!ch) throw new BadRequestException('canal não encontrado');
    if (ch.getOwnerId() && ch.getOwnerId() !== user.sub && user.role !== 'admin') {
      throw new ForbiddenException('canal pertence a outro usuário');
    }
    // Apaga o token (fica criptografado em cold storage? não — del de fato).
    const tokenDoc = await this.tokens.findByChannelId(channelId, 'twitch');
    if (tokenDoc) {
      await this.tokens.delete(tokenDoc.getId());
    }
    // Cancela as subscriptions EventSub do canal — para o chat de chegar via conduit.
    try {
      await this.subscriptions.unsubscribeChannel(channelId);
    } catch (err) {
      this.logger.warn(
        `unsubscribeChannel falhou (segue com revoke local): ${(err as Error).message}`,
      );
    }
    // Inativa o channel (não deletamos — pode haver batch_analysis em CH
    // apontando para ele). Reconstrói o entity com active=false.
    const inactive = Channel.reconstitute({
      id: ch.getId(),
      name: ch.getName(),
      platform: ch.getPlatform(),
      active: false,
      createdAt: ch.getCreatedAt(),
      externalId: ch.getExternalId(),
      displayName: ch.getDisplayName(),
      ownerId: ch.getOwnerId(),
    });
    await this.channels.save(inactive);
    this.logger.log(`OAuth desconectado user=${user.sub} channel=${channelId}`);
    return { ok: true };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private _extractUserId(req: Request, queryToken: string | undefined): string {
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const token = bearer ?? queryToken;
    if (!token) throw new UnauthorizedException('Token não fornecido');
    try {
      // Aceita ambos os formatos: legacy `{ userId, ... }` E novo `{ sub, ... }`.
      const decoded = this.jwt.verify<{ userId?: string; sub?: string }>(token);
      const userId = decoded.userId ?? decoded.sub;
      if (!userId) throw new Error('payload sem userId/sub');
      return userId;
    } catch {
      throw new UnauthorizedException('Token inválido');
    }
  }

  private _redirectUri(): string {
    const base = this.config.get('PUBLIC_API_URL', { infer: true }) ?? 'http://localhost:8080';
    return `${base}/api/v2/auth/twitch/callback`;
  }

  private _consoleUrl(): string {
    return this.config.get('CONSOLE_URL', { infer: true }) ?? 'http://localhost:3000';
  }
}
