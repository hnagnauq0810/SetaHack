import type {
  CourseMetrics,
  GovernanceView,
  LdRole,
  MissingEvidenceItem,
  NormFlag,
  ReportJson,
  TraineeHighlight,
} from '../../models.ts';
import { average, formatNumber, formatPct, maskEmployeeId, round } from './utils.ts';

export interface LdReportAccessContext {
  role: LdRole;
  trainerId?: string;
}

export function applyReportAccessView(
  report: ReportJson,
  access: LdReportAccessContext,
): ReportJson {
  const view = cloneReport(report);
  if (access.role === 'TRAINER') {
    applyTrainerCourseScope(view, access.trainerId);
  }

  const masked = access.role !== 'LND_MANAGER';
  const idMap = collectEmployeeIdMaskMap(view);
  view.governance = maskGovernance(view.governance, access.role, masked, idMap);
  view.evidence = {
    ...view.evidence,
    missingEvidence: view.evidence.missingEvidence.map((item) =>
      maskMissingEvidence(item, masked, idMap),
    ),
  };
  if (masked) {
    view.executiveSummary = maskKnownIds(view.executiveSummary, idMap);
    view.insights = view.insights.map((item) => maskKnownIds(item, idMap));
    view.recommendations = view.recommendations.map((item) => maskKnownIds(item, idMap));
    view.warnings = view.warnings.map((item) => maskKnownIds(item, idMap));
  }

  // File-system paths are internal implementation detail. Downloads are rendered
  // dynamically from this access view so the caller never receives raw artifact paths.
  delete view.artifacts;
  return view;
}

function cloneReport(report: ReportJson): ReportJson {
  return JSON.parse(JSON.stringify(report)) as ReportJson;
}

function applyTrainerCourseScope(report: ReportJson, trainerId: string | undefined): void {
  const courses = report.metrics.courses;
  const allCoursesWerePreScoped =
    trainerId !== undefined &&
    report.scope.trainerId === trainerId &&
    courses.every((course) => !course.trainerId || course.trainerId === trainerId);
  const allowedCourses = allCoursesWerePreScoped
    ? courses
    : courses.filter((course) => trainerId !== undefined && course.trainerId === trainerId);
  const allowedCourseIds = new Set(allowedCourses.map((course) => course.courseId));

  report.scope = {
    ...report.scope,
    ...(trainerId ? { trainerId } : {}),
    courseId: report.scope.courseId,
    reportType: report.scope.reportType,
  };
  report.metrics = {
    ...report.metrics,
    overall: summarizeCourses(allowedCourses),
    courses: allowedCourses,
  };
  report.governance = {
    ...report.governance,
    normFlags: report.governance.normFlags.filter((flag) =>
      isAllowedCourseItem(flag.courseId, allowedCourseIds),
    ),
    outstandingTrainees: report.governance.outstandingTrainees.filter((item) =>
      allowedCourseIds.has(item.courseId),
    ),
    supportNeededTrainees: report.governance.supportNeededTrainees.filter((item) =>
      allowedCourseIds.has(item.courseId),
    ),
    supportNeededGroups: report.governance.supportNeededGroups.filter((item) =>
      allowedCourseIds.has(item.courseId),
    ),
  };
  report.evidence = {
    ...report.evidence,
    missingEvidence: report.evidence.missingEvidence.filter((item) =>
      isAllowedCourseItem(item.courseId, allowedCourseIds),
    ),
  };

  if (allowedCourses.length === 0) {
    report.executiveSummary =
      'No courses in this report are available for the current trainer scope.';
    report.insights = ['Trainer-scoped view contains no matching courses.'];
    report.recommendations = [
      'Ask the L&D Manager to verify the trainer-to-course mapping before sharing this report.',
    ];
    report.warnings = ['No trainer-owned courses matched this report artifact.'];
    return;
  }

  const best = [...allowedCourses]
    .filter((course) => typeof course.effectivenessScore === 'number')
    .sort((a, b) => Number(b.effectivenessScore) - Number(a.effectivenessScore))[0];
  const weakest = [...allowedCourses]
    .filter((course) => typeof course.effectivenessScore === 'number')
    .sort((a, b) => Number(a.effectivenessScore) - Number(b.effectivenessScore))[0];
  report.executiveSummary =
    `Trainer-scoped report view covers ${allowedCourses.length} course(s), ` +
    `${report.metrics.overall.traineeCount} learner-course records, ` +
    `${formatPct(report.metrics.overall.completionRate)} completion, and ` +
    `${formatNumber(report.metrics.overall.effectivenessScore, 2)} effectiveness score.`;
  report.insights = [
    best
      ? `${best.courseName} is the strongest course in this trainer scope (${formatNumber(best.effectivenessScore, 2)} effectiveness score).`
      : 'No scored course is available in this trainer scope.',
    weakest
      ? `${weakest.courseName} needs the closest attention in this trainer scope (${formatNumber(weakest.effectivenessScore, 2)} effectiveness score).`
      : 'No weak course signal is available in this trainer scope.',
  ];
  report.recommendations = report.recommendations.filter((item) =>
    [...allowedCourseIds].some((courseId) => item.includes(courseId)),
  );
  if (report.recommendations.length === 0) {
    report.recommendations = [
      'Review attendance, score, feedback, and evidence warnings for the courses in this trainer-scoped view.',
    ];
  }
  report.warnings = report.warnings.filter((item) =>
    [...allowedCourseIds].some((courseId) => item.includes(courseId)),
  );
}

