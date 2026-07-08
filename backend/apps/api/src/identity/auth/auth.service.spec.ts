/**
 * Testes unitários do AuthService.
 *
 * Estratégia:
 *  - UserRepository e RefreshTokenRepository são mocks puros (jest.fn()).
 *  - JwtService e PasswordHasher idem.
 *  - ConfigService é um stub que retorna defaults previsíveis.
 *
 * Sem Nest context — o service é testado como uma classe comum, o que mantém
 * o feedback rápido e isola as cadeias de controle.
 */
import { createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RefreshToken, RefreshTokenRepository, User, UserRepository } from '@sehloro/domain';
import { AuthService } from './auth.service';
import { PasswordHasher } from './password-hasher';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function makeUser(
  overrides: Partial<{
    id: string;
    username: string;
    email: string;
    role: 'admin' | 'user' | 'moderator';
    passwordHash: string;
  }> = {},
): User {
  return User.reconstitute({
    id: overrides.id ?? 'user-1',
    username: overrides.username ?? 'alice',
    email: overrides.email ?? 'alice@example.com',
    passwordHash: overrides.passwordHash ?? 'bcrypt$hash',
    role: overrides.role ?? 'user',
  });
}

function makeConfig(): ConfigService {
  return {
    get: (key: string, _opts?: unknown) => {
      if (key === 'JWT_ACCESS_TTL') return '15m';
      if (key === 'JWT_REFRESH_TTL_DAYS') return 7;
      return undefined;
    },
  } as unknown as ConfigService;
}

interface Mocks {
  userRepo: jest.Mocked<UserRepository>;
  refreshRepo: jest.Mocked<RefreshTokenRepository>;
  workspaceRepo: { findById: jest.Mock; findBySlug: jest.Mock; save: jest.Mock };
  membershipRepo: {
    findByUserId: jest.Mock;
    findByUserAndWorkspace: jest.Mock;
    save: jest.Mock;
  };
  codeRepo: {
    save: jest.Mock;
    findLatestActiveByEmail: jest.Mock;
    invalidateAllForEmail: jest.Mock;
  };
  email: { send: jest.Mock };
  jwt: jest.Mocked<JwtService>;
  hasher: jest.Mocked<PasswordHasher>;
}

function makeMocks(): Mocks {
  return {
    userRepo: {
      findById: jest.fn(),
      findByUsername: jest.fn(),
      findByEmail: jest.fn(),
      findAll: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    },
    refreshRepo: {
      save: jest.fn(),
      findByTokenHash: jest.fn(),
      revoke: jest.fn(),
      revokeAllByUserId: jest.fn(),
    },
    // Tenancy/sign-up: os testes de login só precisam que retornem vazio.
    workspaceRepo: {
      findById: jest.fn().mockResolvedValue(null),
      findBySlug: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    },
    membershipRepo: {
      findByUserId: jest.fn().mockResolvedValue([]),
      findByUserAndWorkspace: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    },
    codeRepo: {
      save: jest.fn(),
      findLatestActiveByEmail: jest.fn().mockResolvedValue(null),
      invalidateAllForEmail: jest.fn(),
    },
    email: { send: jest.fn().mockResolvedValue(undefined) },
    jwt: {
      sign: jest.fn().mockReturnValue('signed.jwt.token'),
      signAsync: jest.fn(),
      verify: jest.fn(),
      verifyAsync: jest.fn(),
      decode: jest.fn(),
    } as unknown as jest.Mocked<JwtService>,
    hasher: {
      compare: jest.fn(),
      hash: jest.fn(),
    } as unknown as jest.Mocked<PasswordHasher>,
  };
}

function makeService(mocks: Mocks): AuthService {
  return new AuthService(
    mocks.userRepo,
    mocks.refreshRepo,
    mocks.workspaceRepo as unknown as ConstructorParameters<typeof AuthService>[2],
    mocks.membershipRepo as unknown as ConstructorParameters<typeof AuthService>[3],
    mocks.codeRepo as unknown as ConstructorParameters<typeof AuthService>[4],
    mocks.email as unknown as ConstructorParameters<typeof AuthService>[5],
    mocks.jwt,
    makeConfig() as unknown as ConstructorParameters<typeof AuthService>[7],
    mocks.hasher,
  );
}

