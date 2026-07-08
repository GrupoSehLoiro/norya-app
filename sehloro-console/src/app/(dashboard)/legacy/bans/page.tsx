'use client';

import { PageHeader } from '@/components/layout/page-header';
import { LegacyTable, fmtDate, type LegacyColumn } from '@/components/legacy/legacy-table';
import type { BanRow } from '@/lib/legacy-types';

const columns: LegacyColumn<BanRow>[] = [
  { key: 'timestamp', header: 'Quando', width: '170px', render: (r) => fmtDate(r.timestamp) },
  { key: 'channel',   header: 'Canal',  width: '160px', render: (r) => r.channel ?? '—' },
  { key: 'userName',  header: 'Usuário', width: '180px', mono: true },
  { key: 'modName',   header: 'Mod',     width: '160px', mono: true },
  { key: 'reason',    header: 'Motivo',  render: (r) => r.reason || <span className="text-ink-400">—</span> },
];

export default function BansPage() {
  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Legado · Moderação"
        title="Bans"
        description="Banimentos registrados pelos bots no chat dos canais monitorados. Filtre por canal e período."
      />
      <LegacyTable<BanRow>
        resource="bans"
        queryKey="legacy:bans"
        columns={columns}
        emptyTitle="Nenhum ban encontrado"
      />
    </div>
  );
}
