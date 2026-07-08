import { z } from 'zod';

export const ListSessionsSchema = z.object({
  channelId: z.string().optional(),
  state: z.enum(['SCHEDULED', 'ACTIVE', 'ENDED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export type ListSessionsDto = z.infer<typeof ListSessionsSchema>;
