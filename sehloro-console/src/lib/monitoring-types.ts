export interface LiveSessionDto {
  id: string;
  channelId: string;
  state?: string;       // legacy field, see status
  status?: string;
  startedAt: string;
  endedAt: string | null;
  lastEventAt?: string | null;
}

export interface ChannelStatusDto {
  channelId: string;
  online: boolean;
  currentSession: LiveSessionDto | null;
  lastSession: LiveSessionDto | null;
}
