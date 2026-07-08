/**
 * Entidade de domínio: CreatorProfile (Creator bounded context).
 *
 * Perfil de contexto do Creator capturado no onboarding: nicho, categoria,
 * subcategoria, público-alvo, gênero. Alimenta a IA de social listening
 * (enriquece prompts) e a futura segmentação por marca. Taxonomia = seed fixo
 * + texto livre (`tags` e campos podem receber valores "other").
 *
 * 1:1 com Creator (`creatorId` único).
 */
import { generateId } from '../shared/identity';

export interface CreatorAudience {
  ageRange?: string; // ex.: '18-24'
  gender?: string; // ex.: 'predominantly_male' | 'mixed' | 'other'
  size?: string; // ex.: 'nano' | 'micro' | 'mid' | 'large'
  region?: string; // ex.: 'BR' | 'LATAM'
}

export interface CreatorProfilePersistenceShape {
  _id: string;
  creatorId: string;
  niche: string;
  category: string;
  subcategory: string;
  genre: string;
  audience: CreatorAudience;
  tags: string[];
  completedAt: Date | null;
  updatedAt: Date;
}

export interface CreatorProfileInput {
  niche?: string;
  category?: string;
  subcategory?: string;
  genre?: string;
  audience?: CreatorAudience;
  tags?: string[];
}

export class CreatorProfile {
  private constructor(
    private readonly id: string,
    private readonly creatorId: string,
    private niche: string,
    private category: string,
    private subcategory: string,
    private genre: string,
    private audience: CreatorAudience,
    private tags: string[],
    private completedAt: Date | null,
    private updatedAt: Date,
  ) {}

  static create(props: { creatorId: string } & CreatorProfileInput): CreatorProfile {
    return new CreatorProfile(
      generateId(),
      props.creatorId,
      props.niche ?? '',
      props.category ?? '',
      props.subcategory ?? '',
      props.genre ?? '',
      props.audience ?? {},
      props.tags ?? [],
      null,
      new Date(),
    );
  }

  static reconstitute(props: CreatorProfilePersistenceShape): CreatorProfile {
    return new CreatorProfile(
      props._id,
      props.creatorId,
      props.niche,
      props.category,
      props.subcategory,
      props.genre,
      props.audience ?? {},
      props.tags ?? [],
      props.completedAt,
      props.updatedAt,
    );
  }

  getId(): string {
    return this.id;
  }
  getCreatorId(): string {
    return this.creatorId;
  }
  isComplete(): boolean {
    return this.completedAt !== null;
  }

  /** Aplica um patch parcial (campos undefined são ignorados) e toca updatedAt. */
  update(input: CreatorProfileInput): void {
    if (input.niche !== undefined) this.niche = input.niche;
    if (input.category !== undefined) this.category = input.category;
    if (input.subcategory !== undefined) this.subcategory = input.subcategory;
    if (input.genre !== undefined) this.genre = input.genre;
    if (input.audience !== undefined) this.audience = input.audience;
    if (input.tags !== undefined) this.tags = input.tags;
    this.updatedAt = new Date();
  }

  /** Marca o perfil como concluído (mínimo: categoria preenchida). */
  markComplete(at: Date = new Date()): void {
    this.completedAt = at;
    this.updatedAt = at;
  }

  toPersistence(): CreatorProfilePersistenceShape {
    return {
      _id: this.id,
      creatorId: this.creatorId,
      niche: this.niche,
      category: this.category,
      subcategory: this.subcategory,
      genre: this.genre,
      audience: this.audience,
      tags: this.tags,
      completedAt: this.completedAt,
      updatedAt: this.updatedAt,
    };
  }
}
