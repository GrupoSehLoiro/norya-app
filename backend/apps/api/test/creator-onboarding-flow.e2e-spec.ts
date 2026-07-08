/**
 * Fase 2 · E2E do onboarding do Creator (CRUD + perfil + integração + complete).
 *
 * Boota Config + Mongoose(memory) + IdentityModule + CreatorModule. Exercita
 * CreatorService + OnboardingService diretamente (sem HTTP). Cria um Channel via
 * o ChannelRepository (simulando o canal que o OAuth criaria, com ownerId).
 *
 * Cenários:
 *  1. create creator respeita o limite do plano free (1 creator).
 *  2. upsert profile com categoria marca o perfil completo.
 *  3. onboarding NÃO conclui sem integração (NO_INTEGRATION).
 *  4. linkIntegration vincula um canal do usuário ao creator (tenant ok).
 *  5. onboarding conclui após perfil completo + 1 integração.
 *  6. cross-tenant: profile de creator de outro workspace → 403.
 */
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  Channel,
  CHANNEL_REPOSITORY,
  ChannelRepository,
  USER_REPOSITORY,
  UserRepository,
} from '@sehloro/domain';
import { EMAIL_SENDER, EmailMessage } from '@sehloro/infra';
import { IdentityModule } from '../src/identity/identity.module';
import { AuthService } from '../src/identity/auth/auth.service';
import { CreatorModule } from '../src/creator/creator.module';
import { CreatorService } from '../src/creator/creator.service';
import { OnboardingService } from '../src/creator/onboarding.service';

class FakeEmailSender {
  public sent: EmailMessage[] = [];
  async send(m: EmailMessage): Promise<void> {
    this.sent.push(m);
  }
  lastCode(): string {
    const m = this.sent[this.sent.length - 1]?.text.match(/\b(\d{6})\b/);
    if (!m) throw new Error('código não encontrado');
    return m[1];
  }
}

describe('Creator onboarding flow (Fase 2)', () => {
  let mongo: MongoMemoryServer;
  let app: TestingModule;
  let auth: AuthService;
  let creators: CreatorService;
  let onboarding: OnboardingService;
  let users: UserRepository;
  let channels: ChannelRepository;
  const fakeEmail = new FakeEmailSender();

  const EMAIL = 'creator@sehloro.dev';
  const PASSWORD = 'supersecret1';
  let userId: string;
  let workspaceId: string;
  let creatorId: string;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.NODE_ENV = 'test';
    process.env.EVENT_BUS_DRIVER = 'memory';
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_SECRET = 'a'.repeat(40);
    process.env.JWT_ACCESS_TTL = '15m';
    process.env.JWT_REFRESH_TTL_DAYS = '7';
    process.env.CRYPTO_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.EMAIL_DRIVER = 'log';
    process.env.LOG_LEVEL = 'fatal';

    app = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true, ignoreEnvFile: true }),
        IdentityModule,
        CreatorModule,
      ],
    })
      .overrideProvider(EMAIL_SENDER)
      .useValue(fakeEmail)
      .compile();
    await app.init();

    auth = app.get(AuthService);
    creators = app.get(CreatorService);
    onboarding = app.get(OnboardingService);
    users = app.get(USER_REPOSITORY);
    channels = app.get(CHANNEL_REPOSITORY);

    // Registra + verifica para ter user + workspace ativos.
    await auth.register({ email: EMAIL, password: PASSWORD, displayName: 'Creator' });
    await auth.verifyEmail({ email: EMAIL, code: fakeEmail.lastCode() });
    const me = await auth.getMe((await users.findByEmail(EMAIL))!.getId());
    userId = me.user.id;
    workspaceId = me.activeWorkspaceId!;
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it('1. cria creator (e o 2º estoura limite do plano free)', async () => {
    const c = await creators.create(workspaceId, { name: 'YoDa' });
    creatorId = c.id;
    expect(c.workspaceId).toBe(workspaceId);
    expect(c.profileComplete).toBe(false);

    await expect(creators.create(workspaceId, { name: 'Outro' })).rejects.toMatchObject({
      response: { code: 'PLAN_LIMIT' },
    });
  });

  it('2. upsert profile com categoria marca completo', async () => {
    const p = await creators.upsertProfile(creatorId, workspaceId, {
      niche: 'fps competitivo',
      category: 'games',
      subcategory: 'fps',
      genre: 'gaming',
      audience: { ageRange: '18-24', region: 'BR' },
      tags: ['valorant', 'cs'],
    });
    expect(p.complete).toBe(true);
    expect(p.category).toBe('games');
  });

  it('3. onboarding não conclui sem integração', async () => {
    await expect(onboarding.complete(userId, workspaceId)).rejects.toMatchObject({
      response: { code: 'NO_INTEGRATION' },
    });
  });

  it('4. linkIntegration vincula um canal do usuário ao creator', async () => {
    // Simula o canal que o OAuth criaria (ownerId = usuário).
    const channel = await channels.save(
      Channel.create({
        name: 'yoda_tv',
        platform: 'twitch',
        externalId: '12345',
        displayName: 'YoDa TV',
        ownerId: userId,
      }),
    );

    const unlinked = await creators.listUnlinkedForUser(userId);
    expect(unlinked.map((i) => i.id)).toContain(channel.getId());

    const linked = await creators.linkIntegration(creatorId, workspaceId, userId, channel.getId());
    expect(linked.creatorId).toBe(creatorId);

    const list = await creators.listIntegrations(creatorId, workspaceId);
    expect(list).toHaveLength(1);
  });

  it('5. onboarding conclui com perfil completo + 1 integração', async () => {
    const status = await onboarding.complete(userId, workspaceId);
    expect(status.onboardingCompleted).toBe(true);

    const me = await auth.getMe(userId);
    expect(me.user.onboardingCompleted).toBe(true);
  });

  it('6. cross-tenant: creator de outro workspace → 403', async () => {
    await expect(creators.getProfile(creatorId, 'workspace-alheio')).rejects.toMatchObject({
      response: { code: 'CROSS_TENANT' },
    });
  });
});
