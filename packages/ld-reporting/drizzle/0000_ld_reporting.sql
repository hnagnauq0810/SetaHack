CREATE SCHEMA IF NOT EXISTS "ld_reporting";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ld_reporting"."datasets" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid,
  "scope" jsonb NOT NULL,
  "sources" jsonb NOT NULL,
  "normalized_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ld_datasets_created_at" ON "ld_reporting"."datasets" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ld_reporting"."report_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid,
  "initiated_by" uuid,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "scope" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ld_report_runs_created_at" ON "ld_reporting"."report_runs" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ld_reporting"."source_readiness" (
  "id" text PRIMARY KEY NOT NULL,
  "dataset_id" text NOT NULL,
  "result_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ld_reporting"."evidence_decisions" (
  "id" text PRIMARY KEY NOT NULL,
  "dataset_id" text NOT NULL,
  "status" text NOT NULL,
  "result_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ld_reporting"."metrics_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "dataset_id" text NOT NULL,
  "metrics_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ld_reporting"."governance_views" (
  "id" text PRIMARY KEY NOT NULL,
  "report_id" text,
  "role" text NOT NULL,
  "view_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ld_reporting"."report_artifacts" (
  "id" text PRIMARY KEY NOT NULL,
  "report_json" jsonb NOT NULL,
  "pptx_path" text,
  "docx_path" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ld_reporting"."qna_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "report_id" text,
  "question" text,
  "answer_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
