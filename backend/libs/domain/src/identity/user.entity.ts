/**
 * Entidade de domínio: User (Identity bounded context).
 *
 * Regras arquiteturais:
 * - Pura TypeScript. NÃO importa `@nestjs/*`, `mongoose` ou qualquer runtime
 *   de infraestrutura. Dependência de `node:crypto` é aceitável (stdlib).
 * - A representação canônica no domínio é camelCase (`passwordHash`,
 *   `createdAt`). O mapeamento para os nomes legados do Mongo (`password`,
 *   `created_at`) acontece exclusivamente em `toPersistence()` e no mapper
 *   inverso do pacote `@sehloro/infra`.
 *
 * Estratégia de ID (ver também libs/domain/src/shared/identity.ts):
 * - `User.create({...})` gera um UUID v4 via `generateId()`. Esse id é usado
 *   como `_id` do documento Mongo no upsert feito pelo repositório. A opção
 *   alternativa seria deixar o Mongo gerar um ObjectId e mutar a entidade
 *   com o id gerado após `save` — preferimos UUID no create porque:
 *     (a) mantém a entidade internamente consistente (imutável após create,
 *         sem mutação pós-save);
 *     (b) evita que o domínio dependa do formato do driver;
 *     (c) facilita testes (id previsível via mock de `generateId`).
 *   Documentos legados criados pelos bots continuam tendo ObjectId como `_id`;
 *   quando o API rehidrata esses docs via `reconstitute`, o id da entidade
 *   passa a ser a string hex do ObjectId — ambos formatos convivem.
 */
import { DomainError } from '../errors/domain-error';
import { generateId } from '../shared/identity';

export type UserRole = 'admin' | 'user' | 'moderator';

/**
 * Ciclo de vida da conta no fluxo novo de sign-up:
 *  - `pending_email`: cadastrado, aguardando confirmação por código.
 *  - `active`: email confirmado, pode logar normalmente.
 *  - `disabled`: desativado.
 * Campo opcional — usuários legados (criados pelo Express/bots) não têm `status`
 * e são tratados como já ativos (ver `getStatus()`).
 */
export type UserStatus = 'pending_email' | 'active' | 'disabled';

export interface UserPersistenceShape {
  _id: string;
  username: string;
  /** Nome legado: o schema Mongo ainda escreve em `password`. */
  password: string;
  email: string;
  role: UserRole;
  // ── Campos novos (opcionais — zero impacto em docs legados / bots) ──
  status?: UserStatus;
  emailVerifiedAt?: Date | null;
  onboardingCompletedAt?: Date | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  locale?: string | null;
}

/** Perfil de conta editável (não credencial). */
export interface UserProfileInput {
  displayName?: string | null;
  avatarUrl?: string | null;
  locale?: string | null;
}

/**
 * Erros de domínio específicos de User. Ficam no mesmo arquivo para
 * manter coesão local — são consumidos só aqui.
 */
export class InvalidUserError extends DomainError {
  public readonly code = 'INVALID_USER';
  public readonly statusCode = 422;
}

export class User {
  private constructor(
    private readonly id: string,
    private readonly username: string,
    private readonly email: string,
    private readonly passwordHash: string,
    private role: UserRole,
    private status: UserStatus,
    private emailVerifiedAt: Date | null,
    private onboardingCompletedAt: Date | null,
    private displayName: string | null,
    private avatarUrl: string | null,
    private locale: string | null,
  ) {}

  /**
   * Factory de criação. Gera id novo e valida invariantes.
   * Use quando um novo usuário entra no sistema (ex.: registro).
   *
   * No fluxo novo de sign-up o `status` nasce `pending_email` (aguarda código).
   */
  static create(props: {
    username: string;
    email: string;
    passwordHash: string;
    role?: UserRole;
    status?: UserStatus;
    displayName?: string | null;
    locale?: string | null;
  }): User {
    User.assertInvariants(props);
    return new User(
      generateId(),
      props.username,
      props.email,
      props.passwordHash,
      props.role ?? 'user',
      props.status ?? 'active',
      null,
      null,
      props.displayName ?? null,
      null,
      props.locale ?? null,
    );
  }

