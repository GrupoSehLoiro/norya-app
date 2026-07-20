'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { DateRangeFilter, type DateRangeValue } from '@/components/ui/date-range';
import { PageHeader } from '@/components/layout/page-header';
import { useSelectedChannel } from '@/hooks/use-selected-channel';
import { useMe, canManage } from '@/hooks/use-me';
import { api, ApiError } from '@/lib/api-client';
import { fetchAdSummary } from '@/lib/analytics';
import type { AdStatus } from '@/lib/types';

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export default function AdControlPage() {
  const qc = useQueryClient();
  const { channelId } = useSelectedChannel();
  const me = useMe();
  const manage = canManage(me.data?.wsRole);
  const [range, setRange] = useState<DateRangeValue>({ from: '', to: '' });
  const [showManual, setShowManual] = useState(false);
  const [duration, setDuration] = useState(60);
  const [serverError, setServerError] = useState<string | null>(null);

  const summary = useQuery({
    enabled: !!channelId,
    queryKey: ['ad-summary', channelId, range.from, range.to],
    queryFn: () => fetchAdSummary(channelId!, range.from || undefined, range.to || undefined),
  });
  const status = useQuery({
    enabled: !!channelId && showManual,
    queryKey: ['ad-active', channelId],
    queryFn: () => api.get<AdStatus>(`/api/v2/social-listening/ad/active?channelId=${encodeURIComponent(channelId!)}`),
    refetchInterval: 5_000,
  });

  const start = useMutation({
    mutationFn: () => api.post('/api/v2/social-listening/ad/start', { channelId, durationSec: duration }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ad-active', channelId] }),
    onError: (e) => setServerError(e instanceof ApiError ? e.message : 'falha'),
  });
  const stop = useMutation({
    mutationFn: () => api.post('/api/v2/social-listening/ad/stop', { channelId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ad-active', channelId] }),
    onError: (e) => setServerError(e instanceof ApiError ? e.message : 'falha'),
  });

  const maxPerHour = Math.max(1, ...(summary.data?.perHour ?? []).map((h) => h.ads));

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Anúncios"
        title="Anúncios (AD)"
        description="Frequência e janelas de anúncios durante as lives — quantos, quando e por quanto tempo."
        info="Registre e acompanhe as janelas de anúncio das lives: quantidade, duração e como o chat reagiu durante cada uma. (Texto provisório.)"
      />

      {!channelId ? (
        <EmptyState title="Selecione um canal" />
      ) : (
        <>
          <Card>
            <CardHeader title="Período" />
            <DateRangeFilter value={range} onChange={setRange} onApply={() => summary.refetch()} />
          </Card>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Anúncios" value={summary.isLoading ? '—' : String(summary.data?.totalAds ?? 0)} />
            <Stat label="Tempo total em AD" value={summary.isLoading ? '—' : fmtDuration(summary.data?.totalSeconds ?? 0)} />
            <Stat label="Duração média" value={summary.isLoading ? '—' : fmtDuration(Math.round(summary.data?.avgSeconds ?? 0))} />
          </section>

          <Card>
            <CardHeader title="Distribuição por hora" description="Quantidade de anúncios por hora no período." />
            {summary.isError ? (
              <p className="text-sm text-err">Falha ao carregar (precisa do ClickHouse no ar).</p>
            ) : (summary.data?.perHour.length ?? 0) === 0 ? (
              <p className="text-sm text-ink-400">Sem anúncios no período.</p>
            ) : (
              <ul className="space-y-1.5">
                {summary.data!.perHour.map((h) => (
                  <li key={h.bucket} className="flex items-center gap-3 text-xs">
                    <span className="w-32 shrink-0 text-ink-400">{h.bucket}</span>
                    <span className="h-3 rounded bg-accent-400/70" style={{ width: `${(h.ads / maxPerHour) * 100}%` }} />
                    <span className="text-ink-600">{h.ads} ads · {fmtDuration(h.seconds)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {manage && (
            <Card>
              <CardHeader
                eyebrow="Manual"
                title="Modo manual (Kick / forçar AD)"
                actions={
                  <Button size="sm" variant="ghost" onClick={() => setShowManual((v) => !v)}>
                    {showManual ? 'ocultar' : 'mostrar'}
                  </Button>
                }
              />
              {showManual && (
                <div className="flex flex-wrap items-end gap-3">
                  <Badge tone={status.data?.active ? 'warn' : 'neutral'}>
                    {status.data?.active ? 'AD ATIVO' : 'sem AD'}
                  </Badge>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">Duração (s)</label>
                    <Input type="number" min={1} max={3600} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-28" />
                  </div>
                  <Button onClick={() => { setServerError(null); start.mutate(); }} loading={start.isPending}>Iniciar</Button>
                  <Button variant="destructive" onClick={() => { setServerError(null); stop.mutate(); }} loading={stop.isPending} disabled={!status.data?.active}>Parar</Button>
                  {serverError && <p className="w-full rounded-lg border border-err/30 bg-err/[0.08] px-3 py-2 text-sm text-err">{serverError}</p>}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <article className="glass-card">
      <p className="eyebrow">{label}</p>
      <p className="mt-3 text-3xl font-bold tracking-tight text-ink-800">{value}</p>
    </article>
  );
}
