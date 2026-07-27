'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, getToken } from '@/lib/api-client';
import { fetchChannels } from '@/lib/queries';
import { useSelectedChannel } from '@/hooks/use-selected-channel';
import { cn, formatDate } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { DateRangeFilter, type DateRangeValue } from '@/components/ui/date-range';
import type { PagedResponse } from '@/lib/legacy-types';

export interface LegacyColumn<T> {
  key: string;
  header: string;
  width?: string;
  render?: (row: T) => ReactNode;
  /** Quando true, célula é monospace + truncated (mensagens, IDs). */
  mono?: boolean;
}

interface Props<T> {
  /** Resource path: bans, timeouts, removed, predictions, polls, emojis. */
  resource: string;
  /** queryKey prefix used by TanStack Query cache. */
  queryKey: string;
  columns: LegacyColumn<T>[];
  /** Substantivo do registro (plural) — usado na contagem. Ex.: "bans". */
  noun?: string;
  /** Mensagem do estado vazio. */
  emptyTitle?: string;
  emptyDescription?: string;
}

const DEFAULT_PAGE_SIZE = 20;
const EMPTY_RANGE: DateRangeValue = { from: '', to: '' };

/** yyyy-mm-dd → ISO no início/fim do dia (local), ou undefined se vazio. */
function toIso(day: string, endOfDay = false): string | undefined {
  if (!day) return undefined;
  return new Date(`${day}T${endOfDay ? '23:59:59' : '00:00:00'}`).toISOString();
}

/**
 * Tabela compartilhada das 6 telas de histórico (bans, timeouts, mensagens
 * removidas, emojis, enquetes, predictions). O canal NÃO é escolhido aqui: os
 * dados seguem o canal ativo global (o mesmo do menu da conta). Aqui o usuário
 * só recorta o período e exporta.
 */
export function LegacyTable<T extends { id: string }>({
  resource,
  queryKey,
  columns,
  noun = 'registros',
  emptyTitle = 'Nada por aqui ainda',
  emptyDescription = 'Assim que houver registros deste canal no período, eles aparecem aqui.',
}: Props<T>) {
  const { channelId: selectedChannelId } = useSelectedChannel();

  // Resolve UUID → nome/plataforma do canal (as coleções legadas indexam por
  // nome de canal, não por id).
  const { data: channelsList } = useQuery({
    queryKey: ['legacy:channels-lookup'],
    queryFn: fetchChannels,
    staleTime: 60_000,
  });
  const channel = useMemo(
    () => channelsList?.find((c) => c.id === selectedChannelId) ?? null,
    [channelsList, selectedChannelId],
  );
  const channelName = channel?.name ?? null;

  const [page, setPage] = useState(1);
  const [range, setRange] = useState<DateRangeValue>(EMPTY_RANGE);
  const [applied, setApplied] = useState<DateRangeValue>(EMPTY_RANGE);
  const hasRange = Boolean(applied.from || applied.to);

  const { data, isLoading, error } = useQuery({
    enabled: !!channelName,
    queryKey: [queryKey, channelName, page, applied],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(DEFAULT_PAGE_SIZE));
      params.set('channel', channelName!);
      const start = toIso(applied.from);
      const end = toIso(applied.to, true);
      if (start) params.set('startDate', start);
      if (end) params.set('endDate', end);
      return api.get<PagedResponse<T>>(`/api/v2/legacy/${resource}?${params.toString()}`);
    },
  });

  function apply() {
    setPage(1);
    setApplied({ ...range });
  }
  function clear() {
    setRange(EMPTY_RANGE);
    setApplied(EMPTY_RANGE);
    setPage(1);
  }

  async function downloadCsv() {
    const params = new URLSearchParams();
    if (channelName) params.set('channel', channelName);
    const start = toIso(applied.from);
    const end = toIso(applied.to, true);
    if (start) params.set('startDate', start);
    if (end) params.set('endDate', end);
    const token = getToken();
    const res = await fetch(`/api/v2/legacy/${resource}/export/csv?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      // eslint-disable-next-line no-alert
      alert(`Não foi possível exportar agora (HTTP ${res.status}). Tente de novo em instantes.`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resource}-${channelName ?? 'canal'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Sem canal ativo → não há o que mostrar. Convida a escolher um.
  if (!selectedChannelId || (channelsList && !channel)) {
    return (
      <EmptyState
        title="Selecione um canal"
        description="Escolha um canal ativo no menu da conta (canto superior direito) pra ver o histórico deste canal."
      />
    );
  }

  const periodLabel = hasRange
    ? `${applied.from || 'início'} → ${applied.to || 'hoje'}`
    : 'todo o histórico';

  return (
    <div className="flex flex-col gap-5">
      {/* Toolbar: escopo do canal (só leitura) + período + exportação */}
      <Card padding="sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-2.5 pb-1">
            <span
              className={cn(
                'inline-block h-2 w-2 rounded-full',
                channel?.platform === 'twitch' ? 'bg-platform-twitch' : 'bg-platform-kick',
              )}
              aria-hidden
            />
            <span className="text-sm font-semibold text-ink-800">
              {channelName ?? 'carregando…'}
            </span>
            {channel && (
              <Badge tone={channel.platform === 'twitch' ? 'twitch' : 'kick'}>
                {channel.platform}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <DateRangeFilter value={range} onChange={setRange} onApply={apply}>
              {hasRange && (
                <Button type="button" size="sm" variant="ghost" onClick={clear}>
                  Limpar
                </Button>
              )}
            </DateRangeFilter>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={downloadCsv}
              title="Baixar o período filtrado em CSV"
            >
              Exportar CSV
            </Button>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <TableSkeleton columns={columns.length} />
      ) : error ? (
        <Card className="border border-err/30 bg-err/[0.08] text-sm text-err">
          Não foi possível carregar agora. Tente de novo em instantes.
        </Card>
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <div className="flex items-center justify-between px-1 text-xs text-ink-400">
            <span>
              <b className="text-ink-700">{data.total.toLocaleString('pt-BR')}</b> {noun}
            </span>
            <span>{periodLabel}</span>
          </div>

          <Card padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400"
                        style={c.width ? { width: c.width } : undefined}
                      >
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-white/[0.04] last:border-0 transition-colors hover:bg-white/[0.03]"
                    >
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={cn(
                            'px-4 py-3 align-top text-ink-800',
                            c.mono && 'font-mono text-[12.5px] text-ink-600',
                          )}
                        >
                          {c.render
                            ? c.render(row)
                            : String((row as unknown as Record<string, unknown>)[c.key] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function TableSkeleton({ columns }: { columns: number }) {
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="divide-y divide-white/[0.04]">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: columns }).map((__, j) => (
              <div
                key={j}
                className="h-3.5 flex-1 animate-pulse rounded bg-white/[0.06]"
                style={{ maxWidth: j === columns - 1 ? '40%' : undefined }}
              />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Pagination({
  page, totalPages, onChange,
}: { page: number; totalPages: number; onChange: (p: number) => void }) {
  return (
    <div className="flex items-center justify-end gap-2 text-sm text-ink-400">
      <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← Anterior
      </Button>
      <span className="px-1 text-xs tabular-nums text-ink-600">
        {page} / {totalPages}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Próxima →
      </Button>
    </div>
  );
}

/** Helper compartilhado de formatação. */
export function fmtDate(iso: string | null | undefined): string {
  return formatDate(iso);
}
