import type {
  CostRecord,
  Course,
  EvidenceDecision,
  FeedbackRecord,
  MissingEvidenceItem,
  NormalizedDataset,
} from '../../models.ts';
import { id } from './utils.ts';

type EvidenceIssueType = MissingEvidenceItem['type'];
type EvidenceSeverity = MissingEvidenceItem['severity'];

const SHEETS = {
  attendance: 'DS07_Attendance_Log',
  assessment: 'DS08_Assessment_Score',
  feedback: 'DS09_Feedback_Survey',
  cost: 'DS10_Training_Cost_ROI',
  course: 'DS06_Course_Catalog',
} as const;

export function evaluateEvidence(dataset: NormalizedDataset): EvidenceDecision {
  const issues: MissingEvidenceItem[] = [];

  validateSources(dataset, issues);
  validateScopeHasCourses(dataset, issues);
  validateCourseStatus(dataset, issues);
  validateCourseValues(dataset, issues);
  validateCompleteness(dataset, issues);
  validateDuplicates(dataset, issues);
  validateCrossSourceConsistency(dataset, issues);
  validateRowValues(dataset, issues);

  const checklist: EvidenceDecision['checklist'] = [
    {
      check: 'Source availability and required columns',
      status: hasAnyType(issues, ['MISSING_SOURCE', 'MISSING_COLUMN']) ? 'FAIL' : 'PASS',
      detail: 'Required sheets and columns were mapped from Teams, OneDrive, Forms, KPI, Rules and Template sources.',
    },
    {
      check: 'Course status',
      status: hasAnyType(issues, ['NO_COURSES_IN_SCOPE', 'IN_PROGRESS_COURSE']) ? 'FAIL' : 'PASS',
      detail: courseStatusDetail(issues),
    },
    {
      check: 'Attendance completeness',
      status: hasType(issues, 'MISSING_ATTENDANCE', 'blocker')
        ? 'FAIL'
        : hasType(issues, 'MISSING_ATTENDANCE') || hasType(issues, 'INVALID_ATTENDANCE_STATUS')
          ? 'WARN'
          : 'PASS',
      detail: 'Expected attendance rows are trainee count x total sessions. Late is retained for metrics as partial attendance.',
    },
    {
      check: 'Assessment completeness',
      status: hasAnyType(issues, ['MISSING_ASSESSMENT', 'MISSING_SCORE', 'SCORE_INCONSISTENCY', 'INVALID_SCORE_RANGE'])
        ? 'FAIL'
        : 'PASS',
      detail: 'Completed courses require one valid assessment and pass-status row per trainee.',
    },
    {
      check: 'Feedback completeness',
      status: hasAnyType(issues, ['INSUFFICIENT_FEEDBACK', 'INVALID_RATING_RANGE', 'DUPLICATE_FEEDBACK']) ? 'WARN' : 'PASS',
      detail: 'NORM-14 requires at least 60% feedback response rate for valid analysis.',
    },
    {
      check: 'Row-level data quality',
      status: hasAnyType(issues, ['DUPLICATE_ATTENDANCE', 'DUPLICATE_ASSESSMENT', 'INVALID_COURSE_VALUE', 'INVALID_COST_VALUE'])
        ? 'FAIL'
        : 'PASS',
      detail: 'Duplicate rows and numeric ranges were checked before metric generation.',
    },
    {
      check: 'Consistency: course ID and pass-status logic',
      status: hasAnyType(issues, ['CONSISTENCY_ERROR', 'SCORE_INCONSISTENCY']) ? 'FAIL' : 'PASS',
      detail: 'Cross-source course IDs and pass-status logic were checked against the selected course catalog.',
    },
  ];

  const hasBlocker = issues.some((item) => item.severity === 'blocker');
  const hasWarning = issues.some((item) => item.severity === 'warning');
  const status = hasBlocker ? 'BLOCKED' : hasWarning ? 'PARTIAL_PASS' : 'PASS';

  return {
    evidenceId: id('ev'),
    datasetId: dataset.datasetId,
    status,
    generatedAt: new Date().toISOString(),
    missingEvidence: issues,
    checklist,
    canGenerateFinalConclusion: !hasBlocker,
  };
}

