'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ChannelAvatar } from '@/components/ui/channel-avatar';
import { ChannelLiveBadge } from '@/components/monitoring/channel-live-badge';
import { getToken } from '@/lib/api-client';
import { fetchChannels } from '@/lib/queries';
import { cn, formatDate } from '@/lib/utils';

const PAGE_SIZE = 10;

type SortKey = 'name' | 'recent' | 'platform';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Nome (A–Z)' },
  { key: 'recent', label: 'Mais recentes' },
  { key: 'platform', label: 'Plataforma' },
];

export default function ChannelsPage() {
  const [connectOpen, setConnectOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [page, setPage] = useState(1);

  const channels = useQuery({
    queryKey: ['channels-v2'],
    queryFn: fetchChannels,
  });

  const filtered = useMemo(() => {
    const all = channels.data ?? [];
    const term = search.trim().toLowerCase();
    const hit = term
      ? all.filter((c) =>
          (c.displayName ?? '').toLowerCase().includes(term) || c.name.toLowerCase().includes(term))
      : all;
    const sorted = [...hit];
    if (sort === 'name') {
      sorted.sort((a, b) => (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name, 'pt-BR'));
    } else if (sort === 'recent') {
      sorted.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    } else {
      sorted.sort((a, b) =>
        a.platform.localeCompare(b.platform) ||
        (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name, 'pt-BR'));
    }
    return sorted;
  }, [channels.data, search, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Canais"
        title="Canais"
        info="Aqui ficam todos os canais conectados à plataforma (Twitch e Kick): conecte novas contas, busque, ordene e acompanhe o status de cada canal. (Texto provisório.)"
        actions={
          <Button onClick={() => setConnectOpen(true)}>+ Novo canal</Button>
        }
      />

      {connectOpen && <ConnectModal onClose={() => setConnectOpen(false)} />}

      {channels.isLoading ? (
        <Card>Carregando canais…</Card>
      ) : (channels.data?.length ?? 0) > 0 ? (
        <Card>
          {/* Barra de ferramentas: busca + ordenação + visualização */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="w-full max-w-xs">
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Pesquisar canal…"
                aria-label="Pesquisar canal"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] uppercase tracking-[0.14em] text-ink-400" htmlFor="sort-channels">
                Ordenar por
              </label>
              <select
                id="sort-channels"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="h-9 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-ink-800 focus:border-accent-400/60 focus:outline-none"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key} className="bg-bg-1">{s.label}</option>
                ))}
              </select>
              <div className="ml-1 flex overflow-hidden rounded-full border border-white/[0.08]">
                <ViewBtn active={view === 'list'} onClick={() => setView('list')} label="Lista">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                    <path d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </ViewBtn>
                <ViewBtn active={view === 'grid'} onClick={() => setView('grid')} label="Grade">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" />
                    <rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" />
                  </svg>
                </ViewBtn>
              </div>
            </div>
          </div>

          {pageItems.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-400">Nenhum canal encontrado para “{search}”.</p>
          ) : view === 'list' ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08] text-left text-[10px] uppercase tracking-[0.14em] text-ink-400">
                    <th className="pb-2 pr-4 font-medium">Canal</th>
                    <th className="pb-2 pr-4 font-medium">Plataforma</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Criado</th>
                    <th className="pb-2 pr-4 font-medium">Insights</th>
                    <th className="pb-2 pr-4 text-right font-medium">Live</th>
                  </tr>
                </thead>
                <tbody className="text-ink-800">
                  {pageItems.map((c) => (
                    <tr key={c.id} className="border-b border-white/[0.05] last:border-0 transition-colors hover:bg-white/[0.025]">
                      <td className="py-2.5 pr-4">
                        <span className="flex items-center gap-2.5 font-medium">
                          <ChannelAvatar name={c.displayName ?? c.name} src={c.profileImageUrl} size="sm" />
                          {c.displayName ?? c.name}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge tone={c.platform === 'twitch' ? 'twitch' : 'kick'}>{c.platform}</Badge>
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge tone={c.active ? 'positive' : 'neutral'}>{c.active ? 'ativo' : 'inativo'}</Badge>
                      </td>
                      <td className="py-2.5 pr-4 text-ink-400">{formatDate(c.createdAt)}</td>
                      <td className="py-2.5 pr-4">
                        <Link
                          className="text-accent-300 hover:text-accent-400 hover:underline"
                          href={`/insights/${encodeURIComponent(c.id)}`}
                        >
                          ver
                        </Link>
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        <ChannelLiveBadge channelId={c.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {pageItems.map((c) => (
                <li key={c.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                  <div className="flex items-center gap-3">
                    <ChannelAvatar name={c.displayName ?? c.name} src={c.profileImageUrl} size="lg" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink-800">{c.displayName ?? c.name}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <Badge tone={c.platform === 'twitch' ? 'twitch' : 'kick'}>{c.platform}</Badge>
                        <Badge tone={c.active ? 'positive' : 'neutral'}>{c.active ? 'ativo' : 'inativo'}</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-ink-400">
                    <Link
                      className="text-accent-300 hover:text-accent-400 hover:underline"
                      href={`/insights/${encodeURIComponent(c.id)}`}
                    >
                      Ver insights
                    </Link>
                    <ChannelLiveBadge channelId={c.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Paginação */}
          {filtered.length > PAGE_SIZE && (
            <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4 text-sm">
              <span className="text-xs text-ink-400">
                {filtered.length} canais · página {currentPage} de {pageCount}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ← Anterior
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  Próxima →
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <EmptyState
          title="Nenhum canal conectado"
          description="Conecte sua conta Twitch ou Kick para começar a acompanhar o chat."
          action={<Button onClick={() => setConnectOpen(true)}>+ Novo canal</Button>}
        />
      )}
    </div>
  );
}

/**
 * Modal "Novo canal": escolha da plataforma pelo logo. Cada logo dispara o
 * MESMO fluxo OAuth das páginas /integrations/* — navegação top-level não
 * envia headers, então o JWT vai em `?token=` e o backend valida via state
 * HMAC-assinado.
 */
function ConnectModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function startOAuth(platform: 'twitch' | 'kick') {
    const tk = getToken();
    if (!tk) {
      window.location.href = '/login';
      return;
    }
    window.location.href = `/api/v2/auth/${platform}/start?token=${encodeURIComponent(tk)}`;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-bg-0/55 p-4"
      style={{ backdropFilter: 'blur(10px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Conectar novo canal"
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-md p-7 text-center shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between">
          <h2 className="text-lg font-bold tracking-tight text-ink-800">Novo canal</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full p-1 text-ink-400 transition-colors hover:text-ink-800"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-sm text-ink-400">
          Escolha a plataforma para conectar sua conta. Você será levado ao login
          oficial da plataforma e volta pra cá com o canal vinculado.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => startOAuth('twitch')}
            aria-label="Conectar conta Twitch"
            className={
              'group flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/[0.08] ' +
              'bg-[#9146FF]/[0.12] p-7 transition-all hover:-translate-y-0.5 hover:border-[#9146FF]/60 hover:bg-[#9146FF]/[0.22] ' +
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#9146FF]/70'
            }
          >
            <svg width="44" height="44" viewBox="0 0 24 24" fill="#9146FF" aria-hidden>
              <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
            </svg>
            <span className="text-sm font-semibold text-ink-800">Twitch</span>
          </button>

          <button
            type="button"
            onClick={() => startOAuth('kick')}
            aria-label="Conectar conta Kick"
            className={
              'group flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/[0.08] ' +
              'bg-[#53FC18]/[0.10] p-7 transition-all hover:-translate-y-0.5 hover:border-[#53FC18]/60 hover:bg-[#53FC18]/[0.18] ' +
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#53FC18]/70'
            }
          >
            <svg width="44" height="44" viewBox="0 0 24 24" fill="#53FC18" aria-hidden>
              <path d="M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z" />
            </svg>
            <span className="text-sm font-semibold text-ink-800">Kick</span>
          </button>
        </div>

        <p className="mt-5 text-[11px] text-ink-400">
          Passo a passo: escolha a plataforma → autorize na tela oficial → o canal
          aparece aqui automaticamente com foto e nome.
        </p>
      </div>
    </div>
  );
}

function ViewBtn({
  active, onClick, label, children,
}: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Ver em ${label.toLowerCase()}`}
      aria-pressed={active}
      title={label}
      className={cn(
        'flex h-9 w-9 items-center justify-center transition-colors',
        active ? 'bg-accent-400/15 text-accent-300' : 'bg-white/[0.03] text-ink-500 hover:text-ink-800',
      )}
    >
      {children}
    </button>
  );
}
