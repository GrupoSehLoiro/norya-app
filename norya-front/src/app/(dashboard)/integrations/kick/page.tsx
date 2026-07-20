'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { UnlinkedChannelsCard } from '@/components/integrations/unlinked-channels-card';
import { getToken } from '@/lib/api-client';
import { fetchChannels } from '@/lib/queries';

/** Mensagens dos avisos que o callback OAuth devolve em `?warning=`. */
const WARNING_MESSAGES: Record<string, string> = {
  noCreator:
    'Canal conectado, mas o workspace ainda não tem creator — complete o onboarding para vinculá-lo.',
  chooseCreator:
    'Canal conectado. Vincule-o a um creator abaixo para ele aparecer no seletor de canais.',
  autoLinkFailed:
    'Canal conectado, mas o vínculo automático com o creator falhou — vincule manualmente abaixo.',
};

export default function KickPage() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const status = params.get('kick'); // ok | error | denied | null
  const warning = params.get('warning');

  // Pós-OAuth o backend criou/vinculou canal — derruba caches pra sidebar
  // ("Canal ativo") e as listas daqui refletirem na hora.
  useEffect(() => {
    if (status !== 'ok') return;
    void qc.invalidateQueries({ queryKey: ['channels-v2'] });
    void qc.invalidateQueries({ queryKey: ['unlinked-integrations'] });
  }, [status, qc]);

  const channels = useQuery({
    queryKey: ['channels-v2', 'kick'],
    queryFn: fetchChannels,
    // Só ativos: canal desconectado sai daqui (e do picker) na hora.
    select: (xs) => xs.filter((c) => c.platform === 'kick' && c.active !== false),
  });

  // Paridade com o Twitch: aperta o botão → OAuth. O backend descobre o canal
  // pela identidade que autorizou (Kick public API) e cria/recupera sozinho.
  function startOAuth() {
    const tk = getToken();
    if (!tk) {
      window.location.href = '/login';
      return;
    }
    window.location.href = `/api/v2/auth/kick/start?token=${encodeURIComponent(tk)}`;
  }

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Integrações"
        title="Integração Kick"
        description="Conecte sua conta Kick"
        info="Conecte sua conta Kick para a plataforma acompanhar o chat do seu canal. (Texto provisório.)"
      />

      {status === 'ok' && (
        <div className="rounded-xl border border-ok/30 bg-ok/10 p-3 text-sm text-ok">
          Conta Kick conectada — canal criado/atualizado e refresh_token cifrado persistido (AES-256-GCM).
          {!warning && ' Vinculado ao creator — já aparece no seletor de canais.'}
        </div>
      )}
      {warning && (
        <div className="rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
          {WARNING_MESSAGES[warning] ?? `Aviso: ${warning}`}
        </div>
      )}
      {status === 'error' && (
        <div className="rounded-xl border border-negative/30 bg-negative/10 p-3 text-sm text-negative">
          Falha no OAuth Kick. Confira KICK_CLIENT_ID/SECRET, o redirect_uri cadastrado e o scope channel:read.
        </div>
      )}
      {status === 'denied' && (
        <div className="rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
          Autorização negada no Kick.
        </div>
      )}

      <Card>
        <CardHeader eyebrow="Setup" title="Como conectar" />
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-600">
          <li>
            Registre o app Kick em{' '}
            <a className="text-accent-300 hover:text-accent-400 hover:underline" href="https://kick.com/developer" target="_blank" rel="noreferrer">
              kick.com/developer
            </a>{' '}
            com Redirect URL: <code>http://localhost:8080/api/v2/auth/kick/callback</code>.
          </li>
          <li>
            No <code>backend/.env</code> (e <code>infra/.env</code> se usar docker):
            <pre className="mt-1 rounded-lg border border-white/[0.06] bg-white/[0.04] p-2 font-mono text-xs">
{`KICK_CLIENT_ID=...
KICK_CLIENT_SECRET=...`}
            </pre>
          </li>
          <li>Restart do backend (ou <code>docker compose restart nest-api</code>).</li>
          <li>Clique em <strong>Conectar conta Kick</strong> — o canal é criado automaticamente pela identidade que autorizou.</li>
        </ol>
        <Button onClick={startOAuth} className="mt-5">
          Conectar conta Kick
        </Button>
      </Card>

      <UnlinkedChannelsCard platform="kick" />

      <Card>
        <CardHeader eyebrow="Canais" title="Canais Kick conectados" />
        {channels.isLoading ? (
          <p className="text-sm text-ink-400">…</p>
        ) : channels.data && channels.data.length > 0 ? (
          <ul className="space-y-2">
            {channels.data.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                <div>
                  <p className="font-medium text-ink-800">{c.name}</p>
                  <p className="font-mono text-xs text-ink-400">{c.externalId ?? c.id}</p>
                </div>
                <Badge tone="kick">kick</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-400">
            Nenhum canal Kick ainda — conecte uma conta acima para criar o primeiro.
          </p>
        )}
      </Card>
    </div>
  );
}
