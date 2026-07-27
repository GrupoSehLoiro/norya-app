'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { fetchSessions } from '@/lib/queries';
import { formatDate, formatRelative } from '@/lib/utils';

export default function SessionsPage() {
  const sessions = useQuery({
    queryKey: ['monitoring-sessions'],
    queryFn: fetchSessions,
    refetchInterval: 10_000,
  });

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Ao vivo"
        title="Sessões ao vivo"
        description="As lives que a Norya acompanhou: as que estão no ar agora e as já encerradas."
        info="Cada live que você faz num canal conectado vira uma sessão: aqui você vê quais estão no ar neste momento e o histórico das que já terminaram, com início, fim e duração."
      />

      {sessions.isLoading ? (
        <Card>carregando…</Card>
      ) : sessions.data && sessions.data.length > 0 ? (
        <Card className="border-l-2 border-l-pal-green">
          <CardHeader eyebrow="Sessões" title={`${sessions.data.length} sessões registradas`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-left text-[10px] uppercase tracking-[0.14em] text-ink-400">
                  <th className="pb-2 pr-4 font-medium">Canal</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Iniciada</th>
                  <th className="pb-2 pr-4 font-medium">Encerrada</th>
                  <th className="pb-2 pr-4 font-medium">Duração</th>
                </tr>
              </thead>
              <tbody className="text-ink-800">
                {sessions.data.map((s) => (
                  <tr key={s.id} className="border-b border-white/[0.05] last:border-0 transition-colors hover:bg-white/[0.025]">
                    <td className="py-2 pr-4 font-mono text-xs">{s.channelId}</td>
                    <td className="py-2 pr-4">
                      <Badge tone={s.state === 'ACTIVE' ? 'positive' : 'neutral'}>
                        {s.state.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4">{formatDate(s.startedAt)}</td>
                    <td className="py-2 pr-4">{s.endedAt ? formatDate(s.endedAt) : '—'}</td>
                    <td className="py-2 pr-4 text-ink-400">{formatRelative(s.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <EmptyState
          title="Nenhuma sessão ainda"
          description="Assim que você abrir uma live num canal conectado, ela aparece aqui e fica no histórico quando encerrar."
        />
      )}
    </div>
  );
}
