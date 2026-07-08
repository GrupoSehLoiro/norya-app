/**
 * CHAT-02 · Zod schema de RawMessage.
 *
 * Validação na borda de entrada do pipeline: qualquer mensagem recebida
 * de um ChatProvider deve passar por este schema antes de ser processada.
 * O tipo inferido `RawMessageParsed` é equivalente ao tipo manual `RawMessage`.
 */
import { z } from 'zod';

export const RawMessageEmoteSchema = z.object({
  code: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  provider: z.enum(['twitch', 'bttv', '7tv', 'kick']).optional(),
  semantic: z
    .enum(['HYPE', 'BORING', 'SARCASM', 'SAD', 'ANGRY', 'NEUTRAL', 'POSITIVE', 'NEGATIVE'])
    .optional(),
  polarity: z.number().min(-1).max(1).optional(),
  intensity: z.enum(['low', 'mid', 'high']).optional(),
});

export const RawMessageUserSchema = z.object({
  externalId: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string(),
  isSubscriber: z.boolean(),
  isMod: z.boolean(),
  isBroadcaster: z.boolean(),
  badges: z.array(z.string()),
});

export const RawMessageMentionSchema = z.object({
  username: z.string().min(1),
});

export const RawMessageSchema = z.object({
  id: z.string().min(1),
  platform: z.enum(['twitch', 'kick']),
  channelExternalId: z.string().min(1),
  channelName: z.string().min(1),
  user: RawMessageUserSchema,
  text: z.string(),
  emotes: z.array(RawMessageEmoteSchema),
  mentions: z.array(RawMessageMentionSchema),
  rawPayload: z.unknown(),
  receivedAt: z.date(),
});

export type RawMessageParsed = z.infer<typeof RawMessageSchema>;
