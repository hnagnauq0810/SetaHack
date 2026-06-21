import type {
  EvidenceDecision,
  GovernanceView,
  LdRole,
  MetricsSnapshot,
  NormalizedDataset,
  NormFlag,
  TraineeHighlight,
} from '../../models.ts';
import { id, maskEmployeeId } from './utils.ts';

export function applyGovernanceAndRbac(
  dataset: NormalizedDataset,
  metrics: MetricsSnapshot,
  evidence: EvidenceDecision,
  role: LdRole,
): GovernanceView {
  const normFlags = evaluateNormFlags(dataset, metrics, evidence);
  const outstandingTrainees = findOutstandingTrainees(dataset);
  const supportNeededTrainees = findSupportNeededTrainees(dataset);
  const supportNeededGroups = summarizeSupportNeeded(supportNeededTrainees);
  const classification = classifyEffectiveness(metrics, evidence, normFlags);
  const masked = role !== 'LND_MANAGER';

  return {
    governanceId: id('gv'),
    role,
    classification,
    generatedAt: new Date().toISOString(),
    normFlags: maskFlags(normFlags, masked),
    outstandingTrainees: maskHighlights(outstandingTrainees, masked),
    supportNeededTrainees: maskHighlights(supportNeededTrainees, masked),
    supportNeededGroups,
    masked,
  };
}

function evaluateNormFlags(
  dataset: NormalizedDataset,
  metrics: MetricsSnapshot,
  evidence: EvidenceDecision,
): NormFlag[] {
  const flags: NormFlag[] = [];
  for (const course of metrics.courses) {
    if ((course.passRate ?? 1) < 0.7) addFlag(flags, 'NORM-01', 'High', 'Effectiveness', course.courseId, undefined, 'Pass rate is below 70%.', 'Flag course for content review; notify L&D manager');
    if ((course.averageScore ?? 10) < 6.5) addFlag(flags, 'NORM-02', 'High', 'Effectiveness', course.courseId, undefined, 'Average score is below 6.5.', 'Trigger course redesign review; consider re-delivery');
    if ((course.attendanceRate ?? 1) < 0.75) addFlag(flags, 'NORM-03', 'Medium', 'Attendance', course.courseId, undefined, 'Attendance rate is below 75%.', 'Send reminder to absentees; flag to direct manager');
    if ((course.trainerRatingAvg ?? 5) < 3.5) addFlag(flags, 'NORM-08', 'High', 'Trainer', course.courseId, undefined, 'Trainer rating is below 3.5.', 'Escalate to L&D Manager; schedule trainer coaching session');
    if ((course.completionRate ?? 1) < 0.8 && (course.totalCostScaled ?? 0) > 8) addFlag(flags, 'NORM-09', 'Medium', 'ROI', course.courseId, undefined, 'Low completion despite high scaled cost.', 'Review course necessity; consider split delivery or self-paced format');
    if ((course.postTrainingPerfDelta ?? 1) <= 0) addFlag(flags, 'NORM-10', 'High', 'ROI', course.courseId, undefined, 'Post-training performance delta is negative or zero.', 'Audit course design and on-the-job application support');
    if ((course.feedbackResponseRate ?? 1) < 0.6) addFlag(flags, 'NORM-14', 'Medium', 'Feedback', course.courseId, undefined, 'Feedback response rate is below 60%.', 'Mark feedback analysis as statistically insufficient; note in report');
  }

  for (const trainee of dataset.trainees) {
    const course = dataset.courses.find((c) => c.courseId === trainee.courseId);
    if (!course) continue;
    if ((trainee.score ?? -1) >= course.passThresholdScore && trainee.attendanceRate < 0.7) {
      addFlag(flags, 'NORM-04', 'Medium', 'Individual', trainee.courseId, trainee.employeeId, 'Trainee passed with low attendance.', 'Flag for L&D review; verify with manager');
    }
    if (trainee.score === 0 || trainee.score === null) {
      addFlag(flags, 'NORM-05', 'High', 'Individual', trainee.courseId, trainee.employeeId, 'Trainee has zero score or missing assessment.', 'Mark as Incomplete; recommend re-enrollment in next cohort');
    }
    if ((trainee.score ?? 10) < course.passThresholdScore && trainee.attendanceRate >= 0.7) {
      addFlag(flags, 'NORM-07', 'High', 'Individual', trainee.courseId, trainee.employeeId, 'Trainee needs 1:1 support.', 'Flag for coaching; assign buddy or practice resources');
    }
    if (trainee.score !== null && trainee.passStatus !== null) {
      const expectedPass = trainee.score >= course.passThresholdScore;
      if (expectedPass !== trainee.passStatus) {
        addFlag(flags, 'NORM-15', 'High', 'Individual', trainee.courseId, trainee.employeeId, 'Pass_Status does not match score and threshold.', 'Verify with trainer before report generation');
      }
    }
  }

  for (const item of evidence.missingEvidence) {
    if (item.severity === 'blocker') {
      addFlag(flags, 'NORM-11', 'High', 'Reporting', item.courseId, item.employeeId, item.message, 'Block final conclusion; flag data incomplete');
    }
  }
  return flags;
}