function validateSources(dataset: NormalizedDataset, issues: MissingEvidenceItem[]): void {
  for (const source of dataset.sources) {
    if (source.required && !source.present) {
      addIssue(issues, {
        type: 'MISSING_SOURCE',
        severity: 'blocker',
        source: source.source,
        sheetName: source.sheetName,
        message: `Required source ${source.source}/${source.sheetName} is missing.`,
        expected: 'Required source sheet is present.',
        actual: 'Missing',
        recommendedFix: `Restore or reconnect ${source.sheetName} before generating the final report.`,
        ownerRole: 'DATA_OWNER',
      });
    }
    if (source.missingColumns.length > 0) {
      addIssue(issues, {
        type: 'MISSING_COLUMN',
        severity: 'blocker',
        source: source.source,
        sheetName: source.sheetName,
        field: source.missingColumns.join(', '),
        message: `${source.sheetName} is missing columns: ${source.missingColumns.join(', ')}.`,
        affectedCount: source.missingColumns.length,
        expected: 'All required columns are present.',
        actual: source.missingColumns.join(', '),
        recommendedFix: 'Update the source export/template so every required column is included.',
        ownerRole: 'DATA_OWNER',
      });
    }
  }
}

function courseStatusDetail(issues: MissingEvidenceItem[]): string {
  if (hasType(issues, 'NO_COURSES_IN_SCOPE')) return 'No course matched the selected report scope.';
  if (hasType(issues, 'IN_PROGRESS_COURSE')) {
    return `${countType(issues, 'IN_PROGRESS_COURSE')} selected course(s) are not completed.`;
  }
  return 'All selected courses are completed.';
}

function validateScopeHasCourses(dataset: NormalizedDataset, issues: MissingEvidenceItem[]): void {
  if (dataset.courses.length > 0) return;
  addIssue(issues, {
    type: 'NO_COURSES_IN_SCOPE',
    severity: 'blocker',
    source: 'OneDrive',
    sheetName: SHEETS.course,
    message: `No course matched the selected scope (${scopeLabel(dataset.scope)}).`,
    expected: 'At least one course in scope.',
    actual: '0 courses',
    recommendedFix: 'Clear conflicting filters or select the period that contains this course before generating the report.',
    ownerRole: 'LND_MANAGER',
  });
}

function validateCourseStatus(dataset: NormalizedDataset, issues: MissingEvidenceItem[]): void {
  const inProgressCourses = dataset.courses.filter((course) => course.status.toLowerCase() !== 'completed');
  for (const course of inProgressCourses) {
    addIssue(issues, {
      type: 'IN_PROGRESS_COURSE',
      severity: 'blocker',
      source: 'OneDrive',
      sheetName: SHEETS.course,
      field: 'Status',
      courseId: course.courseId,
      message: `Course ${course.courseId} is ${course.status}; final effectiveness conclusion is blocked until completion.`,
      expected: 'Completed',
      actual: course.status,
      recommendedFix: 'Generate a readiness report only, or wait until the course status is Completed.',
      ownerRole: 'LND_MANAGER',
    });
  }
}

function validateCourseValues(dataset: NormalizedDataset, issues: MissingEvidenceItem[]): void {
  for (const course of dataset.courses) {
    if (!Number.isFinite(course.totalSessions) || course.totalSessions <= 0) {
      addInvalidCourseValue(issues, course, 'Total_Sessions', course.totalSessions, 'Positive number');
    }
    if (!Number.isFinite(course.hoursPerSession) || course.hoursPerSession <= 0) {
      addInvalidCourseValue(issues, course, 'Hours_Per_Session', course.hoursPerSession, 'Positive number');
    }
    if (!Number.isFinite(course.passThresholdScore) || course.passThresholdScore < 0 || course.passThresholdScore > 10) {
      addInvalidCourseValue(issues, course, 'Pass_Threshold_Score', course.passThresholdScore, '0 <= threshold <= 10');
    }
  }
}

