import type { ReportJson } from '../../models.ts';
import { formatNumber, formatPct } from './utils.ts';

export type ReportStatusTone = 'excellent' | 'good' | 'monitor' | 'risk' | 'neutral';

export interface ReportKpi {
  key: string;
  label: string;
  value: string;
  target: string;
  status: ReportStatusTone;
  explanation: string;
}

export interface ReportFinding {
  headline: string;
  evidence: string;
  implication: string;
  severity: ReportStatusTone;
}

export interface ReportRecommendation {
  action: string;
  owner: string;
  priority: 'High' | 'Medium' | 'Low';
  expectedOutcome: string;
}

export interface ReportCourseRow {
  course: string;
  learners: string;
  attendance: string;
  completion: string;
  passRate: string;
  score: string;
  effectiveness: string;
}

export type ReportChartKind = 'bullet' | 'bar' | 'groupedBar' | 'donut';

export interface ReportChartSeries {
  label: string;
  value: number;
  valueLabel: string;
  tone: ReportStatusTone;
}

export interface ReportChartPoint {
  label: string;
  value: number;
  valueLabel: string;
  target?: number;
  targetLabel?: string;
  tone: ReportStatusTone;
  series?: ReportChartSeries[];
}

export interface ReportChart {
  id: string;
  kind: ReportChartKind;
  title: string;
  subtitle: string;
  unit: 'percent' | 'score100' | 'count';
  maxValue: number;
  points: ReportChartPoint[];
}

export interface ReportModel {
  title: string;
  scope: string;
  audience: string;
  generatedAt: string;
  status: string;
  evidenceStatus: string;
  classification: string;
  executiveHeadline: string;
  executiveMessage: string;
  decisionMessage: string;
  kpis: ReportKpi[];
  findings: ReportFinding[];
  recommendations: ReportRecommendation[];
  courseRows: ReportCourseRow[];
  charts: ReportChart[];
  evidence: {
    finalConclusion: string;
    missingCount: number;
    warningCount: number;
    checklist: Array<{ check: string; status: string; detail: string }>;
  };
  governance: {
    sensitiveDetails: string;
    rawAppendix: string;
    highPriorityCount: number;
    flags: Array<{ rule: string; priority: string; message: string; action: string }>;
  };
  appendix: string[];
  llmDisclosure: string;
}

