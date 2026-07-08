/**
 * Planos & Entitlements (Identity / billing bounded context).
 *
 * Pura TypeScript, sem framework. Os planos são **seed em código** (não tabela
 * editável) para versionar limites junto do código — ver
 * `rbac/entitlements-plans.md`. Sem cobrança real ainda; só a estrutura para o
 * paywall futuro. `EntitlementsService` (camada de app) consome estas tabelas.
 *
 * Convenção: `-1` = ilimitado.
 */

export type PlanKey = 'free' | 'pro' | 'agency';

/** Features liberáveis por plano. Strings estáveis (usadas em checagens). */
export const FEATURES = {
  INSIGHTS_REALTIME: 'insights.realtime',
  REPORTS_PDF: 'reports.pdf',
  REPORTS_CSV: 'reports.csvExport',
  BRANDS_PLATFORM_BREAKDOWN: 'brands.platformBreakdown',
  MEMBERS_INVITE: 'members.invite',
  SHARING_TO_BRAND: 'sharing.toBrand',
} as const;

export type FeatureKey = (typeof FEATURES)[keyof typeof FEATURES];

export interface Plan {
  key: PlanKey;
  label: string;
  /** Quantos creators ("canais") o workspace pode ter. -1 = ilimitado. */
  maxCreators: number;
  /** Quantas integrações (plataformas) por creator. -1 = ilimitado. */
  maxIntegrationsPerCreator: number;
  /** Quantas marcas (allowlist) por creator. -1 = ilimitado. */
  maxBrands: number;
  /** Dias de retenção de histórico exibível. */
  historyRetentionDays: number;
  features: FeatureKey[];
}

export const PLANS: Record<PlanKey, Plan> = {
  free: {
    key: 'free',
    label: 'Free',
    maxCreators: 1,
    maxIntegrationsPerCreator: 1,
    maxBrands: 3,
    historyRetentionDays: 7,
    features: [FEATURES.INSIGHTS_REALTIME, FEATURES.REPORTS_CSV],
  },
  pro: {
    key: 'pro',
    label: 'Pro',
    maxCreators: 1,
    maxIntegrationsPerCreator: 3,
    maxBrands: 25,
    historyRetentionDays: 90,
    features: [
      FEATURES.INSIGHTS_REALTIME,
      FEATURES.REPORTS_CSV,
      FEATURES.REPORTS_PDF,
      FEATURES.BRANDS_PLATFORM_BREAKDOWN,
      FEATURES.SHARING_TO_BRAND,
    ],
  },
  agency: {
    key: 'agency',
    label: 'Agency',
    maxCreators: 10,
    maxIntegrationsPerCreator: 3,
    maxBrands: -1,
    historyRetentionDays: 180,
    features: [
      FEATURES.INSIGHTS_REALTIME,
      FEATURES.REPORTS_CSV,
      FEATURES.REPORTS_PDF,
      FEATURES.BRANDS_PLATFORM_BREAKDOWN,
      FEATURES.MEMBERS_INVITE,
      FEATURES.SHARING_TO_BRAND,
    ],
  },
};

export const DEFAULT_PLAN_KEY: PlanKey = 'free';

export function getPlan(key: PlanKey): Plan {
  return PLANS[key] ?? PLANS[DEFAULT_PLAN_KEY];
}

export function planHasFeature(key: PlanKey, feature: FeatureKey): boolean {
  return getPlan(key).features.includes(feature);
}

/** `true` se `used` ainda cabe no limite (`-1` = ilimitado). */
export function withinLimit(used: number, limit: number): boolean {
  return limit < 0 || used < limit;
}
