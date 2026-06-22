# L&D Reporting automated test summary

- Command: `pnpm -F @seta/ld-reporting test`
- Test files: 5
- Tests: 27/27 passed; 0 failed; 0 pending.
- Evidence Gate tests: 16/16 passed.
- Independent KPI checks: 9/9 within declared precision tolerance; 8/9 exact matches.

## Test case list

| ID | Scenario | Status | Duration (ms) | Source |
|---|---|---|---:|---|
| TC-001 | DOCX report typography uses a readable professional scale and spacing | PASS | 4.321199999999976 | tests/artifact-writer.test.ts |
| TC-002 | ld-reporting evidence gate passes completed Q1 data from the default workbook | PASS | 211.79589999999985 | tests/evidence-gate.test.ts |
| TC-003 | ld-reporting evidence gate blocks when a required source sheet is missing | PASS | 64.22350000000006 | tests/evidence-gate.test.ts |
| TC-004 | ld-reporting evidence gate blocks when a required column is missing | PASS | 48.43360000000007 | tests/evidence-gate.test.ts |
| TC-005 | ld-reporting evidence gate blocks final conclusion for an in-progress course | PASS | 67.29759999999987 | tests/evidence-gate.test.ts |
| TC-006 | ld-reporting evidence gate blocks conflicting scope filters that match no courses | PASS | 71.40779999999995 | tests/evidence-gate.test.ts |
| TC-007 | ld-reporting evidence gate blocks completed courses with missing attendance rows | PASS | 73.81320000000005 | tests/evidence-gate.test.ts |
| TC-008 | ld-reporting evidence gate blocks completed courses with missing assessment rows | PASS | 58.70420000000013 | tests/evidence-gate.test.ts |
| TC-009 | ld-reporting evidence gate warns but still allows final conclusion when feedback response is below threshold | PASS | 45.261600000000044 | tests/evidence-gate.test.ts |
| TC-010 | ld-reporting evidence gate blocks pass status values that conflict with score threshold | PASS | 47.775100000000066 | tests/evidence-gate.test.ts |
| TC-011 | ld-reporting evidence gate blocks cross-source rows that reference an unknown course id | PASS | 59.92690000000016 | tests/evidence-gate.test.ts |
| TC-012 | ld-reporting evidence gate blocks duplicate attendance rows | PASS | 56.757499999999936 | tests/evidence-gate.test.ts |
| TC-013 | ld-reporting evidence gate blocks duplicate assessment rows | PASS | 41.6259 | tests/evidence-gate.test.ts |
| TC-014 | ld-reporting evidence gate blocks null assessment values in completed courses | PASS | 49.71580000000017 | tests/evidence-gate.test.ts |
| TC-015 | ld-reporting evidence gate blocks score values outside the 0-10 range | PASS | 54.60709999999972 | tests/evidence-gate.test.ts |
| TC-016 | ld-reporting evidence gate warns for feedback ratings outside the 1-5 range | PASS | 53.23120000000017 | tests/evidence-gate.test.ts |
| TC-017 | ld-reporting evidence gate blocks negative cost values | PASS | 39.708900000000085 | tests/evidence-gate.test.ts |
| TC-018 | L&D report finalization HTTP contract returns 409 when blocked evidence is approved | PASS | 1576.6744999999999 | tests/http.test.ts |
| TC-019 | ld-reporting pipeline generates a report for completed Q1 courses | PASS | 2101.9476000000004 | tests/ld-reporting.test.ts |
| TC-020 | ld-reporting pipeline blocks final conclusion for in-progress courses | PASS | 733.1152999999999 | tests/ld-reporting.test.ts |
| TC-021 | ld-reporting pipeline blocks finalization when report quality is not PASS | PASS | 1204.3799 | tests/ld-reporting.test.ts |
| TC-022 | ld-reporting pipeline accepts natural course names as course scope in chat-style requests | PASS | 693.7836000000007 | tests/ld-reporting.test.ts |
| TC-023 | ld-reporting pipeline masks learner-level view for BOD | PASS | 1186.3831999999993 | tests/ld-reporting.test.ts |
| TC-024 | ld-reporting pipeline turns a score comparison into a business interpretation and recommendation | PASS | 1222.4368000000004 | tests/ld-reporting.test.ts |
| TC-025 | ld-reporting pipeline keeps BOD on finalized reports while L&D Manager can review drafts | PASS | 2277.7842999999993 | tests/ld-reporting.test.ts |
| TC-026 | ld-reporting pipeline supports unsaved preview drafts and saving drafts | PASS | 1422.2405000000017 | tests/ld-reporting.test.ts |
| TC-027 | report recommendations gives every expected outcome a measurable baseline and target | PASS | 2119.8656 | tests/report-model.test.ts |
| TC-028 | Independent KPI validation: totalCourses | PASS | N/A | expected=3, actual=3, delta=0, tolerance=0 |
| TC-029 | Independent KPI validation: traineeCount | PASS | N/A | expected=59, actual=59, delta=0, tolerance=0 |
| TC-030 | Independent KPI validation: attendanceRate | PASS | N/A | expected=0.9288, actual=0.9288, delta=0, tolerance=0.0001 |
| TC-031 | Independent KPI validation: completionRate | PASS | N/A | expected=0.9831, actual=0.9831, delta=0, tolerance=0.0001 |
| TC-032 | Independent KPI validation: passRate | PASS | N/A | expected=0.8983, actual=0.8983, delta=0, tolerance=0.0001 |
| TC-033 | Independent KPI validation: averageScore | PASS | N/A | expected=7.59, actual=7.59, delta=0, tolerance=0.01 |
| TC-034 | Independent KPI validation: feedbackRating | PASS | N/A | expected=4.47, actual=4.48, delta=0.01, tolerance=0.01 |
| TC-035 | Independent KPI validation: trainingHours | PASS | N/A | expected=848, actual=848, delta=0, tolerance=0 |
| TC-036 | Independent KPI validation: effectivenessScore | PASS | N/A | expected=88.23, actual=88.23, delta=0, tolerance=0.01 |

## Manual evidence

Authenticated UI screenshots remain manual because this run did not create or bypass platform login sessions. See `../03_rbac-human-review/manual-rbac-checklist.md`. Domain and HTTP RBAC behavior is automated.
