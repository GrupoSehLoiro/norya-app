import { z } from 'zod';

export const StartSessionSchema = z.object({
  channelId: z.string().min(1, 'channelId obrigatório'),
  title: z.string().trim().min(1).max(200).optional(),
});

export type StartSessionDto = z.infer<typeof StartSessionSchema>;
