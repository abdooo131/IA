-- Accounting UX phase A: saved list views, chosen columns, and the chatter's notes and activities.

CREATE TABLE "user_list_favorites" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "list_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_list_favorites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_list_prefs" (
    "user_id" TEXT NOT NULL,
    "list_key" TEXT NOT NULL,
    "columns" TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_list_prefs_pkey" PRIMARY KEY ("user_id","list_key")
);

CREATE TABLE "record_notes" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "record_activities" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "assignee_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "due_on" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "done_at" TIMESTAMP(3),
    "done_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_list_favorites_user_id_list_key_idx" ON "user_list_favorites"("user_id", "list_key");
CREATE UNIQUE INDEX "user_list_favorites_user_id_list_key_name_key" ON "user_list_favorites"("user_id", "list_key", "name");
CREATE INDEX "record_notes_entity_type_entity_id_created_at_idx" ON "record_notes"("entity_type", "entity_id", "created_at");
CREATE INDEX "record_activities_entity_type_entity_id_idx" ON "record_activities"("entity_type", "entity_id");
CREATE INDEX "record_activities_assignee_id_done_at_due_on_idx" ON "record_activities"("assignee_id", "done_at", "due_on");

ALTER TABLE "user_list_favorites" ADD CONSTRAINT "user_list_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_list_prefs" ADD CONSTRAINT "user_list_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "record_notes" ADD CONSTRAINT "record_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "record_activities" ADD CONSTRAINT "record_activities_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "record_activities" ADD CONSTRAINT "record_activities_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Notes are append only, like order events and the audit log.
CREATE TRIGGER "record_notes_append_only" BEFORE UPDATE OR DELETE ON "record_notes"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();
