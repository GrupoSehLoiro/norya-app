/**
 * Re-export do schema canônico que vive em @sehloro/infra.
 *
 * Mantemos este arquivo como atalho local + ponto de extensão caso a API
 * precise sobrescrever defaults específicos no futuro. Por ora é só um
 * pass-through para não espalhar o import string por todo o código da API.
 */
export { configSchema, zodValidate } from '@sehloro/infra';
export type { AppConfig } from '@sehloro/infra';
