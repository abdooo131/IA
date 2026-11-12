-- New account kinds for the chart of accounts. Added on their own, because Postgres cannot
-- use a new enum value in the same transaction that adds it.
ALTER TYPE "ledger_account_type" ADD VALUE 'cash_box';
ALTER TYPE "ledger_account_type" ADD VALUE 'other_asset';
ALTER TYPE "ledger_account_type" ADD VALUE 'other_liability';
ALTER TYPE "ledger_account_type" ADD VALUE 'equity';
ALTER TYPE "ledger_account_type" ADD VALUE 'other_income';
ALTER TYPE "ledger_account_type" ADD VALUE 'expense';
