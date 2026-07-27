/**
 * ResendEmailSender — driver real via Resend (https://resend.com).
 *
 * O pacote `resend` é carregado de forma lazy (`require`) só quando este driver
 * é selecionado — assim o build/test não exige a dependência instalada quando
 * EMAIL_DRIVER=log (default). Em produção, instale `resend` e configure
 * RESEND_API_KEY + MAIL_FROM.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailMessage, EmailSender } from './email-sender.port';

interface ResendClient {
  emails: {
    send(input: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html?: string;
    }): Promise<unknown>;
  };
}

@Injectable()
export class ResendEmailSender implements EmailSender {
  private readonly logger = new Logger('EmailSender:resend');
  private client: ResendClient | null = null;

  constructor(private readonly config: ConfigService) {}

  private getClient(): ResendClient {
    if (this.client) return this.client;
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      throw new Error('RESEND_API_KEY ausente — necessário com EMAIL_DRIVER=resend');
    }
    // Lazy require — evita dependência hard no build quando driver=log.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Resend } = require('resend');
    this.client = new Resend(apiKey) as ResendClient;
    return this.client;
  }

  async send(message: EmailMessage): Promise<void> {
    const from = this.config.get<string>('MAIL_FROM') ?? 'Norya <no-reply@norya.dev>';
    await this.getClient().emails.send({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    this.logger.debug(`email enviado via resend to=${message.to}`);
  }
}
