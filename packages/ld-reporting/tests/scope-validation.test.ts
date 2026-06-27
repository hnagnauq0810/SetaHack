import { describe, expect, it } from 'vitest';
import {
  assertUnambiguousReportScope,
  validateReportScope,
} from '../src/backend/domain/scope-validation.ts';

describe('L&D report scope validation', () => {
  it.each([
    [{}, 'MISSING_SCOPE'],
    [{ reportType: 'full' as const }, 'MISSING_SCOPE'],
    [{ period: 'latest' }, 'AMBIGUOUS_SCOPE'],
    [{ period: 'Q1' }, 'AMBIGUOUS_SCOPE'],
    [{ period: 'this quarter' }, 'AMBIGUOUS_SCOPE'],
    [{ period: 'around Q1' }, 'AMBIGUOUS_SCOPE'],
    [{ courseId: 'it' }, 'AMBIGUOUS_SCOPE'],
    [{ courseId: 'this course' }, 'AMBIGUOUS_SCOPE'],
    [{ courseId: 'latest AWS course' }, 'AMBIGUOUS_SCOPE'],
    [{ courseId: 'AWS or DevOps' }, 'AMBIGUOUS_SCOPE'],
    [{ team: 'current team' }, 'UNSUPPORTED_SCOPE'],
    [{ team: 'my team' }, 'UNSUPPORTED_SCOPE'],
    [{ team: 'Platform Engineering' }, 'UNSUPPORTED_SCOPE'],
    [{ trainerId: 'unknown' }, 'AMBIGUOUS_SCOPE'],
    [{ trainerId: 'the trainer' }, 'AMBIGUOUS_SCOPE'],
  ])('requires clarification for %j', (scope, code) => {
    expect(validateReportScope(scope)).toMatchObject({ ok: false, code });
    expect(() => assertUnambiguousReportScope(scope)).toThrow(
      'Which period or course should I use for the report?',
    );
  });

  it.each([
    { period: '2026-Q1' },
    { period: '2026-03' },
    { period: '2026' },
    { courseId: 'AIAgent_05_2026' },
    { courseId: 'AI Agent & LLM Application Development' },
    { trainerId: 'TR-005' },
    { allCourses: true },
  ])('accepts an explicit scope: %j', (scope) => {
    expect(validateReportScope(scope)).toEqual({ ok: true });
    expect(() => assertUnambiguousReportScope(scope)).not.toThrow();
  });

  it('does not treat allCourses=false as an explicit scope', () => {
    expect(validateReportScope({ allCourses: false })).toMatchObject({
      ok: false,
      code: 'MISSING_SCOPE',
    });
  });

  it('rejects allCourses combined with narrower filters', () => {
    expect(validateReportScope({ allCourses: true, period: '2026-Q1' })).toMatchObject({
      ok: false,
      code: 'CONFLICTING_SCOPE',
      fields: ['allCourses', 'period'],
    });
  });
});
