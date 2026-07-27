/**
 * Helpers de dia/intervalo compartilhados entre o gráfico de atividade e os
 * painéis que seguem o mesmo período selecionado no topo da página de análise.
 */
import { timeFormat } from 'd3-time-format';

export function ymdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayYmd(): string {
  return ymdFromDate(new Date());
}

// Faz o parse de um 'YYYY-MM-DD' numa tupla [ano, mês, dia] de números.
// Necessário porque com `noUncheckedIndexedAccess` o destructure de
// `.split('-').map(Number)` tipa cada elemento como `number | undefined`.
export function parseYmd(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y ?? 0, m ?? 1, d ?? 1];
}

export function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = parseYmd(ymd);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return ymdFromDate(dt);
}

export function dayBoundsIso(ymd: string): { from: string; to: string } {
  // ymd vem do calendário no timezone local. Construímos o intervalo
  // [00:00, 23:59:59.999] local e mandamos em ISO UTC.
  const [y, m, d] = parseYmd(ymd);
  const from = new Date(y, m - 1, d, 0, 0, 0, 0);
  const to = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

const longDate = timeFormat('%a, %d %b %Y');
export function formatYmdLabel(ymd: string): string {
  const [y, m, d] = parseYmd(ymd);
  return longDate(new Date(y, m - 1, d));
}

/**
 * Timestamps do ClickHouse chegam como 'YYYY-MM-DD HH:mm:ss.SSS' SEM sufixo
 * de fuso — mas são UTC. Sem normalizar, o navegador interpreta como hora
 * local e desloca gráfico e recortes em horas. (Eventos do SSE já vêm em
 * ISO com 'Z' e passam direto.)
 */
export function parseUtcDate(s: string): Date {
  if (/z$|[+-]\d\d:?\d\d$/i.test(s)) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
}
