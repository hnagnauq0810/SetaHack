# L&D Reporting Agent — Results & Metrics Evidence Pack

## Evaluation Date

2026-06-22T18:46:29.881Z

## Environment

- Node: v22.18.0 (repository target: Node 24 LTS)
- pnpm: 11.5.2
- OS: win32/x64
- Commit SHA: 8a4d99f
- LLM enabled: false
- Model: deterministic fallback; no external LLM call measured
- Dataset: `packages/ld-reporting/mock-data/LnD_07_Training_Effectiveness.xlsx`
- Test command: `pnpm -F @seta/ld-reporting test`
- Benchmark runs per operation: 5

## Results Overview

| Metric | Result | Evidence |
|---|---:|---|
| Automated test pass rate | 27/27 (100.0%) | `01_test-results/vitest-output.txt` |
| Output quality / metric accuracy | 9/9 within declared tolerance; 8/9 exact | `01_test-results/metrics-assertions.json` |
| Evidence Gate automated tests | 16/16 | `01_test-results/test-summary.md` |
| Processing speed | avg 1374.94 ms; p95 1596.87 ms (5 runs) | `02_benchmark/benchmark.csv` |
| Test coverage list | 27 automated scenarios | `01_test-results/test-summary.md` |
| Edge case handling | 8/8 | `05_edge-cases/edge-case-results.json` |
| RBAC/HITL runtime checks | 7/7 | `03_rbac-human-review/rbac-results.json` |
| Artifact generation | PASS — PPTX 412172 bytes; DOCX 180207 bytes | `04_artifacts/artifact-verification.txt` |

Metric accuracy uses an independent calculation from normalized rows. Feedback rating differs by 0.01 (4.47 raw-order calculation vs 4.48 pipeline result) because the pipeline rounds course ratings before overall aggregation; it passes the declared 0.01 display-precision tolerance and is not counted as an exact match.

## Before/After Efficiency Comparison

No observed or team-estimated manual baseline was supplied, so no time-saving percentage is claimed.

| Workflow Step | Manual Baseline | Agent Workflow (measured) | Evidence |
|---|---:|---:|---|
| Load and normalize data | Not measured | avg 38.79 ms | `02_benchmark/benchmark.csv` |
| Evidence Gate | Not measured | avg 4 ms | `02_benchmark/benchmark.csv` |
| Metric calculation | Not measured | avg 2.28 ms | `02_benchmark/benchmark.csv` |
| Complete draft + PPTX/DOCX | Not measured | avg 1374.94 ms | `02_benchmark/benchmark.csv` |
| Finalize state transition | Not measured | avg 1.5 ms | `02_benchmark/benchmark.csv` |

Efficiency improvement cannot be calculated until a real or explicitly team-estimated manual baseline is recorded.

## Evaluated Report Snapshot

- Report ID: rpt_20e6f8cc-c357-4a4d-8744-8c5cb556b73f
- Status: FINAL
- Evidence: PASS
- Quality: PASS
- Courses: 3
- Trainee-course records: 59
- Attendance: 0.9288
- Completion: 0.9831
- Pass rate: 0.8983
- Effectiveness score: 88.23

## Key Evidence Links

- Test output: `01_test-results/vitest-output.txt`
- Machine-readable tests: `01_test-results/vitest-results.json`
- Metric assertions: `01_test-results/metrics-assertions.json`
- Benchmark CSV: `02_benchmark/benchmark.csv`
- RBAC/HITL evidence: `03_rbac-human-review/rbac-api-test-output.txt`
- Generated PPTX: `04_artifacts/generated-report.pptx`
- Generated DOCX: `04_artifacts/generated-report.docx`
- Edge cases: `05_edge-cases/edge-case-results.json`

## Limitations

- Runtime is Node v22.18.0; repository target is Node 24 LTS.
- LLM was disabled, so benchmark measures deterministic fallback and excludes network/model latency.
- No authenticated UI screenshots were generated; API/domain checks and a manual screenshot checklist are provided instead.
- Manual processing baseline was not measured or provided, so no efficiency-improvement percentage is claimed.
- Benchmark is local development performance, not production load testing.
