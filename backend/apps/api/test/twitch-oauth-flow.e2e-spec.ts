/**
 * E2E do TwitchOAuthController (controller real, Mongo real do compose).
 *
 * Mocks:
 *   - TwitchOAuthService.exchangeCode (não bate em id.twitch.tv)
 *   - TwitchConduitService.ensureConduit
 *   - TwitchConduitSubscriptionsService.subscribeChannel / unsubscribeChannel
 *
 * Cobre:
 *   - GET /start sem token → 401
 *   - GET /start sem TWITCH_CLIENT_ID → 400
 *   - GET /start happy path → 302 com authorize URL + scopes esperados
 *   - GET /callback ?error → redirect com error querystring
 *   - GET /callback sem code → redirect com missing_code_or_state
 *   - GET /callback happy path → Channel criado + token persistido + subscribeChannel chamado
 *   - GET /callback state inválido → redirect com error
 *   - GET /integrations → filtrado por ownerId === user.sub
 *   - DELETE /integrations/:id → unsubscribe chamado + canal desativado + token apagado
 */
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { type Connection } from 'mongoose';
import request from 'supertest';
import {
  PersistenceModule,
  TwitchConduitService,
  TwitchConduitSubscriptionsService,
  TwitchOAuthService,
} from '@sehloro/infra';
import {
  CHANNEL_OAUTH_TOKEN_REPOSITORY,
  CHANNEL_REPOSITORY,
  type ChannelOAuthTokenRepository,
  type ChannelRepository,
} from '@sehloro/domain';
import { TwitchOAuthController } from '../src/identity/twitch-oauth/twitch-oauth.controller';
import { JwtAuthGuard } from '../src/identity/auth/guards/jwt-auth.guard';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from '../src/identity/auth/strategies/jwt.strategy';

const JWT_SECRET = 'a'.repeat(40);
const TWITCH_CLIENT_ID = 'test_twitch_client_id';
const TWITCH_CLIENT_SECRET = 'test_twitch_client_secret';
const BOT_USER_ID = 'bot_user_999';

// ── mocks ────────────────────────────────────────────────────────────────────

class MockConduitService {
  ensureConduit = jest.fn().mockResolvedValue({ conduitId: 'conduit-xyz' });
}

class MockSubscriptionsService {
  subscribeChannel = jest.fn().mockResolvedValue([
    { _id: 's1', type: 'channel.chat.message', status: 'enabled' },
    { _id: 's2', type: 'stream.online', status: 'enabled' },
    { _id: 's3', type: 'stream.offline', status: 'enabled' },
  ]);
  unsubscribeChannel = jest.fn().mockResolvedValue(undefined);
}

// External IDs únicos por execução do arquivo — evita colisão com o
// índice `(platform, externalId)` quando o Mongo do compose retém docs
// de runs anteriores.
const RUN_TAG = randomUUID().slice(0, 8);
const HAPPY_USER_ID = `tw_${RUN_TAG}_happy`;
const BOTMISSING_USER_ID = `tw_${RUN_TAG}_nobot`;
const OTHER_USER_ID = `tw_${RUN_TAG}_other`;

// Subclasse real para preservar state HMAC (testado no unit) +
// mockar só `exchangeCode` (que bate em Twitch).
class StubbedTwitchOAuth extends TwitchOAuthService {
  exchangeCode = jest.fn().mockImplementation(async () => ({
    token: {
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      token_type: 'bearer',
      scope: 'user:read:email user:read:chat channel:bot',
    },
    user: {
      id: HAPPY_USER_ID,
      login: 'mockstreamer_' + RUN_TAG,
      display_name: 'MockStreamer',
      email: 'mock@example.com',
    },
  }));
}

// ── setup ────────────────────────────────────────────────────────────────────

