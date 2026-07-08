/**
 * Schema mínimo para ler `categoryConfiguration` (legado).
 * `SLMOD-api/api/models/categoryConfiguration.model.js`:
 *   { name: string, keywords: string[] }
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const CategoryConfigurationSchemaName = 'CategoryConfig';

@Schema({
  collection: 'categoryconfigs',
  timestamps: false,
})
export class CategoryConfigurationPersistence {
  @Prop({ type: String, required: true, index: true })
  name!: string;

  @Prop({ type: [String], default: [] })
  keywords!: string[];
}

export type CategoryConfigurationDocument = HydratedDocument<CategoryConfigurationPersistence>;
export const CategoryConfigurationSchema = SchemaFactory.createForClass(
  CategoryConfigurationPersistence,
);
