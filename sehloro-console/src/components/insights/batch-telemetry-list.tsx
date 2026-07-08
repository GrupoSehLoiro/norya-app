'use client';

import { useState } from 'react';
import type { BatchAnalysis } from '@/lib/types';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatPct, formatRelative } from '@/lib/utils';

/**
 * Lista dos últimos batches (telemetria). Cada linha é colapsada por padrão;
 * ao clicar, expande pra baixo (animação de altura via grid-rows) e traz a
 * telemetria completa + o insight textual gerado pelo LLM.
 */
export function BatchTelemetryList({ items }: { items: BatchAnalysis[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader
        eyebrow="Telemetria"
        title="Últimos batches"
        description="Clique em um batch para ver a telemetria completa e o insight."
      />
      {items.length === 0 ? (
        <p className="text-sm text-ink-400">Nenhum batch ainda.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-white/[0.06]">
          {items.map((b) => {
            const open = openId === b.batchId;
            return (
              <li key={b.batchId}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : b.batchId)}
                  className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-white/[0.025]"
                >
                  <span className="font-mono text-xs text-ink-700">{b.batchId.slice(0, 8)}</span>
                  <span className="text-xs text-ink-400">{b.messageCount} msgs</span>
                  <Badge tone={b.llmTier === 2 ? 'accent' : b.llmTier === 0 ? 'warn' : 'neutral'}>
                    T{b.llmTier}
                  </Badge>
                  <span className="hidden text-xs text-ink-400 sm:inline">{b.llmLatencyMs} ms</span>
                  <span className="ml-auto text-xs text-ink-400">{formatRelative(b.windowStart)}</span>
                  <svg
                    viewBox="0 0 16 16"
                    className={`h-4 w-4 flex-shrink-0 text-ink-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {/* grid-rows 0fr→1fr anima a altura suavemente sem JS de medição */}
                <div
                  className={`grid transition-all duration-300 ease-out ${
                    open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="pb-4 pt-1">
                      <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3 xl:grid-cols-6">
                        <Stat label="Batch" value={b.batchId.slice(0, 8)} />
                        <Stat label="Msgs" value={`${b.messageCount} (${b.messageCountWeighted})`} />
                        <Stat label="Usuários" value={b.uniqueUsers} />
                        <Stat label="Modelo" value={b.llmModel || '—'} />
                        <Stat label="Latência" value={`${b.llmLatencyMs} ms`} />
                        <Stat label="Confiança" value={formatPct(b.llmConfidence)} />
                      </div>
                      <p className="mt-3 text-xs text-ink-400">
                        {formatDate(b.windowStart)} → {formatDate(b.windowEnd)}
                      </p>
                      {b.insightText ? (
                        <p className="mt-2 text-sm italic text-ink-600">&ldquo;{b.insightText}&rdquo;</p>
                      ) : (
                        <p className="mt-2 text-sm text-ink-400">Sem insight textual para este batch.</p>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink-800">{value}</p>
    </div>
  );
}
