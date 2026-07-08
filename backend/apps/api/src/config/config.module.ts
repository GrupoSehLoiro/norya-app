import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { zodValidate } from './config.schema';

/**
 * Wrapper do @nestjs/config com validação Zod acoplada.
 *
 * - `isGlobal: true` — qualquer módulo injeta `ConfigService` sem re-importar.
 * - `cache: true` — leitura única de process.env (importa para testes e perf).
 * - `validate: zodValidate` — fail-fast no boot se alguma env exigida faltar.
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: zodValidate,
      // Não carregamos .env automaticamente em produção — Docker/Discloud/Vercel
      // injetam env via runtime. Em dev o usuário pode apontar via dotenv CLI.
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      envFilePath: ['.env.local', '.env'],
    }),
  ],
})
export class ConfigModule {}
