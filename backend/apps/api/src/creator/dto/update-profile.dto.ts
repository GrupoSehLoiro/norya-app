import { z } from 'zod';

const AudienceDto = z.object({
  ageRange: z.string().max(40).optional(),
  gender: z.string().max(40).optional(),
  size: z.string().max(40).optional(),
  region: z.string().max(40).optional(),
});

/** Patch parcial do perfil do creator — todos os campos opcionais. */
export const UpdateProfileDto = z.object({
  niche: z.string().max(120).optional(),
  category: z.string().max(120).optional(),
  subcategory: z.string().max(120).optional(),
  genre: z.string().max(120).optional(),
  audience: AudienceDto.optional(),
  tags: z.array(z.string().min(1).max(60)).max(50).optional(),
});

export type UpdateProfileDto = z.infer<typeof UpdateProfileDto>;
