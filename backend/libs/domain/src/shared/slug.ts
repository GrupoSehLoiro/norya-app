/**
 * Helper de slug — gera identificadores URL-safe a partir de nomes humanos.
 *
 * Usado por Workspace e Creator para derivar `slug` a partir de `name`.
 * A unicidade (por workspace, etc.) é responsabilidade da camada de aplicação;
 * aqui só normalizamos a string.
 */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '') // remove acentos (combining marks)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-') // não-alfanumérico → hífen
      .replace(/^-+|-+$/g, '') // tira hífens das pontas
      .slice(0, 64) || 'item'
  );
}
