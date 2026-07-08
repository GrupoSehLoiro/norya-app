/**
 * Testes de integração do ChannelOAuthTokenMongooseRepository.
 *
 * Cenário crítico validado aqui: os campos `accessToken` e `refreshToken`
 * vão para o disco encriptados (prefixo `v1:`) graças ao plugin, MAS são
 * transparentemente decriptados quando o repositório hidrata.
 *
 * Também valida o compound index unique em `(channelId, platform)`.
 */
import { randomBytes } from 'node:crypto';
import { ChannelOAuthToken } from '@sehloro/domain';
import { CryptoService } from '../../../crypto/crypto.service';
import { ChannelOAuthTokenMongooseRepository } from '../repositories/channel-oauth-token.mongoose.repository';
import { startTestMongo, TestMongoHandle } from './test-utils';

describe('ChannelOAuthTokenMongooseRepository', () => {
  let handle: TestMongoHandle;
  let repo: ChannelOAuthTokenMongooseRepository;
  let crypto: CryptoService;

  beforeAll(async () => {
    crypto = new CryptoService({
      masterKeyBase64: randomBytes(32).toString('base64'),
    });
    handle = await startTestMongo({ encryption: crypto });
    await handle.channelOAuthTokenModel.syncIndexes();
    repo = new ChannelOAuthTokenMongooseRepository(handle.channelOAuthTokenModel);
  });

  afterAll(async () => {
    await handle.close();
  });

  afterEach(async () => {
    await handle.channelOAuthTokenModel.deleteMany({}).exec();
  });

  function makeToken(
    overrides: {
      channelId?: string;
      platform?: 'twitch' | 'kick';
      access?: string;
      refresh?: string;
    } = {},
  ): ChannelOAuthToken {
    return ChannelOAuthToken.create({
      channelId: overrides.channelId ?? 'channel-1',
      platform: overrides.platform ?? 'twitch',
      accessToken: overrides.access ?? 'twitch-access-xyz',
      refreshToken: overrides.refresh ?? 'twitch-refresh-abc',
      scope: 'chat:read chat:edit',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  }

  describe('save + findByChannelId', () => {
    it('persiste e recupera preservando plaintext em memória', async () => {
      const token = makeToken();
      const saved = await repo.save(token);
      expect(saved.getAccessToken()).toBe('twitch-access-xyz');
      expect(saved.getRefreshToken()).toBe('twitch-refresh-abc');

      const found = await repo.findByChannelId('channel-1', 'twitch');
      expect(found).not.toBeNull();
      expect(found!.getAccessToken()).toBe('twitch-access-xyz');
      expect(found!.getRefreshToken()).toBe('twitch-refresh-abc');
      expect(found!.getScope()).toBe('chat:read chat:edit');
      expect(found!.getPlatform()).toBe('twitch');
    });

    it('retorna null quando não existe', async () => {
      expect(await repo.findByChannelId('nope', 'twitch')).toBeNull();
    });
  });

  describe('encryption at rest', () => {
    it('grava accessToken e refreshToken no disco com prefixo v1:', async () => {
      const token = makeToken({
        access: 'plain-access-token',
        refresh: 'plain-refresh-token',
      });
      await repo.save(token);

      // Bypass do Mongoose: lemos via driver raw para inspecionar o que
      // realmente está no disco, sem o plugin aplicar decrypt.
      const collection = handle.connection.collection(
        handle.channelOAuthTokenModel.collection.name,
      );
      const raw = await collection.findOne({ _id: token.getId() as never });
      expect(raw).not.toBeNull();
      expect(typeof raw!.accessToken).toBe('string');
      expect(typeof raw!.refreshToken).toBe('string');
      expect((raw!.accessToken as string).startsWith('v1:')).toBe(true);
      expect((raw!.refreshToken as string).startsWith('v1:')).toBe(true);
      // Valores NÃO podem ser o plaintext
      expect(raw!.accessToken).not.toBe('plain-access-token');
      expect(raw!.refreshToken).not.toBe('plain-refresh-token');
      // Os demais campos permanecem em plaintext
      expect(raw!.channelId).toBe('channel-1');
      expect(raw!.platform).toBe('twitch');
    });

    it('cada save gera ciphertext diferente (IV aleatório)', async () => {
      const t1 = makeToken({ channelId: 'c-dup-a', access: 'same-plain' });
      const t2 = makeToken({ channelId: 'c-dup-b', access: 'same-plain' });
      await repo.save(t1);
      await repo.save(t2);

      const collection = handle.connection.collection(
        handle.channelOAuthTokenModel.collection.name,
      );
      const a = await collection.findOne({ _id: t1.getId() as never });
      const b = await collection.findOne({ _id: t2.getId() as never });
      expect(a!.accessToken).not.toBe(b!.accessToken);
    });
  });

  describe('update idempotente', () => {
    it('save duplo não cria duplicatas e atualiza tokens', async () => {
      const token = makeToken({ access: 'access-v1', refresh: 'refresh-v1' });
      await repo.save(token);

      const updated = ChannelOAuthToken.reconstitute({
        id: token.getId(),
        channelId: token.getChannelId(),
        platform: token.getPlatform(),
        accessToken: 'access-v2',
        refreshToken: 'refresh-v2',
        scope: token.getScope(),
        expiresAt: token.getExpiresAt(),
        updatedAt: new Date(),
      });
      await repo.save(updated);

      const count = await handle.channelOAuthTokenModel.countDocuments({}).exec();
      expect(count).toBe(1);

      const reloaded = await repo.findByChannelId(token.getChannelId(), token.getPlatform());
      expect(reloaded!.getAccessToken()).toBe('access-v2');
      expect(reloaded!.getRefreshToken()).toBe('refresh-v2');
    });
  });

  describe('compound unique index', () => {
    it('rejeita dois tokens com mesmo (channelId, platform)', async () => {
      await repo.save(makeToken({ channelId: 'c-dup', platform: 'twitch' }));
      await expect(
        repo.save(makeToken({ channelId: 'c-dup', platform: 'twitch' })),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('permite mesmo channelId em plataformas diferentes', async () => {
      await repo.save(makeToken({ channelId: 'c-multi', platform: 'twitch' }));
      await expect(
        repo.save(makeToken({ channelId: 'c-multi', platform: 'kick' })),
      ).resolves.toBeDefined();
    });
  });

  describe('delete', () => {
    it('remove pelo id', async () => {
      const token = makeToken();
      const saved = await repo.save(token);
      await repo.delete(saved.getId());
      expect(await repo.findByChannelId(token.getChannelId(), token.getPlatform())).toBeNull();
    });
  });
});
