/**
 * KCK-01 · KickOAuthController.
 *
 * Rotas (prefixo global `/api`):
 *   GET /api/v2/auth/kick/start?token=<jwt>   → redireciona para o Kick IdP
 *   GET /api/v2/auth/kick/callback?code&state → troca code, AUTO-CRIA o canal
 *                                               pela identidade Kick, persiste token
 *
 * Paridade com o fluxo Twitch (twitch-oauth.controller.ts): o streamer só
 * aperta "Conectar conta Kick" — não precisa cadastrar o canal antes. O canal
 * é resolvido a partir de quem autorizou (Kick public API), igual ao Helix.
 *
 * Ambas são @Public() — o OAuth precisa ocorrer antes de qualquer auth. O
 * `state` é assinado com HMAC+JWT_SECRET e tem TTL de 10 min (ver KickOAuthService).
 */
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Logger,
  Query,
  Redirect,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { KickOAuthService } from '@sehloro/infra';
import { CHANNEL_REPOSITORY, Channel, type ChannelRepository } from '@sehloro/domain';
import { CreatorService } from '../../creator/creator.service';
import type { AppConfig } from '../../config/config.schema';

const KICK_AUTH_URL = 'https://id.kick.com/oauth/authorize';
const KICK_SCOPE = 'chat:read user:read channel:read';

@Public()
@Controller('v2/auth/kick')
export class KickOAuthController {
  private readonly logger = new Logger(KickOAuthController.name);

  constructor(
    private readonly kickOAuth: KickOAuthService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(CHANNEL_REPOSITORY)
    private readonly channels: ChannelRepository,
    private readonly creators: CreatorService,
  ) {}

  /**
   * Inicia o OAuth. Redireciona o browser do streamer para o Kick IdP.
   * O `userId` (dono do console) vem do JWT — header `Authorization: Bearer`
   * ou `?token=` (full-page redirect não manda header) — e é embutido no
   * `state` assinado para virar o `ownerId` do canal no callback.
   */
  @Get('start')
  @Redirect()
  startOAuth(
    @Query('token') queryToken: string | undefined,
    @Query('redirect') redirect: string | undefined,
    @Req() req: Request,
  ) {
    const { userId, workspaceId } = this._extractPrincipal(req, queryToken);

    const clientId = this.config.get('KICK_CLIENT_ID', { infer: true });
    if (!clientId) {
      throw new BadRequestException('KICK_CLIENT_ID não configurado');
    }

    // PKCE (OAuth 2.1): o Kick exige code_challenge no authorize — sem ele o
    // IdP faz 307 pra raiz (404). O verifier viaja no state assinado.
    const { codeVerifier, codeChallenge } = this.kickOAuth.createPkcePair();
    const state = this.kickOAuth.generateState(
      userId,
      redirect,
      codeVerifier,
      workspaceId ?? undefined,
    );

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: this._callbackUri(),
      scope: KICK_SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return { url: `${KICK_AUTH_URL}?${params.toString()}`, statusCode: 302 };
  }

