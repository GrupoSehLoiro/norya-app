/**
 * BatchInsightService — insight sob demanda de UM bloco (batch) do feed.
 * Carrega as mensagens do batch (Mongo batch_messages) e pede ao Haiku um
 * insight curto. Sem IA → fallback com um resumo dos números.
 *
 * Custo: o batch é IMUTÁVEL, então o insight é gerado uma única vez e
 * persistido no próprio doc (`aiInsight`) — cliques repetidos e outros
 * viewers leem do Mongo, não pagam LLM de novo.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AiContextResolverService,
  BatchMessagesSchemaName,
  ReportLlmService,
} from '@sehloro/infra';

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
  /** Insight IA já gerado para este batch (cache permanente — batch é imutável). */
  aiInsight?: string;
}

/** Sample enviado ao LLM: 40 msgs × 120 chars (antes 60 sem cap de chars). */
const INSIGHT_SAMPLE_MSGS = 40;
const INSIGHT_MSG_MAX_CHARS = 120;

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

    // Cache permanente: o batch é imutável — se já tem insight IA, serve dele.
    if (doc.aiInsight) {
      return {
        batchId,
        channelId: doc.channelId,
        messageCount: msgs.length,
        insight: doc.aiInsight,
        aiEnabled: true,
      };
    }

    const sample = msgs
      .slice(0, INSIGHT_SAMPLE_MSGS)
      .map(
        (m) => `${m.isMod ? '[mod] ' : ''}${m.username}: ${m.text.slice(0, INSIGHT_MSG_MAX_CHARS)}`,
      )
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
        // Persiste pro próximo clique/viewer não pagar o LLM de novo.
        // Best-effort: falha aqui não derruba a resposta.
        await this.model
          .updateOne({ batchId }, { $set: { aiInsight: ai, aiInsightAt: new Date() } })
          .exec()
          .catch(() => undefined);
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