function validateCompleteness(dataset: NormalizedDataset, issues: MissingEvidenceItem[]): void {
  for (const course of dataset.courses) {
    const trainees = dataset.trainees.filter((trainee) => trainee.courseId === course.courseId);
    const expectedAttendanceRows = trainees.length * course.totalSessions;
    const actualAttendanceRows = dataset.attendance.filter((row) => row.courseId === course.courseId).length;
    if (expectedAttendanceRows > 0 && actualAttendanceRows < expectedAttendanceRows) {
      addIssue(issues, {
        type: 'MISSING_ATTENDANCE',
        severity: course.status.toLowerCase() === 'completed' ? 'blocker' : 'warning',
        source: 'Teams',
        sheetName: SHEETS.attendance,
        courseId: course.courseId,
        affectedCount: expectedAttendanceRows - actualAttendanceRows,
        message: `Attendance has ${actualAttendanceRows}/${expectedAttendanceRows} expected rows for ${course.courseId}.`,
        expected: `${expectedAttendanceRows} attendance rows`,
        actual: `${actualAttendanceRows} attendance rows`,
        recommendedFix: 'Backfill missing session attendance rows from Teams before final reporting.',
        ownerRole: 'DATA_OWNER',
      });
    }

    const assessmentEmployeeIds = new Set(
      dataset.assessments.filter((row) => row.courseId === course.courseId).map((row) => row.employeeId),
    );
    if (course.status.toLowerCase() === 'completed' && assessmentEmployeeIds.size < trainees.length) {
      addIssue(issues, {
        type: 'MISSING_ASSESSMENT',
        severity: 'blocker',
        source: 'OneDrive',
        sheetName: SHEETS.assessment,
        courseId: course.courseId,
        affectedCount: trainees.length - assessmentEmployeeIds.size,
        message: `Assessment has ${assessmentEmployeeIds.size}/${trainees.length} trainee rows for ${course.courseId}.`,
        expected: `${trainees.length} assessment rows`,
        actual: `${assessmentEmployeeIds.size} assessment rows`,
        recommendedFix: 'Backfill missing assessment/pass-status rows before publishing the final effectiveness report.',
        ownerRole: 'TRAINER',
      });
    }

    const feedbackEmployeeIds = new Set(
      dataset.feedback
        .filter((row) => row.courseId === course.courseId && (row.trainerRating !== null || row.contentRating !== null))
        .map((row) => row.employeeId),
    );
    if (trainees.length > 0 && feedbackEmployeeIds.size / trainees.length < 0.6) {
      addIssue(issues, {
        type: 'INSUFFICIENT_FEEDBACK',
        severity: 'warning',
        source: 'Forms',
        sheetName: SHEETS.feedback,
        courseId: course.courseId,
        affectedCount: feedbackEmployeeIds.size,
        ruleId: 'NORM-14',
        message: `Feedback response rate is below 60% for ${course.courseId}.`,
        expected: 'Feedback responses from at least 60% of trainees.',
        actual: `${feedbackEmployeeIds.size}/${trainees.length} responses`,
        recommendedFix: 'Keep final report limitations visible or collect additional feedback responses.',
        ownerRole: 'LND_MANAGER',
      });
    }
  }
}