  /**
   * Callback OAuth. Kick redireciona aqui com `code` + `state`.
   * Troca o code, descobre o canal do streamer (Kick public API), cria/recupera
   * o Channel e persiste o token cifrado vinculado a ele. Depois volta pro console.
   */
  @Get('callback')
  @Redirect()
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
  ) {
    const consoleUrl = this._consoleUrl();

    if (error) {
      this.logger.warn(`Kick OAuth negado: ${error}`);
      return { url: `${consoleUrl}/integrations/kick?kick=denied`, statusCode: 302 };
    }

    if (!code || !state) {
      throw new BadRequestException('code e state são obrigatórios');
    }

    const { userId, redirect, codeVerifier, workspaceId } = this.kickOAuth.verifyState(state);

    try {
      const tokens = await this.kickOAuth.exchangeCodeForTokens(
        code,
        this._callbackUri(),
        codeVerifier,
      );
      const identity = await this.kickOAuth.fetchAuthenticatedChannel(tokens.access_token);

      // Cria ou recupera o Channel do streamer (kick slug). Reconexão:
      // reativa + transfere ownerId pro user atual (mesmo padrão do Twitch),
      // preservando o vínculo creator/workspace existente.
      const existing = await this.channels.findByName(identity.slug);
      const channel = existing
        ? await this.channels.save(
            Channel.reconstitute({
              id: existing.getId(),
              name: existing.getName(),
              platform: 'kick',
              active: true,
              createdAt: existing.getCreatedAt(),
              externalId: identity.broadcasterUserId || existing.getExternalId(),
              displayName: identity.displayName,
              ownerId: userId,
              creatorId: existing.getCreatorId(),
              workspaceId: existing.getWorkspaceId(),
              flags: existing.getFlags(),
            }),
          )
        : await this.channels.save(
            Channel.create({
              name: identity.slug,
              platform: 'kick',
              externalId: identity.broadcasterUserId || undefined,
              displayName: identity.displayName,
              ownerId: userId,
            }),
          );

      await this.kickOAuth.storeToken(channel.getId(), tokens);

      // Auto-vincula o canal ao creator do workspace ativo — é o vínculo
      // (creatorId + workspaceId) que faz o canal aparecer em /api/v2/channels
      // (lista escopada por tenant) e no picker "Canal ativo" do console.
      // Falha aqui NÃO derruba o OAuth: canal + token já persistidos.
      let warning: string | null = null;
      if (workspaceId) {
        try {
          const linkResult = await this.creators.autoLinkIntegration(
            workspaceId,
            userId,
            channel.getId(),
          );
          if (linkResult === 'no-creator') warning = 'noCreator';
          else if (linkResult === 'choose-creator') warning = 'chooseCreator';
          this.logger.log(`Auto-link channel=${channel.getId()} ws=${workspaceId} → ${linkResult}`);
        } catch (err) {
          this.logger.error(
            `Auto-link falhou (canal segue sem vínculo): ${(err as Error).message}`,
          );
          warning = 'autoLinkFailed';
        }
      } else {
        warning = 'chooseCreator';
      }

      this.logger.log(
        `OAuth Kick concluído user=${userId} kick=${identity.slug} (channelId=${channel.getId()})`,
      );

      const okQs = new URLSearchParams({ kick: 'ok', channelId: channel.getId() });
      if (warning) okQs.set('warning', warning);
      const target = redirect ?? `${consoleUrl}/integrations/kick?${okQs.toString()}`;
      return {
        url: target.startsWith('http') ? target : `${consoleUrl}${target}`,
        statusCode: 302,
      };
    } catch (err) {
      this.logger.error(`Falha no callback Kick OAuth: ${(err as Error).message}`);
      return { url: `${consoleUrl}/integrations/kick?kick=error`, statusCode: 302 };
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private _extractPrincipal(
    req: Request,
    queryToken: string | undefined,
  ): { userId: string; workspaceId: string | null } {
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const token = bearer ?? queryToken;
    if (!token) throw new UnauthorizedException('Token não fornecido');
    try {
      // Aceita ambos os formatos: legacy `{ userId }` e novo `{ sub }`.
      const decoded = this.jwt.verify<{
        userId?: string;
        sub?: string;
        activeWorkspaceId?: string;
      }>(token);
      const userId = decoded.userId ?? decoded.sub;
      if (!userId) throw new Error('payload sem userId/sub');
      return { userId, workspaceId: decoded.activeWorkspaceId ?? null };
    } catch {
      throw new UnauthorizedException('Token inválido');
    }
  }

  /**
   * redirect_uri estável derivado de PUBLIC_API_URL (igual ao fluxo Twitch),
   * não do host da request — casa SEMPRE com o que está cadastrado no Kick.
   * Cadastrar no painel: `${PUBLIC_API_URL}/api/v2/auth/kick/callback`.
   */
  private _callbackUri(): string {
    const base = this.config.get('PUBLIC_API_URL', { infer: true }) ?? 'http://localhost:8080';
    return `${base}/api/v2/auth/kick/callback`;
  }

  private _consoleUrl(): string {
    return this.config.get('CONSOLE_URL', { infer: true }) ?? 'http://localhost:3000';
  }
}
