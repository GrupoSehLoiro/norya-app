/**
 * Porta de envio de email (Identity / notificações).
 *
 * Driver plugável, espelhando o padrão de `LLM_DRIVER`:
 *   EMAIL_DRIVER=log    (default) → LogEmailSender (loga; dev/local sem credencial)
 *   EMAIL_DRIVER=resend           → ResendEmailSender (API Resend)
 *
 * Injetar pelo símbolo `EMAIL_SENDER`. Adicionar SES/SMTP é só um novo
 * adapter implementando esta interface.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EmailSender');
