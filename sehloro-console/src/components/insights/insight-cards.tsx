import type { BatchAnalysis } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { classifySentiment, formatPct } from '@/lib/utils';

interface InsightCardsProps {
  analysis: BatchAnalysis;
  /**
   * Quando passado, sobrescreve `analysis.marcasMencionadas` no card de
   * marcas. Útil pra exibir agregação cumulativa (ex.: últimos 20 batches)
   * ao invés de só a janela de 15s do último batch — janelas curtas
   * raramente têm menção de marca, então o aggregate é melhor UX.
   */
  brandsOverride?: BatchAnalysis['marcasMencionadas'];
}

export function InsightCards({ analysis, brandsOverride }: InsightCardsProps) {
  const sent = classifySentiment(analysis.climaGeral);
  const brands = brandsOverride ?? analysis.marcasMencionadas;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {/* #1 — Clima geral */}
      <Card className="sm:col-span-2">
        <p className="eyebrow">Clima geral</p>
        <p className={`mt-3 text-2xl font-bold tracking-tight ${sent.color}`}>
          {sent.label}
        </p>
        <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <span className="bg-ok" style={{ width: `${analysis.climaGeral.pos * 100}%` }} />
          <span className="bg-white/30" style={{ width: `${analysis.climaGeral.neu * 100}%` }} />
          <span className="bg-err" style={{ width: `${analysis.climaGeral.neg * 100}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs text-ink-400">
          <span>+ {formatPct(analysis.climaGeral.pos)}</span>
          <span>~ {formatPct(analysis.climaGeral.neu)}</span>
          <span>- {formatPct(analysis.climaGeral.neg)}</span>
        </div>
      </Card>

      {/* #2 — Pauta mais comentada (quadro maior, descrição em destaque) */}
      <Card className="sm:col-span-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="eyebrow">Pauta mais comentada</p>
          {analysis.pautaMaisComentada && analysis.pautaMaisComentada.count > 0 && (
            <span className="text-xs text-ink-400">{analysis.pautaMaisComentada.count} menções</span>
          )}
        </div>
        {analysis.pautaMaisComentada ? (
          <>
            <p className="mt-2 text-2xl font-bold tracking-tight text-ink-800">
              {analysis.pautaMaisComentada.category}
            </p>
            {analysis.pautaMaisComentada.context ? (
              <p className="mt-3 border-l-2 border-accent-400/50 pl-3 text-[15px] leading-relaxed text-ink-700">
                {analysis.pautaMaisComentada.context}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-3 text-sm text-ink-400">—</p>
        )}
      </Card>

      {/* #7 — Marcas mencionadas (quadro maior — span 2 colunas) */}
      <Card className="sm:col-span-2">
        <div className="flex items-center justify-between gap-2">
          <p className="eyebrow">Marcas mencionadas</p>
          {brandsOverride ? (
            <span className="text-[10px] uppercase tracking-[0.12em] text-ink-400">
              cumulativo · histórico recente
            </span>
          ) : null}
        </div>
        {brands.length === 0 ? (
          <p className="mt-3 text-sm text-ink-400">Nenhuma marca do allowlist apareceu</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {brands.map((b) => (
              <li
                key={b.brand}
                className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5"
              >
                <span className="text-sm font-semibold text-ink-800">{b.brand}</span>
                <Badge tone="accent">{b.count}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
