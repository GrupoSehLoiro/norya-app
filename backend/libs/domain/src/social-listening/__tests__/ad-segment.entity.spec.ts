import type { AdSegment } from '../ad-segment.entity';
import { isAdActiveAt } from '../ad-segment.entity';

function seg(start: string, end: string | null): AdSegment {
  return {
    id: 's1',
    channelId: 'c1',
    sessionId: null,
    source: 'manual',
    startedAt: new Date(start),
    endedAt: end ? new Date(end) : null,
    durationSeconds: null,
    isAutomatic: false,
  };
}

describe('isAdActiveAt', () => {
  const s = seg('2026-05-19T12:00:00Z', '2026-05-19T12:01:30Z');

  it('antes do start → false', () => {
    expect(isAdActiveAt(s, new Date('2026-05-19T11:59:00Z'))).toBe(false);
  });
  it('exato no start → true', () => {
    expect(isAdActiveAt(s, new Date('2026-05-19T12:00:00Z'))).toBe(true);
  });
  it('no meio → true', () => {
    expect(isAdActiveAt(s, new Date('2026-05-19T12:00:45Z'))).toBe(true);
  });
  it('depois do end → false', () => {
    expect(isAdActiveAt(s, new Date('2026-05-19T12:02:00Z'))).toBe(false);
  });
  it('endedAt=null (aberto) → true se after start', () => {
    const open = seg('2026-05-19T12:00:00Z', null);
    expect(isAdActiveAt(open, new Date('2026-05-19T13:00:00Z'))).toBe(true);
  });
});
