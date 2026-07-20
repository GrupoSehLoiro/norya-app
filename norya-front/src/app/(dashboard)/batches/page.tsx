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
import { searchMessages, fetchWindowInsight } from '@/lib/analytics';

export default function BatchesPage() {
  const { channelId } = useSelectedChannel();
  const [term, setTerm] = useState('');
  const [range, setRange] = useState<DateRangeValue>({ from: '', to: '' });
  const [applied, setApplied] = useState(0); // bump p/ disparar a busca
  const [aiRequested, setAiRequested] = useState(0); // bump p/ pedir o resumo IA

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

  // Resumo IA sobre o mesmo recorte da busca (termo + período).
  const aiSummary = useQuery({
    enabled: !!channelId && aiRequested > 0,
    queryKey: ['msg-search-ai', channelId, term, range.from, range.to, aiRequested],
    queryFn: () =>
      fetchWindowInsight(channelId!, {
        q: term || undefined,
        from: range.from || undefined,
        to: range.to || undefined,
      }),
    staleTime: 60_000,
  });

  function runSearch() {
    setApplied((n) => n + 1);
    setAiRequested(0); // novo recorte → o resumo anterior não vale mais
  }

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Chat"
        title="Mensagens do chat"
        description="Busque por termo (ex.: redbull) e período. Recorte a live por data."
        info="Todas as mensagens registradas do chat ficam aqui. Busque por palavra-chave e período, e peça um resumo da IA sobre o resultado. (Texto provisório.)"
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
                  onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                  placeholder='ex: "redbull"'
                />
                <Button onClick={runSearch}>Buscar</Button>
              </div>
              <DateRangeFilter value={range} onChange={setRange} onApply={runSearch} />
            </div>
          </Card>

          {applied > 0 && (
            <Card>
              <CardHeader
                title="Resultados"
                actions={
                  search.data ? (
                    <div className="flex items-center gap-2">
                      <Badge tone="accent">{search.data.total} total</Badge>
                      <Badge tone="positive">{search.data.organic} orgânicas</Badge>
                      <Badge tone="twitch">{search.data.fromMods} mod/bot</Badge>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={aiSummary.isLoading && aiRequested > 0}
                        disabled={(search.data.total ?? 0) === 0}
                        onClick={() => setAiRequested((n) => n + 1)}
                        title="A IA resume o contexto das mensagens encontradas"
                      >
                        ✦ Resumo IA
                      </Button>
                    </div>
                  ) : null
                }
              />

              {aiRequested > 0 && (
                <div className="mb-4 rounded-xl border border-accent-400/20 bg-accent-400/[0.04] p-4">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-400">
                    Resumo da IA {term ? `— “${term}”` : '— período selecionado'}
                  </p>
                  {aiSummary.isLoading ? (
                    <p className="text-sm text-ink-400">analisando as mensagens…</p>
                  ) : aiSummary.isError ? (
                    <p className="text-sm text-err">Não foi possível gerar o resumo agora.</p>
                  ) : aiSummary.data ? (
                    <>
                      <p className="text-sm leading-relaxed text-ink-700">{aiSummary.data.insight}</p>
                      <div className="mt-2">
                        <Badge tone={aiSummary.data.aiEnabled ? 'positive' : 'neutral'}>
                          {aiSummary.data.aiEnabled ? 'resumo via IA' : 'resumo básico'}
                        </Badge>
                      </div>
                    </>
                  ) : null}
                </div>
              )}

              {search.isLoading ? (
                <p className="text-sm text-ink-400">buscando…</p>
              ) : search.isError ? (
                <p className="text-sm text-err">Não foi possível buscar agora. Tente novamente em instantes.</p>
              ) : (search.data?.items.length ?? 0) === 0 ? (
                <p className="text-sm text-ink-400">Nenhuma mensagem para esse filtro.</p>
              ) : (
                <ul className="divide-y divide-white/[0.05]">
                  {search.data!.items.map((m) => (
                    <li key={m.messageId} className="py-2.5">
                      <p className="text-sm text-ink-800">
                        <span className="font-medium">{m.username}</span>
                        {m.isMod && <span className="ml-2 text-[10px] uppercase text-platform-twitch">mod</span>}
                        <span className="ml-2 text-ink-700">{m.text}</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-400">{m.receivedAt}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card>
            <CardHeader title="Janelas" description="Blocos de análise acumulados ao longo das lives." />
            <BatchList channelId={channelId} />
          </Card>
        </>
      )}
    </div>
  );
}
