'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fetchChatTopics, fetchChatTopicsHistory } from '@/lib/analytics';
import { isContiguousYmds, parseUtcDate, ymdFromDate } from '@/lib/day-range';

function fmtHour(iso: string): string {
  const d = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * "Assuntos do chat" — labels dos assuntos mais comentados + descrição via IA
 * (Haiku). O período vem do seletor no topo da página (não tem seletor
 * próprio); assuntos podem ser ocultados individualmente pelo "×".
 */
export function ChatTopicsPanel({
  channelId,
  from,
  to,
  dates,
}: {
  channelId: string | null;
  from: string;
  to: string;
  /**
   * Dias selecionados (YYYY-MM-DD), possivelmente não contíguos. O histórico
   * por hora é filtrado para os dias da seleção; o resumo da IA cobre o
   * intervalo completo from..to (uma chamada só) — com buracos na seleção,
   * um aviso sinaliza a diferença.
   */
  dates?: string[];
}) {
  // Assuntos ocultados pelo usuário (por sessão de visualização).
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const topics = useQuery({
    enabled: !!channelId,
    queryKey: ['chat-topics', channelId, from, to],
    queryFn: () => fetchChatTopics(channelId!, from, to),
    staleTime: 30_000,
    refetchInterval: 30_000, // dinâmico
  });
  const history = useQuery({
    enabled: !!channelId,
    queryKey: ['chat-topics-history', channelId, from, to],
    queryFn: () => fetchChatTopicsHistory(channelId!, from, to),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  function hide(label: string) {
    setHidden((prev) => new Set(prev).add(label));
  }

  const visibleLabels = (topics.data?.labels ?? []).filter((l) => !hidden.has(l));
  const gappedSelection = !!dates && dates.length > 1 && !isContiguousYmds(dates);
  // Buckets do histórico: só os dos dias selecionados (o bucket vem em UTC;
  // convertemos pro dia local antes de comparar).
  const selectedDays = dates ? new Set(dates) : null;
  const visibleBuckets = (history.data ?? []).filter(
    (b) => !selectedDays || selectedDays.has(ymdFromDate(parseUtcDate(b.bucket))),
  );

  return (
    <Card>
      <CardHeader
        eyebrow="IA"
        title="Assuntos do chat"
        description="Os temas que dominaram a conversa, resumidos pela IA."
        actions={
          hidden.size > 0 ? (
            <button
              type="button"
              onClick={() => setHidden(new Set())}
              className="text-[11px] text-ink-400 transition-colors hover:text-ink-700"
            >
              restaurar {hidden.size} oculto(s)
            </button>
          ) : null
        }
      />

      {!channelId ? (
        <p className="text-sm text-ink-400">Selecione um canal.</p>
      ) : topics.isLoading ? (
        <p className="text-sm text-ink-400">analisando…</p>
      ) : topics.isError ? (
        <p className="text-sm text-err">Não foi possível carregar os assuntos agora.</p>
      ) : (topics.data?.messageCount ?? 0) === 0 ? (
        <p className="text-sm text-ink-400">Sem mensagens nesse período ainda.</p>
      ) : (
        <div className="space-y-4">
          {visibleLabels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {visibleLabels.map((l) => (
                <span
                  key={l}
                  className="group flex items-center gap-1.5 rounded-full border border-accent-400/30 bg-accent-400/[0.08] py-1 pl-3 pr-1.5 text-sm text-ink-800"
                >
                  {l}
                  <button
                    type="button"
                    onClick={() => hide(l)}
                    aria-label={`Ocultar assunto ${l}`}
                    title="Ocultar este assunto"
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-ink-400 transition-colors hover:bg-white/[0.10] hover:text-ink-800"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="text-sm leading-relaxed text-ink-700">{topics.data!.summary}</p>
          {gappedSelection && (
            <p className="text-[11px] text-ink-400">
              A seleção tem dias excluídos — o resumo da IA cobre o intervalo completo entre o
              primeiro e o último dia; o histórico abaixo mostra só os dias selecionados.
            </p>
          )}
          <div className="flex items-center justify-between text-[11px] text-ink-400">
            <span>{topics.data!.messageCount} mensagens no período</span>
            <Badge tone={topics.data!.aiEnabled ? 'positive' : 'neutral'}>
              {topics.data!.aiEnabled ? 'descrito pela IA' : 'resumo básico'}
            </Badge>
          </div>
        </div>
      )}

      {/* Histórico de assuntos por timestamp */}
      {channelId && visibleBuckets.length > 0 && (
        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-400">
            Histórico (por hora)
          </p>
          <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {visibleBuckets.map((b) => (
              <li key={b.bucket} className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-ink-700">{fmtHour(b.bucket)}</span>
                  <span className="text-[10px] text-ink-400">{b.messageCount} msgs</span>
                </div>
                {b.labels.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {b.labels.map((l) => (
                      <span key={l} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-ink-600">
                        {l}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
