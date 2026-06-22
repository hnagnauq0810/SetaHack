# L&D Reporting Agent - Results & Metrics

Measured on local dev environment, 2026-06-22. Runtime used for benchmark: Node v22.18.0 on Windows. Repository target runtime remains Node 24 LTS.

Benchmark mode: `LD_REPORTING_USE_LLM=false` to measure the deterministic validated pipeline without OpenAI quota/network variability.

## Slide Summary

| Metric | Result | Concrete evidence |
|---|---:|---|
| Output quality / KPI accuracy | 100% | 9/9 headline KPI formulas independently recalculated and matched report output |
| Processing speed | 2.04s | Q1 draft report generated with DOCX/PPTX artifacts in 2043.97 ms |
| Evidence Gate correctness | 100% | 16/16 backend Evidence Gate test scenarios passed |
| Focused automated test coverage | 24/24 passed | 21 backend/domain tests + 3 UI tests |
| Edge case handling | 19 categories | Data readiness, scope, RBAC, edit/finalize, and export/image handling |
| Export artifact quality | PASS | PPTX: 13 slides, 1 native chart XML, 0 SVG media; DOCX: 4 PNG chart images, 0 SVG media |
| Human review + BOD delivery | PASS | Draft can be edited/finalized by L&D Manager; BOD sees/downloads/Q&As only finalized reports |
| Workspace type safety | 26/26 packages | `pnpm typecheck` succeeded across workspace |

## Business Result Snapshot

- Report scope: 2026-Q1, 3 completed courses, 59 trainee-course records.
- Attendance: 92.9%.
- Completion: 98.3%.
- Pass rate: 89.8%.
- Average score: 7.59/10.
- Feedback rating: 4.48/5.
- Training hours: 848.
- Overall effectiveness score: 88.23/100.
- Governance classification: Risk.
- NORM flags: 8 total, 7 high priority.

## Processing Speed Detail

| Step | Measured time |
|---|---:|
| Evidence Gate readiness | 153.06 ms |
| Generate report + DOCX/PPTX artifacts | 2043.97 ms |
| Manual review finalize state transition | 2.19 ms |
| BOD DOCX export after finalize | 1126.35 ms |
| BOD PPTX export after finalize | 33.96 ms |
| BOD Q&A from finalized report portfolio | 3.97 ms |

## KPI Formula Validation

Independent recalculation matched 9/9 headline metrics:

| Metric | Expected | Actual |
|---|---:|---:|
| totalCourses | 3 | 3 |
| traineeCount | 59 | 59 |
| attendanceRate | 0.9288 | 0.9288 |
| completionRate | 0.9831 | 0.9831 |
| passRate | 0.8983 | 0.8983 |
| averageScore | 7.59 | 7.59 |
| feedbackRating | 4.48 | 4.48 |
| trainingHours | 848 | 848 |
| effectivenessScore | 88.23 | 88.23 |

Important business-rule evidence: completion rate was independently recalculated as learners with attendanceRate >= 70%, while pass rate was recalculated separately from assessment passStatus.

## Evidence Gate Scenario Samples

| Scenario | Expected | Actual | Result |
|---|---|---|---|
| completed_q1_default_workbook | PASS | PASS | PASS |
| in_progress_leadership_course | BLOCKED | BLOCKED | PASS |
| natural_course_name_ai_agent | PASS | PASS | PASS |
| conflicting_period_course_scope | BLOCKED | BLOCKED | PASS |

Automated Evidence Gate tests additionally cover:

- missing required source sheet
- missing required column
- in-progress course
- no courses in scope
- missing attendance
- missing assessment
- insufficient feedback
- score/pass-status inconsistency
- unknown course references across sources
- duplicate attendance rows
- duplicate assessment rows
- missing score
- invalid score range
- invalid rating range
- invalid cost value

## Slide Talk Track, 1:30

The key result is that the system is not only generating text; it is enforcing a governed reporting workflow. On output quality, 9 out of 9 headline KPI formulas were independently recalculated and matched the generated report, including the corrected completion rule where completion is based on attendance of at least 70%, not pass rate.

For reliability, our focused L&D test suite passed 24 out of 24 scenarios. This includes 16 Evidence Gate scenarios, BOD finalized-only access, manual draft editing, human review finalization, Q&A from finalized reports, and DOCX/PPTX export checks.

For speed, the deterministic validated pipeline generated a Q1 report with DOCX and PPTX artifacts in 2.04 seconds on local dev. Evidence Gate took 153 ms, BOD DOCX export after finalize took 1.13 seconds, and PPTX export took 34 ms.

For production readiness, the system handles 19 edge categories across data readiness, invalid scope, in-progress courses, RBAC, draft/finalized separation, edit restrictions, and export rendering. The generated PPTX contains 13 slides with native chart XML and no broken SVG media; the DOCX uses PNG chart images and no SVG media.

## Evidence Files

- Dashboard image: `.data/ld-reporting-results-metrics/evidence/results-metrics-dashboard-full.png`
- Dashboard HTML: `.data/ld-reporting-results-metrics/evidence/results-metrics-dashboard.html`
- Backend/domain test log: `.data/ld-reporting-results-metrics/evidence/backend-vitest.log`
- UI download/RBAC test log: `.data/ld-reporting-results-metrics/evidence/web-download-actions-vitest.log`
- Workspace typecheck log: `.data/ld-reporting-results-metrics/evidence/workspace-typecheck.log`
- Benchmark raw JSON: `.data/ld-reporting-results-metrics/evidence/benchmark-results.json`
- KPI validation raw JSON: `.data/ld-reporting-results-metrics/evidence/kpi-formula-validation.json`
- Sample generated PPTX: `.data/ld-reporting-results-metrics/evidence/sample-final-report.pptx`
- Sample generated DOCX: `.data/ld-reporting-results-metrics/evidence/sample-final-report.docx`
