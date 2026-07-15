import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import { AccessLogMiddleware } from '../access-log.middleware';
import type { AccessLogService, AccessLogEntry } from '@sehloro/infra';
import type { ClsService } from 'nestjs-cls';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    originalUrl: '/api/v2/channels?foo=1',
    url: '/api/v2/channels?foo=1',
    headers: { 'user-agent': 'jest' },
    socket: { remoteAddress: '127.0.0.1' },
    query: { foo: '1' },
    body: { name: 'canal', password: 'secreta' },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & EventEmitter {
  const res = new EventEmitter() as Response & EventEmitter;
  (res as { statusCode: number }).statusCode = 201;
  res.json = ((body: unknown) => {
    void body;
    return res;
  }) as Response['json'];
  return res;
}

describe('AccessLogMiddleware', () => {
  let recorded: AccessLogEntry[];
  let middleware: AccessLogMiddleware;

  beforeEach(() => {
    recorded = [];
    const accessLog = {
      record: (entry: AccessLogEntry) => recorded.push(entry),
    } as unknown as AccessLogService;
    const cls = {
      get: () => 'usr-1',
      getId: () => 'trace-1',
    } as unknown as ClsService;
    middleware = new AccessLogMiddleware(accessLog, cls);
  });

  it('captura query, requestBody e responseBody no finish', () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();

    // handler responde JSON e a response finaliza
    res.json({ id: 'chan-1', ok: true });
    res.emit('finish');

    expect(recorded).toHaveLength(1);
    const entry = recorded[0]!;
    expect(entry.path).toBe('/api/v2/channels');
    expect(entry.statusCode).toBe(201);
    expect(entry.query).toEqual({ foo: '1' });
    expect(entry.requestBody).toEqual({ name: 'canal', password: 'secreta' });
    expect(entry.responseBody).toEqual({ id: 'chan-1', ok: true });
  });

  it('não captura responseBody da própria listagem de logs', () => {
    const req = makeReq({
      method: 'GET',
      originalUrl: '/api/v2/logs?limit=100',
      url: '/api/v2/logs?limit=100',
      body: undefined,
    } as Partial<Request>);
    const res = makeRes();

    middleware.use(req, res, jest.fn());
    res.json({ total: 1, items: [] });
    res.emit('finish');

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.responseBody).toBeUndefined();
  });

  it('ignora OPTIONS/HEAD', () => {
    const res = makeRes();
    middleware.use(makeReq({ method: 'OPTIONS' } as Partial<Request>), res, jest.fn());
    res.emit('finish');
    expect(recorded).toHaveLength(0);
  });

  it('responses sem json (ex.: 304) não carregam responseBody', () => {
    const req = makeReq({ method: 'GET', body: undefined } as Partial<Request>);
    const res = makeRes();
    (res as { statusCode: number }).statusCode = 304;

    middleware.use(req, res, jest.fn());
    res.emit('finish');

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.statusCode).toBe(304);
    expect(recorded[0]!.responseBody).toBeUndefined();
  });
});
