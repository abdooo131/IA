-- Loans come only from banks (owner, 2026-11-11): a new lender kind holding the bank's name.
ALTER TYPE "loan_lender" ADD VALUE IF NOT EXISTS 'bank' BEFORE 'supplier';
