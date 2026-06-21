import ExcelJS from 'exceljs';
import type {
  AssessmentRecord,
  AttendanceRecord,
  CostRecord,
  Course,
  FeedbackRecord,
  LdScopeInput,
  NormalizedDataset,
  NormRule,
  SourceMetadata,
  TemplateSection,
  TraineeSnapshot,
} from '../../models.ts';
import { defaultMockWorkbookPath } from './defaults.ts';
import { boolOrNull, numberOrNull, stableHash, stringOrEmpty, stringOrNull } from './utils.ts';

const SOURCE_MAP = {
  DS06_Course_Catalog: { source: 'OneDrive', required: true },
  DS07_Attendance_Log: { source: 'Teams', required: true },
  DS08_Assessment_Score: { source: 'OneDrive', required: true },
  DS09_Feedback_Survey: { source: 'Forms', required: true },
  DS10_Training_Cost_ROI: { source: 'KPI', required: true },
  DS11_LnD_Training_NORM: { source: 'Rules', required: true },
  DS12_Report_Template_Structure: { source: 'Template', required: true },
} as const;

type KnownSheet = keyof typeof SOURCE_MAP;
type SheetRow = Record<string, unknown>;

const REQUIRED_COLUMNS: Record<KnownSheet, string[]> = {
  DS06_Course_Catalog: [
    'Course_ID',
    'Course_Name',
    'Topic_Category',
    'Trainer_ID',
    'Total_Sessions',
    'Hours_Per_Session',
    'Total_Hours',
    'Pass_Threshold_Score',
    'Start_Date',
    'End_Date',
    'Status',
  ],
  DS07_Attendance_Log: [
    'Course_ID',
    'Session_ID',
    'Employee_ID',
    'Attendance_Status',
    'Training_Hours',
  ],
  DS08_Assessment_Score: ['Course_ID', 'Employee_ID', 'Score_0_to_10', 'Pass_Status'],
  DS09_Feedback_Survey: [
    'Course_ID',
    'Employee_ID',
    'Trainer_Rating_1_to_5',
    'Content_Rating_1_to_5',
  ],
  DS10_Training_Cost_ROI: ['Course_ID', 'Total_Cost_Scaled'],
  DS11_LnD_Training_NORM: [
    'Rule_ID',
    'Category',
    'Rule_Description',
    'Threshold',
    'Action_If_Triggered',
    'Priority',
  ],
  DS12_Report_Template_Structure: [
    'Section_ID',
    'Section_Name',
    'Content_Description',
    'Data_Source',
    'Required',
  ],
};

export interface LoadDatasetOptions {
  sourcePath?: string;
  scope?: LdScopeInput;
}

export async function loadAndNormalizeDataset(
  opts: LoadDatasetOptions = {},
): Promise<NormalizedDataset> {
  const workbook = new ExcelJS.Workbook();
  const sourcePath = opts.sourcePath ?? defaultMockWorkbookPath();
  await workbook.xlsx.readFile(sourcePath);

  const importedAt = new Date().toISOString();
  const scope = opts.scope ?? {};
  const sources = buildSourceMetadata(workbook, importedAt);

  const allCourses = parseCourses(readSheet(workbook, 'DS06_Course_Catalog'));
  const catalogCourseIds = new Set(allCourses.map((c) => c.courseId));
  const courses = filterCourses(allCourses, scope);
  const courseIds = new Set(courses.map((c) => c.courseId));
  const inScopeOrUnknownCourse = (courseId: string) =>
    courseIds.has(courseId) || !catalogCourseIds.has(courseId);
  const attendance = parseAttendance(readSheet(workbook, 'DS07_Attendance_Log')).filter((r) =>
    inScopeOrUnknownCourse(r.courseId),
  );
  const assessments = parseAssessments(readSheet(workbook, 'DS08_Assessment_Score')).filter((r) =>
    inScopeOrUnknownCourse(r.courseId),
  );
  const feedback = parseFeedback(readSheet(workbook, 'DS09_Feedback_Survey')).filter((r) =>
    inScopeOrUnknownCourse(r.courseId),
  );
  const costs = parseCosts(readSheet(workbook, 'DS10_Training_Cost_ROI')).filter((r) =>
    inScopeOrUnknownCourse(r.courseId),
  );
  const normRules = parseNormRules(readSheet(workbook, 'DS11_LnD_Training_NORM'));
  const templateSections = parseTemplate(readSheet(workbook, 'DS12_Report_Template_Structure'));
  const trainees = buildTraineeSnapshots(courses, attendance, assessments, feedback);

  return {
    datasetId: `ds_${stableHash({ sourcePath, scope, importedAt })}`,
    scope,
    importedAt,
    sources,
    courses,
    attendance,
    assessments,
    feedback,
    costs,
    normRules,
    templateSections,
    trainees,
  };
}

