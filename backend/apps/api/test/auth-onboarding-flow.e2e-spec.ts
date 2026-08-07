/**
 * Fase 1 · E2E do fluxo de sign-up / verificação de email / tenancy / RBAC.
 *
 * Boota os módulos reais (Config + Mongoose memory + Identity, que puxa
 * Persistence + Email + Jwt) contra mongodb-memory-server. O EMAIL_SENDER é
 * sobrescrito por um fake que captura o código (que só existe em plaintext no
 * email). Exercita AuthService + EntitlementsService diretamente (sem HTTP).
 *
 * Cenários:
 *  1. register cria User pending + Workspace + Membership owner e envia código.
 *  2. login antes de verificar → 403 EMAIL_NOT_VERIFIED.
 *  3. verify com código errado falha e conta tentativa; correto emite JWT
 *     com activeWorkspaceId + wsRole=owner.
 *  4. login após verificar funciona.
 *  5. getMe reporta onboardingCompleted=false, 1 workspace, wsRole owner.
 *  6. activateWorkspace válido emite token; inválido → 403.
 *  7. Entitlements: free permite 1 creator; o 2º estoura PLAN_LIMIT.
 *  8. resendCode invalida o código antigo e emite um novo.
 */
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  Creator,
  CREATOR_REPOSITORY,
  CreatorRepository,
  MEMBERSHIP_REPOSITORY,
  MembershipRepository,
  USER_REPOSITORY,
  UserRepository,
  WORKSPACE_REPOSITORY,
  WorkspaceRepository,
} from '@sehloro/domain';
import { EMAIL_SENDER, EmailMessage } from '@sehloro/infra';
import { IdentityModule } from '../src/identity/identity.module';
import { AuthService } from '../src/identity/auth/auth.service';
import { EntitlementsService } from '../src/identity/billing/entitlements.service';

class FakeEmailSender {
  public sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
  lastCode(): string {
    const last = this.sent[this.sent.length - 1];
    const m = last?.text.match(/\b(\d{6})\b/);
    if (!m) throw new Error('código não encontrado no email capturado');
    return m[1];
  }
}

