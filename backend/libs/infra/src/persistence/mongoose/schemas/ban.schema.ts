/**
 * Schema Mongoose para a collection `bans` (legacy).
 *
 * Escrita pelos bots em `Bots/<Bot>/index.js` via `mongoose.model('Ban', ...)`.
 * Esta versão v2 só lê — não muda os nomes dos campos para preservar
 * compatibilidade com bots e com a API legada (`SLMOD-api`).
 *
 * Campos preservados: `channel`, `userName`, `reason`, `modName`, `timestamp`.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const BanSchemaName = 'Ban';

@Schema({
  collection: 'bans',
  timestamps: false,
})
export class BanPersistence {
  @Prop({ type: String, index: true })
  channel!: string;

  @Prop({ type: String, required: true })
  userName!: string;

  // reason/modName podem vir vazios do EventSub (ban sem motivo, ação
  // automática sem moderador). required:true rejeitava string vazia e
  // perdia o ban inteiro — mesmo bug do deletedMessage.
  @Prop({ type: String, required: false, default: '' })
  reason!: string;

  @Prop({ type: String, required: false, default: '' })
  modName!: string;

  @Prop({ type: Date, required: true, index: true })
  timestamp!: Date;
}

export type BanDocument = HydratedDocument<BanPersistence>;
export const BanSchema = SchemaFactory.createForClass(BanPersistence);