describe('AuthService.login', () => {
  it('lança Credenciais inválidas quando usuário não existe', async () => {
    const mocks = makeMocks();
    mocks.userRepo.findByUsername.mockResolvedValue(null);
    const service = makeService(mocks);

    await expect(service.login({ username: 'ghost', password: 'x' })).rejects.toMatchObject({
      constructor: UnauthorizedException,
    });
    try {
      await service.login({ username: 'ghost', password: 'x' });
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as UnauthorizedException).getResponse()).toEqual(
        expect.objectContaining({ message: 'Credenciais inválidas' }),
      );
    }
  });

  it('lança Credenciais inválidas quando senha errada', async () => {
    const mocks = makeMocks();
    mocks.userRepo.findByUsername.mockResolvedValue(makeUser());
    mocks.hasher.compare.mockResolvedValue(false);
    const service = makeService(mocks);

    try {
      await service.login({ username: 'alice', password: 'wrong' });
      fail('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as UnauthorizedException).getResponse()).toEqual(
        expect.objectContaining({ message: 'Credenciais inválidas' }),
      );
    }
  });

  it('emite par access/refresh quando credenciais OK', async () => {
    const mocks = makeMocks();
    const user = makeUser({ id: 'u42', username: 'alice', role: 'admin' });
    mocks.userRepo.findByUsername.mockResolvedValue(user);
    mocks.hasher.compare.mockResolvedValue(true);
    mocks.refreshRepo.save.mockImplementation(async (t) => t);
    const service = makeService(mocks);

    const before = Date.now();
    const result = await service.login({ username: 'alice', password: 'ok' });
    const after = Date.now();

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(typeof result.refreshToken).toBe('string');
    expect(result.refreshToken.length).toBeGreaterThan(32);
    expect(result.user).toEqual({
      id: 'u42',
      username: 'alice',
      email: 'alice@example.com',
      role: 'admin',
      displayName: null,
    });

    // JWT sign chamado com payload canônico
    expect(mocks.jwt.sign).toHaveBeenCalledWith(
      {
        sub: 'u42',
        username: 'alice',
        email: 'alice@example.com',
        role: 'admin',
      },
      expect.objectContaining({ expiresIn: '15m' }),
    );

    // Refresh persistido com SHA-256, NÃO com plaintext
    expect(mocks.refreshRepo.save).toHaveBeenCalledTimes(1);
    const savedEntity = mocks.refreshRepo.save.mock.calls[0]![0] as RefreshToken;
    expect(savedEntity.getTokenHash()).toBe(sha256(result.refreshToken));
    expect(savedEntity.getTokenHash()).not.toBe(result.refreshToken);
    expect(savedEntity.getUserId()).toBe('u42');
    expect(savedEntity.getRotatedFromId()).toBeNull();

    // expiresAt ~7 dias no futuro
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(savedEntity.getExpiresAt().getTime()).toBeGreaterThanOrEqual(
      before + sevenDaysMs - 1000,
    );
    expect(savedEntity.getExpiresAt().getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
  });
});

