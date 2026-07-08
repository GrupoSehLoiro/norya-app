'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/layout/page-header';
import { fetchChannels, fetchSessions } from '@/lib/queries';
import { useAuth } from '@/hooks/use-auth';

export default function DashboardHomePage() {
  const { user } = useAuth();

  const channels = useQuery({
    queryKey: ['channels-v2'],
    queryFn: fetchChannels,
  });
  const sessions = useQuery({
    queryKey: ['monitoring-sessions'],
    queryFn: fetchSessions,
  });

  const activeSessions = (sessions.data ?? []).filter((s) => s.state === 'ACTIVE');

  return (
    <div className="flex flex-col gap-14 pb-20">
      <PageHeader
        eyebrow={`Olá, ${user?.username ?? ''}`}
        title={<>Painel <span className="text-accent-400">ao vivo</span><span className="text-accent-700">.</span></>}
        description="Visão geral."
      />

      {/* Stat cards */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <StatCard
          label="Canais cadastrados"
          value={channels.isLoading ? '—' : String(channels.data?.length ?? 0)}
          foot="ingestão multi-plataforma"
          href="/channels"
          cta="Gerenciar →"
        />
        <StatCard
          label="Sessões ao vivo"
          value={sessions.isLoading ? '—' : String(activeSessions.length)}
          foot={`${sessions.data?.length ?? 0} no total`}
          href="/sessions"
          cta="Ver sessões →"
          accent
          live
        />
      </section>

      {/* Bento: atalhos do pipeline */}
      <section>
        <div className="mb-6 flex items-end justify-between gap-6">
          <div>
            <p className="eyebrow">IA Core</p>
            <h2 className="text-2xl font-bold tracking-tight text-ink-800">Atalhos</h2>
          </div>
          <Badge tone="accent" eyebrow>Funcionalidades</Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ShortcutCard href="/insights" title="Análise de sentimentos" desc="Clima do chat e assuntos ao vivo" tag="SSE" />
          <ShortcutCard href="/batches" title="Mensagens do chat" desc="Busca e recortes por período" tag="chat" />
          <ShortcutCard href="/brands" title="Marcas" desc="Menções, sentimento e timeline" />
          <ShortcutCard href="/ad-control" title="Anúncios" desc="Frequência e janelas de AD" />
          <ShortcutCard href="/channels" title="Canais" desc="Integrações por plataforma" />
          <ShortcutCard href="/sessions" title="Sessões ao vivo" desc="Lives monitoradas" />
          <ShortcutCard href="/integrations/twitch" title="Integração Twitch" desc="OAuth + tokens cifrados" />
          <ShortcutCard href="/integrations/kick" title="Integração Kick" desc="Pusher protocol no chat" />
        </div>
      </section>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  foot?: string;
  href?: string;
  cta?: string;
  accent?: boolean;
  live?: boolean;
}

function StatCard({ label, value, foot, href, cta, accent, live }: StatCardProps) {
  return (
    <article className={`glass-card ${accent ? 'glass-card--accent' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {live ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-200 bg-accent-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-300">
            <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-accent-400 shadow-[0_0_8px_rgba(215,254,1,0.7)]">
              <span className="absolute inset-[-3px] rounded-full bg-accent-400 opacity-[0.22] animate-led-halo" />
            </span>
            live
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-4xl font-bold tracking-tight text-ink-800">{value}</p>
      {foot ? <p className="mt-3 text-xs text-ink-400">{foot}</p> : null}
      {href && cta ? (
        <Link href={href} className="mt-4 inline-block text-xs font-medium text-accent-300 hover:text-accent-400">
          {cta}
        </Link>
      ) : null}
    </article>
  );
}

function ShortcutCard({
  href, title, desc, tag,
}: { href: string; title: string; desc: string; tag?: string }) {
  return (
    <Link href={href} className="glass-card group block">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-ink-800 group-hover:text-accent-300">{title}</p>
        {tag ? <Badge tone="accent" eyebrow>{tag}</Badge> : null}
      </div>
      <p className="mt-2 text-xs text-ink-400">{desc}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-ink-600 group-hover:text-accent-300">
        Abrir
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h6M6 3l3 3-3 3" />
        </svg>
      </span>
    </Link>
  );
}
