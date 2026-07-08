'use client';

import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { api, getToken } from '@/lib/api-client';
import { fetchChannels } from '@/lib/queries';
import { formatDate } from '@/lib/utils';

interface TwitchIntegration {
  channelId: string;
  name: string;
  displayName?: string;
  externalId: string;
  scope: string;
  expiresAt: string;
  invalidated: boolean;
  createdAt?: string;
}

export default function TwitchPage() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const justConnected = params.get('connected') === '1';
  const errorParam = params.get('error');

  const integrations = useQuery({
    queryKey: ['twitch-integrations'],
    queryFn: () => api.get<{ integrations: TwitchIntegration[] }>(
      '/api/v2/auth/twitch/integrations',
    ).then((r) => r.integrations ?? []),
    refetchInterval: 30_000,
  });

  const channels = useQuery({
    queryKey: ['channels-v2', 'twitch'],
    queryFn: fetchChannels,
    select: (xs) => xs.filter((c) => c.platform === 'twitch'),
  });

  const disconnect = useMutation({
    mutationFn: (channelId: string) =>
      api.delete(`/api/v2/auth/twitch/integrations/${channelId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['twitch-integrations'] });
      void qc.invalidateQueries({ queryKey: ['channels-v2'] });
    },
  });

  function startOAuth() {
    // Browsers não enviam headers em navegação top-level (clique → redirect),
    // então passamos o JWT em `?token=`. O backend valida com o mesmo
    // JwtService e codifica o userId dentro do `state` HMAC-assinado.
    const tk = getToken();
    if (!tk) {
      window.location.href = '/login';
      return;
    }
    window.location.href = `/api/v2/auth/twitch/start?token=${encodeURIComponent(tk)}`;
  }

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Integrações"
        title="Integração Twitch"
        description="Conecte sua conta via OAuth"
      />

      {justConnected && (
        <div className="rounded-2xl border border-ok/30 bg-ok/[0.08] px-4 py-3 text-sm text-ok">
          ✓ Conta Twitch conectada. Canal cadastrado e tokens persistidos.
        </div>
      )}
      {errorParam && (
        <div className="rounded-2xl border border-err/30 bg-err/[0.08] px-4 py-3 text-sm text-err">
          Falha na conexão: {errorParam}
        </div>
      )}

      <Card>
        <CardHeader
          title="Conectar conta Twitch"
          description="Você autoriza, o backend troca o code por access_token + refresh_token, cifra e persiste no banco de dados."
          actions={<Button onClick={startOAuth}>Conectar Twitch →</Button>}
        />
        <p className="text-xs text-ink-400">
          Escopos solicitados:{' '}
          <code>
            user:read:email chat:read channel:read:ads
            channel:read:subscriptions moderator:read:followers
          </code>
          . Streamer pode revogar a qualquer momento em
          twitch.tv/settings/connections.
        </p>
      </Card>

      <Card>
        <CardHeader
          title="Contas conectadas"
          description="Canais Twitch que VOCÊ autorizou (Channel.ownerId = seu user)."
        />
        {integrations.isLoading ? (
          <p className="text-sm text-ink-400">carregando…</p>
        ) : integrations.data && integrations.data.length > 0 ? (
          <ul className="divide-y divide-white/[0.05]">
            {integrations.data.map((it) => (
              <li
                key={it.channelId}
                className="flex items-center justify-between py-3"
              >
                <div>
                  <p className="font-medium text-ink-800">
                    {it.displayName || it.name}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-400">
                    twitch user id{' '}
                    <span className="font-mono">{it.externalId || '—'}</span>
                    {it.expiresAt && (
                      <>
                        {' · '}expira {formatDate(it.expiresAt)}
                      </>
                    )}
                  </p>
                  {it.scope && (
                    <p className="mt-0.5 text-[10px] text-ink-400">
                      scope: {it.scope}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={it.invalidated ? 'negative' : 'positive'}>
                    {it.invalidated ? 'invalidado' : 'ativo'}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => disconnect.mutate(it.channelId)}
                    disabled={disconnect.isPending}
                  >
                    desconectar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Nenhuma conta conectada ainda"
            description='Clique em "Conectar Twitch" acima para autorizar uma conta.'
          />
        )}
      </Card>

      <Card>
        <CardHeader
          title="Outros canais Twitch no banco"
          description="Canais sem ownerId (legacy / seed). OAuth não foi feito por aqui."
        />
        {channels.isLoading ? (
          <p className="text-sm text-ink-400">…</p>
        ) : channels.data && channels.data.length > 0 ? (
          <ul className="space-y-2">
            {channels.data.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-md border border-white/[0.06] p-3"
              >
                <div>
                  <p className="font-medium text-ink-800">{c.name}</p>
                  <p className="text-xs text-ink-400 font-mono">
                    {c.externalId ?? c.id}
                  </p>
                </div>
                <Badge tone="twitch">twitch</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-400">
            Nenhum canal Twitch ainda — conecte uma conta acima.
          </p>
        )}
      </Card>
    </div>
  );
}
