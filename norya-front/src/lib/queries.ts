/**
 * Wrappers tipados sobre `api` para chamadas frequentes onde o backend
 * devolve a lista dentro de `{ <plural>: [...], total }`. Centralizar
 * o unwrap evita repetir o gotcha em cada componente.
 */
import { api } from './api-client';
import type {
  ChannelV2,
  ChannelsListResponse,
  LiveSession,
  SessionsListResponse,
} from './types';

export async function fetchChannels(): Promise<ChannelV2[]> {
  const r = await api.get<ChannelsListResponse | ChannelV2[]>('/api/v2/channels');
  if (Array.isArray(r)) return r;
  return r.channels ?? [];
}

export async function fetchSessions(): Promise<LiveSession[]> {
  const r = await api.get<SessionsListResponse | LiveSession[]>('/api/v2/monitoring/sessions');
  if (Array.isArray(r)) return r;
  return r.sessions ?? [];
}
