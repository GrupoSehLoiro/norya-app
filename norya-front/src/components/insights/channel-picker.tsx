'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchChannels } from '@/lib/queries';

interface Props {
  value: string | null;
  onChange: (channelId: string | null) => void;
}

export function ChannelPicker({ value, onChange }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['channels-v2'],
    queryFn: fetchChannels,
    // Canal desconectado (active=false) não é opção de análise.
    select: (xs) => xs.filter((c) => c.active !== false),
  });

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
        Canal
      </label>
      <div className="relative">
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="h-10 w-full appearance-none rounded-lg border border-white/[0.08] bg-white/[0.04] pl-9 pr-9 text-sm font-medium text-ink-800 focus:border-accent-400/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-accent-400/20"
        >
          <option value="" className="bg-bg-1 text-ink-600">selecione…</option>
          {data?.map((c) => (
            <option key={c.id} value={c.id} className="bg-bg-1 text-ink-800">
              {c.name} ({c.platform})
            </option>
          ))}
        </select>
        <span
          className="pointer-events-none absolute left-3 top-1/2 inline-block h-2 w-2 -translate-y-1/2 rounded-full bg-ok shadow-[0_0_0_4px_rgba(110,231,183,0.18)]"
          aria-hidden
        />
        <svg
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-400"
          width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </div>
      {isLoading && <p className="text-xs text-ink-400">carregando canais…</p>}
      {error && <p className="text-xs text-err">{(error as Error).message}</p>}
    </div>
  );
}
