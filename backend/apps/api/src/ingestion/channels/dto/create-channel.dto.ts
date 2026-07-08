import { z } from 'zod';
import { ChannelPlatform } from '@sehloro/domain';

export const CreateChannelSchema = z.object({
  name: z.string().min(1).max(100),
  platform: z.enum(['twitch', 'kick'] as [ChannelPlatform, ...ChannelPlatform[]]),
  ownerId: z.string().optional(),
  flags: z.record(z.boolean()).optional(),
});

export type CreateChannelDto = z.infer<typeof CreateChannelSchema>;
