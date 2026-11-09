-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "platform";

-- CreateEnum
CREATE TYPE "platform"."UserKind" AS ENUM ('staff', 'agent_person', 'agent_manager', 'merchant_user');

-- CreateEnum
CREATE TYPE "platform"."DeliveryStatus" AS ENUM ('pending', 'done', 'dead');

-- CreateTable
CREATE TABLE "platform"."users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT,
    "password_hash" TEXT NOT NULL,
    "kind" "platform"."UserKind" NOT NULL DEFAULT 'staff',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "role_id" TEXT NOT NULL,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."job_roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,

    CONSTRAINT "job_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."role_access" (
    "role_id" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "level" TEXT NOT NULL,

    CONSTRAINT "role_access_pkey" PRIMARY KEY ("role_id","app")
);

-- CreateTable
CREATE TABLE "platform"."user_sites" (
    "user_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,

    CONSTRAINT "user_sites_pkey" PRIMARY KEY ("user_id","site_id")
);

-- CreateTable
CREATE TABLE "platform"."settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "platform"."audit_log" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."idempotency_records" (
    "key" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key","user_id")
);

-- CreateTable
CREATE TABLE "platform"."outbox_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "key" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."event_deliveries" (
    "event_id" TEXT NOT NULL,
    "handler" TEXT NOT NULL,
    "status" "platform"."DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_deliveries_pkey" PRIMARY KEY ("event_id","handler")
);

-- CreateTable
CREATE TABLE "platform"."companies" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "tax_number" TEXT,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."cost_centres" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,

    CONSTRAINT "cost_centres_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "platform"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_mobile_key" ON "platform"."users"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "job_roles_key_key" ON "platform"."job_roles"("key");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "platform"."audit_log"("entity", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_key_key" ON "platform"."outbox_events"("key");

-- CreateIndex
CREATE INDEX "event_deliveries_status_next_at_idx" ON "platform"."event_deliveries"("status", "next_at");

-- CreateIndex
CREATE UNIQUE INDEX "companies_key_key" ON "platform"."companies"("key");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centres_code_key" ON "platform"."cost_centres"("code");

-- AddForeignKey
ALTER TABLE "platform"."users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "platform"."job_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."role_access" ADD CONSTRAINT "role_access_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "platform"."job_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."user_sites" ADD CONSTRAINT "user_sites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."event_deliveries" ADD CONSTRAINT "event_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "platform"."outbox_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."cost_centres" ADD CONSTRAINT "cost_centres_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "platform"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
