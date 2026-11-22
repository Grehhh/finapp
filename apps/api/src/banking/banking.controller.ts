import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { BankingService } from './banking.service.js';
import { PublicRoute } from '../security/api-token.guard.js';

interface StartConnectionBody {
  bankName?: string;
  countryCode?: string;
}

@Controller('banking')
export class BankingController {
  constructor(private readonly bankingService: BankingService) {}

  @Post('mock/seed')
  seedMockData() {
    if (
      process.env.FINAPP_ENV !== 'staging' ||
      process.env.BANKING_MOCK_ENABLED !== 'true'
    ) {
      throw new NotFoundException();
    }
    return this.bankingService.seedMockData();
  }

  @Get('institutions')
  listInstitutions(@Query('country') country = 'ES') {
    return this.bankingService.listInstitutions(country);
  }

  @Post('connections')
  startConnection(@Body() body: StartConnectionBody) {
    return this.bankingService.startConnection({
      bankName: body?.bankName ?? '',
      countryCode: body?.countryCode ?? 'ES',
    });
  }

  @Get('connections')
  listConnections() {
    return this.bankingService.listConnections();
  }

  @Delete('connections/:id')
  disconnectConnection(@Param('id') connectionId: string) {
    return this.bankingService.disconnectConnection(connectionId);
  }

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @PublicRoute()
  async completeConnection(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    if (!state) throw new BadRequestException('Missing authorization state.');
    await this.bankingService.completeConnection({ code, state, error });
    return { message: 'Bank authorization completed. You can return to Finapp.' };
  }

  @Get('accounts')
  listAccounts() {
    return this.bankingService.listAccounts();
  }

  @Get('transactions')
  listTransactions(
    @Query('accountId') accountId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.bankingService.listTransactions({ accountId, from, to, limit });
  }

  @Post('sync')
  syncAllAccounts() {
    return this.bankingService.syncAllAccounts();
  }

  @Post('accounts/:id/sync')
  syncAccount(@Param('id') accountId: string) {
    return this.bankingService.syncAccount(accountId);
  }
}