function buildSourceMetadata(workbook: ExcelJS.Workbook, loadedAt: string): SourceMetadata[] {
  return (Object.keys(SOURCE_MAP) as KnownSheet[]).map((sheetName) => {
    const ws = workbook.getWorksheet(sheetName);
    const headers = ws ? getHeaderRow(ws) : [];
    const required = REQUIRED_COLUMNS[sheetName];
    const missingColumns = required.filter((h) => !headers.includes(h));
    const config = SOURCE_MAP[sheetName];
    return {
      source: config.source,
      sheetName,
      rowCount: ws ? Math.max(ws.actualRowCount - 1, 0) : 0,
      required: config.required,
      present: Boolean(ws),
      missingColumns,
      loadedAt,
    };
  });
}

function readSheet(workbook: ExcelJS.Workbook, sheetName: KnownSheet): SheetRow[] {
  const ws = workbook.getWorksheet(sheetName);
  if (!ws) return [];
  const headers = getHeaderRow(ws);
  const rows: SheetRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    if (values.every((v) => v === null || v === undefined || v === '')) return;
    const obj: SheetRow = {};
    headers.forEach((header, idx) => {
      if (!header) return;
      obj[header] = normalizeCellValue(values[idx]);
    });
    rows.push(obj);
  });
  return rows;
}

function getHeaderRow(ws: ExcelJS.Worksheet): string[] {
  const row = ws.getRow(1);
  const values = Array.isArray(row.values) ? row.values.slice(1) : [];
  return values.map((v) => stringOrEmpty(normalizeCellValue(v))).filter(Boolean);
}

function normalizeCellValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && value !== null && 'text' in value) {
    return String((value as { text?: unknown }).text ?? '');
  }
  if (typeof value === 'object' && value !== null && 'result' in value) {
    return (value as { result?: unknown }).result ?? null;
  }
  return value;
}

function filterCourses(courses: Course[], scope: LdScopeInput): Course[] {
  return courses.filter((course) => {
    if (scope.courseId && !courseMatchesIdentifierOrName(course, scope.courseId)) return false;
    if (scope.trainerId && course.trainerId !== scope.trainerId) return false;
    if (scope.period && !courseMatchesPeriod(course, scope.period)) return false;
    return true;
  });
}

function courseMatchesIdentifierOrName(course: Course, query: string): boolean {
  const normalized = normalizeCourseQuery(query);
  if (!normalized) return true;
  const id = normalizeCourseQuery(course.courseId);
  const name = normalizeCourseQuery(course.courseName);
  return (
    id === normalized ||
    id.includes(normalized) ||
    normalized.includes(id) ||
    name.includes(normalized) ||
    normalized.includes(name)
  );
}

