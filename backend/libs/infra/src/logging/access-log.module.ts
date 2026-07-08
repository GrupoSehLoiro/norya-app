/**
 * AccessLogModule — registra o schema `access_logs` e expõe o
 * AccessLogService para API (middleware + endpoint de consulta) e
 * worker (eventos EventSub). Pressupõe conexão Mongo raiz já feita
 * (PersistenceModule.forRootAsync no app).
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AccessLogSchema,
  AccessLogSchemaName,
} from '../persistence/mongoose/schemas/access-log.schema';
import { AccessLogService } from './access-log.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: AccessLogSchemaName, schema: AccessLogSchema }])],
  providers: [AccessLogService],
  exports: [AccessLogService],
})
export class AccessLogModule {}
