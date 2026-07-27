'use client';

import { PageHeader } from '@/components/layout/page-header';
import { LegacyTable, fmtDate, type LegacyColumn } from '@/components/legacy/legacy-table';
import type { EmojiRow } from '@/lib/legacy-types';

const columns: LegacyColumn<EmojiRow>[] = [
  { key: 'timestamp', header: 'Quando', width: '180px', render: (r) => fmtDate(r.timestamp) },
  { key: 'username',  header: 'Usuário', width: '180px', mono: true, render: (r) => r.username ?? '—' },
  {
    key: 'emoji',
    header: 'Emoji',
    width: '120px',
    render: (r) => (r.emoji ? <span className="text-lg">{r.emoji}</span> : '—'),
  },
  {
    key: 'message',
    header: 'Mensagem',
    mono: true,
    render: (r) => r.message ?? <span className="text-ink-400">—</span>,
  },
];

export default function EmojisPage() {
  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Social listening"
        title="Emojis"
        description="Os emojis que a audiência mais solta no chat."
        info="Amostra dos emojis usados no chat deste canal ao longo do tempo. Um jeito leve de sentir o clima sem ler mensagem por mensagem. O canal acompanha o que estiver ativo no menu da conta."
      />
      <LegacyTable<EmojiRow>
        resource="emojis"
        queryKey="legacy:emojis"
        columns={columns}
        noun="registros"
        emptyTitle="Nenhum emoji no período"
        emptyDescription="A galera ainda não soltou emojis registrados neste canal no período selecionado."
      />
    </div>
  );
}
