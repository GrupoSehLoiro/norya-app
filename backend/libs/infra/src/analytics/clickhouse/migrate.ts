/**
 * Migration runner do ClickHouse.
 *
 * Vive aqui (libs/infra) e não em backend/scripts porque o pacote
 * @sehloro/infra é quem declara `@clickhouse/client` como dep. O script
 * shell em `backend/scripts/migrate-clickhouse.ts` apenas chama
 * `migrate({...})` daqui.
 *
 * Idempotência:
 *   - todo SQL aplicado é `CREATE ... IF NOT EXISTS`
 *   - schema_migrations registra arquivo + applied_at
 *   - re-rodar não duplica nem falha
 */
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface MigrationConfig {
  url: string;
  username: string;
  password: string;
  database: string;
  migrationsDir: string;
}

export interface MigrationReport {
  applied: string[];
  skipped: string[];
}

/**
 * Split heurístico de SQL em statements. Suporta:
 *   - comentários de linha (`-- ...`) — removidos antes do split
 *   - statements separados por `;` no final de linha
 *
 * NÃO suporta: literais string contendo `;`. Funciona para o schema
 * atual (DDL puro); se precisar de algo mais robusto trocamos por um
 * parser de SQL real.
 */
export function splitStatements(sql: string): string[] {
  const stripped = sql.replace(/--.*$/gm, '');
  return stripped
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function ensureDatabase(client: ClickHouseClient, database: string): Promise<void> {
  await client.exec({ query: `CREATE DATABASE IF NOT EXISTS \`${database}\`` });
}

async function ensureMigrationsTable(client: ClickHouseClient): Promise<void> {
  await client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   String,
        applied_at DateTime DEFAULT now()
      ) ENGINE = MergeTree ORDER BY filename
    `,
  });
}

async function listApplied(client: ClickHouseClient): Promise<Set<string>> {
  const rs = await client.query({
    query: 'SELECT filename FROM schema_migrations',
    format: 'JSONEachRow',
  });
  const rows = await rs.json<{ filename: string }>();
  return new Set(rows.map((r: { filename: string }) => r.filename));
}

async function runOne(client: ClickHouseClient, filename: string, sql: string): Promise<void> {
  const statements = splitStatements(sql);
  for (const stmt of statements) {
    await client.exec({ query: stmt });
  }
  await client.insert({
    table: 'schema_migrations',
    values: [{ filename }],
    format: 'JSONEachRow',
  });
}

export async function migrate(cfg: MigrationConfig): Promise<MigrationReport> {
  // 1. Bootstrap: cria a database conectando sem `database`.
  const bootstrap = createClient({
    url: cfg.url,
    username: cfg.username,
    password: cfg.password,
  });
  try {
    await ensureDatabase(bootstrap, cfg.database);
  } finally {
    await bootstrap.close();
  }

  // 2. Conecta na database alvo e aplica migrations.
  const client = createClient({
    url: cfg.url,
    username: cfg.username,
    password: cfg.password,
    database: cfg.database,
  });

  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await ensureMigrationsTable(client);
    const already = await listApplied(client);

    const entries = await readdir(cfg.migrationsDir);
    const files = entries.filter((f) => f.endsWith('.sql')).sort();

    if (files.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(`[migrate] nenhum arquivo .sql em ${cfg.migrationsDir}`);
    }

    for (const file of files) {
      if (already.has(file)) {
        // eslint-disable-next-line no-console
        console.log(`[migrate] skip ${file} (já aplicado)`);
        skipped.push(file);
        continue;
      }
      const sql = await readFile(join(cfg.migrationsDir, file), 'utf8');
      await runOne(client, file, sql);
      // eslint-disable-next-line no-console
      console.log(`[migrate] applied ${file}`);
      applied.push(file);
    }
  } finally {
    await client.close();
  }

  return { applied, skipped };
}
