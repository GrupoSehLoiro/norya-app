/**
 * Migration runner shim — wrapper de CLI sobre `migrate()` em
 * `@sehloro/infra/analytics/clickhouse`.
 *
 * Mantemos o shim em scripts/ para que o serviço `clickhouse-migrate` do
 * compose monte só esse arquivo (sem precisar copiar a infra inteira),
 * usando `tsx` + um `npm install` ad-hoc de `@clickhouse/client + tsx`.
 *
 * Localmente também é o entrypoint convencional:
 *   tsx backend/scripts/migrate-clickhouse.ts
 *
 * Saída:
 *   exit 0 — todas as migrations aplicadas (ou nada a aplicar)
 *   exit 1 — falha em alguma migration
 */
import { resolve } from 'node:path';

// Quando o script roda dentro do container `clickhouse-migrate` do
// compose, a copia foi feita para /tmp/ch-migrate/ e o `@clickhouse/
// client` foi instalado nesse mesmo dir. Esse `require` resolve via
// CWD (cd /tmp/ch-migrate). Localmente (dentro do workspace pnpm)
// resolve via libs/infra/node_modules.
//
// Usamos import dinâmico tipado pra contornar limitações de
// resolução em build-time quando rodando fora do workspace.
async function loadMigrate(): Promise<
  typeof import('../libs/infra/src/analytics/clickhouse/migrate').migrate
> {
  // No workspace: import direto do source TS funciona (ts-jest / tsx).
  if (process.env['MIGRATE_FROM_SOURCE'] !== '0') {
    try {
      const m = await import('../libs/infra/src/analytics/clickhouse/migrate');
      return m.migrate;
    } catch {
      // fallthrough — ambiente sem workspace (compose container).
    }
  }
  // Fallback: implementação inline que duplica a lógica em libs/infra.
  // Mantida sincronizada manualmente. Pequena (~80 LOC) — facilita
  // o serviço `clickhouse-migrate` ser self-contained.
  const ch = await import('@clickhouse/client' as string);
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  return async function inlineMigrate(cfg): Promise<{ applied: string[]; skipped: string[] }> {
    const bootstrap = ch.createClient({
      url: cfg.url,
      username: cfg.username,
      password: cfg.password,
    });
    try {
      await bootstrap.exec({
        query: `CREATE DATABASE IF NOT EXISTS \`${cfg.database}\``,
      });
    } finally {
      await bootstrap.close();
    }
    const client = ch.createClient({
      url: cfg.url,
      username: cfg.username,
      password: cfg.password,
      database: cfg.database,
    });
    const applied: string[] = [];
    const skipped: string[] = [];
    try {
      await client.exec({
        query: `
          CREATE TABLE IF NOT EXISTS schema_migrations (
            filename String, applied_at DateTime DEFAULT now()
          ) ENGINE = MergeTree ORDER BY filename
        `,
      });
      const rs = await client.query({
        query: 'SELECT filename FROM schema_migrations',
        format: 'JSONEachRow',
      });
      const already = new Set((await rs.json<{ filename: string }>()).map((r) => r.filename));
      const files = (await fs.readdir(cfg.migrationsDir))
        .filter((f: string) => f.endsWith('.sql'))
        .sort();
      for (const f of files) {
        if (already.has(f)) {
          // eslint-disable-next-line no-console
          console.log(`[migrate] skip ${f} (já aplicado)`);
          skipped.push(f);
          continue;
        }
        const sql = await fs.readFile(path.join(cfg.migrationsDir, f), 'utf8');
        const statements = sql
          .replace(/--.*$/gm, '')
          .split(/;\s*\n/)
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0);
        for (const stmt of statements) {
          await client.exec({ query: stmt });
        }
        await client.insert({
          table: 'schema_migrations',
          values: [{ filename: f }],
          format: 'JSONEachRow',
        });
        // eslint-disable-next-line no-console
        console.log(`[migrate] applied ${f}`);
        applied.push(f);
      }
    } finally {
      await client.close();
    }
    return { applied, skipped };
  };
}

async function main(): Promise<void> {
  const cfg = {
    url: process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123',
    username: process.env['CLICKHOUSE_USER'] ?? 'default',
    password: process.env['CLICKHOUSE_PASSWORD'] ?? '',
    database: process.env['CLICKHOUSE_DB'] ?? 'sehloro',
    migrationsDir:
      process.env['MIGRATIONS_DIR'] ??
      resolve(__dirname, '..', '..', 'infra', 'clickhouse', 'migrations'),
  };
  // eslint-disable-next-line no-console
  console.log(`[migrate] iniciando — url=${cfg.url} db=${cfg.database} dir=${cfg.migrationsDir}`);
  const migrate = await loadMigrate();
  const report = await migrate(cfg);
  // eslint-disable-next-line no-console
  console.log(`[migrate] done — applied=${report.applied.length} skipped=${report.skipped.length}`);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[migrate] FAIL', err);
    process.exit(1);
  });
}
