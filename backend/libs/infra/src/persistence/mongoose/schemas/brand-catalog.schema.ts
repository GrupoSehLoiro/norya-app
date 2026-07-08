/**
 * Schema Mongoose para `brand_catalog` — catálogo global das marcas populares
 * (referência para a busca no onboarding). Não é per-tenant; é uma lista
 * compartilhada, seedada no boot. Distinta de `channel_brands` (allowlist do
 * criador). Collection nova.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const BrandCatalogSchemaName = 'BrandCatalog';

@Schema({ collection: 'brand_catalog', _id: false })
export class BrandCatalogPersistence {
  @Prop({ type: String })
  _id!: string; // slug

  @Prop({ type: String, required: true, index: true })
  name!: string;

  @Prop({ type: [String], default: [] })
  aliases!: string[];

  @Prop({ type: String, default: '' })
  sector!: string;

  @Prop({ type: String, enum: ['br', 'global'], default: 'global' })
  country!: string;
}

export type BrandCatalogDocument = HydratedDocument<BrandCatalogPersistence>;
export const BrandCatalogSchema = SchemaFactory.createForClass(BrandCatalogPersistence);
