-- hand-written: drizzle-kit prompts for table conflicts in a non-TTY environment due to snapshot drift from prior hand-written migrations.
CREATE TABLE "planner"."task_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "author_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "edited_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "task_comments_body_not_empty" CHECK (length(btrim(body)) > 0),
  CONSTRAINT "task_comments_body_max_len" CHECK (length(body) <= 4000)
);

CREATE INDEX "task_comments_by_task_recent"
  ON "planner"."task_comments" ("task_id", "created_at" DESC)
  WHERE deleted_at IS NULL;
