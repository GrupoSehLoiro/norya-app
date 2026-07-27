'use client';

/**
 * Card "Canais aguardando vínculo" das páginas de integração.
 *
 * O OAuth (Twitch/Kick) cria o canal com ownerId = usuário, mas é o vínculo
 * com um creator (creatorId + workspaceId) que faz o canal aparecer em
 * /api/v2/channels e no seletor "Canal ativo". O backend auto-vincula quando
 * o workspace tem exatamente um creator; este card cobre o resto (0 creators,
 * múltiplos creators ou falha do auto-link).
 *
 * Renderiza nada quando não há canal pendente — só aparece quando é preciso agir.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fetchCreators, fetchUnlinkedIntegrations, linkIntegration } from '@/lib/onboarding';

export function UnlinkedChannelsCard({ platform }: { platform: 'twitch' | 'kick' }) {
  const qc = useQueryClient();
  // creatorId escolhido por canal (default: primeiro creator da lista).
  const [selection, setSelection] = useState<Record<string, string>>({});

  const unlinked = useQuery({
    queryKey: ['unlinked-integrations'],
    queryFn: fetchUnlinkedIntegrations,
  });
  const creators = useQuery({
    queryKey: ['creators'],
    queryFn: fetchCreators,
  });

  const link = useMutation({
    mutationFn: (args: { creatorId: string; channelId: string }) =>
      linkIntegration(args.creatorId, args.channelId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['unlinked-integrations'] });
      // Canal passa a pertencer ao workspace → sidebar e listas de canais mudam.
      void qc.invalidateQueries({ queryKey: ['channels-v2'] });
    },
  });

  const pending = (unlinked.data ?? []).filter((c) => c.platform === platform);
  if (pending.length === 0) return null;

  const creatorList = creators.data ?? [];

  return (
    <Card>
      <CardHeader
        title="Canais aguardando vínculo"
        description="Você já conectou estes canais. Só falta vinculá-los pra eles aparecerem no seletor de canais."
      />
      {creatorList.length === 0 ? (
        <p className="text-sm text-warn">
          O workspace ainda não tem creator. Complete o onboarding antes de vincular.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {pending.map((c) => {
            const creatorId = selection[c.id] ?? creatorList[0]!.id;
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink-800">{c.displayName || c.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink-400">{c.externalId ?? c.id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={platform === 'twitch' ? 'twitch' : 'kick'}>{platform}</Badge>
                  {creatorList.length > 1 && (
                    <select
                      value={creatorId}
                      onChange={(e) =>
                        setSelection((s) => ({ ...s, [c.id]: e.target.value }))
                      }
                      className="h-9 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 text-sm text-ink-800 transition-colors focus:border-accent-400/60 focus:outline-none focus:ring-2 focus:ring-accent-400/20"
                    >
                      {creatorList.map((cr) => (
                        <option key={cr.id} value={cr.id} className="bg-bg-0">
                          {cr.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <Button
                    size="sm"
                    onClick={() => link.mutate({ creatorId, channelId: c.id })}
                    disabled={link.isPending}
                  >
                    {creatorList.length > 1
                      ? 'Vincular'
                      : `Vincular a ${creatorList[0]!.name}`}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {link.error && (
        <p className="mt-3 text-sm text-err">
          Falha ao vincular: {(link.error as Error).message}
        </p>
      )}
    </Card>
  );
}
