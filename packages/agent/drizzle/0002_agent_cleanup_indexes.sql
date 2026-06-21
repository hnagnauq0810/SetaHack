-- Drizzle cannot model: partial index (WHERE status = 'pending') used by the sweeper and
-- list-my-pending-approvals queries to efficiently scan only open approvals.
CREATE INDEX "workflow_approvals_pending_expires_idx"
  ON "agent"."workflow_approvals" ("expires_at")
  WHERE status = 'pending';

-- Drizzle cannot model: cleanup index on window_start used by the rate-limit cleanup job
-- to efficiently delete expired rate-limit windows without a full table scan.
CREATE INDEX "rl_cleanup_window"
  ON "agent"."rate_limits" ("window_start");
