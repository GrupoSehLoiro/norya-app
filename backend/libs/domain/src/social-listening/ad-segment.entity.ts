/**
 * AdSegment — janela em que um anúncio está rodando num canal.
 *
 * Fonte do sinal (`source`):
 *   - 'twitch'  → veio do EventSub `channel.ad_break.begin`
 *   - 'manual'  → toggle do streamer/admin pelo SPA
 *
 * Pode estar "aberto" (`endedAt == null`) por algum tempo:
 *   - twitch: `endedAt = startedAt + duration_seconds`
 *     (preenchido no momento do start porque o payload traz duração)
 *   - manual: preenchido quando vier POST /ad/stop ou via expiração
 *     se `durationSec` foi passado no start
 */
export type AdSegmentSource = 'twitch' | 'manual';

export interface AdSegment {
  id: string;
  channelId: string;
  sessionId: string | null;
  source: AdSegmentSource;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  isAutomatic: boolean; // só usado por twitch (is_automatic)
  rawPayload?: unknown;
}

/** True se a janela do ad está aberta NA hora `at`. */
export function isAdActiveAt(seg: AdSegment, at: Date): boolean {
  if (at < seg.startedAt) return false;
  if (seg.endedAt && at > seg.endedAt) return false;
  return true;
}
