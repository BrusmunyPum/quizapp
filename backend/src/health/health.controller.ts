import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GameService } from '../game/game.service';
import { getEnvConfig } from '../config/env';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameService: GameService,
  ) {}

  @Get()
  @HttpCode(200)
  async check() {
    const dbOk = await this.prisma.checkHealth();
    const { requireDb } = getEnvConfig();

    const payload = {
      status: dbOk ? 'ok' : requireDb ? 'error' : 'degraded',
      db: dbOk ? 'connected' : 'disconnected',
      activeRooms: this.gameService.getActiveRoomCount(),
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    if (!dbOk && requireDb) {
      throw new ServiceUnavailableException(payload);
    }

    return payload;
  }
}
