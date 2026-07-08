/**
 * DTO de sign-up (registro). Identificador é o **email**; `username` legado é
 * derivado do email no service (compat com o schema único). `displayName` é
 * opcional e alimenta o nome do workspace pessoal + perfil de conta.
 */
import { isValidCnpj, isValidCpf, onlyDigits } from '@sehloro/domain';
import { z } from 'zod';

export const RegisterDto = z
  .object({
    email: z.string().email(),
    password: z.string().min(8, 'senha precisa ter no mínimo 8 caracteres'),
    displayName: z.string().min(1).max(120).optional(),
    /**
     * Tipo de conta escolhido no sign-up. Mapeia para `workspace.type`:
     * streamer→creator, agency→agency, brand→brand. Default streamer.
     */
    accountType: z.enum(['streamer', 'agency', 'brand']).optional(),
    /**
     * Documento fiscal do titular. CPF (pessoa física) para `streamer`;
     * CNPJ (pessoa jurídica) para `agency`/`brand`. Aceita com ou sem máscara.
     */
    document: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.document == null || data.document === '') return;
    // streamer = pessoa física (CPF); agency/brand = pessoa jurídica (CNPJ).
    const expectsCnpj = data.accountType === 'agency' || data.accountType === 'brand';
    const digits = onlyDigits(data.document);
    const ok = expectsCnpj ? isValidCnpj(digits) : isValidCpf(digits);
    if (!ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['document'],
        message: expectsCnpj ? 'CNPJ inválido' : 'CPF inválido',
      });
    }
  });

export type RegisterDto = z.infer<typeof RegisterDto>;
