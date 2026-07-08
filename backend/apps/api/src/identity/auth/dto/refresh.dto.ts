/**
 * DTO para refresh e logout — ambos consomem o refresh token no body.
 *
 * Mandamos o refresh via body (POST JSON) em vez de cookie porque o
 * frontend atual armazena em localStorage (ver SLMOD-platform/src/App.tsx).
 * Quando migrarmos para cookies HttpOnly, este DTO vira opcional e o cookie
 * vira fonte primária.
 */
import { z } from 'zod';

export const RefreshDto = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshDto = z.infer<typeof RefreshDto>;
