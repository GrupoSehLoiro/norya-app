'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, getToken } from '@/lib/api-client';
import { fetchChannels } from '@/lib/queries';
import { useSelectedChannel } from '@/hooks/use-selected-channel';
import { cn, formatDate } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import type { PagedResponse } from '@/lib/legacy-types';

export interface LegacyColumn<T> {
  key: string;
  header: string;
  width?: string;
  render?: (row: T) => ReactNode;
  /** Quando true, célula é monospace + truncated (mensagens, IDs). */
  mono?: boolean;
}

interface Filters {
  channel: string;
  startDate: string;
  endDate: string;
}

interface Props<T> {
  /** Resource path: bans, timeouts, removed, predictions, polls, emojis. */
  resource: string;
  /** queryKey prefix used by TanStack Query cache. */
  queryKey: string;
  columns: LegacyColumn<T>[];
  /** Caso o endpoint devolva `channels` (predictions/polls), passa um picker. */
  showChannelsFromResponse?: boolean;
  /** Lista de canais conhecidos. Se ausente, mostra input livre. */
  knownChannels?: string[];
  /** Mensagem do estado vazio. */
  emptyTitle?: string;
  emptyDescription?: string;
}

const DEFAULT_PAGE_SIZE = 20;

export function LegacyTable<T extends { id: string }>({
  resource,
  queryKey,
  columns,
  showChannelsFromResponse,
  knownChannels,
  emptyTitle = 'Nada encontrado',
  emptyDescription = 'Ajuste os filtros ou aguarde novos registros vindos dos bots.',
}: Props<T>) {
  const { channelId: selectedChannelId } = useSelectedChannel();
  // Resolve UUID → nome do canal (collections legadas indexam por nome de canal).
  const { data: channelsList } = useQuery({
    queryKey: ['legacy:channels-lookup'],
    queryFn: fetchChannels,
    staleTime: 60_000,
  });
  const selectedChannelName = useMemo(() => {
    if (!selectedChannelId || !channelsList) return null;
    return channelsList.find((c) => c.id === selectedChannelId)?.name ?? null;
  }, [selectedChannelId, channelsList]);

  const [page, setPage] = useState(1);
  const [pendingFilters, setPendingFilters] = useState<Filters>({
    channel: '',
    startDate: '',
    endDate: '',
  });
  const [appliedFilters, setAppliedFilters] = useState<Filters>({
    channel: '',
    startDate: '',
    endDate: '',
  });

  // Auto-aplica o canal selecionado no sidebar como filtro inicial.
  // Só reaplica quando o selectedChannelName muda (mudança de canal no picker)
  // — não sobrescreve mudanças manuais subsequentes do usuário no dropdown.
  const lastAutoApplied = useRef<string | null>(null);
  useEffect(() => {
    if (selectedChannelName && selectedChannelName !== lastAutoApplied.current) {
      lastAutoApplied.current = selectedChannelName;
      setPendingFilters((p) => ({ ...p, channel: selectedChannelName }));
      setAppliedFilters((a) => ({ ...a, channel: selectedChannelName }));
      setPage(1);
    } else if (!selectedChannelName && lastAutoApplied.current !== null) {
      // Canal foi limpo no picker → limpa o filtro (mas só se o que estava aplicado
      // foi a gente quem aplicou; respeita escolha manual).
      lastAutoApplied.current = null;
    }
  }, [selectedChannelName]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(DEFAULT_PAGE_SIZE));
    if (appliedFilters.channel) params.set('channel', appliedFilters.channel);
    if (appliedFilters.startDate) {
      params.set('startDate', new Date(appliedFilters.startDate).toISOString());
    }
    if (appliedFilters.endDate) {
      params.set('endDate', new Date(appliedFilters.endDate).toISOString());
    }
    return params.toString();
  }, [page, appliedFilters]);

  const { data, isLoading, error } = useQuery({
    queryKey: [queryKey, page, appliedFilters],
    queryFn: () =>
      api.get<PagedResponse<T> & { channels?: string[] }>(
        `/api/v2/legacy/${resource}?${queryString}`,
      ),
  });

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setAppliedFilters({ ...pendingFilters });
  }

  function resetFilters() {
    const empty: Filters = { channel: '', startDate: '', endDate: '' };
    setPendingFilters(empty);
    setAppliedFilters(empty);
    setPage(1);
  }

  async function downloadCsv() {
    const params = new URLSearchParams();
    if (appliedFilters.channel) params.set('channel', appliedFilters.channel);
    if (appliedFilters.startDate) {
      params.set('startDate', new Date(appliedFilters.startDate).toISOString());
    }
    if (appliedFilters.endDate) {
      params.set('endDate', new Date(appliedFilters.endDate).toISOString());
    }
    const token = getToken();
    const res = await fetch(`/api/v2/legacy/${resource}/export/csv?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      // eslint-disable-next-line no-alert
      alert(`Falha ao exportar CSV: HTTP ${res.status}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resource}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Opções do dropdown de canal:
  //  - predictions/polls: o endpoint devolve `channels` (canais com registros);
  //  - demais features: usa os canais CONECTADOS (fetchChannels) pra escopar
  //    o filtro aos canais reais, evitando typo de nome em input livre.
  const channelOptions = showChannelsFromResponse
    ? data?.channels ?? []
    : knownChannels ?? channelsList?.map((c) => c.name) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card padding="sm">
        <form
          onSubmit={applyFilters}
          className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_auto]"
        >
          <div className="flex flex-col gap-1">
            <label className="eyebrow text-[10px]" htmlFor="legacy-channel">canal</label>
            {channelOptions.length > 0 ? (
              <select
                id="legacy-channel"
                value={pendingFilters.channel}
                onChange={(e) => setPendingFilters((p) => ({ ...p, channel: e.target.value }))}
                className={cn(
                  'h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-ink-800',
                  'focus:border-accent-400/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-accent-400/20',
                )}
              >
                <option value="">todos</option>
                {channelOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            ) : (
              <Input
                id="legacy-channel"
                placeholder="ex: leozeraplay"
                value={pendingFilters.channel}
                onChange={(e) => setPendingFilters((p) => ({ ...p, channel: e.target.value }))}
              />
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="eyebrow text-[10px]" htmlFor="legacy-start">de</label>
            <Input
              id="legacy-start"
              type="datetime-local"
              value={pendingFilters.startDate}
              onChange={(e) => setPendingFilters((p) => ({ ...p, startDate: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="eyebrow text-[10px]" htmlFor="legacy-end">até</label>
            <Input
              id="legacy-end"
              type="datetime-local"
              value={pendingFilters.endDate}
              onChange={(e) => setPendingFilters((p) => ({ ...p, endDate: e.target.value }))}
            />
          </div>

          <div className="flex items-end gap-2">
            <Button type="submit" size="sm">Aplicar</Button>
            <Button type="button" size="sm" variant="ghost" onClick={resetFilters}>
              Limpar
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={downloadCsv}>
              CSV
            </Button>
          </div>
        </form>
      </Card>

      {isLoading ? (
        <Card>Carregando…</Card>
      ) : error ? (
        <Card className="border border-err/30 bg-err/[0.08] text-err">
          {(error as Error).message}
        </Card>
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <Card padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400"
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
                      className="border-b border-white/[0.04] last:border-0 transition-colors hover:bg-white/[0.02]"
                    >
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={cn(
                            'px-4 py-2.5 align-top text-ink-800',
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

          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}

function Pagination({
  page, totalPages, total, onChange,
}: { page: number; totalPages: number; total: number; onChange: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-ink-400">
      <Badge tone="neutral">{total.toLocaleString('pt-BR')} registros</Badge>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          ← Anterior
        </Button>
        <span className="px-2 text-xs text-ink-600">
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
    </div>
  );
}

/** Helper compartilhado de formatação. */
export function fmtDate(iso: string | null | undefined): string {
  return formatDate(iso);
}