export function buildReportModel(report: ReportJson): ReportModel {
  const overall = report.metrics.overall;
  const courseRows = report.metrics.courses.slice(0, 8).map((course) => ({
    course: course.courseName,
    learners: String(course.traineeCount),
    attendance: formatPct(course.attendanceRate),
    completion: formatPct(course.completionRate),
    passRate: formatPct(course.passRate),
    score: `${formatNumber(course.averageScore, 2)}/10`,
    effectiveness: formatNumber(course.effectivenessScore, 2),
  }));
  const highFlags = report.governance.normFlags.filter((flag) => flag.priority === 'High');
  const missingCount = report.evidence.missingEvidence.filter(
    (item) => item.severity === 'blocker',
  ).length;
  const warningCount = report.evidence.missingEvidence.length - missingCount;

  return {
    title: cleanText(report.title),
    scope: scopeLine(report),
    audience: roleLabel(report.governance.role),
    generatedAt: new Date(report.generatedAt).toLocaleString('en-US'),
    status:
      report.status === 'FINAL'
        ? 'Finalized'
        : report.status === 'REVISION_REQUESTED'
          ? 'Revision requested'
          : 'Draft',
    evidenceStatus: evidenceLabel(report.evidence.status),
    classification: report.governance.classification,
    executiveHeadline: headlineFor(report),
    executiveMessage: cleanText(report.executiveSummary),
    decisionMessage: report.evidence.canGenerateFinalConclusion
      ? `Final conclusion is allowed. Overall classification is ${report.governance.classification}.`
      : 'Final conclusion is blocked until required evidence is resolved.',
    kpis: [
      kpi(
        'attendance',
        'Attendance',
        formatPct(overall.attendanceRate),
        'Target >= 85%',
        rateTone(overall.attendanceRate, 0.85, 0.75),
        'Learner attendance across validated sessions.',
      ),
      kpi(
        'completion',
        'Completion',
        formatPct(overall.completionRate),
        'Target >= 90%',
        rateTone(overall.completionRate, 0.9, 0.8),
        'Completion is based on attendance >= 70%, separate from pass rate.',
      ),
      kpi(
        'passRate',
        'Pass rate',
        formatPct(overall.passRate),
        'Target >= 80%',
        rateTone(overall.passRate, 0.8, 0.7),
        'Assessment achievement against course pass threshold.',
      ),
      kpi(
        'score',
        'Avg score',
        `${formatNumber(overall.averageScore, 2)}/10`,
        'Threshold 6.5',
        scoreTone(overall.averageScore, 6.5, 5.5),
        'Average assessment score from validated records.',
      ),
      kpi(
        'satisfaction',
        'Satisfaction',
        `${formatNumber(overall.feedbackRating, 2)}/5`,
        'Target >= 4.0',
        scoreTone(overall.feedbackRating, 4, 3.5),
        'Combined trainer and content feedback rating.',
      ),
      kpi(
        'hours',
        'Training hours',
        formatNumber(overall.trainingHours, 1),
        'Tracked',
        'neutral',
        'Total attended training hours.',
      ),
      kpi(
        'cost',
        'Cost',
        formatNumber(overall.totalCostScaled, 1),
        'Scaled cost',
        'neutral',
        'Scaled cost signal for relative comparison.',
      ),
      kpi(
        'roi',
        'ROI proxy',
        formatNumber(overall.roiProxy, 4),
        'Relative KPI',
        overall.roiProxy === null ? 'neutral' : overall.roiProxy > 0 ? 'monitor' : 'risk',
        'Proxy metric using post-training performance delta and scaled cost.',
      ),
    ],
    findings: buildFindings(report),
    recommendations: buildRecommendations(report),
    courseRows,
    charts: buildCharts(report),
    evidence: {
      finalConclusion: report.evidence.canGenerateFinalConclusion ? 'Allowed' : 'Blocked',
      missingCount,
      warningCount,
      checklist: report.evidence.checklist.slice(0, 8).map((item) => ({
        check: cleanText(item.check),
        status: item.status === 'PASS' ? 'Ready' : item.status === 'WARN' ? 'Warning' : 'Blocked',
        detail: cleanText(item.detail),
      })),
    },
    governance: {
      sensitiveDetails: report.governance.masked ? 'Masked' : 'Visible',
      rawAppendix: report.governance.masked ? 'Restricted' : 'Allowed',
      highPriorityCount: highFlags.length,
      flags: report.governance.normFlags.slice(0, 8).map((flag) => ({
        rule: flag.ruleId,
        priority: flag.priority,
        message: cleanText(flag.message),
        action: cleanText(flag.action),
      })),
    },
    appendix: [
      `Report ID: ${report.reportId}`,
      `Dataset ID: ${report.datasetId}`,
      `Metrics snapshot ID: ${report.metricsId}`,
      `Evidence decision ID: ${report.evidenceId}`,
      `Governance view ID: ${report.governanceId}`,
      `Role view: ${roleLabel(report.governance.role)}`,
      `Sensitive details: ${report.governance.masked ? 'masked' : 'visible'}`,
    ],
    llmDisclosure: report.llm?.enabled
      ? `OpenAI ${report.llm.model ?? 'model'} enriched narrative fields. Numeric metrics remain deterministic.`
      : `Deterministic fallback used. ${report.llm?.fallbackReason ?? 'LLM enrichment was not available.'}`,
  };
}

