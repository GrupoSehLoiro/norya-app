/**
 * Configuração OAuth por plataforma — identidade DA app Sehloro nas
 * plataformas externas. **Não confundir** com `ChannelOAuthToken`, que
 * guarda o token de cada streamer.
 *
 * Esta collection tem no máximo 1 doc por `platform` (`twitch`, `kick`).
 * `clientId` e `clientSecret` ficam cifrados (AES-256-GCM via
 * `CryptoService`, mesmo padrão de AUTH-02). Operador admin edita pela UI;
 * o backend lê este doc no início de cada `start`/`callback` OAuth — se
 * vazio, fallback para env (compat).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const PlatformOAuthConfigSchemaName = 'PlatformOAuthConfig';
export type PlatformKind = 'twitch' | 'kick';

@Schema({
  collection: 'platform_oauth_configs',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class PlatformOAuthConfigPersistence {
  @Prop({ type: String, required: true, unique: true, index: true })
  platform!: PlatformKind;

  /** clientId cifrado (formato v1:<iv>:<ciphertext>:<authTag>). */
  @Prop({ type: String, required: true })
  clientIdEnc!: string;

  /** clientSecret cifrado — nunca devolvido em GET. */
  @Prop({ type: String, required: true })
  clientSecretEnc!: string;

  @Prop({ type: String, default: null })
  updatedBy!: string | null;
}

export type PlatformOAuthConfigDocument = HydratedDocument<PlatformOAuthConfigPersistence>;
export const PlatformOAuthConfigSchema = SchemaFactory.createForClass(
  PlatformOAuthConfigPersistence,
);