function normalizeCourseQuery(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function courseMatchesPeriod(course: Course, period: string): boolean {
  const normalized = period.trim().toUpperCase();
  const start = course.startDate.slice(0, 10);
  const end = course.endDate.slice(0, 10);
  const courseMonths = new Set([start.slice(0, 7), end.slice(0, 7)]);
  if (/^\d{4}-\d{2}$/.test(normalized)) return courseMonths.has(normalized);
  const quarterMatch = normalized.match(/^(\d{4})-?Q([1-4])$/);
  if (quarterMatch) {
    const year = Number(quarterMatch[1]);
    const quarter = Number(quarterMatch[2]);
    const month = Number(start.slice(5, 7));
    return Number(start.slice(0, 4)) === year && Math.ceil(month / 3) === quarter;
  }
  if (/^\d{4}$/.test(normalized)) return start.startsWith(normalized) || end.startsWith(normalized);
  return course.courseId.toUpperCase().includes(normalized);
}

function parseCourses(rows: SheetRow[]): Course[] {
  return rows
    .map((r) => ({
      courseId: stringOrEmpty(r.Course_ID),
      courseName: stringOrEmpty(r.Course_Name),
      topicCategory: stringOrEmpty(r.Topic_Category),
      trainerId: stringOrEmpty(r.Trainer_ID),
      totalSessions: numberOrNull(r.Total_Sessions) ?? 0,
      hoursPerSession: numberOrNull(r.Hours_Per_Session) ?? 0,
      totalHours: numberOrNull(r.Total_Hours) ?? 0,
      passThresholdScore: numberOrNull(r.Pass_Threshold_Score) ?? 0,
      startDate: stringOrEmpty(r.Start_Date),
      endDate: stringOrEmpty(r.End_Date),
      status: stringOrEmpty(r.Status),
    }))
    .filter((r) => r.courseId);
}

function parseAttendance(rows: SheetRow[]): AttendanceRecord[] {
  return rows
    .map((r) => ({
      courseId: stringOrEmpty(r.Course_ID),
      sessionId: stringOrEmpty(r.Session_ID),
      employeeId: stringOrEmpty(r.Employee_ID),
      attendanceStatus: stringOrEmpty(r.Attendance_Status),
      trainingHours: numberOrNull(r.Training_Hours) ?? 0,
    }))
    .filter((r) => r.courseId && r.sessionId && r.employeeId);
}

function parseAssessments(rows: SheetRow[]): AssessmentRecord[] {
  return rows
    .map((r) => ({
      courseId: stringOrEmpty(r.Course_ID),
      employeeId: stringOrEmpty(r.Employee_ID),
      score: numberOrNull(r.Score_0_to_10),
      passStatus: boolOrNull(r.Pass_Status),
      generalizedFeedback: stringOrNull(r.Generalized_Feedback),
    }))
    .filter((r) => r.courseId && r.employeeId);
}

function parseFeedback(rows: SheetRow[]): FeedbackRecord[] {
  return rows
    .map((r) => ({
      courseId: stringOrEmpty(r.Course_ID),
      employeeId: stringOrEmpty(r.Employee_ID),
      trainerRating: numberOrNull(r.Trainer_Rating_1_to_5),
      contentRating: numberOrNull(r.Content_Rating_1_to_5),
      comment: stringOrNull(r.Comment),
    }))
    .filter((r) => r.courseId && r.employeeId);
}

function parseCosts(rows: SheetRow[]): CostRecord[] {
  return rows
    .map((r) => ({
      courseId: stringOrEmpty(r.Course_ID),
      costPerSessionScaled: numberOrNull(r.Cost_Per_Session_Scaled),
      totalSessions: numberOrNull(r.Total_Sessions),
      totalCostScaled: numberOrNull(r.Total_Cost_Scaled),
      traineeCount: numberOrNull(r.Trainee_Count),
      completionRate: numberOrNull(r.Completion_Rate),
      avgScore: numberOrNull(r.Avg_Score),
      passRate: numberOrNull(r.Pass_Rate),
      postTrainingPerfDelta: numberOrNull(r.Post_Training_Perf_Delta),
      notes: stringOrNull(r.Notes),
    }))
    .filter((r) => r.courseId);
}

function parseNormRules(rows: SheetRow[]): NormRule[] {
  return rows
    .map((r) => ({
      ruleId: stringOrEmpty(r.Rule_ID),
      category: stringOrEmpty(r.Category),
      ruleDescription: stringOrEmpty(r.Rule_Description),
      threshold: stringOrEmpty(r.Threshold),
      actionIfTriggered: stringOrEmpty(r.Action_If_Triggered),
      priority: stringOrEmpty(r.Priority),
    }))
    .filter((r) => r.ruleId);
}

function parseTemplate(rows: SheetRow[]): TemplateSection[] {
  return rows
    .map((r) => ({
      sectionId: stringOrEmpty(r.Section_ID),
      sectionName: stringOrEmpty(r.Section_Name),
      contentDescription: stringOrEmpty(r.Content_Description),
      dataSource: stringOrEmpty(r.Data_Source),
      required: stringOrEmpty(r.Required).toLowerCase() === 'yes',
    }))
    .filter((r) => r.sectionId);
}

function attendanceUnit(status: string): number {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'present') return 1;
  if (normalized === 'late') return 0.5;
  return 0;
}

function buildTraineeSnapshots(
  courses: Course[],
  attendance: AttendanceRecord[],
  assessments: AssessmentRecord[],
  feedback: FeedbackRecord[],
): TraineeSnapshot[] {
  const snapshots: TraineeSnapshot[] = [];
  for (const course of courses) {
    const employeeIds = new Set<string>();
    attendance
      .filter((r) => r.courseId === course.courseId)
      .forEach((r) => {
        employeeIds.add(r.employeeId);
      });
    assessments
      .filter((r) => r.courseId === course.courseId)
      .forEach((r) => {
        employeeIds.add(r.employeeId);
      });
    feedback
      .filter((r) => r.courseId === course.courseId)
      .forEach((r) => {
        employeeIds.add(r.employeeId);
      });

    for (const employeeId of employeeIds) {
      const attendanceRows = attendance.filter(
        (r) => r.courseId === course.courseId && r.employeeId === employeeId,
      );
      const attendedUnits = attendanceRows.reduce(
        (sum, r) => sum + attendanceUnit(r.attendanceStatus),
        0,
      );
      const expectedUnits = course.totalSessions;
      const assessment = assessments.find(
        (r) => r.courseId === course.courseId && r.employeeId === employeeId,
      );
      const fb = feedback.find(
        (r) => r.courseId === course.courseId && r.employeeId === employeeId,
      );
      const attendanceRate = expectedUnits ? attendedUnits / expectedUnits : 0;
      snapshots.push({
        courseId: course.courseId,
        employeeId,
        attendedUnits,
        expectedUnits,
        attendanceRate,
        score: assessment?.score ?? null,
        passStatus: assessment?.passStatus ?? null,
        completed: attendanceRate >= 0.7,
        trainerRating: fb?.trainerRating ?? null,
        contentRating: fb?.contentRating ?? null,
        feedbackComment: fb?.comment ?? null,
      });
    }
  }
  return snapshots;
}
