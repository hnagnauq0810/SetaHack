import type { Course, LdScopeInput } from '../../models.ts';

export const REPORT_SCOPE_CLARIFICATION = 'Which period or course should I use for the report?';

export type ReportScopeIssue =
  | 'MISSING_SCOPE'
  | 'AMBIGUOUS_SCOPE'
  | 'CONFLICTING_SCOPE'
  | 'UNSUPPORTED_SCOPE'
  | 'MULTIPLE_COURSES';

export type ReportScopeValidation =
  | { ok: true }
  | { ok: false; code: ReportScopeIssue; fields: string[]; message: string };

export class LdReportingScopeError extends Error {
  readonly code = 'SCOPE_REQUIRED' as const;

  constructor(
    readonly reason: ReportScopeIssue,
    message = REPORT_SCOPE_CLARIFICATION,
    readonly candidates: Array<{ courseId: string; courseName: string }> = [],
  ) {
    super(message);
    this.name = 'LdReportingScopeError';
  }
}

export function validateReportScope(scope: LdScopeInput): ReportScopeValidation {
  const concreteFields = ['period', 'courseId', 'team', 'trainerId'] as const;
  const populatedFields = concreteFields.filter((field) => Boolean(scope[field]?.trim()));

  if (scope.allCourses === true && populatedFields.length > 0) {
    return {
      ok: false,
      code: 'CONFLICTING_SCOPE',
      fields: ['allCourses', ...populatedFields],
      message: REPORT_SCOPE_CLARIFICATION,
    };
  }
  if (scope.allCourses === true) return { ok: true };
  if (populatedFields.length === 0) {
    return {
      ok: false,
      code: 'MISSING_SCOPE',
      fields: [],
      message: REPORT_SCOPE_CLARIFICATION,
    };
  }

  if (scope.team) {
    return {
      ok: false,
      code: 'UNSUPPORTED_SCOPE',
      fields: ['team'],
      message: REPORT_SCOPE_CLARIFICATION,
    };
  }

  const ambiguousFields = populatedFields.filter((field) => {
    const value = scope[field];
    if (!value) return false;
    return field === 'period' ? !isConcretePeriod(value) : isVagueReference(field, value);
  });
  if (ambiguousFields.length > 0) {
    return {
      ok: false,
      code: 'AMBIGUOUS_SCOPE',
      fields: ambiguousFields,
      message: REPORT_SCOPE_CLARIFICATION,
    };
  }
  return { ok: true };
}

export function assertUnambiguousReportScope(scope: LdScopeInput): void {
  const validation = validateReportScope(scope);
  if (!validation.ok) throw new LdReportingScopeError(validation.code, validation.message);
}

export function assertSingleCourseMatch(scope: LdScopeInput, courses: Course[]): void {
  if (!scope.courseId || courses.length <= 1) return;
  const candidates = courses.map((course) => ({
    courseId: course.courseId,
    courseName: course.courseName,
  }));
  throw new LdReportingScopeError(
    'MULTIPLE_COURSES',
    `The course reference "${scope.courseId}" matches multiple courses. Which course should I use?`,
    candidates,
  );
}

function isConcretePeriod(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  return (
    /^\d{4}$/.test(normalized) ||
    /^\d{4}-(?:0[1-9]|1[0-2])$/.test(normalized) ||
    /^\d{4}-?Q[1-4]$/.test(normalized)
  );
}

function isVagueReference(field: 'courseId' | 'team' | 'trainerId', value: string): boolean {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return true;
  if (
    new Set([
      'it',
      'this',
      'that',
      'any',
      'whatever',
      'unknown',
      'unspecified',
      'none',
      'n/a',
      'current',
      'latest',
      'recent',
      'course',
      'training',
      'team',
      'trainer',
    ]).has(normalized)
  ) {
    return true;
  }
  if (/\s+(or|hoac)\s+|\s*\/\s*/.test(normalized)) return true;
  if (
    field === 'courseId' &&
    /^(this|that|current|latest|recent|previous|next)\b/.test(normalized)
  ) {
    return true;
  }
  if (field === 'team' && /^(my|our|the|this|that|current)\s+team$/.test(normalized)) return true;
  if (field === 'trainerId' && /^(my|our|the|this|that|current)\s+trainer$/.test(normalized)) {
    return true;
  }
  return /^(this|that|current|latest|recent|previous|next)\s+(course|team|trainer|period|quarter|year)$/.test(
    normalized,
  );
}
