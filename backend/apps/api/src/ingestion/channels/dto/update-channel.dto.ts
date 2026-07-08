import { z } from 'zod';

export const UpdateChannelSchema = z.object({
  active: z.boolean().optional(),
  flags: z.record(z.boolean()).optional(),
});

export type UpdateChannelDto = z.infer<typeof UpdateChannelSchema>;