function buildCharts(report: ReportJson): ReportChart[] {
  const overall = report.metrics.overall;
  const charts: ReportChart[] = [];
  const kpiPoints = [
    metricPoint(
      'Attendance',
      percentValue(overall.attendanceRate),
      'percent',
      85,
      rateTone(overall.attendanceRate, 0.85, 0.75),
    ),
    metricPoint(
      'Completion',
      percentValue(overall.completionRate),
      'percent',
      90,
      rateTone(overall.completionRate, 0.9, 0.8),
    ),
    metricPoint(
      'Pass rate',
      percentValue(overall.passRate),
      'percent',
      80,
      rateTone(overall.passRate, 0.8, 0.7),
    ),
    metricPoint(
      'Effectiveness',
      numberValue(overall.effectivenessScore),
      'score100',
      85,
      classificationTone(report.governance.classification),
    ),
  ].filter((point): point is ReportChartPoint => point !== null);

  if (kpiPoints.length >= 3) {
    charts.push({
      id: 'overall-kpis',
      kind: 'bullet',
      title: 'Overall KPI vs target',
      subtitle: 'Validated performance metrics compared with L&D operating thresholds.',
      unit: 'percent',
      maxValue: 100,
      points: kpiPoints,
    });
  }

  const courseRatePoints = report.metrics.courses
    .slice(0, 5)
    .map((course): ReportChartPoint | null => {
      const series = [
        chartSeries(
          'Attendance',
          percentValue(course.attendanceRate),
          'percent',
          rateTone(course.attendanceRate, 0.85, 0.75),
        ),
        chartSeries(
          'Completion',
          percentValue(course.completionRate),
          'percent',
          rateTone(course.completionRate, 0.9, 0.8),
        ),
        chartSeries(
          'Pass rate',
          percentValue(course.passRate),
          'percent',
          rateTone(course.passRate, 0.8, 0.7),
        ),
      ].filter((item): item is ReportChartSeries => item !== null);
      if (series.length < 2) return null;
      return {
        label: cleanText(course.courseName),
        value: Math.max(...series.map((item) => item.value)),
        valueLabel: '',
        tone: 'neutral' as const,
        series,
      };
    })
    .filter((point): point is ReportChartPoint => point !== null);

  if (courseRatePoints.length >= 2) {
    charts.push({
      id: 'course-rate-mix',
      kind: 'groupedBar',
      title: 'Course rate mix',
      subtitle: 'Attendance, completion, and pass rate by course.',
      unit: 'percent',
      maxValue: 100,
      points: courseRatePoints,
    });
  }

  const coursePoints = report.metrics.courses
    .filter((course) => typeof course.effectivenessScore === 'number')
    .slice(0, 8)
    .map((course) =>
      metricPoint(
        course.courseName,
        numberValue(course.effectivenessScore),
        'score100',
        85,
        classificationTone(
          (course.effectivenessScore ?? 0) >= 85
            ? 'Effective'
            : (course.effectivenessScore ?? 0) >= 70
              ? 'Needs improvement'
              : 'Risk',
        ),
      ),
    )
    .filter((point): point is ReportChartPoint => point !== null);

  if (coursePoints.length >= 2) {
    charts.push({
      id: 'course-effectiveness',
      kind: 'bar',
      title: 'Course effectiveness comparison',
      subtitle: 'Effectiveness score by course, using the validated L&D scoring model.',
      unit: 'score100',
      maxValue: 100,
      points: coursePoints,
    });
  }

  const priorityCounts = countFlagsByPriority(report);
  const flagPoints = (['High', 'Medium', 'Low'] as const)
    .map((priority) => {
      const value = priorityCounts[priority] ?? 0;
      if (value <= 0) return null;
      return metricPoint(
        priority,
        value,
        'count',
        undefined,
        priority === 'High' ? 'risk' : priority === 'Medium' ? 'monitor' : 'good',
      );
    })
    .filter((point): point is ReportChartPoint => point !== null);

  if (flagPoints.length > 0) {
    charts.push({
      id: 'norm-flags',
      kind: 'donut',
      title: 'Governance flags by priority',
      subtitle: 'NORM rule triggers grouped by business priority.',
      unit: 'count',
      maxValue: flagPoints.reduce((sum, point) => sum + point.value, 0),
      points: flagPoints,
    });
  }

  return charts;
}

function metricPoint(
  label: string,
  value: number | null,
  unit: ReportChart['unit'],
  target: number | undefined,
  tone: ReportStatusTone,
): ReportChartPoint | null {
  if (value === null || Number.isNaN(value)) return null;
  return {
    label: cleanText(label),
    value,
    valueLabel: formatChartValue(value, unit),
    target,
    targetLabel: target === undefined ? undefined : formatChartValue(target, unit),
    tone,
  };
}

function chartSeries(
  label: string,
  value: number | null,
  unit: ReportChart['unit'],
  tone: ReportStatusTone,
): ReportChartSeries | null {
  if (value === null || Number.isNaN(value)) return null;
  return {
    label,
    value,
    valueLabel: formatChartValue(value, unit),
    tone,
  };
}

function percentValue(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Math.round(value * 1000) / 10;
}

function numberValue(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Math.round(value * 100) / 100;
}

function formatChartValue(value: number, unit: ReportChart['unit']): string {
  if (unit === 'percent') return `${formatNumber(value, 1)}%`;
  if (unit === 'score100') return `${formatNumber(value, 1)}/100`;
  return formatNumber(value, 0);
}

function countFlagsByPriority(report: ReportJson): Record<string, number> {
  return report.governance.normFlags.reduce<Record<string, number>>((acc, flag) => {
    acc[flag.priority] = (acc[flag.priority] ?? 0) + 1;
    return acc;
  }, {});
}

function kpi(
  key: string,
  label: string,
  value: string,
  target: string,
  status: ReportStatusTone,
  explanation: string,
): ReportKpi {
  return { key, label, value, target, status, explanation };
}

