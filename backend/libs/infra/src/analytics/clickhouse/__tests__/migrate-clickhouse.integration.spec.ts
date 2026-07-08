/**
 * Integration test do migration runner (backend/scripts/migrate-clickhouse.ts).
 *
 * Roda contra o CH real (mesmo critério do clickhouse.client integration).
 * Valida:
 *   1. Aplica TODAS as migrations do diretório real
 *   2. Tabelas previstas pela 001_initial.sql existem com colunas certas
 *   3. Re-rodar não falha e marca skip nas já aplicadas
 *   4. INSERT roundtrip em chat_messages + batch_analysis funciona
 */
import { createClient as createRawClient } from '@clickhouse/client';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from '../migrate';

const CH_URL = process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123';
const CH_USER = process.env['CLICKHOUSE_USER'] ?? 'default';
const CH_PASSWORD = process.env['CLICKHOUSE_PASSWORD'] ?? 'devpass';
// Test file está em backend/libs/infra/src/analytics/clickhouse/__tests__.
// No host: ../infra/clickhouse/migrations vive como sibling de backend/.
// No container (sem mount), o caller setou MIGRATIONS_DIR explicitamente.
const MIGRATIONS_DIR =
  process.env['MIGRATIONS_DIR'] ??
  resolve(__dirname, '..', '..', '..', '..', '..', '..', '..', 'infra', 'clickhouse', 'migrations');

async function isClickHouseReachable(): Promise<boolean> {
  try {
    const c = createRawClient({
      url: CH_URL,
      username: CH_USER,
      password: CH_PASSWORD,
      request_timeout: 3000,
    });
    const r = await c.ping();
    await c.close();
    return r.success;
  } catch {
    return false;
  }
}

describe('migrate-clickhouse (integration)', () => {
  let reachable = false;
  let testDb: string;
  let admin: ReturnType<typeof createRawClient>;

  beforeAll(async () => {
    reachable = await isClickHouseReachable();
    if (!reachable) {
      // eslint-disable-next-line no-console
      console.warn(`[migrate-integration] CH em ${CH_URL} indisponível — pulando`);
      return;
    }
    testDb = `sehloro_mig_test_${randomUUID().replace(/-/g, '')}`;
    admin = createRawClient({
      url: CH_URL,
      username: CH_USER,
      password: CH_PASSWORD,
    });
  });

  afterAll(async () => {
    if (!reachable) return;
    try {
      await admin.exec({ query: `DROP DATABASE IF EXISTS \`${testDb}\`` });
    } finally {
      await admin.close();
    }
  });

  it('primeira execução aplica 001_initial.sql', async () => {
    if (!reachable) return;
    const report = await migrate({
      url: CH_URL,
      username: CH_USER,
      password: CH_PASSWORD,
      database: testDb,
      migrationsDir: MIGRATIONS_DIR,
    });
    expect(report.applied).toContain('001_initial.sql');
    expect(report.skipped).toEqual([]);
  });

  it('tabelas previstas existem após migrate', async () => {
    if (!reachable) return;
    const c = createRawClient({
      url: CH_URL,
      username: CH_USER,
      password: CH_PASSWORD,
      database: testDb,
    });
    try {
      const rs = await c.query({
        query: `SELECT name FROM system.tables WHERE database = {db: String} ORDER BY name`,
        query_params: { db: testDb },
        format: 'JSONEachRow',
      });
      const tables = (await rs.json<{ name: string }>()).map((r) => r.name);
      expect(tables).toEqual(
        expect.arrayContaining([
          'ad_segments',
          'batch_analysis',
          'chat_messages',
          'schema_migrations',
        ]),
      );
    } finally {
      await c.close();
    }
  });

  it('re-rodar é idempotente (skipped contém 001)', async () => {
    if (!reachable) return;
    const report = await migrate({
      url: CH_URL,
      username: CH_USER,
      password: CH_PASSWORD,
      database: testDb,
      migrationsDir: MIGRATIONS_DIR,
    });
    expect(report.applied).toEqual([]);
    expect(report.skipped).toContain('001_initial.sql');
  });

  it('roundtrip INSERT/SELECT em chat_messages funciona', async () => {
    if (!reachable) return;
    const c = createRawClient({
      url: CH_URL,
      username: CH_USER,
      password: CH_PASSWORD,
      database: testDb,
    });
    try {
      await c.insert({
        table: 'chat_messages',
        format: 'JSONEachRow',
        values: [
          {
            channel_id: 'c1',
            platform: 'twitch',
            message_id: 'm1',
            username: 'alice',
            is_subscriber: 1,
            is_mod: 0,
            text: 'olá!',
            emotes: [],
            sentiment_heuristic: 'positive',
            category_heuristic: 'greeting',
            session_id: null,
            received_at: new Date().toISOString().replace('T', ' ').replace('Z', ''),
          },
        ],
      });
      const rs = await c.query({
        query: `SELECT count() AS c FROM chat_messages WHERE channel_id = {ch: String}`,
        query_params: { ch: 'c1' },
        format: 'JSONEachRow',
      });
      const rows = await rs.json<{ c: string }>();
      expect(Number(rows[0]?.c)).toBeGreaterThanOrEqual(1);
    } finally {
      await c.close();
    }
  });

  it('roundtrip em batch_analysis com colunas dos 7 insights', async () => {
    if (!reachable) return;
    const c = createRawClient({
      url: CH_URL,
      username: CH_USER,
      password: CH_PASSWORD,
      database: testDb,
    });
    try {
      const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
      await c.insert({
        table: 'batch_analysis',
        format: 'JSONEachRow',
        values: [
          {
            channel_id: 'c1',
            session_id: null,
            batch_id: randomUUID(),
            window_start: now,
            window_end: now,
            message_count: 10,
            message_count_weighted: 12,
            unique_users: 7,
            is_subscriber_ratio: 0.4,
            sentiment_pos: 5,
            sentiment_neu: 3,
            sentiment_neg: 2,
            top_categories_json: '[{"category":"game","count":4}]',
            dominant_category: 'game',
            least_category: 'meta',
            least_category_count: 1,
            top_toxic_users_json: '[]',
            most_toxic_username: 'bob',
            most_toxic_ratio: 0.66,
            most_toxic_msg_count: 3,
            least_toxic_username: 'alice',
            least_toxic_ratio: 0.9,
            least_toxic_msg_count: 5,
            ad_active: 0,
            ad_source: '',
            ad_sentiment_pos: 0,
            ad_sentiment_neu: 0,
            ad_sentiment_neg: 0,
            ad_sample_size: 0,
            mentioned_brands_json: '[]',
            top_tokens: ['pog', 'cara'],
            llm_tier: 1,
            llm_model: '',
            llm_cost_usd: 0,
            llm_latency_ms: 0,
            llm_cache_hit_rate: 0,
            llm_confidence: 0.7,
            insight_text: '',
          },
        ],
      });
      const rs = await c.query({
        query: `
          SELECT dominant_category, most_toxic_username, least_toxic_username
          FROM batch_analysis WHERE channel_id = {ch: String}
        `,
        query_params: { ch: 'c1' },
        format: 'JSONEachRow',
      });
      const rows = await rs.json<{
        dominant_category: string;
        most_toxic_username: string;
        least_toxic_username: string;
      }>();
      expect(rows[0]?.dominant_category).toBe('game');
      expect(rows[0]?.most_toxic_username).toBe('bob');
      expect(rows[0]?.least_toxic_username).toBe('alice');
    } finally {
      await c.close();
    }
  });
});
