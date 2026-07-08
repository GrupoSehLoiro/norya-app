/**
 * Constrói o filtro Mongoose comum às 6 features legadas a partir do
 * DTO de listagem. O nome do campo de data varia por feature:
 *   - ban / timeout / messageDeleted / chatEmoji → `timestamp`
 *   - prediction / poll → `created_at`
 */
import type { FilterQuery } from 'mongoose';
import type { ListQuery, ExportQuery } from './dto/list-query.dto';

export function buildFilter(
  q: ListQuery | ExportQuery,
  timestampField: string,
): FilterQuery<Record<string, unknown>> {
  const filter: Record<string, unknown> = {};
  if (q.channel) filter.channel = q.channel;
  if (q.startDate || q.endDate) {
    const range: Record<string, Date> = {};
    if (q.startDate) range.$gte = q.startDate;
    if (q.endDate) range.$lte = q.endDate;
    filter[timestampField] = range;
  }
  return filter as FilterQuery<Record<string, unknown>>;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function paged<T>(items: T[], total: number, q: ListQuery): PagedResult<T> {
  return {
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

export interface CountByChannelRow {
  channel: string;
  count: number;
}
