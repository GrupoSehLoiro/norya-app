/**
 * CryptoModule — wire do CryptoService ao ConfigService via async factory.
 *
 * É GLOBAL (`@Global()`) porque o mesmo singleton é injetado em módulos
 * de persistência (para o plugin Mongoose) E em services de aplicação
 * (futuros use-cases OAuth que vão encriptar tokens explicitamente).
 *
 * A factory lê `CRYPTO_MASTER_KEY` e `CRYPTO_PREV_KEYS` via ConfigService.
 * O Zod já garantiu que `CRYPTO_MASTER_KEY` existe e tem 32 bytes. O
 * CryptoService valida novamente internamente (defense-in-depth).
 */
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CryptoService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const masterKeyBase64 = config.get<string>('CRYPTO_MASTER_KEY');
        if (!masterKeyBase64) {
          throw new Error(
            'CRYPTO_MASTER_KEY ausente no boot — ConfigModule deveria ter barrado antes',
          );
        }
        const prevKeysCsv = config.get<string>('CRYPTO_PREV_KEYS');
        return new CryptoService({ masterKeyBase64, prevKeysCsv });
      },
    },
  ],
  exports: [CryptoService],
})
export class CryptoModule {}