describe('AuthService.refresh', () => {
  it('lança Refresh inválido quando token não existe no repo', async () => {
    const mocks = makeMocks();
    mocks.refreshRepo.findByTokenHash.mockResolvedValue(null);
    const service = makeService(mocks);

    try {
      await service.refresh({ refreshToken: 'anything' });
      fail('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as UnauthorizedException).getResponse()).toEqual(
        expect.objectContaining({ message: 'Refresh inválido' }),
      );
    }
  });

  it('detecta reuse quando token já revogado e derruba sessão inteira', async () => {
    const mocks = makeMocks();
    const revoked = RefreshToken.reconstitute({
      id: 'r1',
      userId: 'u1',
      tokenHash: sha256('plain'),
      expiresAt: new Date(Date.now() + 86400_000),
      createdAt: new Date(Date.now() - 3600_000),
      revokedAt: new Date(Date.now() - 100),
      rotatedFromId: null,
    });
    mocks.refreshRepo.findByTokenHash.mockResolvedValue(revoked);
    const service = makeService(mocks);

    try {
      await service.refresh({ refreshToken: 'plain' });
      fail('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as UnauthorizedException).getResponse()).toEqual(
        expect.objectContaining({
          message: 'Refresh reutilizado — sessão revogada',
        }),
      );
    }
    expect(mocks.refreshRepo.revokeAllByUserId).toHaveBeenCalledWith('u1');
  });

  it('lança Refresh expirado quando expiresAt no passado', async () => {
    const mocks = makeMocks();
    const expired = RefreshToken.reconstitute({
      id: 'r1',
      userId: 'u1',
      tokenHash: sha256('plain'),
      expiresAt: new Date(Date.now() - 60_000),
      createdAt: new Date(Date.now() - 100_000),
      revokedAt: null,
      rotatedFromId: null,
    });
    mocks.refreshRepo.findByTokenHash.mockResolvedValue(expired);
    const service = makeService(mocks);

    try {
      await service.refresh({ refreshToken: 'plain' });
      fail('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as UnauthorizedException).getResponse()).toEqual(
        expect.objectContaining({ message: 'Refresh expirado' }),
      );
    }
  });

  it('lança Refresh inválido quando user sumiu entre login e refresh', async () => {
    const mocks = makeMocks();
    const active = RefreshToken.reconstitute({
      id: 'r1',
      userId: 'u-gone',
      tokenHash: sha256('plain'),
      expiresAt: new Date(Date.now() + 86400_000),
      createdAt: new Date(),
      revokedAt: null,
      rotatedFromId: null,
    });
    mocks.refreshRepo.findByTokenHash.mockResolvedValue(active);
    mocks.userRepo.findById.mockResolvedValue(null);
    const service = makeService(mocks);

    try {
      await service.refresh({ refreshToken: 'plain' });
      fail('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as UnauthorizedException).getResponse()).toEqual(
        expect.objectContaining({ message: 'Refresh inválido' }),
      );
    }
    expect(mocks.refreshRepo.revoke).toHaveBeenCalledWith('r1', 'user-not-found');
  });

  it('rotaciona: revoga o antigo e emite novo par encadeado', async () => {
    const mocks = makeMocks();
    const active = RefreshToken.reconstitute({
      id: 'r1',
      userId: 'u1',
      tokenHash: sha256('plain-original'),
      expiresAt: new Date(Date.now() + 86400_000),
      createdAt: new Date(Date.now() - 60_000),
      revokedAt: null,
      rotatedFromId: null,
    });
    mocks.refreshRepo.findByTokenHash.mockResolvedValue(active);
    mocks.userRepo.findById.mockResolvedValue(
      makeUser({ id: 'u1', username: 'alice', role: 'user' }),
    );
    mocks.refreshRepo.save.mockImplementation(async (t) => t);
    const service = makeService(mocks);

    const result = await service.refresh({ refreshToken: 'plain-original' });

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(typeof result.refreshToken).toBe('string');
    expect(result.refreshToken).not.toBe('plain-original');

    expect(mocks.refreshRepo.revoke).toHaveBeenCalledWith('r1', 'rotated');

    const savedEntity = mocks.refreshRepo.save.mock.calls[0]![0] as RefreshToken;
    expect(savedEntity.getRotatedFromId()).toBe('r1');
    expect(savedEntity.getUserId()).toBe('u1');
    expect(savedEntity.getTokenHash()).toBe(sha256(result.refreshToken));
  });
});

describe('AuthService.logout', () => {
  it('revoga quando token válido é apresentado', async () => {
    const mocks = makeMocks();
    const active = RefreshToken.reconstitute({
      id: 'r1',
      userId: 'u1',
      tokenHash: sha256('plain'),
      expiresAt: new Date(Date.now() + 86400_000),
      createdAt: new Date(),
      revokedAt: null,
      rotatedFromId: null,
    });
    mocks.refreshRepo.findByTokenHash.mockResolvedValue(active);
    const service = makeService(mocks);

    await expect(service.logout({ refreshToken: 'plain' })).resolves.toBeUndefined();
    expect(mocks.refreshRepo.revoke).toHaveBeenCalledWith('r1', 'logout');
  });

  it('é idempotente quando token não existe (sem throw, sem revoke)', async () => {
    const mocks = makeMocks();
    mocks.refreshRepo.findByTokenHash.mockResolvedValue(null);
    const service = makeService(mocks);

    await expect(service.logout({ refreshToken: 'ghost' })).resolves.toBeUndefined();
    expect(mocks.refreshRepo.revoke).not.toHaveBeenCalled();
  });

  it('não revoga de novo quando token já revogado', async () => {
    const mocks = makeMocks();
    const revoked = RefreshToken.reconstitute({
      id: 'r1',
      userId: 'u1',
      tokenHash: sha256('plain'),
      expiresAt: new Date(Date.now() + 86400_000),
      createdAt: new Date(),
      revokedAt: new Date(Date.now() - 100),
      rotatedFromId: null,
    });
    mocks.refreshRepo.findByTokenHash.mockResolvedValue(revoked);
    const service = makeService(mocks);

    await expect(service.logout({ refreshToken: 'plain' })).resolves.toBeUndefined();
    expect(mocks.refreshRepo.revoke).not.toHaveBeenCalled();
  });
});
