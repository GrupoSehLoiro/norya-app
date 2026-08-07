/**
 * LlmBudgetSettings — tetos de custo de IA editáveis pelo ADMIN no console,
 * sem deploy/restart (as envs LLM_BUDGET_* e LLM_RATE_* viram só o default
 * de última instância).
 *
 * Um doc `scope='global'` (singleton) define defaults da plataforma; docs
 * `scope='channel'` são overrides por canal. Campo ausente = herda do nível
 * acima (channel → global → env → hardcoded). `paused=true` no global pausa
 * TODOS os canais (botão de pânico da conta).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const LlmBudgetSettingsSchemaName = 'LlmBudgetSettings';

export type LlmBudgetScope = 'global' | 'channel';

@Schema({
  collection: 'llm_budget_settings',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class LlmBudgetSettingsPersistence {
  @Prop({ type: String, enum: ['global', 'channel'], required: true })
  scope!: LlmBudgetScope;

  /** Obrigatório quando scope='channel'; ausente no doc global. */
  @Prop({ type: String })
  channelId?: string;

  /** Teto mensal de tokens. Ausente = herda. */
  @Prop({ type: Number, min: 1 })
  monthlyTokens?: number;

  /** Teto de tokens por minuto. Ausente = herda. */
  @Prop({ type: Number, min: 1 })
  tokensPerMinute?: number;

  /** Pausa a IA (tier 0 imediato). No global, pausa todos os canais. */
  @Prop({ type: Boolean, default: false })
  paused!: boolean;

  /** Quem alterou por último (email/username do admin) — trilha simples. */
  @Prop({ type: String })
  updatedBy?: string;
}

export type LlmBudgetSettingsDocument = HydratedDocument<LlmBudgetSettingsPersistence>;
export const LlmBudgetSettingsSchema = SchemaFactory.createForClass(LlmBudgetSettingsPersistence);

// Um doc por escopo/canal: global único, no máx. 1 override por canal.
LlmBudgetSettingsSchema.index({ scope: 1, channelId: 1 }, { unique: true });
