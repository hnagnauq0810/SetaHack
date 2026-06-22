# Edge-case evidence

Generated from direct calls to `evaluateEvidence` and the report pipeline.

| ID | Case | Expected | Actual | Result |
|---|---|---|---|---|
| EC-001 | Missing attendance | BLOCKED | BLOCKED | PASS |
| EC-002 | Missing assessment | BLOCKED | BLOCKED | PASS |
| EC-003 | In-progress course | BLOCKED | BLOCKED | PASS |
| EC-004 | Insufficient feedback | PARTIAL_PASS | PARTIAL_PASS | PASS |
| EC-005 | Unknown course ID | BLOCKED | BLOCKED | PASS |
| EC-006 | Duplicate attendance | BLOCKED | BLOCKED | PASS |
| EC-007 | Invalid score and rating | BLOCKED | BLOCKED | PASS |
| EC-008 | LLM unavailable / deterministic fallback | FALLBACK | FALLBACK | PASS |

LLM fallback was verified from the generated report metadata with `LD_REPORTING_USE_LLM=false`.
