/**
 * `@Public()` — marca um handler (ou controller inteiro) como rota sem
 * autenticação. Funciona em conjunto com o `JwtAuthGuard` global: se o
 * reflector encontrar este metadata, o guard devolve `true` sem olhar
 * header Authorization.
 *
 * Chave do metadata exportada como constante para evitar typo em múltiplos
 * pontos (decorator aqui, leitura no guard).
 */
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
