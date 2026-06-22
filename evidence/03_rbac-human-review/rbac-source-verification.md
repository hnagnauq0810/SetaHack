# RBAC and human-review source verification

- Role masking and artifact-path removal: `packages/ld-reporting/src/backend/domain/access-control.ts` — `applyReportAccessView`.
- Manager/BOD finalized-only filtering: `packages/ld-reporting/src/backend/domain/orchestrator.ts` — `listReports`, `canUseReportForRole`.
- Evidence/quality finalize gate: `packages/ld-reporting/src/backend/domain/orchestrator.ts` — `ld_finalizeReport`.
- HTTP finalize endpoint and 409 mapping: `packages/ld-reporting/src/backend/http/index.ts`.
- BOD finalized-only Q&A: `packages/ld-reporting/src/backend/domain/orchestrator.ts` — `ld_answerQuestion`.
- Automated API contract: `packages/ld-reporting/tests/http.test.ts`.

See `rbac-api-test-output.txt` for runtime results. UI screenshots were not generated because this runner does not create or bypass authenticated user sessions.
