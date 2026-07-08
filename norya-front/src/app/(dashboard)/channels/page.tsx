'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ChannelLiveToggle } from '@/components/monitoring/channel-live-toggle';
import { api, ApiError } from '@/lib/api-client';
import { fetchChannels } from '@/lib/queries';
import { formatDate } from '@/lib/utils';

const NewChannelSchema = z.object({
  platform: z.enum(['twitch', 'kick']),
  name: z.string().min(2),
  externalId: z.string().optional(),
});
type NewChannelFormData = z.infer<typeof NewChannelSchema>;

export default function ChannelsPage() {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const channels = useQuery({
    queryKey: ['channels-v2'],
    queryFn: fetchChannels,
  });

  const createMut = useMutation({
    mutationFn: (data: NewChannelFormData) => api.post('/api/v2/channels', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['channels-v2'] });
      setShowForm(false);
      setServerError(null);
    },
    onError: (err) => {
      setServerError(err instanceof ApiError ? err.message : 'Falha ao criar canal');
    },
  });

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Ingestão"
        title="Canais"
        description="Endpoint /api/v2/channels. O backend tenta auto-resolver IDs via Helix/Kick."
        actions={
          <Button onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancelar' : '+ Novo canal'}
          </Button>
        }
      />

      {showForm && <NewChannelForm mut={createMut} serverError={serverError} />}

      {channels.isLoading ? (
        <Card>Carregando canais…</Card>
      ) : channels.data && channels.data.length > 0 ? (
        <Card>
          <CardHeader title={`${channels.data.length} canal(is) cadastrado(s)`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-left text-[10px] uppercase tracking-[0.14em] text-ink-400">
                  <th className="pb-2 pr-4 font-medium">Canal</th>
                  <th className="pb-2 pr-4 font-medium">Plataforma</th>
                  <th className="pb-2 pr-4 font-medium">External ID</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Criado</th>
                  <th className="pb-2 pr-4 font-medium">Insights</th>
                  <th className="pb-2 pr-4 text-right font-medium">Live</th>
                </tr>
              </thead>
              <tbody className="text-ink-800">
                {channels.data.map((c) => (
                  <tr key={c.id} className="border-b border-white/[0.05] last:border-0 transition-colors hover:bg-white/[0.025]">
                    <td className="py-2 pr-4 font-medium">{c.name}</td>
                    <td className="py-2 pr-4">
                      <Badge tone={c.platform === 'twitch' ? 'twitch' : 'kick'}>
                        {c.platform}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{c.externalId ?? '—'}</td>
                    <td className="py-2 pr-4">
                      <Badge tone={c.active ? 'positive' : 'neutral'}>
                        {c.active ? 'ativo' : 'inativo'}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-ink-400">{formatDate(c.createdAt)}</td>
                    <td className="py-2 pr-4">
                      <Link
                        className="text-accent-300 hover:text-accent-400 hover:underline"
                        href={`/insights/${encodeURIComponent(c.id)}`}
                      >
                        ver
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <ChannelLiveToggle channelId={c.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <EmptyState
          title="Nenhum canal v2 cadastrado"
          description="Cadastre um canal para o orchestrator começar a monitorá-lo (precisa também estar em SOCIAL_LISTENING_CHANNELS no .env do backend)."
          action={<Button onClick={() => setShowForm(true)}>+ Novo canal</Button>}
        />
      )}
    </div>
  );
}

function NewChannelForm({
  mut, serverError,
}: {
  mut: ReturnType<typeof useMutation<unknown, unknown, NewChannelFormData>>;
  serverError: string | null;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<NewChannelFormData>({
    defaultValues: { platform: 'twitch' },
  });
  return (
    <Card>
      <CardHeader title="Novo canal" description="O backend faz Helix/Kick lookup automático pelo nome." />
      <form
        onSubmit={handleSubmit((data) => {
          const parsed = NewChannelSchema.safeParse(data);
          if (!parsed.success) return;
          mut.mutate(parsed.data);
        })}
        className="grid grid-cols-1 gap-4 md:grid-cols-4"
      >
        <div className="md:col-span-1">
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">Plataforma</label>
          <select
            {...register('platform')}
            className="h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-ink-800 focus:border-accent-400/60 focus:outline-none focus:ring-2 focus:ring-accent-400/20"
          >
            <option value="twitch" className="bg-bg-1">Twitch</option>
            <option value="kick" className="bg-bg-1">Kick</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">Nome do canal</label>
          <Input placeholder="yodachannel" {...register('name')} />
          {errors.name && (
            <p className="mt-1 text-xs text-err">{errors.name.message}</p>
          )}
        </div>
        <div className="md:col-span-1">
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">External ID (opcional)</label>
          <Input placeholder="auto-resolve" {...register('externalId')} />
        </div>
        {serverError && (
          <p className="md:col-span-4 rounded-lg border border-err/30 bg-err/[0.08] px-3 py-2 text-sm text-err">{serverError}</p>
        )}
        <div className="md:col-span-4">
          <Button type="submit" loading={mut.isPending}>Cadastrar</Button>
        </div>
      </form>
    </Card>
  );
}
