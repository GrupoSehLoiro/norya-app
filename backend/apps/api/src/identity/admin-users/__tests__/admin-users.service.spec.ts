/**
 * Unit do AdminUsersService — regras da gestão de acesso:
 * criação de admin ativa/verificada com workspace, email duplicado rejeita,
 * troca de role funciona e auto-rebaixamento é bloqueado (anti-lockout).
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Membership, User, Workspace } from '@sehloro/domain';
import { AdminUsersService } from '../admin-users.service';

function makeRepos() {
  const users = new Map<string, User>();
  const userRepo = {
    findById: jest.fn(async (id: string) => users.get(id) ?? null),
    findByUsername: jest.fn(async () => null),
    findByEmail: jest.fn(
      async (email: string) => [...users.values()].find((u) => u.getEmail() === email) ?? null,
    ),
    findAll: jest.fn(async () => [...users.values()]),
    save: jest.fn(async (u: User) => {
      users.set(u.getId(), u);
      return u;
    }),
    delete: jest.fn(),
  };
  const workspaceRepo = {
    findBySlug: jest.fn(async () => null),
    save: jest.fn(async (w: Workspace) => w),
  } as never;
  const membershipRepo = {
    save: jest.fn(async (m: Membership) => m),
  } as never;
  const hasher = { hash: jest.fn(async (p: string) => `hashed:${p}`) } as never;
  const cascade = { deleteUserCascade: jest.fn() } as never;

  return { users, userRepo, workspaceRepo, membershipRepo, hasher, cascade };
}

function build() {
  const deps = makeRepos();
  const service = new AdminUsersService(
    deps.userRepo as never,
    deps.workspaceRepo,
    deps.membershipRepo,
    deps.hasher,
    deps.cascade,
  );
  return { service, ...deps };
}

describe('AdminUsersService', () => {
  it('cria admin ativo, verificado, com workspace pessoal e membership owner', async () => {
    const { service, userRepo, workspaceRepo, membershipRepo } = build();

    const view = await service.createUser({
      email: 'Chefe@Sehloro.dev',
      password: 'senha-forte-123',
      role: 'admin',
    });

    expect(view.role).toBe('admin');
    expect(view.status).toBe('active');
    expect(view.emailVerified).toBe(true);
    expect(view.email).toBe('chefe@sehloro.dev'); // normalizado
    expect(userRepo.save).toHaveBeenCalled();
    expect((workspaceRepo as { save: jest.Mock }).save).toHaveBeenCalled();
    expect((membershipRepo as { save: jest.Mock }).save).toHaveBeenCalled();
  });

  it('rejeita email já cadastrado', async () => {
    const { service } = build();
    await service.createUser({ email: 'a@b.c', password: 'senha-forte-123', role: 'user' });
    await expect(
      service.createUser({ email: 'a@b.c', password: 'outra-senha-123', role: 'admin' }),
    ).rejects.toThrow(ConflictException);
  });

  it('troca role de outro usuário', async () => {
    const { service } = build();
    const created = await service.createUser({
      email: 'mod@sehloro.dev',
      password: 'senha-forte-123',
      role: 'user',
    });

    const updated = await service.changeRole({
      targetUserId: created.id,
      role: 'admin',
      actingUserId: 'outro-admin-id',
    });
    expect(updated.role).toBe('admin');
  });

  it('bloqueia alterar o próprio papel (anti-lockout)', async () => {
    const { service } = build();
    const created = await service.createUser({
      email: 'root@sehloro.dev',
      password: 'senha-forte-123',
      role: 'admin',
    });

    await expect(
      service.changeRole({
        targetUserId: created.id,
        role: 'user',
        actingUserId: created.id,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('bloqueia apagar o próprio usuário (anti-lockout)', async () => {
    const { service, cascade } = build();
    await expect(
      service.deleteUser({ targetUserId: 'admin-1', actingUserId: 'admin-1' }),
    ).rejects.toThrow(ForbiddenException);
    expect((cascade as { deleteUserCascade: jest.Mock }).deleteUserCascade).not.toHaveBeenCalled();
  });

  it('delega a exclusão de terceiros ao cascade', async () => {
    const { service, cascade } = build();
    await service.deleteUser({ targetUserId: 'user-2', actingUserId: 'admin-1' });
    expect((cascade as { deleteUserCascade: jest.Mock }).deleteUserCascade).toHaveBeenCalledWith(
      'user-2',
    );
  });
});
