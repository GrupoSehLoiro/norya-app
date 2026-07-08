/**
 * `@EncryptedField()` — decorator de propriedade que marca um campo de
 * schema Mongoose para encryption-at-rest via `createEncryptionPlugin`.
 *
 * Como funciona:
 *   - Registra o nome da property numa Map global indexada pelo constructor
 *     da classe do schema (`target.constructor`).
 *   - O bootstrap do schema lê essa Map via `getEncryptedFields(SchemaClass)`
 *     e passa a lista para o plugin — evita que o call-site precise digitar
 *     os nomes dos campos duas vezes.
 *
 * Uso:
 *   @Schema({ collection: 'channel_oauth_tokens' })
 *   class ChannelOAuthTokenDocument {
 *     @EncryptedField()
 *     @Prop({ type: String, required: true })
 *     accessToken!: string;
 *   }
 *
 *   ChannelOAuthTokenSchema.plugin(
 *     createEncryptionPlugin(cryptoService),
 *     { fields: getEncryptedFields(ChannelOAuthTokenDocument) },
 *   );
 */

/** Classe de schema decorada — qualquer construtor serve como chave de metadata. */
type SchemaClass = abstract new (...args: never[]) => unknown;

const ENCRYPTED_FIELDS_METADATA: Map<SchemaClass, string[]> = new Map();

export function EncryptedField(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    if (typeof propertyKey !== 'string') {
      // Não suportamos symbols — schemas Mongoose sempre usam string keys.
      return;
    }
    const ctor = (target as { constructor: SchemaClass }).constructor;
    const existing = ENCRYPTED_FIELDS_METADATA.get(ctor) ?? [];
    if (!existing.includes(propertyKey)) {
      existing.push(propertyKey);
    }
    ENCRYPTED_FIELDS_METADATA.set(ctor, existing);
  };
}

/**
 * Lê a lista de campos marcados com `@EncryptedField()` em uma classe de
 * schema. Inclui herança: se `ChildSchema extends ParentSchema`, os campos
 * do parent também são retornados.
 */
export function getEncryptedFields(target: SchemaClass): string[] {
  const fields = new Set<string>();
  let cursor: SchemaClass | null = target;
  while (cursor && cursor !== Function.prototype) {
    const own = ENCRYPTED_FIELDS_METADATA.get(cursor);
    if (own) {
      for (const f of own) fields.add(f);
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  return Array.from(fields);
}
