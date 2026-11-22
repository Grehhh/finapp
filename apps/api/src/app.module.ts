import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BankingModule } from './banking/banking.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ApiTokenGuard } from './security/api-token.guard.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [PrismaModule, BankingModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ApiTokenGuard }],
})
export class AppModule {}