function buildFindings(report: ReportJson): ReportFinding[] {
  const overall = report.metrics.overall;
  const findings: ReportFinding[] = [
    {
      headline: `Strong completion outcome at ${formatPct(overall.completionRate)}`,
      evidence: `Completion is calculated as attendance >= 70%; pass rate is tracked separately at ${formatPct(overall.passRate)}.`,
      implication:
        'Learners are completing the required session exposure, and assessment achievement is also healthy.',
      severity: rateTone(overall.completionRate, 0.9, 0.8),
    },
    {
      headline: `Overall effectiveness score is ${formatNumber(overall.effectivenessScore, 2)}`,
      evidence: `Attendance ${formatPct(overall.attendanceRate)}, pass rate ${formatPct(overall.passRate)}, average score ${formatNumber(overall.averageScore, 2)}/10.`,
      implication: `The selected scope is classified as ${report.governance.classification}.`,
      severity: classificationTone(report.governance.classification),
    },
  ];
  for (const insight of report.insights.slice(0, 4)) {
    findings.push({
      headline: cleanText(insight).slice(0, 110),
      evidence: 'Supported by validated metrics, evidence gate, and L&D NORM checks.',
      implication: 'Use this signal to prioritize follow-up actions and stakeholder communication.',
      severity: /risk|attention|support|blocked|flag/i.test(insight) ? 'monitor' : 'good',
    });
  }
  return findings.slice(0, 6);
}

function buildRecommendations(report: ReportJson): ReportRecommendation[] {
  const highFlagActions = new Set(
    report.governance.normFlags
      .filter((flag) => flag.priority === 'High')
      .map((flag) => cleanText(flag.action)),
  );
  const out: ReportRecommendation[] = [];
  for (const action of [...highFlagActions, ...report.recommendations.map(cleanText)]) {
    if (!action) continue;
    out.push({
      action,
      owner: /manager|attendance|direct/i.test(action) ? 'Team Manager + L&D' : 'L&D Manager',
      priority: /block|high|coaching|support|risk|incomplete/i.test(action)
        ? 'High'
        : out.length < 3
          ? 'Medium'
          : 'Low',
      expectedOutcome: /coaching|support|buddy/i.test(action)
        ? 'Improve learner recovery and reduce support-needed cases.'
        : /attendance/i.test(action)
          ? 'Reduce attendance risk in the next cohort.'
          : 'Improve training effectiveness and repeatability.',
    });
    if (out.length >= 6) break;
  }
  if (out.length === 0) {
    out.push({
      action: 'Maintain current delivery model and reuse top-performing materials.',
      owner: 'L&D Manager',
      priority: 'Low',
      expectedOutcome: 'Preserve current performance level while monitoring future cohorts.',
    });
  }
  return out;
}

function headlineFor(report: ReportJson): string {
  const overall = report.metrics.overall;
  if (!report.evidence.canGenerateFinalConclusion)
    return 'Evidence gaps block a final effectiveness conclusion.';
  if ((overall.effectivenessScore ?? 0) >= 85)
    return 'Training effectiveness is strong with validated evidence.';
  if ((overall.effectivenessScore ?? 0) >= 70)
    return 'Training effectiveness is acceptable with areas to monitor.';
  return 'Training effectiveness needs management attention.';
}

function scopeLine(report: ReportJson): string {
  const pieces = [
    report.scope.period ? `Period ${report.scope.period}` : undefined,
    report.scope.courseId ? `Course ${report.scope.courseId}` : undefined,
    report.scope.team ? `Team ${report.scope.team}` : undefined,
    report.scope.reportType ? `Type ${report.scope.reportType}` : undefined,
  ].filter(Boolean);
  return pieces.join(' | ') || 'All available data';
}

function roleLabel(role: string): string {
  if (role === 'LND_MANAGER') return 'L&D Manager';
  if (role === 'BOD') return 'Board of Directors';
  return role;
}

function evidenceLabel(status: string): string {
  if (status === 'PASS') return 'Passed';
  if (status === 'PARTIAL_PASS') return 'Passed with warnings';
  if (status === 'BLOCKED') return 'Blocked';
  return status;
}

function rateTone(
  value: number | null | undefined,
  good: number,
  monitor: number,
): ReportStatusTone {
  if (value === null || value === undefined) return 'neutral';
  if (value >= Math.max(good + 0.08, 0.98)) return 'excellent';
  if (value >= good) return 'good';
  if (value >= monitor) return 'monitor';
  return 'risk';
}

function scoreTone(
  value: number | null | undefined,
  good: number,
  monitor: number,
): ReportStatusTone {
  if (value === null || value === undefined) return 'neutral';
  if (value >= good + 1.2) return 'excellent';
  if (value >= good) return 'good';
  if (value >= monitor) return 'monitor';
  return 'risk';
}

function classificationTone(value: string): ReportStatusTone {
  const normalized = value.toLowerCase();
  if (normalized.includes('effective')) return 'good';
  if (normalized.includes('improvement')) return 'monitor';
  if (normalized.includes('risk') || normalized.includes('not reportable')) return 'risk';
  return 'neutral';
}

function cleanText(value: string): string {
  return value
    .replace(/â€”/g, '-')
    .replace(/â€¢/g, '-')
    .replace(/Â·/g, '|')
    .replace(/\s+/g, ' ')
    .trim();
}