function validateDuplicates(dataset: NormalizedDataset, issues: MissingEvidenceItem[]): void {
  addDuplicateIssues({
    issues,
    rows: dataset.attendance,
    sheetName: SHEETS.attendance,
    type: 'DUPLICATE_ATTENDANCE',
    severity: 'blocker',
    key: (row) => `${row.courseId}:${row.sessionId}:${row.employeeId}`,
    message: (row) => `Duplicate attendance row found for ${row.employeeId}/${row.sessionId} in ${row.courseId}.`,
    recommendedFix: 'Remove duplicate attendance rows or merge them into one authoritative row.',
  });
  addDuplicateIssues({
    issues,
    rows: dataset.assessments,
    sheetName: SHEETS.assessment,
    type: 'DUPLICATE_ASSESSMENT',
    severity: 'blocker',
    key: (row) => `${row.courseId}:${row.employeeId}`,
    message: (row) => `Duplicate assessment row found for ${row.employeeId} in ${row.courseId}.`,
    recommendedFix: 'Keep one official assessment row per learner/course before final reporting.',
  });
  addDuplicateIssues({
    issues,
    rows: dataset.feedback,
    sheetName: SHEETS.feedback,
    type: 'DUPLICATE_FEEDBACK',
    severity: 'warning',
    key: (row) => `${row.courseId}:${row.employeeId}`,
    message: (row) => `Duplicate feedback row found for ${row.employeeId} in ${row.courseId}.`,
    recommendedFix: 'Review duplicate feedback rows and keep the latest/official survey response.',
  });
}

function validateCrossSourceConsistency(dataset: NormalizedDataset, issues: MissingEvidenceItem[]): void {
  const courseIds = new Set(dataset.courses.map((course) => course.courseId));
  const unknownCourseRows = [
    ...dataset.attendance.map((row) => ({ courseId: row.courseId, source: 'Teams', sheetName: SHEETS.attendance })),
    ...dataset.assessments.map((row) => ({ courseId: row.courseId, source: 'OneDrive', sheetName: SHEETS.assessment })),
    ...dataset.feedback.map((row) => ({ courseId: row.courseId, source: 'Forms', sheetName: SHEETS.feedback })),
    ...dataset.costs.map((row) => ({ courseId: row.courseId, source: 'KPI', sheetName: SHEETS.cost })),
  ].filter((row) => !courseIds.has(row.courseId));
  for (const row of unknownCourseRows.slice(0, 20)) {
    addIssue(issues, {
      type: 'CONSISTENCY_ERROR',
      severity: 'blocker',
      source: row.source,
      sheetName: row.sheetName,
      field: 'Course_ID',
      courseId: row.courseId,
      message: `Unknown course id ${row.courseId} found in ${row.sheetName}.`,
      expected: 'Course_ID exists in selected course catalog scope.',
      actual: row.courseId,
      recommendedFix: 'Correct the Course_ID or regenerate the report for a scope that includes this course.',
      ownerRole: 'DATA_OWNER',
    });
  }
}

