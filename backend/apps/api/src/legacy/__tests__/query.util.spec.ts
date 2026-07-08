/**
 * Unit tests do utilitário de filtro/paginação.
 *
 * Garante que `buildFilter` aplica canal e intervalo de datas corretamente
 * para os dois nomes de campo de timestamp (`timestamp` vs `created_at`),
 * e que `paged` calcula totalPages corretamente nos edge cases.
 */
import { buildFilter, paged } from '../query.util';
import type { ListQuery } from '../dto/list-query.dto';

function q(partial: Partial<ListQuery> = {}): ListQuery {
  return { page: 1, pageSize: 20, ...partial };
}

describe('buildFilter', () => {
  it('vazio sem filtros', () => {
    expect(buildFilter(q(), 'timestamp')).toEqual({});
  });

  it('aplica filtro por canal', () => {
    expect(buildFilter(q({ channel: 'leozeraplay' }), 'timestamp')).toEqual({
      channel: 'leozeraplay',
    });
  });

  it('aplica intervalo de datas no campo `timestamp`', () => {
    const start = new Date('2026-05-20T00:00:00Z');
    const end = new Date('2026-05-25T00:00:00Z');
    expect(buildFilter(q({ startDate: start, endDate: end }), 'timestamp')).toEqual({
      timestamp: { $gte: start, $lte: end },
    });
  });

  it('usa o nome de campo customizado (predictions/polls)', () => {
    const start = new Date('2026-05-20T00:00:00Z');
    expect(buildFilter(q({ startDate: start }), 'created_at')).toEqual({
      created_at: { $gte: start },
    });
  });

  it('aceita só startDate ou só endDate', () => {
    const d = new Date('2026-05-20T00:00:00Z');
    expect(buildFilter(q({ startDate: d }), 'timestamp')).toEqual({ timestamp: { $gte: d } });
    expect(buildFilter(q({ endDate: d }), 'timestamp')).toEqual({ timestamp: { $lte: d } });
  });

  it('combina canal + intervalo', () => {
    const start = new Date('2026-05-20T00:00:00Z');
    expect(buildFilter(q({ channel: 'r', startDate: start }), 'timestamp')).toEqual({
      channel: 'r',
      timestamp: { $gte: start },
    });
  });
});

describe('paged', () => {
  it('calcula totalPages para dados completos', () => {
    expect(paged([1, 2, 3], 50, q({ page: 1, pageSize: 10 }))).toEqual({
      items: [1, 2, 3],
      total: 50,
      page: 1,
      pageSize: 10,
      totalPages: 5,
    });
  });

  it('arredonda totalPages pra cima', () => {
    expect(paged([], 11, q({ page: 1, pageSize: 10 })).totalPages).toBe(2);
  });

  it('garante totalPages mínimo de 1 mesmo sem registros', () => {
    expect(paged([], 0, q()).totalPages).toBe(1);
  });
});