function addFlag(
  flags: NormFlag[],
  ruleId: string,
  priority: string,
  category: string,
  courseId: string | undefined,
  employeeId: string | undefined,
  message: string,
  action: string,
): void {
  flags.push({ ruleId, priority, category, courseId, employeeId, message, action });
}

function classifyEffectiveness(
  metrics: MetricsSnapshot,
  evidence: EvidenceDecision,
  flags: NormFlag[],
): GovernanceView['classification'] {
  if (!evidence.canGenerateFinalConclusion) return 'Not reportable';
  const highFlags = flags.filter((f) => f.priority === 'High').length;
  const score = metrics.overall.effectivenessScore ?? 0;
  if (highFlags > 0 || score < 65) return 'Risk';
  if (score < 80 || flags.some((f) => f.priority === 'Medium')) return 'Needs improvement';
  return 'Effective';
}

function findOutstandingTrainees(dataset: NormalizedDataset): TraineeHighlight[] {
  return dataset.trainees
    .filter((t) => (t.score ?? 0) >= 9 && t.attendanceRate >= 1)
    .map((t) => ({
      courseId: t.courseId,
      employeeId: t.employeeId,
      score: t.score,
      attendanceRate: t.attendanceRate,
      reason: 'Score >= 9.0 and full attendance',
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function findSupportNeededTrainees(dataset: NormalizedDataset): TraineeHighlight[] {
  return dataset.trainees
    .filter((t) => {
      const course = dataset.courses.find((c) => c.courseId === t.courseId);
      if (!course) return false;
      return (t.score !== null && t.score < course.passThresholdScore) || t.attendanceRate < 0.7;
    })
    .map((t) => ({
      courseId: t.courseId,
      employeeId: t.employeeId,
      score: t.score,
      attendanceRate: t.attendanceRate,
      reason: 'Below pass threshold or attendance below 70%',
    }))
    .sort((a, b) => a.courseId.localeCompare(b.courseId));
}

function summarizeSupportNeeded(items: TraineeHighlight[]): Array<{ courseId: string; count: number; reason: string }> {
  const map = new Map<string, number>();
  for (const item of items) map.set(item.courseId, (map.get(item.courseId) ?? 0) + 1);
  return Array.from(map.entries()).map(([courseId, count]) => ({
    courseId,
    count,
    reason: 'At least one learner is below pass threshold or attendance policy.',
  }));
}

function maskHighlights(items: TraineeHighlight[], masked: boolean): TraineeHighlight[] {
  if (!masked) return items;
  return items.map((item) => ({ ...item, employeeId: maskEmployeeId(item.employeeId) }));
}

function maskFlags(items: NormFlag[], masked: boolean): NormFlag[] {
  if (!masked) return items;
  return items.map((item) => ({
    ...item,
    employeeId: item.employeeId ? maskEmployeeId(item.employeeId) : undefined,
  }));
}
