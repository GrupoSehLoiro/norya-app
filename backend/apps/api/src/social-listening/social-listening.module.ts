/**
 * SocialListeningModule (apps/api) — agrega Fase 3..7 do M4 IA core.
 *
 * Imports:
 *   - SocialListeningPersistenceModule (Mongo schemas)
 *   - AnalyticsModule (ClickHouse client)
 *   - LlmModule (mock/real/fallback driver)
 *   - CacheModule (já @Global) → ChatBuffer + EventBus + Redis token
 *   - SocialListeningInfraModule (RedisCopypastaDedup)
 */
import { Module } from '@nestjs/common';
import {
  PersistenceModule,
  SocialListeningPersistenceModule,
  SocialListeningInfraModule,
  AnalyticsModule,
  LlmModule,
  ReportLlmService,
  TwitchHelixService,
} from '@sehloro/infra';
import { SocialListeningController } from './social-listening.controller';
import { SocialListeningService } from './social-listening.service';
import { AdSegmentService } from './ad-segment.service';
import { AdSegmentController } from './ad-segment.controller';
import { BrandService } from './brand.service';
import { BrandCountsService } from './brand-counts.service';
import { BrandController } from './brand.controller';
import { TwitchAdBreakHandler } from './twitch-ad-break.handler';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BatchAnalysisWriter } from './batch-analysis.writer';
import { PublishInsightService } from './publish-insight.service';
import { SocialListeningOrchestrator } from './orchestrator.service';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';
import { StreamController } from './stream.controller';
import { LiveChatService } from './live-chat.service';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { InsightsReportService } from './insights-report.service';
import { ReportPdfService } from './report-pdf.service';
import { BatchesController } from './batches.controller';
import { MessageSearchService } from './message-search.service';
import { MessageSearchController } from './message-search.controller';
import { AdSummaryService } from './ad-summary.service';
import { AdSummaryController } from './ad-summary.controller';
import { BrandAnalyticsService } from './brand-analytics.service';
import { BrandAnalyticsController } from './brand-analytics.controller';
import { TopicsService } from './topics.service';
import { TopicsController } from './topics.controller';
import { BatchInsightService } from './batch-insight.service';
import { BatchInsightController } from './batch-insight.controller';
import { EmotesService } from './emotes.service';
import { EmotesController } from './emotes.controller';
import { HtmlPdfRendererService } from './html-pdf-renderer.service';
import { LlmResultCacheService } from './llm-result-cache.service';
import { LlmBudgetAdminController } from './llm-budget-admin.controller';

@Module({
  imports: [
    PersistenceModule, // CHANNEL_REPOSITORY pro orchestrator auto-discovery
    SocialListeningPersistenceModule,
    SocialListeningInfraModule.forRoot(),
    AnalyticsModule.forRootAsync(),
    LlmModule.forRootAsync(),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [
    SocialListeningController,
    AdSegmentController,
    BrandController,
    InsightsController,
    StreamController,
    MetricsController,
    BatchesController,
    MessageSearchController,
    AdSummaryController,
    BrandAnalyticsController,
    TopicsController,
    BatchInsightController,
    EmotesController,
    LlmBudgetAdminController,
  ],
  providers: [
    SocialListeningService,
    AdSegmentService,
    BrandService,
    BrandCountsService,
    TwitchAdBreakHandler,
    // ConfigsLoaderService vem exportado do SocialListeningPersistenceModule
    BatchAnalysisWriter,
    PublishInsightService,
    SocialListeningOrchestrator,
    InsightsService,
    LiveChatService,
    MetricsService,
    // Cache de resultados de IA sob demanda (topics/relatório) — Redis ou memória.
    LlmResultCacheService,
    ReportLlmService,
    InsightsReportService,
    ReportPdfService,
    HtmlPdfRendererService,
    MessageSearchService,
    AdSummaryService,
    BrandAnalyticsService,
    TopicsService,
    BatchInsightService,
    EmotesService,
    // Instância própria (mesma decisão do MonitoringModule): token de app é
    // barato e o serviço não guarda estado além do cache do token.
    {
      provide: TwitchHelixService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const clientId = config.get<string>('TWITCH_CLIENT_ID') ?? '';
        const clientSecret = config.get<string>('TWITCH_CLIENT_SECRET') ?? '';
        return new TwitchHelixService(clientId, clientSecret);
      },
    },
  ],
  exports: [
    SocialListeningService,
    AdSegmentService,
    BrandService,
    SocialListeningOrchestrator,
    PublishInsightService,
  ],
})
export class SocialListeningModule {}
