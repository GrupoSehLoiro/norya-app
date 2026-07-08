/**
 * Testes do UserMongooseRepository.
 *
 * Usamos `mongodb-memory-server` para rodar contra um Mongo real em memória
 * — preferível a mocks porque cobre caminhos específicos do driver (upsert,
 * unique index, cast de _id).
 *
 * Casos exigidos pelo NEST-04:
 *  - save + findById roundtrip
 *  - findByUsername acerto + erro (null)
 *  - findByEmail acerto + erro (null)
 *  - save atualiza quando id já existe (não duplica)
 *  - delete remove
 *  - Unique constraint: save com username já existente → erro 11000
 *  - Mapper roundtrip preserva campos
 */
import { User } from '@sehloro/domain';
import { UserMongooseRepository } from '../repositories/user.mongoose.repository';
import { startTestMongo, TestMongoHandle } from './test-utils';
import { toDomain, toPersistence } from '../mappers/user.mapper';

describe('UserMongooseRepository', () => {
  let handle: TestMongoHandle;
  let repo: UserMongooseRepository;

  beforeAll(async () => {
    handle = await startTestMongo();
    // Garante que os índices únicos sejam construídos antes dos testes
    // (Mongoose constrói async por padrão; sem isso o teste de E11000 "flaka").
    await handle.userModel.syncIndexes();
    repo = new UserMongooseRepository(handle.userModel);
  });

  afterAll(async () => {
    await handle.close();
  });

  afterEach(async () => {
    await handle.userModel.deleteMany({}).exec();
  });

  describe('save + findById', () => {
    it('persiste e recupera uma entidade criada via create', async () => {
      const user = User.create({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: 'hash-alice',
      });

      const saved = await repo.save(user);
      expect(saved.getUsername()).toBe('alice');

      const found = await repo.findById(saved.getId());
      expect(found).not.toBeNull();
      expect(found!.getUsername()).toBe('alice');
      expect(found!.getEmail()).toBe('alice@example.com');
      expect(found!.getRole()).toBe('user');
    });

    it('retorna null quando o id não existe', async () => {
      const found = await repo.findById('000000000000000000000000');
      expect(found).toBeNull();
    });
  });

  describe('findByUsername / findByEmail', () => {
    it('acerta quando existe', async () => {
      const user = User.create({
        username: 'bob',
        email: 'bob@example.com',
        passwordHash: 'h',
      });
      await repo.save(user);

      const byUsername = await repo.findByUsername('bob');
      expect(byUsername).not.toBeNull();
      expect(byUsername!.getEmail()).toBe('bob@example.com');

      const byEmail = await repo.findByEmail('bob@example.com');
      expect(byEmail).not.toBeNull();
      expect(byEmail!.getUsername()).toBe('bob');
    });

    it('retorna null quando não encontra', async () => {
      expect(await repo.findByUsername('ninguem')).toBeNull();
      expect(await repo.findByEmail('nope@x.com')).toBeNull();
    });
  });

  describe('save (update)', () => {
    it('atualiza quando id já existe, sem duplicar', async () => {
      const user = User.create({
        username: 'carol',
        email: 'carol@example.com',
        passwordHash: 'h1',
        role: 'user',
      });
      const saved = await repo.save(user);

      // Reconstitui com novo email e role mas mesmo id
      const updated = User.reconstitute({
        id: saved.getId(),
        username: 'carol',
        email: 'carol@new.com',
        passwordHash: 'h2',
        role: 'admin',
      });
      await repo.save(updated);

      const count = await handle.userModel.countDocuments({}).exec();
      expect(count).toBe(1);

      const refreshed = await repo.findById(saved.getId());
      expect(refreshed!.getEmail()).toBe('carol@new.com');
      expect(refreshed!.getRole()).toBe('admin');
    });
  });

  describe('delete', () => {
    it('remove pelo id', async () => {
      const user = User.create({
        username: 'dave',
        email: 'dave@example.com',
        passwordHash: 'h',
      });
      const saved = await repo.save(user);
      await repo.delete(saved.getId());
      expect(await repo.findById(saved.getId())).toBeNull();
    });

    it('não falha ao deletar id inexistente', async () => {
      await expect(repo.delete('000000000000000000000000')).resolves.toBeUndefined();
    });
  });

  describe('unique constraint', () => {
    it('dispara erro de chave duplicada em username (E11000)', async () => {
      const u1 = User.create({
        username: 'eve',
        email: 'eve1@example.com',
        passwordHash: 'h',
      });
      await repo.save(u1);

      const u2 = User.create({
        username: 'eve',
        email: 'eve2@example.com',
        passwordHash: 'h',
      });

      // save de um novo _id com username repetido → E11000
      await expect(repo.save(u2)).rejects.toMatchObject({
        code: 11000,
      });
    });
  });

  describe('mapper roundtrip', () => {
    it('toDomain(toPersistence(user)) preserva campos', async () => {
      const user = User.create({
        username: 'frank',
        email: 'frank@example.com',
        passwordHash: 'h',
        role: 'moderator',
      });
      await repo.save(user);
      const doc = await handle.userModel.findById(user.getId()).exec();
      expect(doc).not.toBeNull();

      const rehydrated = toDomain(doc!);
      expect(rehydrated.getUsername()).toBe(user.getUsername());
      expect(rehydrated.getEmail()).toBe(user.getEmail());
      expect(rehydrated.getRole()).toBe(user.getRole());

      // Confere que o shape persistido usa os nomes LEGADOS
      const persistence = toPersistence(rehydrated);
      expect(persistence).toHaveProperty('password'); // não passwordHash
      expect(persistence).not.toHaveProperty('passwordHash');
    });
  });

  describe('validatePassword', () => {
    it('delega ao compareFn injetado e retorna seu resultado', async () => {
      const user = User.create({
        username: 'gina',
        email: 'gina@example.com',
        passwordHash: 'stored-hash',
      });

      const compare = jest.fn().mockImplementation(async (plain: string, hash: string) => {
        return plain === 'right' && hash === 'stored-hash';
      });

      expect(await user.validatePassword('right', compare)).toBe(true);
      expect(await user.validatePassword('wrong', compare)).toBe(false);
      expect(await user.validatePassword('', compare)).toBe(false);
    });
  });
});
