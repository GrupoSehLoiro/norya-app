/**
 * Testes unitários do JwtAuthGuard.
 *
 * Cobre:
 *  - `canActivate` com metadata `@Public()` → bypass sem delegar ao super.
 *  - `canActivate` sem `@Public()` → delega ao super (`AuthGuard('jwt')`).
 *  - `handleRequest` diferenciando "Token não fornecido" vs "Token inválido"
 *    conforme o header Authorization.
 */
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Constrói um mock de `ExecutionContext` cujo `switchToHttp().getRequest()`
 * devolve o objeto `request` fornecido. Suficiente para testar o guard.
 */
function makeContext(request: { headers?: Record<string, unknown> } = {}): ExecutionContext {
  const handler = jest.fn();
  const controllerClass = class {};
  return {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({ getContext: () => ({}), getData: () => ({}) }),
    switchToWs: () => ({
      getClient: () => ({}),
      getData: () => ({}),
      getPattern: () => '',
    }),
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  describe('canActivate', () => {
    it('retorna true sem delegar ao super quando @Public() está presente', () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(true),
      } as unknown as Reflector;
      const guard = new JwtAuthGuard(reflector);

      // Spy no super.canActivate via prototype — se chamarem, detectamos.
      const parentProto = Object.getPrototypeOf(Object.getPrototypeOf(guard));
      const superSpy = jest.spyOn(parentProto, 'canActivate');

      const ctx = makeContext();
      const result = guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(superSpy).not.toHaveBeenCalled();
      superSpy.mockRestore();
    });

    it('delega ao super quando @Public() não está presente', () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(false),
      } as unknown as Reflector;
      const guard = new JwtAuthGuard(reflector);

      const parentProto = Object.getPrototypeOf(Object.getPrototypeOf(guard));
      const superSpy = jest
        .spyOn(parentProto, 'canActivate')
        .mockReturnValue(true as unknown as Promise<boolean>);

      const ctx = makeContext();
      const result = guard.canActivate(ctx);

      expect(superSpy).toHaveBeenCalledWith(ctx);
      expect(result).toBe(true);
      superSpy.mockRestore();
    });
  });

  describe('handleRequest', () => {
    const reflector = {} as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);

    it('retorna o user quando válido', () => {
      const user = { sub: 'u1', username: 'a', email: 'a@b.c', role: 'user' };
      const ctx = makeContext({ headers: { authorization: 'Bearer abc.def.ghi' } });
      expect(guard.handleRequest(null, user, null, ctx)).toEqual(user);
    });

    it('lança "Token não fornecido" quando header Authorization ausente', () => {
      const ctx = makeContext({ headers: {} });
      try {
        guard.handleRequest(null, false, null, ctx);
        fail('deveria ter lançado');
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        const resp = (err as UnauthorizedException).getResponse();
        expect(resp).toEqual(expect.objectContaining({ message: 'Token não fornecido' }));
      }
    });

    it('lança "Token não fornecido" quando header é Basic (não-Bearer)', () => {
      const ctx = makeContext({ headers: { authorization: 'Basic xyz' } });
      try {
        guard.handleRequest(null, false, null, ctx);
        fail('deveria ter lançado');
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        const resp = (err as UnauthorizedException).getResponse();
        expect(resp).toEqual(expect.objectContaining({ message: 'Token não fornecido' }));
      }
    });

    it('lança "Token não fornecido" quando Bearer sem valor (só "Bearer ")', () => {
      const ctx = makeContext({ headers: { authorization: 'Bearer ' } });
      try {
        guard.handleRequest(null, false, null, ctx);
        fail('deveria ter lançado');
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        const resp = (err as UnauthorizedException).getResponse();
        expect(resp).toEqual(expect.objectContaining({ message: 'Token não fornecido' }));
      }
    });

    it('lança "Token inválido" quando há Bearer mas info indica expiração', () => {
      const info = Object.assign(new Error('jwt expired'), {
        name: 'TokenExpiredError',
      });
      const ctx = makeContext({ headers: { authorization: 'Bearer x.y.z' } });
      try {
        guard.handleRequest(null, false, info, ctx);
        fail('deveria ter lançado');
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        const resp = (err as UnauthorizedException).getResponse();
        expect(resp).toEqual(expect.objectContaining({ message: 'Token inválido' }));
      }
    });

    it('lança "Token inválido" quando há Bearer mas info indica JsonWebTokenError', () => {
      const info = Object.assign(new Error('invalid signature'), {
        name: 'JsonWebTokenError',
      });
      const ctx = makeContext({ headers: { authorization: 'Bearer garbage' } });
      try {
        guard.handleRequest(null, false, info, ctx);
        fail('deveria ter lançado');
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        const resp = (err as UnauthorizedException).getResponse();
        expect(resp).toEqual(expect.objectContaining({ message: 'Token inválido' }));
      }
    });

    it('lança "Token inválido" quando err não-null acompanha Bearer', () => {
      const ctx = makeContext({ headers: { authorization: 'Bearer x.y.z' } });
      const err = new Error('boom');
      try {
        guard.handleRequest(err, null, null, ctx);
        fail('deveria ter lançado');
      } catch (caught) {
        expect(caught).toBeInstanceOf(UnauthorizedException);
        const resp = (caught as UnauthorizedException).getResponse();
        expect(resp).toEqual(expect.objectContaining({ message: 'Token inválido' }));
      }
    });

    it('trata header authorization não-string como ausente', () => {
      const ctx = makeContext({ headers: { authorization: undefined } });
      try {
        guard.handleRequest(null, false, null, ctx);
        fail('deveria ter lançado');
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        const resp = (err as UnauthorizedException).getResponse();
        expect(resp).toEqual(expect.objectContaining({ message: 'Token não fornecido' }));
      }
    });
  });
});
