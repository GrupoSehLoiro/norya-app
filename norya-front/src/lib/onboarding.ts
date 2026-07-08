/**
 * Cliente das rotas de onboarding/creator (Fase 2 do backend).
 * Tipos espelhados manualmente — a interface HTTP é o contrato.
 */
import { api } from './api-client';

export interface TaxonomyOption {
  value: string;
  label: string;
}
export interface SubcategoryNode extends TaxonomyOption {
  /** 3º nível — títulos/itens específicos (ex.: Valorant em FPS). */
  items?: TaxonomyOption[];
}
export interface CategoryNode extends TaxonomyOption {
  subcategories: SubcategoryNode[];
}
export interface Taxonomy {
  categories: CategoryNode[];
  audience: {
    ageRanges: TaxonomyOption[];
  };
}

export interface CreatorView {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: string;
  profileComplete: boolean;
  createdAt: string;
}

export interface ProfileView {
  creatorId: string;
  niche: string;
  category: string;
  subcategory: string;
  genre: string;
  audience: {
    ageRange?: string;
    gender?: string;
    size?: string;
    region?: string;
  };
  tags: string[];
  complete: boolean;
}

export interface IntegrationView {
  id: string;
  platform: string;
  name: string;
  displayName: string | null;
  externalId: string | null;
  active: boolean;
  creatorId: string | null;
}

export interface OnboardingStatus {
  onboardingCompleted: boolean;
  hasCreator: boolean;
  hasCompleteProfile: boolean;
  hasIntegration: boolean;
}

export const fetchTaxonomy = () =>
  api.get<Taxonomy>('/api/v2/onboarding/taxonomy');

export const fetchOnboardingStatus = () =>
  api.get<OnboardingStatus>('/api/v2/onboarding/status');

export const completeOnboarding = () =>
  api.post<OnboardingStatus>('/api/v2/onboarding/complete');

export const fetchCreators = () => api.get<CreatorView[]>('/api/v2/creators');

export const createCreator = (name: string) =>
  api.post<CreatorView>('/api/v2/creators', { name });

export const fetchProfile = (creatorId: string) =>
  api.get<ProfileView>(`/api/v2/creators/${creatorId}/profile`);

export const saveProfile = (
  creatorId: string,
  dto: Partial<Omit<ProfileView, 'creatorId' | 'complete'>>,
) => api.put<ProfileView>(`/api/v2/creators/${creatorId}/profile`, dto);

export const fetchUnlinkedIntegrations = () =>
  api.get<IntegrationView[]>('/api/v2/integrations/unlinked');

export const fetchCreatorIntegrations = (creatorId: string) =>
  api.get<IntegrationView[]>(`/api/v2/integrations?creatorId=${creatorId}`);

export const linkIntegration = (creatorId: string, channelId: string) =>
  api.post<IntegrationView>('/api/v2/integrations/link', { creatorId, channelId });

// ── Catálogo de marcas (busca no onboarding) ─────────────────────────────────
export interface BrandCatalogItem {
  slug: string;
  name: string;
  aliases: string[];
  sector: string;
  country: string;
}

export const searchBrandCatalog = (q: string, limit = 12) =>
  api.get<BrandCatalogItem[]>(
    `/api/v2/brand-catalog?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