function validateRowValues(dataset: NormalizedDataset, issues: MissingEvidenceItem[]): void {
  for (const attendance of dataset.attendance) {
    const course = dataset.courses.find((item) => item.courseId === attendance.courseId);
    const normalized = attendance.attendanceStatus.trim().toLowerCase();
    if (!['present', 'absent', 'late'].includes(normalized)) {
      addIssue(issues, {
        type: 'INVALID_ATTENDANCE_STATUS',
        severity: course?.status.toLowerCase() === 'completed' ? 'blocker' : 'warning',
        source: 'Teams',
        sheetName: SHEETS.attendance,
        field: 'Attendance_Status',
        courseId: attendance.courseId,
        employeeId: attendance.employeeId,
        message: `Invalid attendance status "${attendance.attendanceStatus}" for ${attendance.employeeId} in ${attendance.courseId}.`,
        expected: 'Present, Absent, or Late',
        actual: attendance.attendanceStatus,
        recommendedFix: 'Map the attendance status to Present, Absent, or Late before metric generation.',
        ownerRole: 'DATA_OWNER',
      });
    }
  }

  for (const assessment of dataset.assessments) {
    const course = dataset.courses.find((item) => item.courseId === assessment.courseId);
    if (!course) continue;
    if (course.status.toLowerCase() === 'completed' && (assessment.score === null || assessment.passStatus === null)) {
      addIssue(issues, {
        type: 'MISSING_SCORE',
        severity: 'blocker',
        source: 'OneDrive',
        sheetName: SHEETS.assessment,
        field: assessment.score === null ? 'Score_0_to_10' : 'Pass_Status',
        courseId: assessment.courseId,
        employeeId: assessment.employeeId,
        message: `Assessment score/pass status is missing for ${assessment.employeeId} in ${assessment.courseId}.`,
        expected: 'Score_0_to_10 and Pass_Status are populated.',
        actual: null,
        recommendedFix: 'Fill the assessment score and pass status before generating a final report.',
        ownerRole: 'TRAINER',
      });
      continue;
    }
    if (assessment.score !== null && (assessment.score < 0 || assessment.score > 10)) {
      addIssue(issues, {
        type: 'INVALID_SCORE_RANGE',
        severity: 'blocker',
        source: 'OneDrive',
        sheetName: SHEETS.assessment,
        field: 'Score_0_to_10',
        courseId: assessment.courseId,
        employeeId: assessment.employeeId,
        message: `Score ${assessment.score} is outside the 0-10 range for ${assessment.employeeId} in ${assessment.courseId}.`,
        expected: '0 <= score <= 10',
        actual: assessment.score,
        recommendedFix: 'Correct the score range or verify the assessment export.',
        ownerRole: 'TRAINER',
      });
      continue;
    }
    if (assessment.score !== null && assessment.passStatus !== null) {
      const expectedPass = assessment.score >= course.passThresholdScore;
      if (expectedPass !== assessment.passStatus) {
        addIssue(issues, {
          type: 'SCORE_INCONSISTENCY',
          severity: 'blocker',
          source: 'OneDrive',
          sheetName: SHEETS.assessment,
          field: 'Pass_Status',
          courseId: assessment.courseId,
          employeeId: assessment.employeeId,
          message: `Pass_Status conflicts with score/threshold for ${assessment.employeeId} in ${assessment.courseId}.`,
          expected: `Pass_Status=${expectedPass}`,
          actual: assessment.passStatus,
          recommendedFix: 'Verify pass status with the trainer before report generation.',
          ownerRole: 'TRAINER',
        });
      }
    }
  }

  for (const feedback of dataset.feedback) {
    validateRating(issues, feedback, 'Trainer_Rating_1_to_5', feedback.trainerRating);
    validateRating(issues, feedback, 'Content_Rating_1_to_5', feedback.contentRating);
  }

  for (const cost of dataset.costs) {
    validateCostValue(issues, cost, 'Total_Cost_Scaled', cost.totalCostScaled, true);
    validateCostValue(issues, cost, 'Cost_Per_Session_Scaled', cost.costPerSessionScaled, true);
    validateCostValue(issues, cost, 'Total_Sessions', cost.totalSessions, true);
    validateCostValue(issues, cost, 'Trainee_Count', cost.traineeCount, true);
    validateCostValue(issues, cost, 'Completion_Rate', cost.completionRate, false, '0 <= completion rate <= 1');
    validateCostValue(issues, cost, 'Pass_Rate', cost.passRate, false, '0 <= pass rate <= 1');
    if (cost.completionRate !== null && (cost.completionRate < 0 || cost.completionRate > 1)) {
      addInvalidCostIssue(issues, cost, 'Completion_Rate', cost.completionRate, '0 <= completion rate <= 1');
    }
    if (cost.passRate !== null && (cost.passRate < 0 || cost.passRate > 1)) {
      addInvalidCostIssue(issues, cost, 'Pass_Rate', cost.passRate, '0 <= pass rate <= 1');
    }
  }
}

function validateRating(
  issues: MissingEvidenceItem[],
  feedback: FeedbackRecord,
  field: 'Trainer_Rating_1_to_5' | 'Content_Rating_1_to_5',
  value: number | null,
): void {
  if (value === null || (value >= 1 && value <= 5)) return;
  addIssue(issues, {
    type: 'INVALID_RATING_RANGE',
    severity: 'warning',
    source: 'Forms',
    sheetName: SHEETS.feedback,
    field,
    courseId: feedback.courseId,
    employeeId: feedback.employeeId,
    message: `${field} value ${value} is outside the 1-5 range for ${feedback.employeeId} in ${feedback.courseId}.`,
    expected: '1 <= rating <= 5',
    actual: value,
    recommendedFix: 'Correct or exclude invalid feedback ratings; keep report limitations visible until fixed.',
    ownerRole: 'DATA_OWNER',
  });
}

