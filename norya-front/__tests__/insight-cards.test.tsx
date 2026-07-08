import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InsightCards } from '@/components/insights/insight-cards';
import type { BatchAnalysis } from '@/lib/types';

const baseAnalysis: BatchAnalysis = {
  batchId: '01ab23cd-ef45-6789-abcd-ef0123456789',
  channelId: 'c1',
  sessionId: null,
  windowStart: new Date('2026-05-19T12:00:00Z').toISOString(),
  windowEnd: new Date('2026-05-19T12:00:15Z').toISOString(),
  messageCount: 87,
  messageCountWeighted: 102,
  uniqueUsers: 41,
  isSubscriberRatio: 0.31,
  topTokens: ['rage', 'lag', 'fire'],
  climaGeral: { pos: 0.18, neg: 0.62, neu: 0.20 },
  pautaMaisComentada: { category: 'gameplay-negative', count: 28 },
  pautaMenosComentada: { category: 'hype', count: 9 },
  userMaisToxico: { username: 'ragequit99', ratio: 0.91, msgCount: 11, negCount: 10 },
  userMenosToxico: { username: 'calm', ratio: 0.83, msgCount: 6, posCount: 5 },
  sentimentoAd: { active: true, source: 'twitch', pos: 8, neg: 17, neu: 5, sampleSize: 30 },
  marcasMencionadas: [{ brand: 'YoDaSnacks', count: 4, sample: ['m1'] }],
  llmTier: 2,
  llmModel: 'mock-haiku-4-5',
  llmCostUsd: 0,
  llmLatencyMs: 12,
  llmCacheHitRate: 0,
  llmConfidence: 0.78,
  insightText: 'mock test',
};

describe('<InsightCards />', () => {
  it('renderiza clima geral com label correto', () => {
    render(<InsightCards analysis={baseAnalysis} />);
    expect(screen.getByText('negativo')).toBeInTheDocument();
  });
  // O componente foi enxugado para 3 cards (clima geral, pauta mais
  // comentada, marcas) — pauta menos comentada / user tóxico / badge AD
  // saíram do design. Os testes cobrem o que existe hoje.
  it('renderiza pauta mais comentada', () => {
    render(<InsightCards analysis={baseAnalysis} />);
    expect(screen.getByText('gameplay-negative')).toBeInTheDocument();
  });
  it('renderiza marca mencionada', () => {
    render(<InsightCards analysis={baseAnalysis} />);
    expect(screen.getByText('YoDaSnacks')).toBeInTheDocument();
  });
  it('brandsOverride substitui as marcas do batch (agregado cumulativo)', () => {
    render(
      <InsightCards
        analysis={baseAnalysis}
        brandsOverride={[{ brand: 'OutraMarca', count: 12, sample: ['m9'] }]}
      />,
    );
    expect(screen.getByText('OutraMarca')).toBeInTheDocument();
    expect(screen.queryByText('YoDaSnacks')).not.toBeInTheDocument();
  });
  it('renderiza fallbacks quando insight ausente', () => {
    const empty: BatchAnalysis = {
      ...baseAnalysis,
      pautaMaisComentada: null,
      pautaMenosComentada: null,
      userMaisToxico: null,
      userMenosToxico: null,
      sentimentoAd: null,
      marcasMencionadas: [],
    };
    render(<InsightCards analysis={empty} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma marca do allowlist apareceu')).toBeInTheDocument();
  });
});
