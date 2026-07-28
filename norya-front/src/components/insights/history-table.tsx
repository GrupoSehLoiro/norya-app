import type { BatchAnalysis } from '@/lib/types';
import { humanizeCategory } from '@/lib/category-labels';
import { formatDate, formatPct } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export function HistoryTable({ items }: { items: BatchAnalysis[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-400">Sem histórico para este canal ainda.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-white/[0.08] text-left text-[10px] uppercase tracking-[0.14em] text-ink-400">
            <th className="pb-2 pr-4 font-medium">Janela</th>
            <th className="pb-2 pr-4 font-medium">Msgs</th>
            <th className="pb-2 pr-4 font-medium">Pos</th>
            <th className="pb-2 pr-4 font-medium">Neg</th>
            <th className="pb-2 pr-4 font-medium">Pauta</th>
            <th className="pb-2 pr-4 font-medium">Tóxico</th>
            <th className="pb-2 pr-4 font-medium">Tier</th>
            <th className="pb-2 pr-4 font-medium">Custo</th>
          </tr>
        </thead>
        <tbody className="text-ink-800">
          {items.map((b) => (
            <tr key={b.batchId} className="border-b border-white/[0.05] last:border-0 transition-colors hover:bg-white/[0.025]">
              <td className="py-2 pr-4 font-mono text-xs text-ink-700">{formatDate(b.windowStart)}</td>
              <td className="py-2 pr-4">{b.messageCount}</td>
              <td className="py-2 pr-4 text-ok">{formatPct(b.climaGeral.pos)}</td>
              <td className="py-2 pr-4 text-err">{formatPct(b.climaGeral.neg)}</td>
              <td className="py-2 pr-4">
                {b.pautaMaisComentada ? humanizeCategory(b.pautaMaisComentada.category) : '—'}
              </td>
              <td className="py-2 pr-4">{b.userMaisToxico?.username ?? '—'}</td>
              <td className="py-2 pr-4">
                <Badge tone={b.llmTier === 2 ? 'accent' : b.llmTier === 0 ? 'warn' : 'neutral'}>
                  T{b.llmTier}
                </Badge>
              </td>
              <td className="py-2 pr-4 text-ink-400">${Number(b.llmCostUsd ?? 0).toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
