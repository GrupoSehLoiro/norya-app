/**
 * Plugin Mongoose para encryption-at-rest transparente de campos marcados
 * com `@EncryptedField()`.
 *
 * ABORDAGEM: hooks pre/post — NÃO getter/setter inline.
 * =====================================================
 * Avaliamos as duas alternativas clássicas:
 *
 *   (a) Getter/setter via `schema.path(field).get/set(...)`:
 *       Simples de escrever, mas tem pitfalls:
 *         - Quando o Mongoose hidrata um doc do banco, internamente ele
 *           constrói `new Model(rawDbDoc)` — o que dispara o setter para
 *           valores JÁ encriptados, corrompendo-os (re-encrypt-on-hydrate).
 *         - Getters só se aplicam com `{ getters: true }` em toJSON/toObject
 *           e NÃO funcionam com `.lean()` queries, o que silenciosamente
 *           vaza ciphertext cru pelo caminho "performance".
 *         - Convive mal com populate, aggregate, bulk writes.
 *
 *   (b) Hooks pre/post (ESCOLHIDA):
 *         - `pre('save')`        : encripta antes do write.
 *         - `post('init')`       : decripta após hydrate (doc vindo do DB).
 *         - `pre('findOneAndUpdate')` / `pre('updateOne')` /
 *           `pre('updateMany')` : encripta valores em `$set`.
 *       Mais código, mas determinístico: o ciclo encrypt <-> decrypt está
 *       acoplado aos pontos em que o doc DE FATO cruza a fronteira com o DB.
 *       Leituras `.lean()` continuam devolvendo ciphertext cru — o consumer
 *       deve fazer `cryptoService.decryptField(...)` explicitamente quando
 *       quiser usar lean, o que é o comportamento correto para um rollout
 *       disciplinado.
 *
 * IDEMPOTÊNCIA
 * ============
 * `pre('save')` só encripta valores cujo campo está dirty (`doc.isModified`).
 * Isso evita re-encrypt-on-save e degradação progressiva do ciphertext em
 * fluxos read-modify-write.
 */
import type mongoose from 'mongoose';
import { CryptoService } from './crypto.service';

export interface EncryptionPluginOptions {
  fields: string[];
}

/**
 * Factory: recebe o `CryptoService` singleton e devolve o plugin. Separado
 * porque plugins Mongoose são registrados estaticamente na classe do schema,
 * mas o CryptoService é injetado pelo DI do Nest — a factory resolve o gap.
 */
export function createEncryptionPlugin(
  crypto: CryptoService,
): (schema: mongoose.Schema, options: EncryptionPluginOptions) => void {
  return (schema, options) => {
    const fields = options?.fields ?? [];
    if (fields.length === 0) {
      // Nada a fazer. Útil para schemas que recebem o plugin por default
      // mas não têm campos marcados.
      return;
    }

    /**
     * pre('save'): encripta valores modificados antes do write.
     * `doc.isModified(field)` é true tanto em inserts (tudo é modified)
     * quanto em updates que tocaram o campo.
     */
    schema.pre('save', function (next) {
      try {
        // `this` é o document. Tipado solto porque o TS não conhece os
        // campos dinâmicos que o plugin pode receber.
        const doc = this as unknown as {
          isModified: (path: string) => boolean;
          get: (path: string) => unknown;
          set: (path: string, value: unknown) => void;
        };
        for (const field of fields) {
          if (!doc.isModified(field)) continue;
          const value = doc.get(field);
          if (value === null || value === undefined) continue;
          if (typeof value !== 'string') continue;
          // Short-circuit defensivo: se já está no formato cifrado, não
          // re-encripta. Isso protege contra double-save accidents.
          if (value.startsWith('v1:')) continue;
          doc.set(field, crypto.encrypt(value));
        }
        next();
      } catch (err) {
        next(err as Error);
      }
    });

    /**
     * post('init'): após o Mongoose hidratar o doc a partir do raw DB,
     * decripta os campos. Dispara UMA vez por hydrate, antes de qualquer
     * consumer tocar no doc.
     */
    const decryptInPlace = function (doc: {
      get: (path: string) => unknown;
      set: (path: string, value: unknown) => void;
      unmarkModified?: (path: string) => void;
    }): void {
      for (const field of fields) {
        const value = doc.get(field);
        if (value === null || value === undefined) continue;
        if (typeof value !== 'string') continue;
        if (!value.startsWith('v1:')) continue;
        const plain = crypto.decrypt(value);
        doc.set(field, plain);
        // Marca como NÃO modificado para que o próximo save não dispare
        // uma re-encryption desnecessária se o consumer não tocou o campo.
        doc.unmarkModified?.(field);
      }
    };

    schema.post('init', function () {
      decryptInPlace(this as unknown as Parameters<typeof decryptInPlace>[0]);
    });

    /**
     * post('save'): o `pre('save')` encriptou os campos in-memory para o
     * write. O contrato do repositório é que o doc devolvido preserva
     * plaintext — então desfazemos a encryption em memória aqui. O que
     * está no disco já foi gravado encriptado antes deste hook rodar.
     */
    schema.post('save', function () {
      decryptInPlace(this as unknown as Parameters<typeof decryptInPlace>[0]);
    });

    /**
     * Encrypt em updates que passam pelo Query API (não vão por
     * `doc.save()`). Cobre `findOneAndUpdate`, `updateOne`, `updateMany`.
     * `$set` é a forma canônica; se o consumer passar update shape sem
     * `$set`, extraímos os campos de lá também.
     */
    const updateHook = function (
      this: mongoose.Query<unknown, unknown>,
      next: (err?: Error) => void,
    ) {
      try {
        const update = this.getUpdate() as Record<string, unknown> | null;
        if (!update) return next();

        const $set = ((update as Record<string, unknown>).$set as Record<string, unknown>) ?? null;
        const target = $set ?? (update as Record<string, unknown>);

        for (const field of fields) {
          const value = target[field];
          if (value === null || value === undefined) continue;
          if (typeof value !== 'string') continue;
          if (value.startsWith('v1:')) continue;
          target[field] = crypto.encrypt(value);
        }
        this.setUpdate(update);
        next();
      } catch (err) {
        next(err as Error);
      }
    };

    schema.pre('findOneAndUpdate', updateHook);
    schema.pre('updateOne', updateHook);
    schema.pre('updateMany', updateHook);
  };
}
