'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { DateRangeFilter, type DateRangeValue } from '@/components/ui/date-range';
import { BatchList } from '@/components/batches/batch-list';
import { PageHeader } from '@/components/layout/page-header';
import { useSelectedChannel } from '@/hooks/use-selected-channel';
import { searchMessages } from '@/lib/analytics';

export default function BatchesPage() {
  const { channelId } = useSelectedChannel();
  const [term, setTerm] = useState('');
  const [range, setRange] = useState<DateRangeValue>({ from: '', to: '' });
  const [applied, setApplied] = useState(0); // bump p/ disparar a busca

  const search = useQuery({
    enabled: !!channelId && applied > 0,
    queryKey: ['msg-search', channelId, term, range.from, range.to, applied],
    queryFn: () =>
      searchMessages(
        channelId!,
        term,
        range.from || undefined,
        range.to || undefined,
      ),
  });

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Chat"
        title="Mensagens do chat"
        description="Busque por termo (ex.: redbull) e período. Recorte a live por data."
      />

      {!channelId ? (
        <EmptyState title="Selecione um canal" description="As mensagens são acumuladas conforme as lives são monitoradas." />
      ) : (
        <>
          <Card>
            <CardHeader title="Buscar mensagens" description="Termo + período. Deixe o termo vazio para listar tudo do período." />
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setApplied((n) => n + 1)}
                  placeholder='ex: "redbull"'
                />
                <Button onClick={() => setApplied((n) => n + 1)}>Buscar</Button>
              </div>
              <DateRangeFilter value={range} onChange={setRange} onApply={() => setApplied((n) => n + 1)} />
            </div>
          </Card>

          {applied > 0 && (
            <Card>
              <CardHeader
                title="Resultados"
                actions={
                  search.data ? (
                    <div className="flex gap-2">
                      <Badge tone="accent">{search.data.total} total</Badge>
                      <Badge tone="positive">{search.data.organic} orgânicas</Badge>
                      <Badge tone="twitch">{search.data.fromMods} mod/bot</Badge>
                    </div>
                  ) : null
                }
              />
              {search.isLoading ? (
                <p className="text-sm text-ink-400">buscando…</p>
              ) : search.isError ? (
                <p className="text-sm text-err">Falha na busca (precisa do ClickHouse no ar).</p>
              ) : (search.data?.items.length ?? 0) === 0 ? (
                <p className="text-sm text-ink-400">Nenhuma mensagem para esse filtro.</p>
              ) : (
                <ul className="divide-y divide-white/[0.05]">
                  {search.data!.items.map((m) => (
                    <li key={m.messageId} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-ink-800">
                          <span className="font-medium">{m.username}</span>
                          {m.isMod && <span className="ml-2 text-[10px] uppercase text-platform-twitch">mod</span>}
                          <span className="ml-2 text-ink-700">{m.text}</span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-ink-400">{m.receivedAt}</p>
                      </div>
                      <Badge tone={m.sentiment === 'positive' ? 'positive' : m.sentiment === 'negative' ? 'negative' : 'accent'}>
                        {m.sentiment}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card>
            <CardHeader title="Janelas (batches)" description="Janelas de ~15s acumuladas pelo orchestrator." />
            <BatchList channelId={channelId} />
          </Card>
        </>
      )}
    </div>
  );
}
