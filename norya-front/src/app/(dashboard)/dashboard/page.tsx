'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/page-header';
import { ChannelAvatar } from '@/components/ui/channel-avatar';
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
        title={<>Início<span className="text-accent-700">.</span></>}
        description="Seus canais, marcas e análises num só lugar."
        info="Seu ponto de partida: os canais conectados, as lives que estão no ar agora e atalhos pras principais áreas. Comece conectando um canal: na sua próxima live, a Norya já começa a ler o chat."
      />

      {/* Stat cards */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <StatCard
          label="Canais cadastrados"
          value={channels.isLoading ? '—' : String(channels.data?.length ?? 0)}
          href="/channels"
          cta="Gerenciar →"
          className="outline outline-1 -outline-offset-1 outline-pal-cyan-line"
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

      {/* Atalhos principais */}
      <section>
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight text-ink-800">Atalhos</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {/* Canais — com foto de perfil + nome */}
          <Link href="/channels" className="glass-card group block">
            <p className="font-semibold text-ink-800 group-hover:text-accent-300">Canais</p>
            {channels.data && channels.data.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {channels.data.slice(0, 3).map((c) => (
                  <li key={c.id} className="flex items-center gap-2.5">
                    <ChannelAvatar name={c.displayName ?? c.name} src={c.profileImageUrl} size="sm" />
                    <span className="truncate text-sm text-ink-700">{c.displayName ?? c.name}</span>
                  </li>
                ))}
                {channels.data.length > 3 && (
                  <li className="text-xs text-ink-400">+{channels.data.length - 3} canais</li>
                )}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-ink-400">Conecte seu primeiro canal</p>
            )}
            <OpenLink />
          </Link>

          <ShortcutCard href="/brands" title="Marcas" desc="Quanto a audiência cita cada marca que você acompanha" />
          <ShortcutCard href="/batches" title="Mensagens do chat" desc="Busque o que a galera falou, por termo e período" />
          <ShortcutCard href="/insights" title="Pulso da live" desc="O clima do chat, os assuntos e os picos, em tempo real" />
        </div>
      </section>
    </div>
  );
}

function OpenLink() {
  return (
    <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-ink-600 group-hover:text-accent-300">
      Abrir
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h6M6 3l3 3-3 3" />
      </svg>
    </span>
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
  className?: string;
}

function StatCard({ label, value, foot, href, cta, accent, live, className }: StatCardProps) {
  return (
    <article className={`glass-card ${accent ? 'glass-card--accent' : ''} ${className ?? ''}`}>
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

function ShortcutCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="glass-card group block">
      <p className="font-semibold text-ink-800 group-hover:text-accent-300">{title}</p>
      <p className="mt-2 text-xs text-ink-400">{desc}</p>
      <OpenLink />
    </Link>
  );
}
