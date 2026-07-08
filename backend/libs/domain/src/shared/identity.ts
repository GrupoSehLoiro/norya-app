/**
 * Helper de geração de identificadores para entidades de domínio.
 *
 * Decisão arquitetural (NEST-04):
 * - IDs de entidade são `string` — opacos pela perspectiva do domínio.
 * - Em runtime, o valor pode ser:
 *   a) Um ObjectId do Mongo (string hex de 24 chars), quando a entidade
 *      nasceu via `reconstitute(...)` após leitura de um `UserDocument` /
 *      `ChannelDocument`.
 *   b) Um UUID v4, quando a entidade foi criada na camada de aplicação via
 *      `User.create(...)` / `Channel.create(...)` ANTES de chegar no banco.
 *
 * Ambos os formatos são aceitáveis em `_id` do Mongo (Mongoose faz auto-cast
 * quando possível; para UUID armazenamos como string literal, o que funciona
 * porque não definimos `_id` no schema e o default ObjectId só se aplica
 * quando nenhum valor é fornecido). O repositório sempre faz upsert por
 * `_id`, então o formato só importa para unicidade interna.
 *
 * Esta função é isolada para ser fácil de mockar em testes determinísticos
 * (ex.: `jest.spyOn(identity, 'generateId').mockReturnValue('fixed-id')`).
 */
import { randomUUID } from 'node:crypto';

export function generateId(): string {
  return randomUUID();
}
