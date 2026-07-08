/**
 * Schema mínimo para ler a collection legada `sentimentConfiguration`
 * que as bots de `Bots/` ainda preenchem. Mesmo shape do modelo
 * `SLMOD-api/api/models/sentimentConfiguration.model.js`:
 *   { name: string, keywords: string[] }
 *
 * Convenções de `name` usadas pelas bots:
 *   - 'positive' / 'negative' / 'neutral' → keywords de sentimento
 *   - 'blockedWords'                        → palavras moderação
 *   - 'blockedPerson'                       → usernames bloqueados
 *   - 'botUsers' (não-legacy, novo MVP)     → usernames bot
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const SentimentConfigurationSchemaName = 'SentimentConfiguration';

@Schema({
  collection: 'sentimentconfigurations', // mongoose pluraliza
  timestamps: false,
})
export class SentimentConfigurationPersistence {
  @Prop({ type: String, required: true, index: true })
  name!: string;

  @Prop({ type: [String], default: [] })
  keywords!: string[];
}

export type SentimentConfigurationDocument = HydratedDocument<SentimentConfigurationPersistence>;
export const SentimentConfigurationSchema = SchemaFactory.createForClass(
  SentimentConfigurationPersistence,
);
