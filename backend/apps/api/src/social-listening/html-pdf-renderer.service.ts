/**
 * HtmlPdfRendererService — imprime HTML em PDF via Chromium (puppeteer-core).
 *
 * Desenhado para uma VPS pequena (8 GB), com três salvaguardas de recursos:
 *   1. LAZY: o Chromium só sobe no primeiro render — zero custo em repouso.
 *   2. FILA SERIAL: renders concorrentes entram numa fila de concorrência 1 —
 *      no pior caso há UM Chromium com UMA página aberta (~200–300 MB por
 *      alguns segundos), nunca N instâncias.
 *   3. AUTO-SHUTDOWN: 60s sem uso → o browser fecha e devolve a RAM.
 *
 * Não baixa browser nenhum (puppeteer-core): usa o binário do sistema, via
 * CHROME_PATH / PUPPETEER_EXECUTABLE_PATH ou caminhos padrão. Sem binário
 * disponível, `isAvailable()` é false e o chamador cai no fallback pdfkit —
 * o deploy nunca quebra por falta de Chromium.
 */
import { existsSync } from 'node:fs';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer-core';

const IDLE_CLOSE_MS = 60_000;
const RENDER_TIMEOUT_MS = 30_000;
// Espera pelas imagens dos emotes (CDNs externos). Estourou → imprime assim
// mesmo; um emote faltando não pode segurar o relatório.
const NETWORK_IDLE_TIMEOUT_MS = 10_000;

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/chrome',
];

@Injectable()
export class HtmlPdfRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(HtmlPdfRendererService.name);
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  isAvailable(): boolean {
    return this.executablePath() !== null;
  }

  /** Enfileira o render — concorrência 1, com timeout duro por job. */
  render(html: string): Promise<Buffer> {
    const job = this.queue.then(
      () => this._withTimeout(this._render(html)),
      () => this._withTimeout(this._render(html)),
    );
    // A fila nunca guarda rejeição (senão um erro travaria os próximos).
    this.queue = job.catch(() => undefined);
    return job;
  }

  async onModuleDestroy(): Promise<void> {
    await this._closeBrowser();
  }

  private executablePath(): string | null {
    const fromEnv = process.env.CHROME_PATH ?? process.env.PUPPETEER_EXECUTABLE_PATH;
    for (const p of [fromEnv, ...CHROME_CANDIDATES]) {
      if (p && existsSync(p)) return p;
    }
    return null;
  }

  private _withTimeout(p: Promise<Buffer>): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`render excedeu ${RENDER_TIMEOUT_MS}ms`)), RENDER_TIMEOUT_MS);
      p.then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); },
      );
    });
  }

  private async _render(html: string): Promise<Buffer> {
    const browser = await this._getBrowser();
    const page = await browser.newPage();
    try {
      // Espera a rede aquietar (imagens dos emotes); timeout → imprime o que deu.
      await page.setContent(html, { waitUntil: 'load', timeout: NETWORK_IDLE_TIMEOUT_MS });
      await page
        .waitForNetworkIdle({ idleTime: 300, timeout: NETWORK_IDLE_TIMEOUT_MS })
        .catch(() => this.logger.warn('timeout aguardando imagens de emote — imprimindo mesmo assim'));
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '44px', bottom: '56px', left: '54px', right: '54px' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="width:100%;font-size:8px;font-family:Helvetica,Arial,sans-serif;color:#767c83;' +
          'padding:0 54px;display:flex;justify-content:space-between;align-items:center;">' +
          '<span>norya</span>' +
          '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
      this._scheduleIdleClose();
    }
  }

  private async _getBrowser(): Promise<Browser> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.browser?.connected) return this.browser;
    if (this.launching) return this.launching;

    const executablePath = this.executablePath();
    if (!executablePath) throw new Error('nenhum Chromium disponível (CHROME_PATH)');

    this.launching = puppeteer
      .launch({
        executablePath,
        headless: true,
        // Flags para container/VPS: sem sandbox (roda como user do app), sem
        // /dev/shm (pequeno em Docker), sem GPU. Mantém o footprint mínimo.
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--mute-audio',
        ],
      })
      .then((b) => {
        this.browser = b;
        this.launching = null;
        this.logger.log(`Chromium iniciado p/ PDFs (${executablePath})`);
        b.once('disconnected', () => {
          if (this.browser === b) this.browser = null;
        });
        return b;
      })
      .catch((err) => {
        this.launching = null;
        throw err;
      });
    return this.launching;
  }

  private _scheduleIdleClose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this._closeBrowser().then(() =>
        this.logger.log('Chromium ocioso encerrado — RAM devolvida'),
      );
    }, IDLE_CLOSE_MS);
    // Não segura o processo vivo só por causa do timer.
    this.idleTimer.unref?.();
  }

  private async _closeBrowser(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const b = this.browser;
    this.browser = null;
    if (b) await b.close().catch(() => undefined);
  }
}
