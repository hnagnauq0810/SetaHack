# L&D Training Effectiveness Reporting Module

This module implements the SETA HackAIthon Track 7 POC as a single specialist agent with deterministic tools and controlled report generation.

## Implemented pipeline

1. Load mock Excel workbook from `packages/ld-reporting/mock-data/LnD_07_Training_Effectiveness.xlsx`.
2. Map sheets to simulated sources:
   - `DS07_Attendance_Log` → Teams
   - `DS06_Course_Catalog`, `DS08_Assessment_Score` → OneDrive
   - `DS09_Feedback_Survey` → Forms
   - `DS10_Training_Cost_ROI` → KPI
   - `DS11_LnD_Training_NORM` → Rules
   - `DS12_Report_Template_Structure` → Template
3. Normalize dataset into course, trainee, attendance, score, feedback, cost, NORM, template sections.
4. Evidence Gate returns `PASS`, `PARTIAL_PASS`, or `BLOCKED`.
5. Metrics Service calculates trainee count, attendance, completion, pass rate, average score, feedback, hours, scaled cost, ROI proxy, effectiveness score.
6. Governance/RBAC applies L&D NORM rules and masks sensitive learner-level data for BOD/Team Manager views.
7. Report Builder creates validated report JSON plus presentation-ready PPTX and DOCX artifacts with data-driven charts.
8. Q&A answers only from saved report artifacts.
9. Human review finalizes or requests revision/regeneration.

## API

- `POST /api/ld-reporting/readiness`
- `POST /api/ld-reporting/reports`
- `GET /api/ld-reporting/reports/:id`
- `POST /api/ld-reporting/reports/:id/finalize`
- `POST /api/ld-reporting/qna`
- `GET /api/ld-reporting/reports/:id/download/pptx`
- `GET /api/ld-reporting/reports/:id/download/docx`

## Example payload

```json
{
  "scope": {
    "period": "2026-Q1",
    "reportType": "full"
  },
  "role": "LND_MANAGER"
}
```

Blocked course example:

```json
{
  "scope": {
    "courseId": "Leadership_06_2026"
  },
  "role": "LND_MANAGER"
}
```

## Frontend

Dashboard route: `/ld-reporting`

The chat-first page includes conversation history, a finalized-report inbox for BOD, a draft editor and human-review workflow for L&D Manager, artifact downloads, and report-grounded Q&A.

## Install / migrate / run

After pulling these changes, refresh dependencies and migrations:

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

If the server/worker fail with `schema_migrations behind`, run `pnpm db:migrate` again, because the module contributes a new migration file: `packages/ld-reporting/drizzle/0000_ld_reporting.sql`.

## Notes

- The POC uses file-backed artifact storage under `.data/ld-reporting` for report JSON, Q&A logs, PPTX and DOCX files. Database schema is included for production persistence alignment.
- `LD_REPORTING_STORAGE_DIR` can override the artifact directory.
- `dataFilePath` can be passed to API/tools to load a different workbook during testing.

## LLM usage

The L&D module now uses OpenAI when `OPENAI_API_KEY` is configured and `LD_REPORTING_USE_LLM` is not `false`.

- `ld_generateReport()` still calculates Evidence Gate, Metrics and Governance deterministically, then calls the LLM only to improve executive narrative, insights and recommendations from validated metrics.
- `ld_answerQuestion()` first creates a deterministic grounded fallback, then asks the LLM to answer from the validated report artifact only. RBAC masking is enforced in the prompt/context and individual learner details are removed for BOD/Team Manager roles.
- PPTX/DOCX generation remains deterministic for file structure and chart selection. PPTX uses PowerPoint-native charts and shapes; DOCX rasterizes charts to high-resolution PNG for broad Office compatibility. Narrative content comes from the LLM-enhanced report artifact, with deterministic fallback recorded in `report.llm`.

Recommended local env:

```env
OPENAI_API_KEY=sk-...
LD_REPORTING_USE_LLM=true
LD_REPORTING_LLM_MODEL=gpt-4o-mini
```
