/**
 * SmtpEmailSender — driver SMTP (nodemailer). Útil em dev com um mail catcher
 * local (Mailpit/MailHog) e em prod com qualquer SMTP. Selecionado por
 * EMAIL_DRIVER=smtp. Lê SMTP_HOST/SMTP_PORT/SMTP_SECURE/SMTP_USER/SMTP_PASS.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailMessage, EmailSender } from './email-sender.port';

interface Transporter {
  sendMail(opts: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<unknown>;
}

@Injectable()
export class SmtpEmailSender implements EmailSender {
  private readonly logger = new Logger('EmailSender:smtp');
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    const host = this.config.get<string>('SMTP_HOST') ?? 'localhost';
    const port = Number(this.config.get<string>('SMTP_PORT') ?? '1025');
    const secure = String(this.config.get<string>('SMTP_SECURE') ?? 'false') === 'true';
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodemailer = require('nodemailer');
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user && pass ? { auth: { user, pass } } : {}),
    }) as Transporter;
    return this.transporter;
  }

  async send(message: EmailMessage): Promise<void> {
    const from = this.config.get<string>('MAIL_FROM') ?? 'SEHLORO <no-reply@sehloro.dev>';
    await this.getTransporter().sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    this.logger.debug(`email enviado via smtp to=${message.to}`);
  }
}
