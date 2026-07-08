/**
 * DTO de confirmação de email — código de 6 dígitos enviado no sign-up.
 */
import { z } from 'zod';

export const VerifyEmailDto = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'código deve ter 6 dígitos'),
});

export type VerifyEmailDto = z.infer<typeof VerifyEmailDto>;
