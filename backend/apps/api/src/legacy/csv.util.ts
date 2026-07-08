/**
 * Mini serializer CSV inline — escolha consciente para evitar dependência
 * (`json2csv`/`papaparse`) por causa de seis endpoints de export.
 *
 * Garantias:
 *   - Aspas duplas envolvem células que contêm vírgula, aspas, CR ou LF.
 *   - Aspas dentro da célula são escapadas dobrando ("Lula" → "Lula"" ").
 *   - `null`/`undefined` viram célula vazia.
 *   - Datas viram timestamps em horário de Brasília (UTC-3) no formato
 *     `dd/MM/yyyy HH:mm:ss` — mesmo padrão que o SLMOD-api legado usava.
 *
 * Se a lista ficar grande (> ~50k linhas) virar streaming, mas por enquanto
 * sync atende: collections legadas têm volume baixo e o cliente exporta
 * com filtro de data.
 */

export interface CsvColumn<T> {
  key: string;
  header: string;
  /** Extrai o valor cru da row. Default: `row[key as keyof T]`. */
  pick?: (row: T) => unknown;
  /** Formata o valor para string CSV. Default: `String(value)`. */
  format?: (value: unknown, row: T) => string;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const headerLine = columns.map((c) => escapeCell(c.header)).join(',');
  const dataLines = rows.map((row) =>
    columns
      .map((col) => {
        const raw = col.pick ? col.pick(row) : (row as Record<string, unknown>)[col.key];
        const formatted = col.format ? col.format(raw, row) : defaultFormat(raw);
        return escapeCell(formatted);
      })
      .join(','),
  );
  return [headerLine, ...dataLines].join('\r\n');
}

function defaultFormat(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatBrasilia(value);
  return String(value);
}

function escapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const BRASILIA_OFFSET_HOURS = -3;

export function formatBrasilia(date: Date): string {
  const local = new Date(date.getTime() + BRASILIA_OFFSET_HOURS * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ` +
    `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`
  );
}
