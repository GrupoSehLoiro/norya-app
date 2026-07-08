/**
 * Contract (port) do repositório de User.
 *
 * Implementação concreta vive em `@sehloro/infra` (Mongoose). Módulos Nest
 * injetam pela constante de símbolo `USER_REPOSITORY` — evita acoplar a
 * API consumidora à implementação concreta e permite swap em testes.
 */
import { User } from './user.entity';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  /**
   * Lista para o gerenciador de acesso (rota admin). `limit` defensivo —
   * a página não pagina; base de usuários do console é pequena.
   */
  findAll(limit?: number): Promise<User[]>;
  /**
   * Upsert por id. Idempotente. Retorna a entidade persistida para permitir
   * que o caller use a versão canônica (id, timestamps eventuais) sem
   * precisar re-ler explicitamente.
   */
  save(user: User): Promise<User>;
  delete(id: string): Promise<void>;
}

export const USER_REPOSITORY = Symbol('UserRepository');
