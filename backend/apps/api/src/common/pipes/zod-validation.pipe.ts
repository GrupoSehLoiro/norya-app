/**
 * ZodValidationPipe — pipe genérico do NestJS que valida o payload contra
 * um `ZodSchema` e substitui o valor original pela versão tipada + normalizada.
 *
 * Uso:
 *   @Body(new ZodValidationPipe(LoginDto)) dto: LoginDto
 *
 * Quando a validação falha, lançamos o `ZodError` original — o
 * AllExceptionsFilter já sabe convertê-lo em 400 com `code: VALIDATION_ERROR`
 * e a lista de issues. Isso mantém o filter como ponto único de verdade
 * para o shape de resposta de erro.
 */
import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    // `parse` lança ZodError em caso de falha — deliberadamente NÃO tratamos
    // aqui; o filter global converte para 400 com shape canônico.
    return this.schema.parse(value);
  }
}
