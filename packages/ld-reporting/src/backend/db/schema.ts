import { index, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const ldReporting = pgSchema('ld_reporting');

export const datasets = ldReporting.table(
  'datasets',
  {
    id: text('id').primaryKey(),
    tenant_id: uuid('tenant_id'),
    scope: jsonb('scope').notNull(),
    sources: jsonb('sources').notNull(),
    normalized_json: jsonb('normalized_json').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('ld_datasets_created_at').on(t.created_at)],
);

export const reportRuns = ldReporting.table(
  'report_runs',
  {
    id: text('id').primaryKey(),
    tenant_id: uuid('tenant_id'),
    initiated_by: uuid('initiated_by'),
    status: text('status').notNull().default('DRAFT'),
    scope: jsonb('scope').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    finalized_at: timestamp('finalized_at', { withTimezone: true }),
  },
  (t) => [index('ld_report_runs_created_at').on(t.created_at)],
);

export const sourceReadiness = ldReporting.table('source_readiness', {
  id: text('id').primaryKey(),
  dataset_id: text('dataset_id').notNull(),
  result_json: jsonb('result_json').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const evidenceDecisions = ldReporting.table('evidence_decisions', {
  id: text('id').primaryKey(),
  dataset_id: text('dataset_id').notNull(),
  status: text('status').notNull(),
  result_json: jsonb('result_json').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const metricsSnapshots = ldReporting.table('metrics_snapshots', {
  id: text('id').primaryKey(),
  dataset_id: text('dataset_id').notNull(),
  metrics_json: jsonb('metrics_json').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const governanceViews = ldReporting.table('governance_views', {
  id: text('id').primaryKey(),
  report_id: text('report_id'),
  role: text('role').notNull(),
  view_json: jsonb('view_json').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const reportArtifacts = ldReporting.table('report_artifacts', {
  id: text('id').primaryKey(),
  report_json: jsonb('report_json').notNull(),
  pptx_path: text('pptx_path'),
  docx_path: text('docx_path'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  finalized_at: timestamp('finalized_at', { withTimezone: true }),
});

export const qnaLogs = ldReporting.table('qna_logs', {
  id: text('id').primaryKey(),
  report_id: text('report_id'),
  question: text('question'),
  answer_json: jsonb('answer_json').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
