/**
 * Stub de `puppeteer-core` para o Jest e2e.
 *
 * O pacote real é ESM puro e o ts-jest não transforma node_modules, o que
 * quebrava o parse de qualquer suíte que importe (transitivamente) o
 * HtmlPdfRendererService. Nenhuma suíte e2e renderiza PDF de verdade; se
 * alguma tentar, o launch falha com mensagem explícita.
 */
export type Browser = unknown;

export default {
  launch: async (): Promise<never> => {
    throw new Error('puppeteer-core stub: renderização de PDF não disponível no e2e');
  },
};
