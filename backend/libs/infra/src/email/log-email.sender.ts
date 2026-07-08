/**
 * LogEmailSender — driver default. Não envia email de verdade; loga o conteúdo
 * (incluindo o código) para dev/local. Em produção use EMAIL_DRIVER=resend.
 */
import { Injectable, Logger } from '@nestjs/common';
import { EmailMessage, EmailSender } from './email-sender.port';

@Injectable()
export class LogEmailSender implements EmailSender {
  private readonly logger = new Logger('EmailSender:log');

  async send(message: EmailMessage): Promise<void> {
    this.logger.log(`[EMAIL:log] to=${message.to} subject="${message.subject}"\n${message.text}`);
  }
}
