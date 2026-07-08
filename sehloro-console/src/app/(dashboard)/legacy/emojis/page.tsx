'use client';

import { PageHeader } from '@/components/layout/page-header';
import { LegacyTable, fmtDate, type LegacyColumn } from '@/components/legacy/legacy-table';
import type { EmojiRow } from '@/lib/legacy-types';

const columns: LegacyColumn<EmojiRow>[] = [
  { key: 'timestamp', header: 'Quando', width: '170px', render: (r) => fmtDate(r.timestamp) },
  { key: 'channel',   header: 'Canal',   width: '140px', render: (r) => r.channel ?? '—' },
  { key: 'username',  header: 'Usuário', width: '160px', mono: true, render: (r) => r.username ?? '—' },
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
        eyebrow="Legado · Social Listening"
        title="Emojis"
        description="Amostragem de emojis usados no chat — útil pra heurísticas de sentimento legadas."
      />
      <LegacyTable<EmojiRow>
        resource="emojis"
        queryKey="legacy:emojis"
        columns={columns}
        emptyTitle="Nenhum emoji no período"
      />
    </div>
  );
}
