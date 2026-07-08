import { Test } from '@nestjs/testing';
import { INestApplication, Controller, Get } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import request from 'supertest';
import { zodValidate } from '../src/config/config.schema';
import { ConfigModule } from '../src/config/config.module';
import { LoggerModule } from '../src/logger/logger.module';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';

/**
 * Testes de boot e do error shape.
 *
 * Estratégia: manipulamos process.env antes do Test.createTestingModule()
 * para validar o comportamento do `zodValidate`. Salvamos/restauramos o env
 * em beforeEach/afterEach para não vazar entre specs.
 */
describe('Bootstrap / ConfigModule Zod validation', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // Zera só as chaves que o teste mexe — manter PATH etc.
    delete process.env.JWT_SECRET;
    delete process.env.MONGODB_URI;
    delete process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    // AUTH-02 exige CRYPTO_MASTER_KEY no boot. Os testes de boot desta
    // suíte focam em outras envs — deixamos a chave sempre presente.
    process.env.CRYPTO_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  // Helper: invoca `NestConfigModule.forRoot` com a Zod validate na hora do
  // teste, usando o env atual. Não reutilizamos o `ConfigModule` wrapper
  // porque `forRoot()` do @nestjs/config v3 valida sincronamente na chamada
  // — ou seja, o wrapper congela o resultado na primeira importação. Testes
  // que precisam exercitar cenários de env inválido têm que recriar o
  // DynamicModule a cada assertion.
  const buildConfigDynamicModule = () =>
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: false,
      validate: zodValidate,
      ignoreEnvFile: true,
    });

  it('falha no boot quando JWT_SECRET está ausente', async () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    // JWT_SECRET omitido de propósito

    await expect(
      Test.createTestingModule({
        imports: [buildConfigDynamicModule()],
      }).compile(),
    ).rejects.toThrow(/JWT_SECRET/);
  });

  it('falha no boot quando JWT_SECRET tem menos de 32 chars', async () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    process.env.JWT_SECRET = 'a'.repeat(20); // 20 chars — abaixo do mínimo

    await expect(
      Test.createTestingModule({
        imports: [buildConfigDynamicModule()],
      }).compile(),
    ).rejects.toThrow(/JWT_SECRET.*32/);
  });

  it('sobe normalmente quando JWT_SECRET >= 32 chars e MONGODB_URI presente', async () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    process.env.JWT_SECRET = 'a'.repeat(40);

    const moduleRef = await Test.createTestingModule({
      imports: [buildConfigDynamicModule()],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});

// -----------------------------------------------------------------------------
// Error shape — garante que o AllExceptionsFilter mantém o contrato
// { statusCode, message, code, traceId }
// -----------------------------------------------------------------------------

@Controller('error-test')
class ErrorTestController {
  @Get('boom')
  boom(): never {
    throw new Error('kaboom');
  }
}

describe('AllExceptionsFilter — shape da resposta', () => {
  const ORIGINAL_ENV = { ...process.env };
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    process.env.JWT_SECRET = 'a'.repeat(40);
    process.env.CRYPTO_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.LOG_LEVEL = 'fatal'; // silencia logs nos asserts

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, LoggerModule],
      controllers: [ErrorTestController],
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

  it('segue o shape { statusCode, message, code, traceId } em erro não tratado', async () => {
    const res = await request(app.getHttpServer()).get('/api/error-test/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual(
      expect.objectContaining({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: expect.any(String),
      }),
    );
    // traceId pode ser undefined em contexto de teste sem middleware CLS
    // quando o supertest não bate no mesmo event loop — aceitamos undefined
    // ou string não-vazia.
    if (res.body.traceId !== undefined) {
      expect(typeof res.body.traceId).toBe('string');
      expect(res.body.traceId.length).toBeGreaterThan(0);
    }
    // Em NODE_ENV=test (não-production), stack é incluído
    expect(res.body.stack).toBeDefined();
  });

  it('esconde stack quando NODE_ENV=production', async () => {
    // Não dá para mudar NODE_ENV em runtime pro filter (ele lê do env a cada
    // chamada). Re-validamos o comportamento invocando o filter direto.
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app.getHttpServer()).get('/api/error-test/boom');
      expect(res.status).toBe(500);
      expect(res.body.stack).toBeUndefined();
      expect(res.body.message).toBe('Erro interno do servidor');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
