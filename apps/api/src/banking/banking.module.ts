import { Module } from '@nestjs/common';
import { BankingController } from './banking.controller.js';
import { BankingService } from './banking.service.js';
import { EnableBankingClient } from './enable-banking.client.js';

@Module({
  controllers: [BankingController],
  providers: [BankingService, EnableBankingClient],
})
export class BankingModule {}