function summarizeCourses(courses: CourseMetrics[]): ReportJson['metrics']['overall'] {
  const completedCourses = courses.filter((course) => course.status.toLowerCase() === 'completed');
  const traineeCount = courses.reduce((sum, course) => sum + course.traineeCount, 0);
  const totalCostScaled = courses.reduce((sum, course) => sum + (course.totalCostScaled ?? 0), 0);
  const trainingHours = courses.reduce((sum, course) => sum + course.trainingHours, 0);
  return {
    totalCourses: courses.length,
    completedCourses: completedCourses.length,
    traineeCount,
    attendanceRate: round(weightedAverage(courses, 'attendanceRate')),
    completionRate: round(weightedAverage(courses, 'completionRate')),
    passRate: round(weightedAverage(courses, 'passRate')),
    averageScore: round(weightedAverage(courses, 'averageScore'), 2),
    feedbackRating: round(weightedAverage(courses, 'feedbackRating'), 2),
    trainingHours: round(trainingHours, 2) ?? 0,
    totalCostScaled: round(totalCostScaled, 2) ?? 0,
    roiProxy: round(average(courses.map((course) => course.roiProxy)), 4),
    effectivenessScore: round(average(courses.map((course) => course.effectivenessScore)), 2),
  };
}

function weightedAverage(courses: CourseMetrics[], key: keyof CourseMetrics): number | null {
  let weightedSum = 0;
  let weightSum = 0;
  for (const course of courses) {
    const value = course[key];
    if (typeof value !== 'number' || Number.isNaN(value)) continue;
    const weight = Math.max(course.traineeCount, 1);
    weightedSum += value * weight;
    weightSum += weight;
  }
  if (weightSum === 0) return null;
  return weightedSum / weightSum;
}

function isAllowedCourseItem(courseId: string | undefined, allowedCourseIds: ReadonlySet<string>) {
  return !courseId || allowedCourseIds.has(courseId);
}

function maskGovernance(
  governance: GovernanceView,
  role: LdRole,
  masked: boolean,
  idMap: ReadonlyMap<string, string>,
): GovernanceView {
  return {
    ...governance,
    role,
    masked,
    normFlags: governance.normFlags.map((flag) => maskFlag(flag, masked, idMap)),
    outstandingTrainees: governance.outstandingTrainees.map((item) =>
      maskHighlight(item, masked, idMap),
    ),
    supportNeededTrainees: governance.supportNeededTrainees.map((item) =>
      maskHighlight(item, masked, idMap),
    ),
  };
}

function maskHighlight(
  item: TraineeHighlight,
  masked: boolean,
  idMap: ReadonlyMap<string, string>,
): TraineeHighlight {
  if (!masked) return item;
  return {
    ...item,
    employeeId: idMap.get(item.employeeId) ?? maskEmployeeId(item.employeeId),
    reason: maskKnownIds(item.reason, idMap),
  };
}

function maskFlag(flag: NormFlag, masked: boolean, idMap: ReadonlyMap<string, string>): NormFlag {
  if (!masked) return flag;
  const employeeId = flag.employeeId
    ? (idMap.get(flag.employeeId) ?? maskEmployeeId(flag.employeeId))
    : undefined;
  return {
    ...flag,
    ...(employeeId ? { employeeId } : {}),
    message: maskKnownIds(flag.message, idMap),
    action: maskKnownIds(flag.action, idMap),
  };
}

function maskMissingEvidence(
  item: MissingEvidenceItem,
  masked: boolean,
  idMap: ReadonlyMap<string, string>,
): MissingEvidenceItem {
  if (!masked) return item;
  const employeeId = item.employeeId
    ? (idMap.get(item.employeeId) ?? maskEmployeeId(item.employeeId))
    : undefined;
  return {
    ...item,
    ...(employeeId ? { employeeId } : {}),
    message: maskKnownIds(item.message, idMap),
    actual: typeof item.actual === 'string' ? maskKnownIds(item.actual, idMap) : item.actual,
  };
}

function collectEmployeeIdMaskMap(report: ReportJson): Map<string, string> {
  const ids = new Set<string>();
  for (const flag of report.governance.normFlags) if (flag.employeeId) ids.add(flag.employeeId);
  for (const item of report.governance.outstandingTrainees) ids.add(item.employeeId);
  for (const item of report.governance.supportNeededTrainees) ids.add(item.employeeId);
  for (const item of report.evidence.missingEvidence) if (item.employeeId) ids.add(item.employeeId);
  return new Map([...ids].map((employeeId) => [employeeId, maskEmployeeId(employeeId)]));
}

function maskKnownIds(value: string, idMap: ReadonlyMap<string, string>): string {
  let out = value;
  for (const [raw, masked] of idMap) {
    out = out.split(raw).join(masked);
  }
  return out;
}
