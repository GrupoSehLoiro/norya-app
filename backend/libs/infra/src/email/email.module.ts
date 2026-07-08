/**
 * EmailModule — provê `EMAIL_SENDER` selecionando o driver via env.
 *
 *   EMAIL_DRIVER=log (default) → LogEmailSender
 *   EMAIL_DRIVER=resend        → ResendEmailSender (RESEND_API_KEY exigido)
 *
 * @Global para qualquer bounded context injetar `@Inject(EMAIL_SENDER)`.
 * Espelha o padrão do LlmModule.
 */
import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EMAIL_SENDER } from './email-sender.port';
import { LogEmailSender } from './log-email.sender';
import { ResendEmailSender } from './resend-email.sender';
import { SmtpEmailSender } from './smtp-email.sender';

@Global()
@Module({})
export class EmailModule {
  static forRootAsync(): DynamicModule {
    return {
      module: EmailModule,
      imports: [ConfigModule],
      providers: [
        LogEmailSender,
        ResendEmailSender,
        SmtpEmailSender,
        {
          provide: EMAIL_SENDER,
          inject: [ConfigService, LogEmailSender, ResendEmailSender, SmtpEmailSender],
          useFactory: (
            config: ConfigService,
            log: LogEmailSender,
            resend: ResendEmailSender,
            smtp: SmtpEmailSender,
          ) => {
            const driver = config.get<string>('EMAIL_DRIVER') ?? 'log';
            if (driver === 'resend') return resend;
            if (driver === 'smtp') return smtp;
            return log;
          },
        },
      ],
      exports: [EMAIL_SENDER],
    };
  }
}