describe('TwitchOAuthController (e2e)', () => {
  let app: INestApplication;
  let module: TestingModule;
  let jwt: JwtService;
  let conduit: MockConduitService;
  let subs: MockSubscriptionsService;
  let userJwt: string;
  let secondUserJwt: string;

  beforeAll(async () => {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI obrigatório (use o Mongo do compose)');
    }
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.TWITCH_CLIENT_ID = TWITCH_CLIENT_ID;
    process.env.TWITCH_CLIENT_SECRET = TWITCH_CLIENT_SECRET;
    process.env.TWITCH_BOT_USER_ID = BOT_USER_ID;
    process.env.PUBLIC_API_URL = 'http://localhost:8080';
    process.env.CONSOLE_URL = 'http://localhost:3000';
    process.env.LOG_LEVEL = 'fatal';

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(process.env.MONGODB_URI!),
        PassportModule,
        JwtModule.registerAsync({
          inject: [ConfigService],
          useFactory: (cfg: ConfigService) => ({
            secret: cfg.get<string>('JWT_SECRET'),
            signOptions: { expiresIn: '15m' },
          }),
        }),
        PersistenceModule,
      ],
      controllers: [TwitchOAuthController],
      providers: [
        StubbedTwitchOAuth,
        { provide: TwitchOAuthService, useExisting: StubbedTwitchOAuth },
        { provide: TwitchConduitService, useClass: MockConduitService },
        { provide: TwitchConduitSubscriptionsService, useClass: MockSubscriptionsService },
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        Reflector,
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    jwt = module.get(JwtService);
    conduit = module.get(TwitchConduitService) as unknown as MockConduitService;
    subs = module.get(TwitchConduitSubscriptionsService) as unknown as MockSubscriptionsService;

    userJwt = jwt.sign({ sub: 'user-A', username: 'alice', email: 'a@x', role: 'admin' });
    secondUserJwt = jwt.sign({ sub: 'user-B', username: 'bob', email: 'b@x', role: 'user' });

    // Isolation: limpa collections que esses testes mexem. Não usa drop()
    // porque a connection é compartilhada via PersistenceModule.
    // Inclui channels com externalIds usados nos testes — índice
    // (platform, externalId) é unique e residuos de runs anteriores
    // explodem com E11000 no Channel.create.
    const conn = module.get<Connection>(getConnectionToken());
    if (conn.db) {
      await conn.db.collection('channels').deleteMany({
        $or: [
          { ownerId: { $in: ['user-A', 'user-B'] } },
          { externalId: { $in: ['twitch_user_123', 'twitch_user_no_bot', 'twitch_user_other'] } },
          { channel: { $regex: '^(mockstreamer|no_bot|other)_' } },
        ],
      });
      await conn.db.collection('channeloauthtokens').deleteMany({});
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  afterEach(() => {
    conduit.ensureConduit.mockClear();
    subs.subscribeChannel.mockClear();
    subs.unsubscribeChannel.mockClear();
  });

  // ── /start ────────────────────────────────────────────────────────────────

  it('GET /start sem token → 401', async () => {
    await request(app.getHttpServer()).get('/api/v2/auth/twitch/start').expect(401);
  });

  it('GET /start com token mas TWITCH_CLIENT_ID vazio → 400', async () => {
    // Trick: força ConfigService a retornar undefined para TWITCH_CLIENT_ID
    const cfg = module.get(ConfigService);
    const orig = cfg.get.bind(cfg);
    jest.spyOn(cfg, 'get').mockImplementation((key: string, opts?: unknown) => {
      if (key === 'TWITCH_CLIENT_ID') return undefined as never;
      return orig(key as never, opts as never);
    });
    await request(app.getHttpServer())
      .get(`/api/v2/auth/twitch/start?token=${userJwt}`)
      .expect(400);
    (cfg.get as jest.Mock).mockRestore();
  });

  it('GET /start happy → 302 para authorize URL com scopes corretos', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v2/auth/twitch/start?token=${userJwt}`)
      .expect(302);
    const loc = res.headers['location'] as string;
    expect(loc).toContain('https://id.twitch.tv/oauth2/authorize');
    expect(loc).toContain(`client_id=${TWITCH_CLIENT_ID}`);
    expect(loc).toContain('response_type=code');
    expect(loc).toMatch(/scope=[^&]+user%3Aread%3Achat/);
    expect(loc).toMatch(/scope=[^&]+channel%3Abot/);
    expect(loc).toMatch(/scope=[^&]+channel%3Aread%3Aads/);
    expect(loc).toMatch(/state=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  });

  it('GET /start aceita Authorization header em vez de ?token=', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v2/auth/twitch/start')
      .set('Authorization', `Bearer ${userJwt}`)
      .expect(302);
    expect(res.headers['location']).toContain('id.twitch.tv/oauth2/authorize');
  });

  // ── /callback ─────────────────────────────────────────────────────────────

  it('GET /callback ?error → redirect com error querystring', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v2/auth/twitch/callback?error=access_denied&error_description=user_canceled')
      .expect(302);
    expect(res.headers['location']).toContain('/integrations/twitch');
    expect(res.headers['location']).toMatch(/error=user_canceled/);
  });

  it('GET /callback sem code/state → redirect com missing_code_or_state', async () => {
    const res = await request(app.getHttpServer()).get('/api/v2/auth/twitch/callback').expect(302);
    expect(res.headers['location']).toMatch(/error=missing_code_or_state/);
  });

  it('GET /callback state inválido → redirect com error', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v2/auth/twitch/callback?code=abc&state=garbage')
      .expect(302);
    expect(res.headers['location']).toMatch(/error=/);
    expect(res.headers['location']).not.toContain('connected=1');
  });

  it('GET /callback happy → cria Channel + storeToken + subscribeChannel', async () => {
    const oauth = module.get(StubbedTwitchOAuth);
    const state = oauth.generateState('user-A');

    const res = await request(app.getHttpServer())
      .get(`/api/v2/auth/twitch/callback?code=mock_code&state=${encodeURIComponent(state)}`)
      .expect(302);
    expect(res.headers['location']).toContain('connected=1');

    expect(oauth.exchangeCode).toHaveBeenCalledTimes(1);
    expect(conduit.ensureConduit).toHaveBeenCalledTimes(1);
    expect(subs.subscribeChannel).toHaveBeenCalledTimes(1);
    const callArg = subs.subscribeChannel.mock.calls[0][0];
    expect(callArg.botUserId).toBe(BOT_USER_ID);
    expect(callArg.conduitId).toBe('conduit-xyz');
    expect(callArg.channelExternalId).toBe(HAPPY_USER_ID);

    // Channel persistido com ownerId = user-A
    const channelRepo = module.get<ChannelRepository>(CHANNEL_REPOSITORY);
    const tokenRepo = module.get<ChannelOAuthTokenRepository>(CHANNEL_OAUTH_TOKEN_REPOSITORY);
    const ch = await channelRepo.findById(callArg.channelId);
    expect(ch).toBeDefined();
    expect(ch!.getOwnerId()).toBe('user-A');
    expect(ch!.getPlatform()).toBe('twitch');

    const token = await tokenRepo.findByChannelId(callArg.channelId, 'twitch');
    expect(token).toBeDefined();
    expect(token!.getScope()).toContain('user:read:chat');
  });

  it('GET /callback sem TWITCH_BOT_USER_ID → subscribe só lifecycle (chatViaIrcOnly)', async () => {
    const cfg = module.get(ConfigService);
    const orig = cfg.get.bind(cfg);
    jest.spyOn(cfg, 'get').mockImplementation((key: string, opts?: unknown) => {
      if (key === 'TWITCH_BOT_USER_ID') return undefined as never;
      return orig(key as never, opts as never);
    });
    try {
      const oauth = module.get(StubbedTwitchOAuth);
      // Faz exchangeCode devolver um login diferente pra não colidir com o
      // teste anterior (findByName reaproveita Channel existente).
      oauth.exchangeCode.mockResolvedValueOnce({
        token: {
          access_token: 'a',
          refresh_token: 'r',
          expires_in: 3600,
          token_type: 'bearer',
          scope: 'user:read:chat',
        },
        user: {
          id: BOTMISSING_USER_ID,
          login: 'no_bot_' + RUN_TAG,
          display_name: 'X',
          email: 'x@x',
        },
      });
      const state = oauth.generateState('user-A');
      const res = await request(app.getHttpServer())
        .get(`/api/v2/auth/twitch/callback?code=c&state=${encodeURIComponent(state)}`)
        .expect(302);
      expect(res.headers['location']).toContain('connected=1');
      // O subscribe AINDA é chamado — pra stream.online/offline. Só o
      // botUserId é null no arg (service skipa channel.chat.message).
      expect(subs.subscribeChannel).toHaveBeenCalledTimes(1);
      const arg = subs.subscribeChannel.mock.calls[0][0];
      expect(arg.botUserId).toBeNull();
      expect(res.headers['location']).toMatch(/warning=chatViaIrcOnly/);
    } finally {
      (cfg.get as jest.Mock).mockRestore();
    }
  });

  // ── /integrations ─────────────────────────────────────────────────────────

  it('GET /integrations filtra por ownerId === user.sub', async () => {
    const myRes = await request(app.getHttpServer())
      .get('/api/v2/auth/twitch/integrations')
      .set('Authorization', `Bearer ${userJwt}`)
      .expect(200);
    const mine = myRes.body.integrations as Array<{ channelId: string }>;
    // O happy-path acima criou pelo menos um channel pra user-A
    expect(mine.length).toBeGreaterThan(0);

    // user-B nunca conectou — deve vir vazio
    const otherRes = await request(app.getHttpServer())
      .get('/api/v2/auth/twitch/integrations')
      .set('Authorization', `Bearer ${secondUserJwt}`)
      .expect(200);
    expect(otherRes.body.integrations).toEqual([]);
  });

  // ── /disconnect ───────────────────────────────────────────────────────────

  it('DELETE /integrations/:id revoga token + unsubscribe + desativa canal', async () => {
    const listRes = await request(app.getHttpServer())
      .get('/api/v2/auth/twitch/integrations')
      .set('Authorization', `Bearer ${userJwt}`)
      .expect(200);
    const channelId = listRes.body.integrations[0].channelId as string;

    await request(app.getHttpServer())
      .delete(`/api/v2/auth/twitch/integrations/${channelId}`)
      .set('Authorization', `Bearer ${userJwt}`)
      .expect(200);

    expect(subs.unsubscribeChannel).toHaveBeenCalledWith(channelId);

    // Token apagado
    const tokenRepo = module.get<ChannelOAuthTokenRepository>(CHANNEL_OAUTH_TOKEN_REPOSITORY);
    const remaining = await tokenRepo.findByChannelId(channelId, 'twitch');
    expect(remaining).toBeNull();

    // Channel desativado
    const channelRepo = module.get<ChannelRepository>(CHANNEL_REPOSITORY);
    const ch = await channelRepo.findById(channelId);
    expect(ch!.isActive()).toBe(false);
  });

  it('DELETE /integrations/:id de outro user → 403 (não-admin)', async () => {
    // Recria um canal pra user-A
    const oauth = module.get(StubbedTwitchOAuth);
    oauth.exchangeCode.mockResolvedValueOnce({
      token: {
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 3600,
        token_type: 'bearer',
        scope: 'user:read:chat',
      },
      user: {
        id: OTHER_USER_ID,
        login: 'other_' + RUN_TAG,
        display_name: 'X',
        email: 'x@x',
      },
    });
    const state = oauth.generateState('user-A');
    await request(app.getHttpServer())
      .get(`/api/v2/auth/twitch/callback?code=c&state=${encodeURIComponent(state)}`)
      .expect(302);
    const listRes = await request(app.getHttpServer())
      .get('/api/v2/auth/twitch/integrations')
      .set('Authorization', `Bearer ${userJwt}`)
      .expect(200);
    const someChannelId = listRes.body.integrations[0].channelId as string;

    // user-B (role=user) tenta deletar — deve 403
    await request(app.getHttpServer())
      .delete(`/api/v2/auth/twitch/integrations/${someChannelId}`)
      .set('Authorization', `Bearer ${secondUserJwt}`)
      .expect(403);
  });
});
