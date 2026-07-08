import { Controller, Get } from '@nestjs/common';
import { Public } from './identity/auth/decorators/public.decorator';
// Versão lida de forma estática do package.json do próprio app.
// Usamos require() para evitar problemas com `resolveJsonModule` em build
// (o tsconfig já tem habilitado, mas ESM/CJS interop no Jest fica mais
// previsível via require em runtime CJS do Nest).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json') as { version: string };

/**
 * Root controller — endpoint de descoberta + health simples.
 *
 * Com o prefixo global `/api`, o GET fica em `GET /api` e retorna metadados
 * do serviço (usado pelo SLMOD-platform para detectar qual backend está
 * respondendo: legado Vercel ou nova API Nest). Público — é o discovery.
 */
@Controller()
export class HelloController {
  @Public()
  @Get()
  hello(): { service: string; version: string } {
    return {
      service: 'sehloro-api',
      version: pkg.version,
    };
  }
}
