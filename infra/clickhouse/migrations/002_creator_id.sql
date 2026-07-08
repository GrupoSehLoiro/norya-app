-- Fase 2 (onboarding/insights) — adiciona creator_id às tabelas analíticas.
--
-- A coleta continua por integração (channel_id intacto); creator_id permite
-- consolidar a leitura no nível do criador (ver YouTube/Kick juntos) sem
-- reescrever o orchestrator. Colunas aditivas com DEFAULT '' → linhas antigas
-- ficam com creator_id vazio (não-consolidáveis até reprocessamento).
--
-- `mentioned_brands_json` já existe (001); a partir desta fase cada hit pode
-- incluir a plataforma de origem ({brand,count,sample,platform}) — mudança de
-- conteúdo do JSON, sem alteração de schema.

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS creator_id String DEFAULT '';

ALTER TABLE batch_analysis
  ADD COLUMN IF NOT EXISTS creator_id String DEFAULT '';
