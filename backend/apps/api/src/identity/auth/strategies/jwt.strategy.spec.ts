/**
 * Testes unitários do JwtStrategy.
 *
 * Objetivo: validar o comportamento do `validate()` puro — interop entre o
 * payload NOVO (com `sub`) e o payload LEGADO (com `userId`).
 *
 * NÃO sobe nest context. Instanciamos a strategy direto, passando um mock
 * mínimo do `ConfigService` que retorna um JWT_SECRET qualquer (o passport
 * precisa dele para construir o super).
 */
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

function makeStrategy(): JwtStrategy {
  const config = {
    get: (_key: string, _opts?: unknown) => 'a'.repeat(40),
  } as unknown as ConstructorParameters<typeof JwtStrategy>[0];
  return new JwtStrategy(config);
}

describe('JwtStrategy.validate', () => {
  const strategy = makeStrategy();

  it('aceita payload novo { sub } e retorna AuthUser completo', () => {
    const result = strategy.validate({
      sub: 'u1',
      username: 'x',
      email: 'x@y.com',
      role: 'admin',
    });
    expect(result).toEqual({
      sub: 'u1',
      username: 'x',
      email: 'x@y.com',
      role: 'admin',
    });
  });

  it('aceita payload legado { userId } e mapeia para sub (interop)', () => {
    const result = strategy.validate({
      userId: 'u1',
      username: 'x',
      email: 'x@y.com',
      role: 'user',
    });
    expect(result).toEqual({
      sub: 'u1',
      username: 'x',
      email: 'x@y.com',
      role: 'user',
    });
  });

  it('prioriza sub sobre userId quando ambos vêm (defesa)', () => {
    const result = strategy.validate({
      sub: 'novo',
      userId: 'legado',
      username: 'x',
      email: 'x@y.com',
      role: 'user',
    });
    expect(result.sub).toBe('novo');
  });

  it('rejeita payload sem sub nem userId com Token inválido', () => {
    expect(() =>
      strategy.validate({
        username: 'x',
        email: 'x@y.com',
        role: 'user',
      }),
    ).toThrow(UnauthorizedException);

    try {
      strategy.validate({ username: 'x' });
      fail('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      const resp = (err as UnauthorizedException).getResponse();
      expect(resp).toEqual(expect.objectContaining({ message: 'Token inválido' }));
    }
  });

  it('aplica default role "user" quando payload vem sem role', () => {
    const result = strategy.validate({
      sub: 'u1',
      username: 'x',
      email: 'x@y.com',
    });
    expect(result.role).toBe('user');
  });

  it('aceita payload sem username/email (strategy não valida esses campos)', () => {
    const result = strategy.validate({ sub: 'u1' });
    expect(result.sub).toBe('u1');
    expect(result.username).toBe('');
    expect(result.email).toBe('');
    expect(result.role).toBe('user');
  });
});
