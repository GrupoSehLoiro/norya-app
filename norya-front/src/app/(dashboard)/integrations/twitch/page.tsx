'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { UnlinkedChannelsCard } from '@/components/integrations/unlinked-channels-card';
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

/** Mensagens dos avisos que o callback OAuth devolve em `?warning=`. */
const WARNING_MESSAGES: Record<string, string> = {
  noCreator:
    'Canal conectado, mas o workspace ainda não tem creator — complete o onboarding para vinculá-lo.',
  chooseCreator:
    'Canal conectado. Vincule-o a um creator abaixo para ele aparecer no seletor de canais.',
  autoLinkFailed:
    'Canal conectado, mas o vínculo automático com o creator falhou — vincule manualmente abaixo.',
  subscribeFailed:
    'Canal conectado, mas as subscriptions EventSub falharam — chat/lifecycle podem ficar degradados.',
  chatViaIrcOnly:
    'TWITCH_BOT_USER_ID não configurado — chat será lido via IRC (fallback).',
};

export default function TwitchPage() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const justConnected = params.get('connected') === '1';
  const errorParam = params.get('error');
  const warnings = (params.get('warning') ?? '').split(',').filter(Boolean);

  // Pós-OAuth o backend criou/vinculou canal — derruba caches pra sidebar
  // ("Canal ativo") e as listas daqui refletirem na hora.
  useEffect(() => {
    if (!justConnected) return;
    void qc.invalidateQueries({ queryKey: ['channels-v2'] });
    void qc.invalidateQueries({ queryKey: ['twitch-integrations'] });
    void qc.invalidateQueries({ queryKey: ['unlinked-integrations'] });
  }, [justConnected, qc]);

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
          {warnings.length === 0 && ' Vinculado ao creator — já aparece no seletor de canais.'}
        </div>
      )}
      {warnings.map((w) => (
        <div
          key={w}
          className="rounded-2xl border border-warn/30 bg-warn/[0.08] px-4 py-3 text-sm text-warn"
        >
          {WARNING_MESSAGES[w] ?? `Aviso: ${w}`}
        </div>
      ))}
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

      <UnlinkedChannelsCard platform="twitch" />

      <Card>
        <CardHeader
          title="Canais Twitch do workspace"
          description="Canais já vinculados a um creator deste workspace — são estes que aparecem no seletor de canais."
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
