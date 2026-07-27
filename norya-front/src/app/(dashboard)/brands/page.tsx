'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { BrandAvatar } from '@/components/brands/brand-avatar';
import { IconX } from '@/components/ui/icons';
import { useSelectedChannel } from '@/hooks/use-selected-channel';
import { useMe, canManage } from '@/hooks/use-me';
import { api, ApiError } from '@/lib/api-client';
import { fetchBrandAnalytics } from '@/lib/analytics';
import { searchBrandCatalog } from '@/lib/onboarding';
import { brandLogoUrl, brandAccent } from '@/lib/brand-visuals';
import type { ChannelBrand } from '@/lib/types';

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
        eyebrow="Social listening"
        title="Marcas"
        description="Acompanhe marcas, nomes, tags e veja o engajamento que eles geram no seu chat."
        info="Cadastre o que quiser acompanhar: a marca de um patrocinador, o seu próprio nick, a hashtag de uma campanha, o nome de um jogo. A plataforma conta cada menção no chat ao vivo e mostra a evolução dia a dia."
      />

      {!channelId ? (
        <EmptyState title="Selecione um canal para começar a acompanhar" />
      ) : (
        <>
          <Card>
            <CardHeader
              title="O que a audiência mais cita"
              description="Menções de cada termo acompanhado no chat (histórico recente). Quanto maior a barra, mais a galera fala sobre ele."
            />
            {analytics.isError ? (
              <p className="text-sm text-err">Falha ao carregar (precisa do ClickHouse no ar).</p>
            ) : (analytics.data?.totals.length ?? 0) === 0 ? (
              <p className="text-sm text-ink-400">
                Ainda sem menções. Assim que sua audiência citar um termo acompanhado no chat, ele aparece aqui.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {analytics.data!.totals.map((t) => (
                  <li key={t.brand} className="flex items-center gap-3 text-sm">
                    <BrandAvatar name={t.brand} size={26} />
                    <span className="w-28 shrink-0 truncate font-medium text-ink-800">{t.brand}</span>
                    <span className="h-2.5 flex-1">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${(t.count / maxMentions) * 100}%`,
                          background: brandAccent(t.brand).solid,
                        }}
                      />
                    </span>
                    <span className="w-10 shrink-0 text-right tabular-nums text-ink-600">{t.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Adicionar + lista, juntos numa só experiência. */}
          <Card>
            <CardHeader
              title={`Acompanhando (${brands.data?.length ?? 0})`}
              description={
                manage
                  ? 'Busque uma marca no catálogo ou digite qualquer termo: um nome, uma tag, um jogo. Sem match, entra como termo custom.'
                  : 'Tudo que este canal acompanha hoje.'
              }
            />

            {manage && (
              <div className="mb-5">
                <BrandCombobox
                  addedNames={addedNames}
                  onAdd={addBrand}
                  pending={create.isPending}
                />
                {serverError && (
                  <p className="mt-2 rounded-lg border border-err/30 bg-err/[0.08] px-3 py-2 text-sm text-err">
                    {serverError}
                  </p>
                )}
              </div>
            )}

            {brands.isLoading ? (
              <p className="text-sm text-ink-400">carregando…</p>
            ) : brands.data && brands.data.length > 0 ? (
              <div className="flex flex-wrap gap-2.5">
                {brands.data.map((b) => (
                  <BrandChip
                    key={b.id}
                    name={b.name}
                    aliasCount={b.aliases.length}
                    canRemove={manage}
                    removing={remove.isPending}
                    onRemove={() => remove.mutate(b.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-400">
                Você ainda não acompanha nada neste canal. Adicione uma marca ou um termo acima pra começar.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * Chip de uma marca cadastrada. Duas formas:
 * - com logo conhecido → card com o avatar da marca + nome;
 * - sem logo → pill "#palavra" numa cor vibrante determinística (estilo hashtag).
 */
function BrandChip({
  name,
  aliasCount,
  canRemove,
  removing,
  onRemove,
}: {
  name: string;
  aliasCount: number;
  canRemove: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const hasLogo = brandLogoUrl(name) !== null;
  const accent = brandAccent(name);

  if (hasLogo) {
    return (
      <div className="group relative flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] py-1.5 pl-1.5 pr-3 transition-colors hover:border-white/20">
        <BrandAvatar name={name} size={34} />
        <div className="min-w-0 pr-1">
          <p className="truncate text-sm font-semibold leading-tight text-ink-800">{name}</p>
          {aliasCount > 0 && (
            <p className="truncate text-[11px] leading-tight text-ink-400">
              {aliasCount} {aliasCount === 1 ? 'apelido' : 'apelidos'}
            </p>
          )}
        </div>
        {canRemove && <RemoveButton onClick={onRemove} disabled={removing} label={name} />}
      </div>
    );
  }

  return (
    <div
      className="group relative inline-flex items-center gap-1.5 rounded-2xl border px-3 py-2 transition-colors"
      style={{ borderColor: accent.border, background: accent.bg }}
    >
      <span className="text-sm font-bold tracking-tight" style={{ color: accent.text }}>
        #{name}
      </span>
      {canRemove && (
        <RemoveButton onClick={onRemove} disabled={removing} label={name} color={accent.text} />
      )}
    </div>
  );
}

function RemoveButton({
  onClick,
  disabled,
  label,
  color,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`remover ${label}`}
      className="grid h-5 w-5 place-items-center rounded-full text-ink-400 opacity-60 transition hover:bg-white/10 hover:text-err hover:opacity-100 disabled:opacity-30"
      style={color ? { color } : undefined}
    >
      <IconX size={11} />
    </button>
  );
}

/**
 * Combobox de catálogo de marcas — dropdown sólido (glass-surface, mesmo
 * padrão do picker da sidebar), navegação por teclado (↑ ↓ Enter Esc),
 * highlight sincronizado com o mouse, avatar da marca em cada opção e opção
 * explícita de marca custom quando a busca não tem match exato. Clique fora fecha.
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
        className="focus:border-pal-pink focus:ring-pal-pink-soft"
        placeholder="Buscar marca ou digitar um termo… (ex: Red Bull, seu nick, #campanha)"
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
              nada para adicionar: você já acompanha esse termo ou a busca está vazia
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
                        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors ease-glass ' +
                        (active
                          ? 'bg-gradient-to-br from-accent-300 to-accent-400 text-bg-0'
                          : 'text-ink-700 hover:text-ink-800')
                      }
                    >
                      <BrandAvatar name={opt.name} size={26} />
                      {opt.kind === 'catalog' ? (
                        <>
                          <span className="min-w-0 flex-1 truncate font-medium">{opt.name}</span>
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
                          <span className="min-w-0 flex-1 truncate">
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
