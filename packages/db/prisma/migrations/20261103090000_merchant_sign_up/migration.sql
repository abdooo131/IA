-- Merchant self sign up: a sign up waits for admin approval; merchants made by admin are approved.

-- CreateEnum
CREATE TYPE "merchant_approval" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "approval" "merchant_approval" NOT NULL DEFAULT 'approved',
ADD COLUMN     "reject_reason" TEXT;

