/**
 * Cliente de entitlements (plano + uso vs. limites do workspace ativo).
 */
import { api } from './api-client';

export interface Entitlements {
  plan: {
    key: string;
    label: string;
    maxCreators: number;
    maxIntegrationsPerCreator: number;
    maxBrands: number;
    historyRetentionDays: number;
    features: string[];
  };
  usage: { creators: number };
  limits: {
    maxCreators: number;
    maxIntegrationsPerCreator: number;
    maxBrands: number;
  };
  features: string[];
}

export const fetchEntitlements = () =>
  api.get<Entitlements>('/api/v2/entitlements');

/** `-1` = ilimitado → mostra ∞. */
export const fmtLimit = (n: number) => (n < 0 ? '∞' : String(n));
