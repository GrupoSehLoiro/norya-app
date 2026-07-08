import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';

/**
 * Smoke test dos 5 bounded contexts.
 *
 * Para cada área, valida que `GET /api/<nome>/ping` retorna
 * `{ context, status: 'alive' }` com HTTP 200. Se algum módulo for removido
 * ou renomeado sem atualizar o AppModule, este teste quebra.
 */
describe('Bounded contexts — /ping de cada módulo', () => {
  const ORIGINAL_ENV = { ...process.env };
  let app: INestApplication;

  const contexts = [
    'identity',
    'moderation',
    'ingestion',
    'monitoring',
    'social-listening',
  ] as const;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    process.env.JWT_SECRET = 'a'.repeat(40);
    // AUTH-02 exige chave de 32 bytes base64 no boot.
    process.env.CRYPTO_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.LOG_LEVEL = 'fatal';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    const cls = app.get(ClsService);
    app.useGlobalFilters(new AllExceptionsFilter(cls));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env = { ...ORIGINAL_ENV };
  });

  it.each(contexts)('GET /api/%s/ping retorna { context, status: alive }', async (ctx) => {
    const res = await request(app.getHttpServer()).get(`/api/${ctx}/ping`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ context: ctx, status: 'alive' });
  });

  it('GET /api retorna metadados do serviço', async () => {
    const res = await request(app.getHttpServer()).get('/api');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('sehloro-api');
    expect(typeof res.body.version).toBe('string');
  });
});
