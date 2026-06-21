import type { QualityCheckResult, ReportJson } from '../../models.ts';
import { id } from './utils.ts';

export function validateReportQuality(report: ReportJson): QualityCheckResult {
  const issues: string[] = [];
  if (!report.executiveSummary.includes(String(report.metrics.overall.totalCourses))) {
    issues.push('Executive summary does not include the validated total course count.');
  }
  if (!report.executiveSummary.includes(String(report.metrics.overall.traineeCount))) {
    issues.push('Executive summary does not include the validated trainee count.');
  }
  if (!report.evidence.canGenerateFinalConclusion && report.governance.classification !== 'Not reportable') {
    issues.push('Report has blocked evidence but still provides a final effectiveness classification.');
  }
  if (report.evidence.status === 'BLOCKED' && report.recommendations.length === 0) {
    issues.push('Blocked evidence requires at least one remediation recommendation.');
  }
  const status = issues.length === 0 ? 'PASS' : issues.length <= 2 ? 'REVISION_REQUIRED' : 'FAIL';
  return {
    qualityId: id('qc'),
    status,
    generatedAt: new Date().toISOString(),
    issues,
  };
}
