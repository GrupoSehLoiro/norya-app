'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

  const addedNames = new Set((brands.data ?? []).map((b) => b.name.toLowerCase()));

  function addBrand(name: string, aliases: string[]) {
    if (!name.trim() || addedNames.has(name.toLowerCase())) return;
    create.mutate({ name: name.trim(), aliases });
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
            <CardHeader
              title="Adicionar marca"
              description="Busque no catálogo e navegue com ↑ ↓ · Enter adiciona · sem match, adicione como marca custom."
            />
            <BrandCombobox
              addedNames={addedNames}
              onAdd={addBrand}
              pending={create.isPending}
            />
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

/**
 * Combobox de catálogo de marcas — dropdown sólido (glass-surface, mesmo
 * padrão do picker da sidebar), navegação por teclado (↑ ↓ Enter Esc),
 * highlight sincronizado com o mouse e opção explícita de marca custom
 * quando a busca não tem match exato. Clique fora fecha.
 */
function BrandCombobox({
  addedNames,
  onAdd,
  pending,
}: {
  addedNames: Set<string>;
  onAdd: (name: string, aliases: string[]) => void;
  pending: boolean;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const results = useQuery({
    queryKey: ['brand-catalog', debounced],
    queryFn: () => searchBrandCatalog(debounced, 8),
    enabled: debounced.length > 0,
  });

  const suggestions = useMemo(
    () => (results.data ?? []).filter((b) => !addedNames.has(b.name.toLowerCase())),
    [results.data, addedNames],
  );

  // Opções = catálogo + "custom" (quando o texto digitado não é match exato).
  type Option =
    | { kind: 'catalog'; name: string; aliases: string[]; sector: string; country: string }
    | { kind: 'custom'; name: string };
  const options = useMemo<Option[]>(() => {
    const list: Option[] = suggestions.map((b) => ({
      kind: 'catalog',
      name: b.name,
      aliases: b.aliases,
      sector: b.sector,
      country: b.country,
    }));
    const typed = query.trim();
    const exact = suggestions.some((b) => b.name.toLowerCase() === typed.toLowerCase());
    if (typed.length > 0 && !exact && !addedNames.has(typed.toLowerCase())) {
      list.push({ kind: 'custom', name: typed });
    }
    return list;
  }, [suggestions, query, addedNames]);

  // Highlight nunca aponta pra fora da lista quando as opções mudam.
  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, options.length - 1)));
  }, [options.length]);

  // Clique fora fecha o painel.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function pick(opt: Option) {
    onAdd(opt.name, opt.kind === 'catalog' ? opt.aliases : []);
    setQuery('');
    setOpen(false);
    setHighlight(0);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      if (options.length === 0) return;
      setHighlight((h) =>
        e.key === 'ArrowDown' ? (h + 1) % options.length : (h - 1 + options.length) % options.length,
      );
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const opt = options[highlight] ?? options[0];
      if (opt) pick(opt);
    }
  }

  const showPanel = open && query.trim().length > 0;

  return (
    <div ref={rootRef} className="relative">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        disabled={pending}
        placeholder="Buscar marca… (ex: Red Bull, Nubank, Nike)"
        role="combobox"
        aria-expanded={showPanel}
        aria-autocomplete="list"
      />
      {showPanel && (
        <div className="glass-surface absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-y-auto p-1.5">
          {results.isLoading ? (
            <p className="px-3 py-2 text-xs text-ink-400">buscando no catálogo…</p>
          ) : options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-400">
              nada para adicionar — marca já cadastrada ou busca vazia
            </p>
          ) : (
            <ul role="listbox" className="flex flex-col gap-0.5">
              {options.map((opt, i) => {
                const active = i === highlight;
                return (
                  <li key={opt.kind === 'catalog' ? `c-${opt.name}` : `x-${opt.name}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setHighlight(i)}
                      // onMouseDown pra ganhar do blur/click-outside do input.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(opt);
                      }}
                      className={
                        'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ease-glass ' +
                        (active
                          ? 'bg-gradient-to-br from-accent-300 to-accent-400 text-bg-0'
                          : 'text-ink-700 hover:text-ink-800')
                      }
                    >
                      {opt.kind === 'catalog' ? (
                        <>
                          <span className="truncate font-medium">{opt.name}</span>
                          <span
                            className={
                              'shrink-0 text-[10px] uppercase tracking-[0.1em] ' +
                              (active ? 'text-bg-0/80' : 'text-ink-400')
                            }
                          >
                            {opt.sector}
                            {opt.country === 'br' ? ' · BR' : ''}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="truncate">
                            adicionar <span className="font-semibold">“{opt.name}”</span>
                          </span>
                          <span
                            className={
                              'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ' +
                              (active ? 'bg-bg-0/15 text-bg-0' : 'bg-white/[0.07] text-ink-400')
                            }
                          >
                            custom
                          </span>
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
