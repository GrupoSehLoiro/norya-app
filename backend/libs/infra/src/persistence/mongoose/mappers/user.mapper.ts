/**
 * Mapper User ↔ UserDocument.
 *
 * Funções puras — não recebem dependências injetadas. Só traduzem shapes.
 * Isso mantém o repositório fino e facilita testes de roundtrip.
 */
import { User, UserRole, UserStatus } from '@sehloro/domain';
import { UserDocument } from '../schemas/user.schema';

/**
 * Converte um documento Mongo em entidade de domínio.
 * Usa `reconstitute` (não valida invariantes "de criação" — docs escritos
 * por bots legados podem ter dados históricos que não passariam no `create`).
 */
export function toDomain(doc: UserDocument): User {
  return User.reconstitute({
    id: String(doc._id),
    username: doc.username,
    email: doc.email,
    passwordHash: doc.password,
    role: (doc.role as UserRole) ?? 'user',
    status: (doc.status as UserStatus) ?? undefined,
    emailVerifiedAt: doc.emailVerifiedAt ?? null,
    onboardingCompletedAt: doc.onboardingCompletedAt ?? null,
    displayName: doc.displayName ?? null,
    avatarUrl: doc.avatarUrl ?? null,
    locale: doc.locale ?? null,
  });
}

/**
 * Converte uma entidade de domínio no shape legado para persistir no Mongo.
 * Delega para `user.toPersistence()` — única fonte de verdade do mapping.
 */
export function toPersistence(user: User): ReturnType<User['toPersistence']> {
  return user.toPersistence();
}