function validateCostValue(
  issues: MissingEvidenceItem[],
  cost: CostRecord,
  field: string,
  value: number | null,
  nonNegativeOnly: boolean,
  expected = 'Non-negative number',
): void {
  if (value === null) return;
  if (nonNegativeOnly && value < 0) addInvalidCostIssue(issues, cost, field, value, expected);
}

function addInvalidCostIssue(
  issues: MissingEvidenceItem[],
  cost: CostRecord,
  field: string,
  value: number,
  expected: string,
): void {
  addIssue(issues, {
    type: 'INVALID_COST_VALUE',
    severity: 'blocker',
    source: 'KPI',
    sheetName: SHEETS.cost,
    field,
    courseId: cost.courseId,
    message: `${field} value ${value} is invalid for ${cost.courseId}.`,
    expected,
    actual: value,
    recommendedFix: 'Correct the KPI/cost export before ROI and cost metrics are used in the report.',
    ownerRole: 'DATA_OWNER',
  });
}

function addInvalidCourseValue(
  issues: MissingEvidenceItem[],
  course: Course,
  field: string,
  value: number,
  expected: string,
): void {
  addIssue(issues, {
    type: 'INVALID_COURSE_VALUE',
    severity: 'blocker',
    source: 'OneDrive',
    sheetName: SHEETS.course,
    field,
    courseId: course.courseId,
    message: `${field} value ${value} is invalid for ${course.courseId}.`,
    expected,
    actual: value,
    recommendedFix: 'Correct the course catalog value before metric generation.',
    ownerRole: 'DATA_OWNER',
  });
}

function addDuplicateIssues<T extends { courseId: string; employeeId?: string }>(input: {
  issues: MissingEvidenceItem[];
  rows: T[];
  sheetName: string;
  type: EvidenceIssueType;
  severity: EvidenceSeverity;
  key: (row: T) => string;
  message: (row: T) => string;
  recommendedFix: string;
}): void {
  const seen = new Map<string, T>();
  const reported = new Set<string>();
  for (const row of input.rows) {
    const key = input.key(row);
    const first = seen.get(key);
    if (!first) {
      seen.set(key, row);
      continue;
    }
    if (reported.has(key)) continue;
    reported.add(key);
    addIssue(input.issues, {
      type: input.type,
      severity: input.severity,
      sheetName: input.sheetName,
      courseId: row.courseId,
      employeeId: row.employeeId,
      message: input.message(row),
      expected: 'One authoritative row per business key.',
      actual: 'Duplicate rows',
      recommendedFix: input.recommendedFix,
      ownerRole: 'DATA_OWNER',
    });
  }
}

function addIssue(issues: MissingEvidenceItem[], issue: MissingEvidenceItem): void {
  issues.push(issue);
}

function hasType(
  items: MissingEvidenceItem[],
  type: EvidenceIssueType,
  severity?: EvidenceSeverity,
): boolean {
  return items.some((item) => item.type === type && (!severity || item.severity === severity));
}

function hasAnyType(items: MissingEvidenceItem[], types: EvidenceIssueType[]): boolean {
  return types.some((type) => hasType(items, type));
}

function countType(items: MissingEvidenceItem[], type: EvidenceIssueType): number {
  return items.filter((item) => item.type === type).length;
}

function scopeLabel(scope: NormalizedDataset['scope']): string {
  const parts = [
    scope.period ? `period=${scope.period}` : undefined,
    scope.courseId ? `courseId=${scope.courseId}` : undefined,
    scope.team ? `team=${scope.team}` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'all courses';
}
