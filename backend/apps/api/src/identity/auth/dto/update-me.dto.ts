/**
 * DTO de auto-edição da conta (`PATCH /api/v2/auth/me`). Campos que o próprio
 * usuário pode alterar sobre si — sem tocar em role, email ou status, que são
 * gerenciados por outros fluxos (admin/verificação). Patch parcial: todos
 * opcionais, mas ao menos um precisa vir (validado no service).
 */
import { z } from 'zod';

export const UpdateMeDto = z.object({
  displayName: z.string().trim().min(1, 'nome não pode ficar vazio').max(120).optional(),
  locale: z.string().trim().max(10).optional(),
});

export type UpdateMeDto = z.infer<typeof UpdateMeDto>;
