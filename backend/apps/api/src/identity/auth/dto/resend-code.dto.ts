/**
 * DTO de reenvio de código de verificação.
 */
import { z } from 'zod';

export const ResendCodeDto = z.object({
  email: z.string().email(),
});

export type ResendCodeDto = z.infer<typeof ResendCodeDto>;
