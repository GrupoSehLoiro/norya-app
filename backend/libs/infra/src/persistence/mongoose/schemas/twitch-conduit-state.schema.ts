/**
 * CON-01 · twitch_conduit_state — singleton com o conduit ID corrente.
 *
 * Twitch EventSub Conduits agrega TODAS as subscriptions de todos os canais
 * sob um único transporte. Por isso o estado é singleton: existe no máximo
 * um conduit ativo por aplicação. _id fixo em 'singleton' garante a
 * unicidade sem precisar de outro índice.
 *
 * Persistir o conduitId em Mongo evita ter que enumerar conduits via Helix
 * a cada boot — economiza uma chamada e cobre o caso em que a Twitch perde
 * estado e devolve lista vazia (precisamos saber se ja tivemos um para
 * lidar com a transição).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TwitchConduitStateDocument = HydratedDocument<TwitchConduitStatePersistence>;

export const TwitchConduitStateSchemaName = 'TwitchConduitState';
export const TWITCH_CONDUIT_SINGLETON_ID = 'singleton';

@Schema({
  collection: 'twitch_conduit_state',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  versionKey: false,
})
export class TwitchConduitStatePersistence {
  /** Sempre 'singleton'. Não é ObjectId — string fixa pra forçar unicidade. */
  @Prop({ type: String, required: true })
  declare _id: string;

  @Prop({ type: String, required: true })
  declare conduitId: string;

  @Prop({ type: Number, required: true, min: 1 })
  declare shardCount: number;

  @Prop({ type: Date })
  declare createdAt?: Date;

  @Prop({ type: Date })
  declare updatedAt?: Date;
}

export const TwitchConduitStateSchema = SchemaFactory.createForClass(TwitchConduitStatePersistence);