  /**
   * Rehidratação a partir de persistência. NÃO valida invariantes "de criação"
   * (um documento já salvo pode ter sido escrito por um bot legado antes
   * desta classe existir). Validação forte só em `create`.
   *
   * Docs legados sem `status` → tratados como `active` (já existiam e logavam).
   */
  static reconstitute(props: {
    id: string;
    username: string;
    email: string;
    passwordHash: string;
    role: UserRole;
    status?: UserStatus;
    emailVerifiedAt?: Date | null;
    onboardingCompletedAt?: Date | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    locale?: string | null;
  }): User {
    return new User(
      props.id,
      props.username,
      props.email,
      props.passwordHash,
      props.role,
      props.status ?? 'active',
      props.emailVerifiedAt ?? null,
      props.onboardingCompletedAt ?? null,
      props.displayName ?? null,
      props.avatarUrl ?? null,
      props.locale ?? null,
    );
  }

  private static assertInvariants(props: {
    username: string;
    email: string;
    passwordHash: string;
  }): void {
    if (!props.username || props.username.trim().length === 0) {
      throw new InvalidUserError('username não pode ser vazio');
    }
    if (!props.email || props.email.trim().length === 0) {
      throw new InvalidUserError('email não pode ser vazio');
    }
    if (!props.passwordHash || props.passwordHash.length === 0) {
      throw new InvalidUserError('passwordHash não pode ser vazio');
    }
  }

  /**
   * Valida senha em texto puro contra o hash armazenado.
   * O comparador é injetado de fora (bcrypt mora em infra, não aqui).
   * AUTH-01 vai conectar o bcrypt real; nos testes pode ser um mock trivial.
   */
  async validatePassword(
    plaintext: string,
    compareFn: (plain: string, hash: string) => Promise<boolean>,
  ): Promise<boolean> {
    if (!plaintext) return false;
    return compareFn(plaintext, this.passwordHash);
  }

  getId(): string {
    return this.id;
  }

  getUsername(): string {
    return this.username;
  }

  getEmail(): string {
    return this.email;
  }

  getRole(): UserRole {
    return this.role;
  }

  getStatus(): UserStatus {
    return this.status;
  }
  getEmailVerifiedAt(): Date | null {
    return this.emailVerifiedAt;
  }
  isEmailVerified(): boolean {
    return this.emailVerifiedAt !== null || this.status === 'active';
  }
  getOnboardingCompletedAt(): Date | null {
    return this.onboardingCompletedAt;
  }
  isOnboardingCompleted(): boolean {
    return this.onboardingCompletedAt !== null;
  }
  getDisplayName(): string | null {
    return this.displayName;
  }
  getAvatarUrl(): string | null {
    return this.avatarUrl;
  }
  getLocale(): string | null {
    return this.locale;
  }

  /** Confirma o email (verificação 1x): marca verificado e ativa a conta. */
  /**
   * Troca de papel — SOMENTE via gestão de acesso (rota admin). O sign-up
   * público nunca passa por aqui; o RegisterDto nem aceita `role`.
   */
  changeRole(role: UserRole): void {
    this.role = role;
  }

  markEmailVerified(at: Date = new Date()): void {
    this.emailVerifiedAt = at;
    if (this.status === 'pending_email') {
      this.status = 'active';
    }
  }
  markOnboardingCompleted(at: Date = new Date()): void {
    this.onboardingCompletedAt = at;
  }
  updateProfile(input: UserProfileInput): void {
    if (input.displayName !== undefined) this.displayName = input.displayName;
    if (input.avatarUrl !== undefined) this.avatarUrl = input.avatarUrl;
    if (input.locale !== undefined) this.locale = input.locale;
  }

  /**
   * Projeção para persistência. Mapeia `passwordHash` (domínio) → `password`
   * (Mongo, legado). Campos novos saem como `undefined` quando nulos para não
   * poluir docs legados desnecessariamente — o schema os trata como opcionais.
   *
   * Mantido como método público porque o repositório de infra precisa ler o
   * hash para persistir; o getter público continua escondido para não vazar
   * credenciais por caminhos triviais (ex.: `JSON.stringify(user)`).
   */
  toPersistence(): UserPersistenceShape {
    return {
      _id: this.id,
      username: this.username,
      password: this.passwordHash,
      email: this.email,
      role: this.role,
      status: this.status,
      emailVerifiedAt: this.emailVerifiedAt,
      onboardingCompletedAt: this.onboardingCompletedAt,
      displayName: this.displayName,
      avatarUrl: this.avatarUrl,
      locale: this.locale,
    };
  }
}
