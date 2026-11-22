import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sign } from 'node:crypto';

const DEFAULT_API_URL = 'https://api.enablebanking.com';

export interface EnableBankingInstitution {
  name: string;
  country: string;
  bic?: string;
  logo?: string;
  psu_types?: string[];
  services?: string[];
}

export interface EnableBankingAccount {
  uid: string;
  name?: string;
  details?: string;
  usage?: string;
  cash_account_type?: string;
  product?: string;
  currency?: string;
  account_id?: {
    iban?: string;
    other?: { identification?: string; scheme_name?: string };
  };
}

export interface EnableBankingBalance {
  name?: string;
  balance_type?: string;
  balance_amount?: { amount?: string; currency?: string };
  reference_date?: string;
  last_change_date_time?: string;
}

export interface EnableBankingTransaction {
  transaction_id?: string;
  entry_reference?: string;
  reference_number?: string;
  transaction_amount?: { amount?: string; currency?: string };
  credit_debit_indicator?: string;
  status?: string;
  booking_date?: string;
  value_date?: string;
  transaction_date?: string;
  remittance_information?: string[];
  bank_transaction_code?: { code?: string; sub_code?: string; description?: string };
  merchant_category_code?: string;
  creditor?: { name?: string };
  debtor?: { name?: string };
}

export interface EnableBankingSession {
  session_id: string;
  accounts: EnableBankingAccount[];
  access?: { valid_until?: string };
}

interface EnableBankingAuthResponse {
  url: string;
  authorization_id: string;
}

@Injectable()
export class EnableBankingClient {
  private privateKey?: string;
  private readonly baseUrl =
    process.env.ENABLE_BANKING_API_URL?.replace(/\/$/, '') ?? DEFAULT_API_URL;

  async listInstitutions(country: string): Promise<EnableBankingInstitution[]> {
    const result = await this.request<{ aspsps: EnableBankingInstitution[] }>(
      `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal&service=AIS`,
    );

    return result.aspsps;
  }

  async startAuthorization(input: {
    bankName: string;
    countryCode: string;
    state: string;
    redirectUrl: string;
  }): Promise<EnableBankingAuthResponse> {
    const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const result = await this.request<EnableBankingAuthResponse>('/auth', {
      method: 'POST',
      body: JSON.stringify({
        access: {
          balances: true,
          transactions: true,
          valid_until: validUntil.toISOString(),
        },
        aspsp: { name: input.bankName, country: input.countryCode },
        state: input.state,
        redirect_url: input.redirectUrl,
        psu_type: 'personal',
      }),
    });

    if (!result.url || new URL(result.url).protocol !== 'https:') {
      throw new ServiceUnavailableException(
        'The banking provider returned an invalid authorization URL.',
      );
    }

    return result;
  }

  authorizeSession(code: string): Promise<EnableBankingSession> {
    return this.request<EnableBankingSession>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request<{ message: string }>(
      `/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE', allowNotFound: true },
    );
  }

  getBalances(accountId: string): Promise<{ balances: EnableBankingBalance[] }> {
    return this.request(
      `/accounts/${encodeURIComponent(accountId)}/balances`,
    );
  }

  async getTransactions(
    accountId: string,
    options: { dateFrom?: string; strategy: 'default' | 'longest' },
  ): Promise<EnableBankingTransaction[]> {
    const transactions: EnableBankingTransaction[] = [];
    let continuationKey: string | undefined;

    for (let page = 0; page < 50; page += 1) {
      const query = new URLSearchParams({ strategy: options.strategy });
      if (options.dateFrom) query.set('date_from', options.dateFrom);
      if (continuationKey) query.set('continuation_key', continuationKey);

      const result = await this.request<{
        transactions: EnableBankingTransaction[];
        continuation_key?: string;
      }>(
        `/accounts/${encodeURIComponent(accountId)}/transactions?${query.toString()}`,
      );

      transactions.push(...(result.transactions ?? []));
      continuationKey = result.continuation_key;
      if (!continuationKey) return transactions;
    }

    throw new ServiceUnavailableException(
      'The banking provider returned too many transaction pages.',
    );
  }

  private async request<T>(
    path: string,
    init: {
      method?: 'GET' | 'POST' | 'DELETE';
      body?: string;
      allowNotFound?: boolean;
    } = {},
  ): Promise<T> {
    const token = await this.createJwt();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Could not reach the banking provider.',
      );
    }

    if (!response.ok) {
      if (init.allowNotFound && response.status === 404) return {} as T;
      throw new ServiceUnavailableException(
        `The banking provider returned HTTP ${response.status}.`,
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ServiceUnavailableException(
        'The banking provider returned an unreadable response.',
      );
    }
  }

  private async createJwt(): Promise<string> {
    const appId = process.env.ENABLE_BANKING_APP_ID;
    const privateKeyPath = process.env.ENABLE_BANKING_PRIVATE_KEY_PATH;

    if (!appId || !privateKeyPath) {
      throw new ServiceUnavailableException(
        'Banking access is not configured. Set the Enable Banking app ID and private key path.',
      );
    }

    if (!this.privateKey) {
      try {
        this.privateKey = await readFile(resolve(process.cwd(), privateKeyPath), 'utf8');
      } catch {
        throw new ServiceUnavailableException(
          'Could not read the configured Enable Banking private key.',
        );
      }
    }
    const privateKey = this.privateKey;

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'enablebanking.com',
        aud: 'api.enablebanking.com',
        iat: now,
        exp: now + 60 * 60,
      }),
    ).toString('base64url');
    const unsignedToken = `${header}.${payload}`;
    const signature = sign('RSA-SHA256', Buffer.from(unsignedToken), privateKey)
      .toString('base64url');

    return `${unsignedToken}.${signature}`;
  }
}
