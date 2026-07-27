'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { DateRangeFilter, type DateRangeValue } from '@/components/ui/date-range';
import { InsightText } from '@/components/ui/insight-text';
import { EmoteText } from '@/components/ui/emote-text';
import { useChannelEmotes } from '@/hooks/use-channel-emotes';
import { BatchList } from '@/components/batches/batch-list';
import { PageHeader } from '@/components/layout/page-header';
import { useSelectedChannel } from '@/hooks/use-selected-channel';
import { searchMessages, fetchWindowInsight } from '@/lib/analytics';

export default function BatchesPage() {
  const { channelId } = useSelectedChannel();
  const emotes = useChannelEmotes(channelId);
  const [term, setTerm] = useState('');
  const [range, setRange] = useState<DateRangeValue>({ from: '', to: '' });
  // Recorte APLICADO (snapshot no clique/Enter) — digitar no input não
  // re-dispara a busca; apagar o termo fecha os resultados.
  const [appliedFilter, setAppliedFilter] = useState<{ term: string; from: string; to: string } | null>(null);
  const [aiRequested, setAiRequested] = useState(0); // bump p/ pedir o resumo IA

  const search = useQuery({
    enabled: !!channelId && appliedFilter !== null,
    queryKey: ['msg-search', channelId, appliedFilter],
    queryFn: () =>
      searchMessages(
        channelId!,
        appliedFilter!.term,
        appliedFilter!.from || undefined,
        appliedFilter!.to || undefined,
      ),
  });

  // Resumo IA sobre o mesmo recorte da busca (termo + período).
  const aiSummary = useQuery({
    enabled: !!channelId && appliedFilter !== null && aiRequested > 0,
    queryKey: ['msg-search-ai', channelId, appliedFilter, aiRequested],
    queryFn: () =>
      fetchWindowInsight(channelId!, {
        q: appliedFilter!.term || undefined,
        from: appliedFilter!.from || undefined,
        to: appliedFilter!.to || undefined,
      }),
    staleTime: 60_000,
  });

  function runSearch() {
    setAppliedFilter({ term, from: range.from, to: range.to });
    setAiRequested(0); // novo recorte → o resumo anterior não vale mais
  }

  function onTermChange(value: string) {
    setTerm(value);
    // Campo esvaziado → volta ao estado inicial, sem painel de resultados.
    if (value === '') {
      setAppliedFilter(null);
      setAiRequested(0);
    }
  }

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Social listening"
        title="Mensagens do chat"
        description="Todo o chat das suas lives, buscável por termo e período, com um resumo da IA sobre o que você encontrar."
        info="Cada mensagem das suas lives fica guardada aqui, buscável. Procure por uma palavra (o nome de um patrocinador, um meme, uma reclamação) num período qualquer, veja as mensagens originais e peça pra IA resumir o que a galera estava falando."
      />

      {!channelId ? (
        <EmptyState title="Selecione um canal" description="As mensagens vão se acumulando aqui a cada live que você faz." />
      ) : (
        <>
          <Card>
            <CardHeader title="Buscar mensagens" description="Um termo e um período. Deixe o termo vazio pra ver tudo do período." />
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Input
                  value={term}
                  onChange={(e) => onTermChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                  placeholder='ex: "redbull"'
                  className="focus:border-pal-peri focus:ring-pal-peri-soft"
                />
                <Button onClick={runSearch}>Buscar</Button>
              </div>
              <DateRangeFilter value={range} onChange={setRange} onApply={runSearch} />
            </div>
          </Card>

          {appliedFilter !== null && (
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
                        title="A IA resume o que a galera estava falando nessas mensagens"
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
                    Resumo da IA {appliedFilter?.term ? `(“${appliedFilter.term}”)` : '(período selecionado)'}
                  </p>
                  {aiSummary.isLoading ? (
                    <p className="text-sm text-ink-400">analisando as mensagens…</p>
                  ) : aiSummary.isError ? (
                    <p className="text-sm text-err">Não foi possível gerar o resumo agora.</p>
                  ) : aiSummary.data ? (
                    <>
                      <InsightText text={aiSummary.data.insight} />
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
                        <EmoteText text={m.text} emotes={emotes} className="ml-2 text-ink-700" />
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-400">{m.receivedAt}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card>
            <CardHeader title="Janelas de análise" description="Cada trecho da live que a IA leu e resumiu, do mais recente ao mais antigo. Abra uma pra ver o resumo daquele momento." />
            <BatchList channelId={channelId} />
          </Card>
        </>
      )}
    </div>
  );
}
