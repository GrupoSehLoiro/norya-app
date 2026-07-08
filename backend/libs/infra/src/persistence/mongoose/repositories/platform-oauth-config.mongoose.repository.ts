import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CryptoService } from '../../../crypto/crypto.service';
import {
  PlatformKind,
  PlatformOAuthConfigPersistence,
  PlatformOAuthConfigSchemaName,
} from '../schemas/platform-oauth-config.schema';

export interface PlatformOAuthConfig {
  platform: PlatformKind;
  clientId: string;
  clientSecret: string;
  updatedBy: string | null;
  updatedAt: Date | null;
}

export interface PlatformOAuthConfigMeta {
  platform: PlatformKind;
  configured: boolean;
  clientId: string | null;
  /** Quantos chars do secret pra mostrar mascarado (e.g. 4). */
  clientSecretMask: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
}

@Injectable()
export class PlatformOAuthConfigRepository {
  constructor(
    @InjectModel(PlatformOAuthConfigSchemaName)
    private readonly model: Model<PlatformOAuthConfigPersistence>,
    private readonly crypto: CryptoService,
  ) {}

  async upsert(args: {
    platform: PlatformKind;
    clientId: string;
    clientSecret: string;
    updatedBy: string | null;
  }): Promise<PlatformOAuthConfig> {
    const enc = {
      clientIdEnc: this.crypto.encryptField(args.clientId) ?? args.clientId,
      clientSecretEnc: this.crypto.encryptField(args.clientSecret) ?? args.clientSecret,
      updatedBy: args.updatedBy,
    };
    const doc = await this.model.findOneAndUpdate(
      { platform: args.platform },
      { $set: enc, $setOnInsert: { platform: args.platform } },
      { upsert: true, new: true },
    );
    return {
      platform: args.platform,
      clientId: args.clientId,
      clientSecret: args.clientSecret,
      updatedBy: doc?.updatedBy ?? null,
      updatedAt: doc?.get('updatedAt') ?? null,
    };
  }

  async get(platform: PlatformKind): Promise<PlatformOAuthConfig | null> {
    const doc = await this.model.findOne({ platform }).exec();
    if (!doc) return null;
    const clientId = this.crypto.decryptField(doc.clientIdEnc) ?? doc.clientIdEnc;
    const clientSecret = this.crypto.decryptField(doc.clientSecretEnc) ?? doc.clientSecretEnc;
    return {
      platform: doc.platform,
      clientId,
      clientSecret,
      updatedBy: doc.updatedBy ?? null,
      updatedAt: doc.get('updatedAt') ?? null,
    };
  }

  async meta(platform: PlatformKind): Promise<PlatformOAuthConfigMeta> {
    const cfg = await this.get(platform);
    if (!cfg) {
      return {
        platform,
        configured: false,
        clientId: null,
        clientSecretMask: null,
        updatedBy: null,
        updatedAt: null,
      };
    }
    return {
      platform,
      configured: true,
      clientId: cfg.clientId,
      clientSecretMask: maskSecret(cfg.clientSecret),
      updatedBy: cfg.updatedBy,
      updatedAt: cfg.updatedAt,
    };
  }

  async delete(platform: PlatformKind): Promise<void> {
    await this.model.deleteOne({ platform }).exec();
  }
}

function maskSecret(s: string): string {
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}