describe('Auth / onboarding flow (Fase 1)', () => {
  let mongo: MongoMemoryServer;
  let app: TestingModule;
  let auth: AuthService;
  let entitlements: EntitlementsService;
  let users: UserRepository;
  let workspaces: WorkspaceRepository;
  let memberships: MembershipRepository;
  let creators: CreatorRepository;
  const fakeEmail = new FakeEmailSender();

  const EMAIL = 'yoda@sehloro.dev';
  const PASSWORD = 'supersecret1';

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
      ],
    })
      .overrideProvider(EMAIL_SENDER)
      .useValue(fakeEmail)
      .compile();
    await app.init();

    auth = app.get(AuthService);
    entitlements = app.get(EntitlementsService);
    users = app.get(USER_REPOSITORY);
    workspaces = app.get(WORKSPACE_REPOSITORY);
    memberships = app.get(MEMBERSHIP_REPOSITORY);
    creators = app.get(CREATOR_REPOSITORY);
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  let activeWorkspaceId: string;

  it('1. register cria User ATIVO + Workspace + Membership owner e já emite JWT', async () => {
    const res = await auth.register({
      email: EMAIL,
      password: PASSWORD,
      displayName: 'YoDa',
    });
    // Sign-up direto: nasce ativa/verificada e o par de tokens vem na hora.
    expect(res.accessToken).toBeTruthy();
    expect(res.refreshToken).toBeTruthy();
    expect(res.wsRole).toBe('owner');

    const user = await users.findByEmail(EMAIL);
    expect(user).not.toBeNull();
    expect(user!.getStatus()).toBe('active');
    expect(user!.isEmailVerified()).toBe(true);

    const wss = await workspaces.findByOwnerUserId(user!.getId());
    expect(wss).toHaveLength(1);
    activeWorkspaceId = wss[0].getId();
    expect(wss[0].getPlanKey()).toBe('free');
    expect(res.activeWorkspaceId).toBe(activeWorkspaceId);

    const membership = await memberships.findByUserAndWorkspace(user!.getId(), activeWorkspaceId);
    expect(membership?.getRole()).toBe('owner');

    // Nenhum código por email é emitido no fluxo atual.
    expect(fakeEmail.sent).toHaveLength(0);
  });

  it('2. login logo após o register funciona (sem gate de verificação)', async () => {
    const result = await auth.login({ email: EMAIL, password: PASSWORD });
    expect(result.accessToken).toBeTruthy();
    expect(result.activeWorkspaceId).toBe(activeWorkspaceId);
    expect(result.wsRole).toBe('owner');
  });

  it('3. verifyEmail (legado) sem código ativo → NO_ACTIVE_CODE', async () => {
    // O endpoint continua existindo por compatibilidade, mas o register não
    // emite mais código — logo nunca há código ativo para consumir.
    await expect(auth.verifyEmail({ email: EMAIL, code: '000000' })).rejects.toMatchObject({
      response: { code: 'NO_ACTIVE_CODE' },
    });
  });

  it('4. login após verificar funciona', async () => {
    const result = await auth.login({ email: EMAIL, password: PASSWORD });
    expect(result.accessToken).toBeTruthy();
    expect(result.wsRole).toBe('owner');
  });

  it('5. getMe reporta tenancy correto', async () => {
    const user = await users.findByEmail(EMAIL);
    const me = await auth.getMe(user!.getId());
    expect(me.user.emailVerified).toBe(true);
    expect(me.user.onboardingCompleted).toBe(false);
    expect(me.workspaces).toHaveLength(1);
    expect(me.wsRole).toBe('owner');
    expect(me.activeWorkspaceId).toBe(activeWorkspaceId);
  });

  it('6. activateWorkspace: válido emite token; inválido → 403', async () => {
    const user = await users.findByEmail(EMAIL);
    const ok = await auth.activateWorkspace(user!.getId(), activeWorkspaceId);
    expect(ok.accessToken).toBeTruthy();

    await expect(auth.activateWorkspace(user!.getId(), 'nao-existe')).rejects.toMatchObject({
      response: { code: 'NOT_A_MEMBER' },
    });
  });

  it('7. Entitlements: limites do Free ilimitados por enquanto (TODO em plans.ts)', async () => {
    // Nenhum creator ainda → pode adicionar.
    await expect(entitlements.assertCanAddCreator(activeWorkspaceId)).resolves.toBeUndefined();

    await creators.save(Creator.create({ workspaceId: activeWorkspaceId, name: 'Canal 1' }));

    // Free está temporariamente sem limites (-1) — um 2º creator NÃO estoura.
    // Quando o billing restaurar os limites, reverter para o
    // `rejects.toMatchObject({ response: { code: 'PLAN_LIMIT' } })` original.
    await expect(entitlements.assertCanAddCreator(activeWorkspaceId)).resolves.toBeUndefined();

    const ent = await entitlements.getEntitlements(activeWorkspaceId);
    expect(ent.usage.creators).toBe(1);
    expect(ent.limits.maxCreators).toBe(-1);
  });

  it('8. resendCode (legado) é no-op para conta ativa e não vaza existência', async () => {
    const other = 'fulano@sehloro.dev';
    await auth.register({ email: other, password: PASSWORD, displayName: 'Fulano' });

    // Conta já nasce ativa → só age em status pending_email, então nada é enviado.
    await expect(auth.resendCode({ email: other })).resolves.toEqual({ ok: true });
    expect(fakeEmail.sent).toHaveLength(0);

    // Anti-enumeration: email inexistente responde igual.
    await expect(auth.resendCode({ email: 'ninguem@sehloro.dev' })).resolves.toEqual({ ok: true });
    expect(fakeEmail.sent).toHaveLength(0);
  });
});
