/**
 * Testes de unidade da entidade User.
 * Pure TS — não precisa de Mongo. Roda no jest do @sehloro/infra via alias.
 * (Colocamos o .spec aqui no próprio libs/domain para manter coesão, mas
 * o jest do libs/infra também resolveria pelo moduleNameMapper.)
 */
import { InvalidUserError, User } from './user.entity';

describe('User entity', () => {
  describe('create', () => {
    it('gera id novo e usa defaults', () => {
      const u = User.create({
        username: 'x',
        email: 'x@y.com',
        passwordHash: 'h',
      });
      expect(u.getId()).toBeDefined();
      expect(u.getId().length).toBeGreaterThan(0);
      expect(u.getRole()).toBe('user');
    });

    it('aceita role explicito', () => {
      const u = User.create({
        username: 'x',
        email: 'x@y.com',
        passwordHash: 'h',
        role: 'admin',
      });
      expect(u.getRole()).toBe('admin');
    });

    it('rejeita username vazio', () => {
      expect(() => User.create({ username: '  ', email: 'x@y.com', passwordHash: 'h' })).toThrow(
        InvalidUserError,
      );
    });

    it('rejeita email vazio', () => {
      expect(() => User.create({ username: 'x', email: '', passwordHash: 'h' })).toThrow(
        InvalidUserError,
      );
    });

    it('rejeita passwordHash vazio', () => {
      expect(() => User.create({ username: 'x', email: 'x@y.com', passwordHash: '' })).toThrow(
        InvalidUserError,
      );
    });
  });

  describe('reconstitute', () => {
    it('respeita id passado', () => {
      const u = User.reconstitute({
        id: 'fixed-id',
        username: 'x',
        email: 'x@y.com',
        passwordHash: 'h',
        role: 'moderator',
      });
      expect(u.getId()).toBe('fixed-id');
      expect(u.getRole()).toBe('moderator');
    });
  });

  describe('toPersistence', () => {
    it('mapeia passwordHash → password (nome legado)', () => {
      const u = User.reconstitute({
        id: 'id',
        username: 'x',
        email: 'x@y.com',
        passwordHash: 'hashed',
        role: 'user',
      });
      const p = u.toPersistence();
      expect(p.password).toBe('hashed');
      expect(p._id).toBe('id');
      expect(p.username).toBe('x');
      expect(p.email).toBe('x@y.com');
      expect(p.role).toBe('user');
    });
  });

  describe('validatePassword', () => {
    it('retorna false para plaintext vazio sem chamar compareFn', async () => {
      const u = User.create({
        username: 'x',
        email: 'x@y.com',
        passwordHash: 'h',
      });
      const cmp = jest.fn();
      expect(await u.validatePassword('', cmp)).toBe(false);
      expect(cmp).not.toHaveBeenCalled();
    });
  });
});
