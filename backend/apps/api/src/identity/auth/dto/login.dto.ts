/**
 * DTO de login.
 *
 * Aceita **email** (identificador canônico no fluxo novo de sign-up) OU
 * `username` (compat com o legado). Pelo menos um precisa estar presente.
 * O service resolve por email primeiro, depois por username.
 */
import { z } from 'zod';

export const LoginDto = z
  .object({
    email: z.string().email().optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(1),
  })
  .refine((v) => Boolean(v.email || v.username), {
    message: 'informe email ou username',
    path: ['email'],
  });

export type LoginDto = z.infer<typeof LoginDto>;
