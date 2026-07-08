/**
 * Testes do ChannelMongooseRepository.
 * Estrutura espelha user.mongoose.repository.spec.ts — ver comentários lá.
 */
import { Channel } from '@sehloro/domain';
import { ChannelMongooseRepository } from '../repositories/channel.mongoose.repository';
import { startTestMongo, TestMongoHandle } from './test-utils';
import { toDomain, toPersistence } from '../mappers/channel.mapper';

describe('ChannelMongooseRepository', () => {
  let handle: TestMongoHandle;
  let repo: ChannelMongooseRepository;

  beforeAll(async () => {
    handle = await startTestMongo();
    await handle.channelModel.syncIndexes();
    repo = new ChannelMongooseRepository(handle.channelModel);
  });

  afterAll(async () => {
    await handle.close();
  });

  afterEach(async () => {
    await handle.channelModel.deleteMany({}).exec();
  });

  describe('save + findById', () => {
    it('persiste e recupera uma entidade criada via create', async () => {
      const ch = Channel.create({
        name: 'sehloiro',
        platform: 'twitch',
      });

      const saved = await repo.save(ch);
      expect(saved.getName()).toBe('sehloiro');
      expect(saved.isActive()).toBe(true);
      expect(saved.getChannelWithPrefix()).toBe('#sehloiro');

      const found = await repo.findById(saved.getId());
      expect(found).not.toBeNull();
      expect(found!.getName()).toBe('sehloiro');
    });

    it('retorna null quando o id não existe', async () => {
      const found = await repo.findById('000000000000000000000000');
      expect(found).toBeNull();
    });
  });

  describe('findByName', () => {
    it('acerta quando existe', async () => {
      await repo.save(Channel.create({ name: 'canal-a', platform: 'twitch' }));
      const found = await repo.findByName('canal-a');
      expect(found).not.toBeNull();
      expect(found!.getName()).toBe('canal-a');
    });

    it('retorna null quando não encontra', async () => {
      expect(await repo.findByName('inexistente')).toBeNull();
    });
  });

  describe('findAllActive', () => {
    it('retorna só os ativos', async () => {
      const ativo = Channel.create({ name: 'a', platform: 'twitch' });
      const inativo = Channel.create({
        name: 'b',
        platform: 'twitch',
        active: false,
      });
      await repo.save(ativo);
      await repo.save(inativo);

      const ativos = await repo.findAllActive();
      expect(ativos.length).toBe(1);
      expect(ativos[0]!.getName()).toBe('a');
    });
  });

  describe('save (update)', () => {
    it('atualiza quando id já existe, sem duplicar', async () => {
      const saved = await repo.save(Channel.create({ name: 'x', platform: 'twitch' }));

      const updated = Channel.reconstitute({
        id: saved.getId(),
        name: 'x',
        platform: 'twitch',
        active: false,
        createdAt: saved.getCreatedAt(),
      });
      await repo.save(updated);

      const count = await handle.channelModel.countDocuments({}).exec();
      expect(count).toBe(1);

      const refreshed = await repo.findById(saved.getId());
      expect(refreshed!.isActive()).toBe(false);
    });
  });

  describe('delete', () => {
    it('remove pelo id', async () => {
      const saved = await repo.save(Channel.create({ name: 'y', platform: 'twitch' }));
      await repo.delete(saved.getId());
      expect(await repo.findById(saved.getId())).toBeNull();
    });
  });

  describe('unique constraint', () => {
    it('dispara erro de chave duplicada em channel (E11000)', async () => {
      await repo.save(Channel.create({ name: 'dup', platform: 'twitch' }));
      await expect(
        repo.save(Channel.create({ name: 'dup', platform: 'twitch' })),
      ).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe('mapper roundtrip', () => {
    it('toDomain(toPersistence(channel)) preserva campos legados', async () => {
      const ch = Channel.create({ name: 'roundtrip', platform: 'twitch' });
      await repo.save(ch);

      const doc = await handle.channelModel.findById(ch.getId()).exec();
      expect(doc).not.toBeNull();

      // O doc tem os nomes LEGADOS
      expect(doc!.channel).toBe('roundtrip');
      expect(doc!.channelWithPrefix).toBe('#roundtrip');
      expect(doc!.created_at).toBeInstanceOf(Date);

      const rehydrated = toDomain(doc!);
      expect(rehydrated.getName()).toBe('roundtrip');
      expect(rehydrated.getChannelWithPrefix()).toBe('#roundtrip');

      // Persistence shape usa os nomes LEGADOS, não os de domínio
      const p = toPersistence(rehydrated);
      expect(p).toHaveProperty('channel');
      expect(p).toHaveProperty('channelWithPrefix');
      expect(p).toHaveProperty('created_at');
      expect(p).not.toHaveProperty('name');
      expect(p).not.toHaveProperty('createdAt');
    });
  });
});
