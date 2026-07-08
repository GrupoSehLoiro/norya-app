import { describe, it, expect } from 'vitest';
import { classifySentiment, formatPct, formatRelative, cn } from '@/lib/utils';

describe('cn', () => {
  it('mescla classes Tailwind, removendo duplicação', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('flex', false, 'gap-2')).toBe('flex gap-2');
  });
});

describe('formatPct', () => {
  it('aplica 1 casa decimal por default', () => {
    expect(formatPct(0.183)).toBe('18.3%');
    expect(formatPct(1)).toBe('100.0%');
  });
});

describe('classifySentiment', () => {
  it('positivo quando pos dominante', () => {
    expect(classifySentiment({ pos: 0.7, neg: 0.1, neu: 0.2 }).label).toBe('positivo');
  });
  it('negativo quando neg dominante', () => {
    expect(classifySentiment({ pos: 0.1, neg: 0.7, neu: 0.2 }).label).toBe('negativo');
  });
  it('neutro quando tudo zero', () => {
    expect(classifySentiment({ pos: 0, neg: 0, neu: 0 }).label).toBe('neutro');
  });
});

describe('formatRelative', () => {
  it('retorna "agora" para datas instantâneas', () => {
    expect(formatRelative(new Date())).toBe('agora');
  });
  it('retorna em segundos para diff < 60s', () => {
    expect(formatRelative(new Date(Date.now() - 30_000))).toMatch(/^30s atrás$/);
  });
  it('retorna em minutos para diff < 1h', () => {
    expect(formatRelative(new Date(Date.now() - 5 * 60_000))).toMatch(/^5m atrás$/);
  });
});
