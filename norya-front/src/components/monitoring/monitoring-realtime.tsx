'use client';

import { useMonitoringRealtime } from '@/hooks/use-monitoring-realtime';

/**
 * Componente invisível que abre a conexão SSE global de status (montado uma
 * vez no layout do dashboard). Não renderiza nada — só mantém o realtime.
 */
export function MonitoringRealtime() {
  useMonitoringRealtime();
  return null;
}
