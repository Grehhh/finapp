CREATE TYPE "BankConnectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'FAILED', 'REAUTH_REQUIRED');

CREATE TABLE "BankConnection" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'enablebanking',
    "providerAuthorizationId" TEXT,
    "providerSessionId" TEXT,
    "callbackState" TEXT,
    "bankName" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL DEFAULT 'ES',
    "status" "BankConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "accessValidUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BankConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "name" TEXT,
    "accountNumberLast4" CHAR(4),
    "currency" CHAR(3),
    "accountType" TEXT,
    "product" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankBalance" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "balanceType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "referenceDate" DATE,
    "lastChangedAt" TIMESTAMP(3),
    CONSTRAINT "BankBalance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "entryReference" TEXT,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" TEXT,
    "counterpartyName" TEXT,
    "merchantCategoryCode" TEXT,
    "transactionCode" TEXT,
    "status" TEXT,
    "bookingDate" DATE,
    "valueDate" DATE,
    "transactionDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BankConnection_providerAuthorizationId_key" ON "BankConnection"("providerAuthorizationId");
CREATE UNIQUE INDEX "BankConnection_providerSessionId_key" ON "BankConnection"("providerSessionId");
CREATE UNIQUE INDEX "BankConnection_callbackState_key" ON "BankConnection"("callbackState");
CREATE INDEX "BankConnection_status_idx" ON "BankConnection"("status");
CREATE UNIQUE INDEX "BankAccount_connectionId_providerAccountId_key" ON "BankAccount"("connectionId", "providerAccountId");
CREATE INDEX "BankAccount_connectionId_idx" ON "BankAccount"("connectionId");
CREATE UNIQUE INDEX "BankBalance_accountId_balanceType_currency_key" ON "BankBalance"("accountId", "balanceType", "currency");
CREATE INDEX "BankBalance_accountId_idx" ON "BankBalance"("accountId");
CREATE UNIQUE INDEX "BankTransaction_accountId_dedupeKey_key" ON "BankTransaction"("accountId", "dedupeKey");
CREATE INDEX "BankTransaction_accountId_bookingDate_idx" ON "BankTransaction"("accountId", "bookingDate");

ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankBalance" ADD CONSTRAINT "BankBalance_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
