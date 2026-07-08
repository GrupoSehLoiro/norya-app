/**
 * Unit tests do utilitário CSV inline.
 *
 * Não toca em Mongo nem precisa de mongodb-memory-server — roda em ms.
 * Garante que as garantias de escaping/formatting documentadas em
 * `csv.util.ts` continuam valendo.
 */
import { toCsv, formatBrasilia, type CsvColumn } from '../csv.util';

describe('toCsv', () => {
  it('serializa header + rows simples', () => {
    const csv = toCsv(
      [
        { a: 1, b: 'foo' },
        { a: 2, b: 'bar' },
      ],
      [
        { key: 'a', header: 'A' },
        { key: 'b', header: 'B' },
      ],
    );
    expect(csv).toBe('A,B\r\n1,foo\r\n2,bar');
  });

  it('escapa vírgula', () => {
    const csv = toCsv([{ v: 'a,b' }], [{ key: 'v', header: 'v' }]);
    expect(csv).toBe('v\r\n"a,b"');
  });

  it('escapa aspas duplas', () => {
    const csv = toCsv([{ v: 'he said "hi"' }], [{ key: 'v', header: 'v' }]);
    expect(csv).toBe('v\r\n"he said ""hi"""');
  });

  it('escapa CR/LF dentro de célula', () => {
    const csv = toCsv([{ v: 'line1\r\nline2' }], [{ key: 'v', header: 'v' }]);
    expect(csv).toBe('v\r\n"line1\r\nline2"');
  });

  it('null/undefined viram célula vazia', () => {
    const csv = toCsv(
      [{ a: null, b: undefined, c: 'x' }],
      [
        { key: 'a', header: 'A' },
        { key: 'b', header: 'B' },
        { key: 'c', header: 'C' },
      ],
    );
    expect(csv).toBe('A,B,C\r\n,,x');
  });

  it('formata Date em fuso de Brasília automaticamente', () => {
    // 2026-05-20T13:00:00Z → 10:00 BRT (UTC-3)
    const csv = toCsv([{ t: new Date('2026-05-20T13:00:00Z') }], [{ key: 't', header: 't' }]);
    expect(csv).toBe('t\r\n20/05/2026 10:00:00');
  });

  it('respeita `pick` customizado', () => {
    type Row = { options: { title: string }[] };
    const cols: CsvColumn<Row>[] = [
      { key: 'first', header: 'first', pick: (r) => r.options[0]?.title ?? '' },
      { key: 'second', header: 'second', pick: (r) => r.options[1]?.title ?? '' },
    ];
    const csv = toCsv([{ options: [{ title: 'a' }, { title: 'b' }] }], cols);
    expect(csv).toBe('first,second\r\na,b');
  });

  it('respeita `format` customizado', () => {
    const csv = toCsv(
      [{ n: 12345 }],
      [{ key: 'n', header: 'n', format: (v) => `R$ ${Number(v).toFixed(2)}` }],
    );
    expect(csv).toBe('n\r\nR$ 12345.00');
  });

  it('header escapa caracteres especiais também', () => {
    const csv = toCsv([], [{ key: 'a', header: 'col, with comma' }]);
    expect(csv).toBe('"col, with comma"');
  });
});

describe('formatBrasilia', () => {
  it('produz dd/MM/yyyy HH:mm:ss', () => {
    expect(formatBrasilia(new Date('2026-01-15T13:30:45Z'))).toBe('15/01/2026 10:30:45');
  });

  it('zero-pad em todos os componentes', () => {
    expect(formatBrasilia(new Date('2026-02-05T04:05:09Z'))).toBe('05/02/2026 01:05:09');
  });

  it('vira o dia quando o offset cruza meia-noite', () => {
    // 01:30 UTC do dia 5 → 22:30 BRT do dia 4
    expect(formatBrasilia(new Date('2026-03-05T01:30:00Z'))).toBe('04/03/2026 22:30:00');
  });
});
