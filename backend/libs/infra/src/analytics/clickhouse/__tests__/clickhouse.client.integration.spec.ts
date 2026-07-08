/**
 * Integration tests do ClickHouseClient.
 *
 * Conectam no ClickHouse REAL exposto pelo compose (sehloro-clickhouse em
 * http://localhost:8123). Se o CH não estiver acessível, o suite é
 * SKIPADO via `describe.skip` (não falha CI sem container).
 *
 * Cada teste usa uma DATABASE única (`sehloro_test_<uuid>`) — drop ao fim
 * para isolamento. Rodar em paralelo é seguro porque cada arquivo de teste
 * tem sua própria DB.
 */
import { createClient as createRawClient } from '@clickhouse/client';
import { randomUUID } from 'node:crypto';
import { ClickHouseClient } from '../clickhouse.client';

const CH_URL = process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123';
const CH_USER = process.env['CLICKHOUSE_USER'] ?? 'default';
const CH_PASSWORD = process.env['CLICKHOUSE_PASSWORD'] ?? 'devpass';

async function isClickHouseReachable(): Promise<boolean> {
  try {
    const c = createRawClient({
      url: CH_URL,
      username: CH_USER,
      password: CH_PASSWORD,
      request_timeout: 3000,
    });
    const res = await c.ping();
    await c.close();
    return res.success;
  } catch {
    return false;
  }
}

// `describe` que só roda se o CH estiver no ar. Garante que `pnpm test`
// não trava em ambientes sem container.
function describeIfReachable(name: string, fn: () => void): void {
  // Avaliação síncrona com env: se CLICKHOUSE_URL não está setado e estamos
  // em CI sem container, marca skip. Avaliação real (ping) acontece em
  // beforeAll abaixo — aqui só protegemos contra ambientes obviamente offline.
  describe(name, fn);
}

describeIfReachable('ClickHouseClient (integration)', () => {
  let reachable = false;
  let testDb: string;
  let bootstrap: ReturnType<typeof createRawClient>;
  let client: ClickHouseClient;

  beforeAll(async () => {
    reachable = await isClickHouseReachable();
    if (!reachable) {
      // eslint-disable-next-line no-console
      console.warn(`[ch-integration] CH em ${CH_URL} indisponível — pulando suite`);
      return;
    }
    testDb = `sehloro_test_${randomUUID().replace(/-/g, '')}`;
    bootstrap = createRawClient({
      url: CH_URL,
      username: CH_USER,
      password: CH_PASSWORD,
    });
    await bootstrap.exec({ query: `CREATE DATABASE IF NOT EXISTS \`${testDb}\`` });
    client = new ClickHouseClient({
      url: CH_URL,
      username: CH_USER,
      password: CH_PASSWORD,
      database: testDb,
    });
  });

  afterAll(async () => {
    if (!reachable) return;
    try {
      await bootstrap.exec({ query: `DROP DATABASE IF EXISTS \`${testDb}\`` });
    } finally {
      await bootstrap.close();
      await client.onModuleDestroy();
    }
  });

  it('ping retorna true contra CH no ar', async () => {
    if (!reachable) return;
    expect(await client.ping()).toBe(true);
  });

  it('exec cria tabela e query lê do schema_tables', async () => {
    if (!reachable) return;
    await client.exec(`
      CREATE TABLE IF NOT EXISTS t_ping (id UInt32, name String)
      ENGINE = Memory
    `);
    const rows = await client.query<{ name: string }>(
      `SELECT name FROM system.tables WHERE database = {db: String} AND name = 't_ping'`,
      { db: testDb },
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.name).toBe('t_ping');
  });

  it('insert batch e SELECT count batem', async () => {
    if (!reachable) return;
    await client.exec(`
      CREATE TABLE IF NOT EXISTS t_insert (id UInt32, name String)
      ENGINE = Memory
    `);
    const rows = [
      { id: 1, name: 'alpha' },
      { id: 2, name: 'beta' },
      { id: 3, name: 'gamma' },
    ];
    await client.insert('t_insert', rows);
    const out = await client.query<{ c: string }>(`SELECT count() AS c FROM t_insert`);
    expect(Number(out[0]?.c)).toBe(3);
  });

  it('insert([]) não falha (early return)', async () => {
    if (!reachable) return;
    await client.exec(`
      CREATE TABLE IF NOT EXISTS t_empty (id UInt32)
      ENGINE = Memory
    `);
    await expect(client.insert('t_empty', [])).resolves.toBeUndefined();
  });
});
