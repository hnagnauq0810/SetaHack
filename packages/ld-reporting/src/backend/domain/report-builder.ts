import type {
  EvidenceDecision,
  GovernanceView,
  MetricsSnapshot,
  NormalizedDataset,
  ReportJson,
} from '../../models.ts';
import { formatNumber, formatPct, id } from './utils.ts';

export function buildReportJson(input: {
  dataset: NormalizedDataset;
  evidence: EvidenceDecision;
  metrics: MetricsSnapshot;
  governance: GovernanceView;
}): ReportJson {
  const { dataset, evidence, metrics, governance } = input;
  const title = buildTitle(dataset);
  const warnings = buildWarnings(evidence);
  const insights = buildInsights(metrics, governance, evidence);
  const recommendations = buildRecommendations(governance, evidence);
  return {
    reportId: id('rpt'),
    datasetId: dataset.datasetId,
    metricsId: metrics.metricsId,
    evidenceId: evidence.evidenceId,
    governanceId: governance.governanceId,
    title,
    scope: dataset.scope,
    status: 'DRAFT',
    generatedAt: new Date().toISOString(),
    executiveSummary: buildExecutiveSummary(metrics, governance, evidence),
    insights,
    recommendations,
    warnings,
    evidence,
    metrics,
    governance,
  };
}

function buildTitle(dataset: NormalizedDataset): string {
  const scope = dataset.scope;
  if (scope.courseId) {
    const courseName = dataset.courses.find((course) => course.courseId === scope.courseId)?.courseName ?? scope.courseId;
    return `L&D Training Effectiveness Report - ${courseName}`;
  }
  if (scope.period) return `L&D Training Effectiveness Report - ${scope.period}`;
  if (scope.courseId) return `L&D Training Effectiveness Report — ${scope.courseId}`;
  if (scope.period) return `L&D Training Effectiveness Report — ${scope.period}`;
  return 'L&D Training Effectiveness Report';
}

function buildExecutiveSummary(
  metrics: MetricsSnapshot,
  governance: GovernanceView,
  evidence: EvidenceDecision,
): string {
  const o = metrics.overall;
  const reportability = evidence.canGenerateFinalConclusion
    ? `Overall effectiveness classification is ${governance.classification}.`
    : 'Final effectiveness conclusion is blocked because required evidence is incomplete or course status is not completed.';
  return [
    `The selected scope contains ${o.totalCourses} course(s), ${o.completedCourses} completed course(s), and ${o.traineeCount} trainee-course records.`,
    `Overall attendance is ${formatPct(o.attendanceRate)}, completion is ${formatPct(o.completionRate)}, pass rate is ${formatPct(o.passRate)}, and average score is ${formatNumber(o.averageScore, 2)}/10.`,
    `Total training hours are ${formatNumber(o.trainingHours, 2)} and scaled cost is ${formatNumber(o.totalCostScaled, 2)}.`,
    reportability,
  ].join(' ');
}

function buildInsights(
  metrics: MetricsSnapshot,
  governance: GovernanceView,
  evidence: EvidenceDecision,
): string[] {
  const insights: string[] = [];
  const sortedByScore = [...metrics.courses].sort(
    (a, b) => (b.effectivenessScore ?? -1) - (a.effectivenessScore ?? -1),
  );
  const best = sortedByScore[0];
  const weakest = sortedByScore[sortedByScore.length - 1];
  if (best) {
    insights.push(metrics.courses.length === 1
      ? `${best.courseName} has an effectiveness score of ${formatNumber(best.effectivenessScore, 2)} in the selected scope.`
      : `${best.courseName} has the strongest effectiveness score (${formatNumber(best.effectivenessScore, 2)}) in the selected scope.`);
  }
  if (weakest && weakest !== best) {
    insights.push(
      `${weakest.courseName} needs attention with effectiveness score ${formatNumber(weakest.effectivenessScore, 2)}, attendance ${formatPct(weakest.attendanceRate)}, and pass rate ${formatPct(weakest.passRate)}.`,
    );
  }
  if (governance.outstandingTrainees.length > 0) {
    insights.push(
      `${formatCount(governance.outstandingTrainees.length, 'outstanding trainee')} met the star learner rule: score >= 9.0 and full attendance.`,
    );
  }
  if (governance.supportNeededGroups.length > 0) {
    insights.push(
      `${formatCount(governance.supportNeededGroups.length, 'course group')} contained learners who need support based on score or attendance policy.`,
    );
  }
  const highFlags = governance.normFlags.filter((flag) => flag.priority === 'High').length;
  if (highFlags > 0) insights.push(`${formatCount(highFlags, 'high-priority L&D NORM flag')} ${highFlags === 1 ? 'was' : 'were'} triggered.`);
  if (evidence.status !== 'PASS') {
    insights.push(`Evidence status is ${evidence.status}; conclusions must be limited to validated metrics.`);
  }
  return insights;
}

function buildRecommendations(governance: GovernanceView, evidence: EvidenceDecision): string[] {
  const recommendations: string[] = [];
  if (!evidence.canGenerateFinalConclusion) {
    recommendations.push('Do not publish a final effectiveness conclusion until blocked evidence items are resolved.');
    recommendations.push('Use this output as a preliminary readiness report and assign owners to missing evidence items.');
  }
  const highActions = governance.normFlags
    .filter((flag) => flag.priority === 'High')
    .slice(0, 5)
    .map((flag) => humanizeNormAction(flag.action));
  recommendations.push(...Array.from(new Set(highActions)));
  if (governance.supportNeededGroups.length > 0) {
    recommendations.push('Assign a coaching owner for support-needed learners and review attendance issues with direct managers.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Maintain the current delivery model and reuse top-performing materials for future cohorts.');
  }
  return recommendations;
}

function buildWarnings(evidence: EvidenceDecision): string[] {
  return evidence.missingEvidence.map((item) => `[${item.severity.toUpperCase()}] ${item.message}`);
}

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function humanizeNormAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  if (normalized.includes('flag for coaching')) {
    return 'Assign a coaching owner, buddy support, and targeted practice resources for the flagged learner.';
  }
  if (normalized.includes('mark as incomplete')) {
    return 'Mark incomplete learner records for review and schedule re-enrollment in the next suitable cohort.';
  }
  if (normalized.includes('content review')) {
    return 'Open a course content review with the L&D manager and confirm the improvement owner.';
  }
  if (normalized.includes('course redesign')) {
    return 'Start a course redesign review and decide whether re-delivery is required.';
  }
  if (normalized.includes('trainer coaching')) {
    return 'Escalate trainer quality concerns to the L&D manager and schedule a coaching session.';
  }
  if (normalized.includes('audit course design')) {
    return 'Audit course design and strengthen on-the-job application support.';
  }
  if (normalized.includes('verify with trainer')) {
    return 'Verify pass-status inconsistencies with the trainer before publishing the final report.';
  }
  return action;
}
