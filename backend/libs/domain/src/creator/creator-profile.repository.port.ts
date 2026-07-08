/**
 * Contract (port) do repositório de CreatorProfile.
 * Implementação concreta (Mongoose) em `@sehloro/infra`.
 */
import { CreatorProfile } from './creator-profile.entity';

export interface CreatorProfileRepository {
  findByCreatorId(creatorId: string): Promise<CreatorProfile | null>;
  save(profile: CreatorProfile): Promise<CreatorProfile>;
  delete(id: string): Promise<void>;
}

export const CREATOR_PROFILE_REPOSITORY = Symbol('CreatorProfileRepository');
