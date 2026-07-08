/**
 * PasswordHasher — wrapper fino sobre `bcrypt` registrado como provider
 * injetável. Mantém `AuthService` livre de `import 'bcrypt'` direto, o que
 * facilita testes (fornecer um mock com `provide: PasswordHasher, useValue:
 * { compare: async () => true }`) e também evita acoplar o domínio a uma
 * biblioteca de hash específica.
 *
 * `compare` bate o shape esperado por `User.validatePassword(plain, compareFn)`.
 */
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

@Injectable()
export class PasswordHasher {
  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  hash(plain: string, rounds = 10): Promise<string> {
    return bcrypt.hash(plain, rounds);
  }
}
