/**
 * DTO compartilhado entre as 6 features legadas: filtros comuns para listagem
 * + CSV export. Zod valida query params (page, pageSize, channel, datas).
 *
 * `timestampField` é específico de cada feature porque ban/timeout/removed/emoji
 * usam `timestamp` enquanto prediction/poll usam `created_at`. O controller
 * passa o nome correto pra service.
 */
import { z } from 'zod';

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'data inválida (ISO esperado)' })
  .transform((s) => new Date(s));

export const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  channel: z.string().trim().min(1).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
});

export type ListQuery = z.infer<typeof ListQuerySchema>;

export const ExportQuerySchema = ListQuerySchema.omit({ page: true, pageSize: true });
export type ExportQuery = z.infer<typeof ExportQuerySchema>;
