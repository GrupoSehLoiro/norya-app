import { z } from 'zod';

export const CreateCreatorDto = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(64).optional(),
});

export type CreateCreatorDto = z.infer<typeof CreateCreatorDto>;
