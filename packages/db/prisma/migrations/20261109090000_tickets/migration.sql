-- Internal tickets between team members, mirrored in Slack when connected; users get their Slack id.
-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('open', 'answered', 'closed');

-- CreateEnum
CREATE TYPE "ticket_priority" AS ENUM ('normal', 'urgent');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "slack_user_id" TEXT;

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "priority" "ticket_priority" NOT NULL DEFAULT 'normal',
    "status" "ticket_status" NOT NULL DEFAULT 'open',
    "created_by_id" TEXT NOT NULL,
    "assignee_id" TEXT NOT NULL,
    "related_type" TEXT,
    "related_id" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "read_at" TIMESTAMP(3),
    "answered_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "read_reminder_at" TIMESTAMP(3),
    "late_notice_at" TIMESTAMP(3),
    "slack_channel" TEXT,
    "slack_thread_ts" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "author_id" TEXT,
    "author_name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "slack_ts" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");

-- CreateIndex
CREATE INDEX "tickets_assignee_id_status_idx" ON "tickets"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "tickets_created_by_id_status_idx" ON "tickets"("created_by_id", "status");

-- CreateIndex
CREATE INDEX "tickets_status_due_at_idx" ON "tickets"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_slack_channel_slack_thread_ts_key" ON "tickets"("slack_channel", "slack_thread_ts");

-- CreateIndex
CREATE INDEX "ticket_messages_ticket_id_created_at_idx" ON "ticket_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_messages_ticket_id_slack_ts_key" ON "ticket_messages"("ticket_id", "slack_ts");

-- CreateIndex
CREATE UNIQUE INDEX "users_slack_user_id_key" ON "users"("slack_user_id");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Ticket messages are history: never changed or removed.
CREATE TRIGGER "ticket_messages_append_only" BEFORE UPDATE OR DELETE ON "ticket_messages"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();
