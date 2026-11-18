import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getEnvConfig } from '../config/env';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private connected = false;

  isDbConnected(): boolean {
    return this.connected;
  }

  async checkHealth(): Promise<boolean> {
    if (!this.connected) {
      return false;
    }

    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async onModuleInit(): Promise<void> {
    const config = getEnvConfig();
    try {
      await this.$connect();
      await this.$queryRaw`SELECT 1`;
      this.connected = true;
      this.logger.log('Connected to PostgreSQL database');
    } catch (err: unknown) {
      this.connected = false;
      const message = err instanceof Error ? err.message : String(err);

      if (config.requireDb) {
        this.logger.error(`PostgreSQL connection failed (REQUIRE_DB=true): ${message}`);
        throw err;
      }

      this.logger.warn(
        `PostgreSQL unavailable (${message}). Running in non-persistent fallback mode because REQUIRE_DB=false.`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connected) {
      await this.$disconnect();
      this.connected = false;
    }
  }
}
