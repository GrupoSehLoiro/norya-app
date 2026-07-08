-- ============================================================================
-- SEHLORO / SLMOD — IA Core M4 — Migration 001
--
-- Tabelas analíticas append-only para o pipeline de social-listening.
-- Cobre os 7 insights do MVP (flow-ia-core.txt §1).
--
-- Idempotência: todas as criações usam IF NOT EXISTS, então re-aplicar
-- não falha. O runner (backend/scripts/migrate-clickhouse.ts) ainda assim
-- registra em schema_migrations para auditoria de quais arquivos rodaram.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- chat_messages
--
-- Append-only de cada msg de chat decorada com classificações heurísticas
-- de tier-1. TTL de 30 dias mantém custo de storage controlado; agregados
-- históricos vivem em materialized views (PR seguinte CH-04).
--
-- ORDER BY (channel_id, received_at, message_id) suporta as queries-pão:
--   - "msgs do canal X entre t0 e t1"
--   - "msgs do canal X com sentiment=negative na última hora"
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages
(
    channel_id           String,
    platform             LowCardinality(String),         -- 'twitch' | 'kick'
    message_id           String,
    username             String,
    is_subscriber        UInt8,
    is_mod               UInt8,
    text                 String,
    emotes               Array(String),
    sentiment_heuristic  LowCardinality(String) DEFAULT '',  -- '' | 'positive' | 'neutral' | 'negative'
    category_heuristic   LowCardinality(String) DEFAULT '',  -- '' | <category-id>
    session_id           Nullable(String),
    received_at          DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(received_at)
ORDER BY (channel_id, received_at, message_id)
TTL toDateTime(received_at) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;

-- ----------------------------------------------------------------------------
-- batch_analysis
--
-- Uma row por janela fechada (default 15s) por canal. Carrega os 7
-- insights do MVP em colunas dedicadas + JSON pra estruturas com
-- cardinalidade variável (top categorias, top tóxicos, marcas).
--
-- llm_tier convenção:
--   0 = fallback keyword (breaker OPEN ou budget=0)
--   1 = só heurístico (tier-2 desativado)
--   2 = Haiku 4.5 (tier-2 LLM real)
--   3 = Sonnet 4.6 (tier-3, fora do MVP)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS batch_analysis
(
    channel_id              String,
    session_id              Nullable(String),
    batch_id                UUID,
    window_start            DateTime64(3, 'UTC'),
    window_end              DateTime64(3, 'UTC'),

    -- Volume da janela
    message_count           UInt32,                          -- total único pós-dedup
    message_count_weighted  UInt32,                          -- inclui peso do copypasta
    unique_users            UInt32,
    is_subscriber_ratio     Float32,

    -- Insight #1 — clima geral
    sentiment_pos           UInt32,
    sentiment_neu           UInt32,
    sentiment_neg           UInt32,

    -- Insight #2/#3 — pautas (top + bottom não-zero)
    -- JSON: [{"category":"<id>","count":N},...] ordenado desc
    top_categories_json     String DEFAULT '[]',
    dominant_category       LowCardinality(String) DEFAULT 'other',
    least_category          LowCardinality(String) DEFAULT '',
    least_category_count    UInt32 DEFAULT 0,

    -- Insight #4 — usuário mais tóxico
    -- JSON: [{"username":"...","ratio":0.83,"msg_count":12,"neg_count":10},...]
    top_toxic_users_json    String DEFAULT '[]',
    most_toxic_username     String DEFAULT '',
    most_toxic_ratio        Float32 DEFAULT 0,
    most_toxic_msg_count    UInt32 DEFAULT 0,

    -- Insight #5 — usuário menos tóxico (mais positivo)
    least_toxic_username    String DEFAULT '',
    least_toxic_ratio       Float32 DEFAULT 0,
    least_toxic_msg_count   UInt32 DEFAULT 0,

    -- Insight #6 — sentimento sobre AD
    ad_active               UInt8 DEFAULT 0,
    ad_source               LowCardinality(String) DEFAULT '',   -- '' | 'twitch' | 'manual'
    ad_sentiment_pos        UInt32 DEFAULT 0,
    ad_sentiment_neu        UInt32 DEFAULT 0,
    ad_sentiment_neg        UInt32 DEFAULT 0,
    ad_sample_size          UInt32 DEFAULT 0,

    -- Insight #7 — marcas mencionadas (allowlist hits)
    -- JSON: [{"brand":"...","count":N,"sample":["msgId",...]},...]
    mentioned_brands_json   String DEFAULT '[]',

    -- Tokens (auxilia debug + futuros widgets)
    top_tokens              Array(String) DEFAULT [],

    -- Telemetria LLM
    llm_tier                UInt8,
    llm_model               LowCardinality(String) DEFAULT '',
    llm_cost_usd            Decimal(18, 6) DEFAULT 0,
    llm_latency_ms          UInt32 DEFAULT 0,
    llm_cache_hit_rate      Float32 DEFAULT 0,
    llm_confidence          Float32 DEFAULT 0,

    -- Insight em texto livre (preenchido só por tier-3 — fora do MVP)
    insight_text            String DEFAULT '',

    created_at              DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (channel_id, window_start, batch_id)
TTL toDateTime(created_at) + INTERVAL 180 DAY
SETTINGS index_granularity = 8192;

-- ----------------------------------------------------------------------------
-- ad_segments
--
-- Espelho analítico do Mongo ad_segment (source of truth lá). Inserido
-- pelo AdSegmentService quando uma janela de AD abre/fecha (Twitch
-- EventSub ou toggle manual). Permite JOIN analítico com batch_analysis.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_segments
(
    channel_id           String,
    session_id           Nullable(String),
    source               LowCardinality(String),       -- 'twitch' | 'manual'
    started_at           DateTime64(3, 'UTC'),
    ended_at             Nullable(DateTime64(3, 'UTC')),
    duration_seconds     Nullable(UInt32),
    is_automatic         UInt8 DEFAULT 0,
    raw_json             String DEFAULT '',
    created_at           DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
ORDER BY (channel_id, started_at)
SETTINGS index_granularity = 8192;

-- ----------------------------------------------------------------------------
-- schema_migrations — auditoria do runner
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations
(
    filename     String,
    applied_at   DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY filename
SETTINGS index_granularity = 8192;
