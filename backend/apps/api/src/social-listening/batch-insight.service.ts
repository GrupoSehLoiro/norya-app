/**
 * BatchInsightService — insight sob demanda de UM bloco (batch) do feed.
 * Carrega as mensagens do batch (Mongo batch_messages) e pede ao Haiku um
 * insight curto. Sem IA → fallback com um resumo dos números.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AiContextResolverService, BatchMessagesSchemaName, ReportLlmService } from '@sehloro/infra';

export interface BatchInsight {
  batchId: string;
  channelId: string;
  messageCount: number;
  insight: string;
  aiEnabled: boolean;
}

interface Msg {
  username: string;
  isMod?: boolean;
  text: string;
}
interface BatchDoc {
  batchId: string;
  channelId: string;
  messages: Msg[];
  messageCount?: number;
}

@Injectable()
export class BatchInsightService {
  constructor(
    @InjectModel(BatchMessagesSchemaName)
    private readonly model: Model<BatchDoc>,
    private readonly reportLlm: ReportLlmService,
    private readonly aiContext: AiContextResolverService,
  ) {}

  async forBatch(batchId: string): Promise<BatchInsight> {
    const doc = (await this.model.findOne({ batchId }).lean().exec()) as unknown as BatchDoc | null;
    if (!doc) throw new NotFoundException('Batch não encontrado');

    const msgs = doc.messages ?? [];
    const sample = msgs
      .slice(0, 60)
      .map((m) => `${m.isMod ? '[mod] ' : ''}${m.username}: ${m.text}`)
      .join('\n');

    let insight =
      msgs.length > 0
        ? `Bloco com ${msgs.length} mensagens. Ative a IA (LLM_DRIVER=real) para um insight descritivo.`
        : 'Bloco sem mensagens.';
    let aiEnabled = false;

    if (msgs.length > 0) {
      const extraContext = (await this.aiContext.resolveForChannel(doc.channelId)) ?? undefined;
      const ai = await this.reportLlm.quickInsight({
        channelName: doc.channelId,
        context: `Mensagens do bloco:\n${sample}`,
        extraContext,
      });
      if (ai) {
        insight = ai;
        aiEnabled = true;
      }
    }

    return {
      batchId,
      channelId: doc.channelId,
      messageCount: msgs.length,
      insight,
      aiEnabled,
    };
  }
}
