'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { useSelectedChannel } from '@/hooks/use-selected-channel';
import { useMe, canManage } from '@/hooks/use-me';
import { api, ApiError } from '@/lib/api-client';
import { fetchBrandAnalytics } from '@/lib/analytics';
import { searchBrandCatalog } from '@/lib/onboarding';
import type { ChannelBrand } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function BrandsPage() {
  const qc = useQueryClient();
  const { channelId } = useSelectedChannel();
  const me = useMe();
  const manage = canManage(me.data?.wsRole);
  const [serverError, setServerError] = useState<string | null>(null);

  const brands = useQuery({
    enabled: !!channelId,
    queryKey: ['brands', channelId],
    queryFn: () => api.get<ChannelBrand[]>(
      `/api/v2/social-listening/brands?channelId=${encodeURIComponent(channelId!)}`,
    ),
  });

  const analytics = useQuery({
    enabled: !!channelId,
    queryKey: ['brand-analytics', channelId],
    queryFn: () => fetchBrandAnalytics(channelId!),
  });
  const maxMentions = Math.max(1, ...(analytics.data?.totals ?? []).map((t) => t.count));

  const create = useMutation({
    mutationFn: (input: { name: string; aliases?: string[]; regex?: string | null }) =>
      api.post('/api/v2/social-listening/brands', { channelId, ...input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['brands', channelId] });
      setServerError(null);
    },
    onError: (e) => setServerError(e instanceof ApiError ? e.message : 'falha ao criar'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v2/social-listening/brands/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brands', channelId] }),
  });

  // Typeahead de catálogo (mesmo flow do onboarding: digitar → aparece → Enter).
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);
  const results = useQuery({
    queryKey: ['brand-catalog', debounced],
    queryFn: () => searchBrandCatalog(debounced, 8),
    enabled: debounced.length > 0,
  });
  const addedNames = new Set((brands.data ?? []).map((b) => b.name.toLowerCase()));
  const suggestions = (results.data ?? []).filter((b) => !addedNames.has(b.name.toLowerCase()));

  function addBrand(name: string, aliases: string[]) {
    if (!name.trim() || addedNames.has(name.toLowerCase())) {
      setQuery('');
      return;
    }
    create.mutate({ name: name.trim(), aliases });
    setQuery('');
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (suggestions[0]) addBrand(suggestions[0].name, suggestions[0].aliases);
    else if (query.trim()) addBrand(query.trim(), []);
  }

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="IA Core"
        title="Marcas (allowlist)"
        description="Por canal. Detecção via regex barato; LLM enriquece quando ligado."
      />

      {!channelId ? (
        <EmptyState title="Selecione um canal" />
      ) : (
        <>
          <Card>
            <CardHeader
              title="Menções por marca"
              description="Quantas vezes cada marca do allowlist foi citada no chat (histórico recente)."
            />
            {analytics.isError ? (
              <p className="text-sm text-err">Falha ao carregar (precisa do ClickHouse no ar).</p>
            ) : (analytics.data?.totals.length ?? 0) === 0 ? (
              <p className="text-sm text-ink-400">Nenhuma menção registrada ainda.</p>
            ) : (
              <ul className="space-y-2">
                {analytics.data!.totals.map((t) => (
                  <li key={t.brand} className="flex items-center gap-3 text-sm">
                    <span className="w-32 shrink-0 truncate font-medium text-ink-800">{t.brand}</span>
                    <span className="h-3 rounded bg-accent-400/70" style={{ width: `${(t.count / maxMentions) * 100}%` }} />
                    <span className="text-ink-600">{t.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {manage && (
          <Card>
            <CardHeader title="Adicionar marca" description="Busque no catálogo e aperte Enter para adicionar. Sem match, Enter adiciona como marca custom." />
            <div className="relative">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Buscar marca… (ex: Red Bull, Nubank, Nike)"
              />
              {debounced.length > 0 && suggestions.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-white/[0.1] bg-bg-1 p-1 shadow-elevated">
                  {suggestions.map((b) => (
                    <li key={b.slug}>
                      <button
                        type="button"
                        onClick={() => addBrand(b.name, b.aliases)}
                        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-ink-800 hover:bg-white/[0.06]"
                      >
                        <span>{b.name}</span>
                        <span className="text-[10px] uppercase tracking-wide text-ink-400">
                          {b.sector}{b.country === 'br' ? ' · BR' : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {serverError && (
              <p className="mt-2 rounded-lg border border-err/30 bg-err/[0.08] px-3 py-2 text-sm text-err">{serverError}</p>
            )}
          </Card>
          )}

          <Card>
            <CardHeader title={`Marcas (${brands.data?.length ?? 0})`} />
            {brands.isLoading ? (
              <p className="text-sm text-ink-400">carregando…</p>
            ) : brands.data && brands.data.length > 0 ? (
              <ul className="divide-y divide-white/[0.05]">
                {brands.data.map((b) => (
                  <li key={b.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium text-ink-800">{b.name}</p>
                      <p className="text-xs text-ink-400">
                        {b.aliases.length > 0 ? <>aliases: {b.aliases.join(', ')} · </> : null}
                        {b.regex ? <>regex: <code>{b.regex}</code> · </> : null}
                        criada {formatDate(b.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone="accent">{b.aliases.length} alias</Badge>
                      {manage && (
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => remove.mutate(b.id)}
                          disabled={remove.isPending}
                        >
                          remover
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-400">Nenhuma marca cadastrada para este canal.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
