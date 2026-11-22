import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, BankConnectionStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  EnableBankingAccount,
  EnableBankingBalance,
  EnableBankingClient,
  EnableBankingInstitution,
  EnableBankingTransaction,
} from './enable-banking.client.js';

const CALLBACK_STATE_TTL_MS = 15 * 60 * 1000;
const INCREMENTAL_SYNC_OVERLAP_DAYS = 7;

@Injectable()
export class BankingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: EnableBankingClient,
  ) {}

  async seedMockData() {
    const now = new Date();
    const mockTransactions = [
      {
        id: 'supermarket',
        amount: '-68.42',
        description: 'Compra supermercado (movimiento ficticio)',
        counterpartyName: 'Supermercado de ejemplo',
        merchantCategoryCode: '5411',
        daysAgo: 2,
      },
      {
        id: 'restaurant',
        amount: '-24.90',
        description: 'Comida fuera (movimiento ficticio)',
        counterpartyName: 'Restaurante de ejemplo',
        merchantCategoryCode: '5812',
        daysAgo: 5,
      },
      {
        id: 'salary',
        amount: '1850.00',
        description: 'Ingreso mensual (movimiento ficticio)',
        counterpartyName: 'Empresa de ejemplo',
        merchantCategoryCode: undefined,
        daysAgo: 8,
      },
    ];

    return this.prisma.$transaction(async (transaction) => {
      const connection = await transaction.bankConnection.upsert({
        where: { providerAuthorizationId: 'mock:finapp-sample-v1' },
        create: {
          provider: 'mock',
          providerAuthorizationId: 'mock:finapp-sample-v1',
          bankName: 'Finapp Mock Bank',
          countryCode: 'ES',
          status: BankConnectionStatus.ACTIVE,
          accessValidUntil: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
        },
        update: {
          bankName: 'Finapp Mock Bank',
          status: BankConnectionStatus.ACTIVE,
          accessValidUntil: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
        },
      });

      const account = await transaction.bankAccount.upsert({
        where: {
          connectionId_providerAccountId: {
            connectionId: connection.id,
            providerAccountId: 'mock-account-checking-001',
          },
        },
        create: {
          connectionId: connection.id,
          providerAccountId: 'mock-account-checking-001',
          name: 'Cuenta Corriente de Prueba',
          accountNumberLast4: '4242',
          currency: 'EUR',
          accountType: 'CHECKING',
          product: 'Cuenta personal ficticia',
          lastSyncedAt: now,
        },
        update: {
          name: 'Cuenta Corriente de Prueba',
          accountNumberLast4: '4242',
          currency: 'EUR',
          accountType: 'CHECKING',
          product: 'Cuenta personal ficticia',
          lastSyncedAt: now,
        },
      });

      await transaction.bankBalance.upsert({
        where: {
          accountId_balanceType_currency: {
            accountId: account.id,
            balanceType: 'CLBD',
            currency: 'EUR',
          },
        },
        create: {
          accountId: account.id,
          name: 'Saldo disponible ficticio',
          balanceType: 'CLBD',
          amount: new Prisma.Decimal('1482.73'),
          currency: 'EUR',
          referenceDate: this.mockDate(now, 0),
          lastChangedAt: now,
        },
        update: {
          name: 'Saldo disponible ficticio',
          amount: new Prisma.Decimal('1482.73'),
          referenceDate: this.mockDate(now, 0),
          lastChangedAt: now,
        },
      });

      for (const item of mockTransactions) {
        const dedupeKey = createHash('sha256')
          .update(`${account.id}|mock:${item.id}`)
          .digest('hex');
        const bookingDate = this.mockDate(now, item.daysAgo);

        await transaction.bankTransaction.upsert({
          where: {
            accountId_dedupeKey: { accountId: account.id, dedupeKey },
          },
          create: {
            accountId: account.id,
            dedupeKey,
            providerTransactionId: `mock-tx-${item.id}`,
            entryReference: `mock-ref-${item.id}`,
            amount: new Prisma.Decimal(item.amount),
            currency: 'EUR',
            description: item.description,
            counterpartyName: item.counterpartyName,
            merchantCategoryCode: item.merchantCategoryCode,
            status: 'BOOKED',
            bookingDate,
            valueDate: bookingDate,
            transactionDate: bookingDate,
          },
          update: {
            amount: new Prisma.Decimal(item.amount),
            currency: 'EUR',
            description: item.description,
            counterpartyName: item.counterpartyName,
            merchantCategoryCode: item.merchantCategoryCode,
            status: 'BOOKED',
            bookingDate,
            valueDate: bookingDate,
            transactionDate: bookingDate,
          },
        });
      }

      return {
        mock: true,
        connectionId: connection.id,
        accountId: account.id,
        transactionsSeeded: mockTransactions.length,
        message: 'Fictional data seeded. No banking provider was contacted.',
      };
    });
  }

  private mockDate(now: Date, daysAgo: number): Date {
    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        Math.max(1, now.getUTCDate() - daysAgo),
      ),
    );
  }

  private isMockMode(): boolean {
    return (
      process.env.FINAPP_ENV === 'staging' &&
      process.env.BANKING_MOCK_ENABLED === 'true'
    );
  }

  listInstitutions(countryCode: string): Promise<EnableBankingInstitution[]> {
    const country = countryCode.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) {
      throw new BadRequestException('country must be a two-letter country code.');
    }
    if (this.isMockMode()) {
      return Promise.resolve([
        {
          name: 'Finapp Mock Bank',
          country: 'ES',
          bic: 'MOCKESMMXXX',
          psu_types: ['personal'],
          services: ['AIS'],
        },
      ]);
    }
    return this.provider.listInstitutions(country);
  }

  async startConnection(input: { bankName: string; countryCode: string }) {
    const bankName = input.bankName?.trim();
    const countryCode = input.countryCode?.trim().toUpperCase();
    const redirectUrl = process.env.ENABLE_BANKING_REDIRECT_URL;

    if (!bankName || !countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
      throw new BadRequestException('A bank name and two-letter country code are required.');
    }
    if (this.isMockMode()) {
      throw new BadRequestException(
        'Mock mode does not contact banks. Seed the fictional dataset with POST /banking/mock/seed.',
      );
    }
    if (!redirectUrl) {
      throw new BadRequestException(
        'Set ENABLE_BANKING_REDIRECT_URL to the callback URL registered with the provider.',
      );
    }

    const state = randomUUID();
    const connection = await this.prisma.bankConnection.create({
      data: { bankName, countryCode, callbackState: state },
    });

    try {
      const authorization = await this.provider.startAuthorization({
        bankName,
        countryCode,
        state,
        redirectUrl,
      });

      await this.prisma.bankConnection.update({
        where: { id: connection.id },
        data: { providerAuthorizationId: authorization.authorization_id },
      });

      return { authorizationUrl: authorization.url };
    } catch (error) {
      await this.prisma.bankConnection.update({
        where: { id: connection.id },
        data: { status: BankConnectionStatus.FAILED, callbackState: null },
      });
      throw error;
    }
  }

  async completeConnection(input: {
    code?: string;
    state?: string;
    error?: string;
  }) {
    if (this.isMockMode()) {
      throw new NotFoundException();
    }
    if (!input.state) throw new BadRequestException('Missing authorization state.');

    const connection = await this.prisma.bankConnection.findUnique({
      where: { callbackState: input.state },
    });
    if (!connection || connection.status !== BankConnectionStatus.PENDING) {
      throw new BadRequestException('The authorization state is invalid or expired.');
    }

    const expiresBefore = new Date(Date.now() - CALLBACK_STATE_TTL_MS);
    const claimed = await this.prisma.bankConnection.updateMany({
      where: {
        id: connection.id,
        callbackState: input.state,
        status: BankConnectionStatus.PENDING,
        createdAt: { gt: expiresBefore },
      },
      data: { status: BankConnectionStatus.FAILED, callbackState: null },
    });

    if (claimed.count !== 1) {
      await this.prisma.bankConnection.updateMany({
        where: {
          id: connection.id,
          callbackState: input.state,
          status: BankConnectionStatus.PENDING,
          createdAt: { lte: expiresBefore },
        },
        data: { status: BankConnectionStatus.FAILED, callbackState: null },
      });
      throw new BadRequestException('The authorization state has expired. Start again.');
    }

    if (input.error || !input.code) {
      throw new BadRequestException('Bank authorization was not completed.');
    }

    const session = await this.provider.authorizeSession(input.code);
    const activeConnection = await this.prisma.bankConnection.update({
      where: { id: connection.id },
      data: {
        providerSessionId: session.session_id,
        accessValidUntil: session.access?.valid_until
          ? new Date(session.access.valid_until)
          : null,
        status: BankConnectionStatus.ACTIVE,
        callbackState: null,
      },
    });

    const accounts = await Promise.all(
      (session.accounts ?? []).map((account) =>
        this.saveAccount(activeConnection.id, account),
      ),
    );
    await Promise.all(
      accounts.map((account) => this.syncAccount(account.id).catch(() => undefined)),
    );
  }

  async listAccounts() {
    const accounts = await this.prisma.bankAccount.findMany({
      include: {
        connection: { select: { bankName: true, countryCode: true, status: true } },
        balances: true,
      },
      orderBy: [{ connection: { bankName: 'asc' } }, { name: 'asc' }],
    });

    return accounts.map((account) => ({
      id: account.id,
      bank: account.connection.bankName,
      name: account.name,
      accountNumberLast4: account.accountNumberLast4,
      currency: account.currency,
      lastSyncedAt: account.lastSyncedAt,
      connectionStatus: account.connection.status,
      balances: account.balances.map((balance) => ({
        name: balance.name,
        type: balance.balanceType,
        amount: balance.amount.toString(),
        currency: balance.currency,
        referenceDate: balance.referenceDate,
        lastChangedAt: balance.lastChangedAt,
      })),
    }));
  }

  listConnections() {
    return this.prisma.bankConnection.findMany({
      select: {
        id: true,
        bankName: true,
        countryCode: true,
        status: true,
        accessValidUntil: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async disconnectConnection(connectionId: string) {
    const connection = await this.prisma.bankConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection) throw new NotFoundException('Bank connection not found.');

    let providerConsentRevoked = true;
    if (connection.providerSessionId) {
      try {
        await this.provider.deleteSession(connection.providerSessionId);
      } catch {
        providerConsentRevoked = false;
      }
    }

    await this.prisma.bankConnection.delete({ where: { id: connection.id } });
    return {
      localDataDeleted: true,
      providerConsentRevoked,
    };
  }

  async listTransactions(input: {
    accountId?: string;
    from?: string;
    to?: string;
    limit?: number | string;
  }) {
    const from = this.parseDate(input.from, 'from');
    const to = this.parseDate(input.to, 'to');
    if (from && to && from > to) {
      throw new BadRequestException('from must be on or before to.');
    }

    const requestedLimit = input.limit === undefined ? 100 : Number(input.limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
      throw new BadRequestException('limit must be a positive integer.');
    }

    const rows = await this.prisma.bankTransaction.findMany({
      where: {
        ...(input.accountId ? { accountId: input.accountId } : {}),
        bookingDate: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      },
      include: { account: { include: { connection: true } } },
      orderBy: [{ bookingDate: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(requestedLimit, 500),
    });

    return rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      bank: row.account.connection.bankName,
      amount: row.amount.toString(),
      currency: row.currency,
      description: row.description,
      counterparty: row.counterpartyName,
      categoryCode: row.merchantCategoryCode,
      status: row.status,
      bookingDate: row.bookingDate,
      valueDate: row.valueDate,
      transactionDate: row.transactionDate,
    }));
  }

  async syncAllAccounts() {
    const accounts = await this.prisma.bankAccount.findMany({
      ...(this.isMockMode()
        ? { where: { connection: { provider: 'mock' } } }
        : {}),
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    const results = [];

    for (const account of accounts) {
      try {
        results.push(await this.syncAccount(account.id));
      } catch {
        results.push({ accountId: account.id, synced: false });
      }
    }

    return { accounts: results };
  }

  async syncAccount(accountId: string) {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: { connection: true },
    });
    if (!account) throw new NotFoundException('Bank account not found.');
    if (account.connection.provider === 'mock' && this.isMockMode()) {
      const syncedAt = new Date();
      await this.prisma.bankAccount.update({
        where: { id: account.id },
        data: { lastSyncedAt: syncedAt },
      });
      return {
        accountId: account.id,
        synced: true,
        transactionsFetched: 3,
        syncedAt,
        mock: true,
      };
    }
    if (
      account.connection.status !== BankConnectionStatus.ACTIVE ||
      !account.connection.providerSessionId
    ) {
      throw new BadRequestException('Reconnect this bank account before syncing.');
    }
    if (
      account.connection.accessValidUntil &&
      account.connection.accessValidUntil.getTime() <= Date.now()
    ) {
      await this.prisma.bankConnection.update({
        where: { id: account.connectionId },
        data: { status: BankConnectionStatus.REAUTH_REQUIRED },
      });
      throw new BadRequestException('Bank access has expired. Reconnect this account.');
    }

    const dateFrom = account.lastSyncedAt
      ? new Date(
          account.lastSyncedAt.getTime() -
            INCREMENTAL_SYNC_OVERLAP_DAYS * 24 * 60 * 60 * 1000,
        )
          .toISOString()
          .slice(0, 10)
      : undefined;
    const strategy = dateFrom ? 'default' : 'longest';
    const [balanceResponse, transactions] = await Promise.all([
      this.provider.getBalances(account.providerAccountId),
      this.provider.getTransactions(account.providerAccountId, { dateFrom, strategy }),
    ]);

    await this.saveBalances(account.id, balanceResponse.balances ?? []);
    await this.saveTransactions(account.id, transactions);
    const syncedAt = new Date();
    await this.prisma.bankAccount.update({
      where: { id: account.id },
      data: { lastSyncedAt: syncedAt },
    });

    return {
      accountId: account.id,
      synced: true,
      transactionsFetched: transactions.length,
      syncedAt,
    };
  }

  private saveAccount(connectionId: string, account: EnableBankingAccount) {
    const iban = account.account_id?.iban;
    const accountNumberLast4 = iban?.slice(-4);
    return this.prisma.bankAccount.upsert({
      where: {
        connectionId_providerAccountId: {
          connectionId,
          providerAccountId: account.uid,
        },
      },
      create: {
        connectionId,
        providerAccountId: account.uid,
        name: account.name ?? account.product ?? null,
        accountNumberLast4,
        currency: this.currency(account.currency),
        accountType: account.cash_account_type ?? account.usage ?? null,
        product: account.product ?? null,
      },
      update: {
        name: account.name ?? account.product ?? null,
        accountNumberLast4,
        currency: this.currency(account.currency),
        accountType: account.cash_account_type ?? account.usage ?? null,
        product: account.product ?? null,
      },
    });
  }

  private async saveBalances(accountId: string, balances: EnableBankingBalance[]) {
    for (const balance of balances) {
      const amount = balance.balance_amount?.amount;
      const currency = this.currency(balance.balance_amount?.currency);
      if (amount === undefined || !currency) continue;

      const balanceType = balance.balance_type ?? 'UNKNOWN';
      await this.prisma.bankBalance.upsert({
        where: {
          accountId_balanceType_currency: { accountId, balanceType, currency },
        },
        create: {
          accountId,
          name: balance.name ?? balanceType,
          balanceType,
          amount: new Prisma.Decimal(amount),
          currency,
          referenceDate: this.parseDate(balance.reference_date, 'reference_date'),
          lastChangedAt: this.parseDateTime(balance.last_change_date_time),
        },
        update: {
          name: balance.name ?? balanceType,
          amount: new Prisma.Decimal(amount),
          referenceDate: this.parseDate(balance.reference_date, 'reference_date'),
          lastChangedAt: this.parseDateTime(balance.last_change_date_time),
        },
      });
    }
  }

  private async saveTransactions(
    accountId: string,
    transactions: EnableBankingTransaction[],
  ) {
    for (const transaction of transactions) {
      const amountValue = transaction.transaction_amount?.amount;
      const currency = this.currency(transaction.transaction_amount?.currency);
      if (amountValue === undefined || !currency) continue;

      const description = [
        ...(transaction.remittance_information ?? []),
        transaction.bank_transaction_code?.description,
      ]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(' · ')
        .slice(0, 2000);
      const counterpartyName =
        transaction.credit_debit_indicator === 'DBIT'
          ? transaction.creditor?.name
          : transaction.debtor?.name;
      const amount = new Prisma.Decimal(amountValue).abs();
      const signedAmount =
        transaction.credit_debit_indicator === 'DBIT'
          ? amount.negated()
          : transaction.credit_debit_indicator === 'CRDT'
            ? amount
            : new Prisma.Decimal(amountValue);
      const stableReference =
        transaction.transaction_id ??
        transaction.entry_reference ??
        transaction.reference_number ??
        [
          transaction.booking_date,
          transaction.transaction_date,
          amountValue,
          currency,
          description,
          counterpartyName,
        ].join('|');
      const dedupeKey = createHash('sha256')
        .update(`${accountId}|${stableReference}`)
        .digest('hex');

      await this.prisma.bankTransaction.upsert({
        where: { accountId_dedupeKey: { accountId, dedupeKey } },
        create: {
          accountId,
          dedupeKey,
          providerTransactionId: transaction.transaction_id,
          entryReference: transaction.entry_reference,
          amount: signedAmount,
          currency,
          description: description || null,
          counterpartyName: counterpartyName?.slice(0, 300),
          merchantCategoryCode: transaction.merchant_category_code,
          transactionCode: transaction.bank_transaction_code?.code,
          status: transaction.status,
          bookingDate: this.parseDate(transaction.booking_date, 'booking_date'),
          valueDate: this.parseDate(transaction.value_date, 'value_date'),
          transactionDate: this.parseDate(transaction.transaction_date, 'transaction_date'),
        },
        update: {
          amount: signedAmount,
          currency,
          description: description || null,
          counterpartyName: counterpartyName?.slice(0, 300),
          merchantCategoryCode: transaction.merchant_category_code,
          transactionCode: transaction.bank_transaction_code?.code,
          status: transaction.status,
          bookingDate: this.parseDate(transaction.booking_date, 'booking_date'),
          valueDate: this.parseDate(transaction.value_date, 'value_date'),
          transactionDate: this.parseDate(transaction.transaction_date, 'transaction_date'),
        },
      });
    }
  }

  private currency(value?: string): string | undefined {
    const normalized = value?.trim().toUpperCase();
    return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : undefined;
  }

  private parseDate(value: string | undefined, field: string): Date | undefined {
    if (!value) return undefined;
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    if (!match) throw new BadRequestException(`Invalid ${field} date from provider.`);
    const parsed = new Date(`${match[1]}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Invalid ${field} date from provider.`);
    }
    return parsed;
  }

  private parseDateTime(value?: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
}
