/**
 * Unit do LogsBasicAuthGuard — endpoint desligado sem env, 401 com
 * credencial errada, passa com credencial certa.
 */
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { LogsBasicAuthGuard } from '../logs-basic-auth.guard';

function ctx(authorization?: string): ExecutionContext {
  const req = { headers: authorization ? { authorization } : {} };
  const res = { setHeader: jest.fn() };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

function buildGuard(env: Record<string, string | undefined>): LogsBasicAuthGuard {
  const config = { get: (key: string) => env[key] } as never;
  return new LogsBasicAuthGuard(config);
}

describe('LogsBasicAuthGuard', () => {
  const env = { LOGS_USER: 'ops', LOGS_PASSWORD: 'senha-bem-longa-12' };

  it('responde 404 quando LOGS_USER/LOGS_PASSWORD não estão setados', () => {
    expect(() => buildGuard({}).canActivate(ctx())).toThrow(NotFoundException);
    expect(() => buildGuard({ LOGS_USER: 'ops' }).canActivate(ctx())).toThrow(NotFoundException);
  });

  it('401 sem header Authorization', () => {
    expect(() => buildGuard(env).canActivate(ctx())).toThrow(UnauthorizedException);
  });

  it('401 com credencial errada', () => {
    expect(() => buildGuard(env).canActivate(ctx(basic('ops', 'errada-mas-longa')))).toThrow(
      UnauthorizedException,
    );
    expect(() => buildGuard(env).canActivate(ctx(basic('outra', env.LOGS_PASSWORD)))).toThrow(
      UnauthorizedException,
    );
  });

  it('passa com credencial correta', () => {
    expect(buildGuard(env).canActivate(ctx(basic('ops', env.LOGS_PASSWORD)))).toBe(true);
  });

  it('aceita senha contendo ":" (split só no primeiro separador)', () => {
    const guard = buildGuard({ LOGS_USER: 'ops', LOGS_PASSWORD: 'com:dois:pontos!' });
    expect(guard.canActivate(ctx(basic('ops', 'com:dois:pontos!')))).toBe(true);
  });
});
