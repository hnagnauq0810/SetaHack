import { Button, Card, CardContent, cn } from '@seta/shared-ui';
import { AlertTriangle, ChevronDown, Database, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { LdReport, ReadinessResult } from '../api-client';
import {
  evidenceBusinessLabel,
  evidenceLabel,
  evidenceTone,
} from './display-utils';
import { StatusBadge } from './status-badge';

interface ReadinessEvidenceCardProps {
  readiness: ReadinessResult | null;
  report: LdReport | null;
}

const SOURCE_LABELS: Record<string, string> = {
  DS07_Attendance_Log: 'Attendance data',
  DS08_Assessment_Score: 'Assessment scores',
  DS09_Feedback_Survey: 'Feedback survey',
  DS10_Training_Cost_ROI: 'Cost & ROI',
  DS11_LnD_Training_NORM: 'L&D NORM rules',
  DS12_Report_Template_Structure: 'Report template',
  DS06_Course_Catalog: 'Course catalog',
};

const DEFAULT_SOURCES = [
  'Attendance data',
  'Assessment scores',
  'Feedback survey',
  'Cost & ROI',
  'L&D NORM rules',
  'Report template',
];

export function ReadinessEvidenceCard({ readiness, report }: ReadinessEvidenceCardProps) {
  const [open, setOpen] = useState(false);
  const evidence = report?.evidence ?? readiness?.evidence;
  const missingCount = evidence?.missingEvidence.filter((item) => item.severity === 'blocker').length ?? 0;
  const warningCount =
    evidence?.missingEvidence.filter((item) => item.severity !== 'blocker').length ??
    evidence?.missingEvidence.length ??
    0;
  const sources = buildSources(readiness, Boolean(report || evidence));
  const issues = evidence?.missingEvidence ?? [];

  return (
    <Card className="rounded-2xl border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-slate-700" />
            <h2 className="text-lg font-semibold text-slate-950">Readiness & Evidence</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Business-ready evidence status from source sheets and validation checks.
          </p>
        </div>
        <StatusBadge tone={evidenceTone(evidence?.status)}>{evidenceLabel(evidence?.status)}</StatusBadge>
      </div>

      <CardContent className="pt-5">
        <div
          className={cn(
            'rounded-2xl border p-4',
            evidence?.status === 'PASS' && 'border-emerald-200 bg-emerald-50',
            evidence?.status === 'PARTIAL_PASS' && 'border-amber-200 bg-amber-50',
            evidence?.status === 'BLOCKED' && 'border-red-200 bg-red-50',
            !evidence && 'border-slate-200 bg-slate-50',
          )}
        >
          <div className="text-sm font-medium text-slate-600">Evidence decision</div>
          <div className="mt-1 text-xl font-semibold text-slate-950">
            {evidenceBusinessLabel(evidence?.status)}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <EvidenceStat
              label="Final conclusion"
              value={
                evidence?.canGenerateFinalConclusion
                  ? 'Allowed'
                  : evidence
                    ? 'Blocked'
                    : 'Pending'
              }
            />
            <EvidenceStat label="Missing evidence" value={String(missingCount)} />
            <EvidenceStat label="Warnings" value={String(warningCount)} />
          </div>
        </div>

        {issues.length > 0 && (
          <div className="mt-5 rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <AlertTriangle className="size-4 text-amber-600" />
              <div className="text-sm font-semibold text-slate-950">Evidence issues</div>
            </div>
            <div className="divide-y divide-slate-100">
              {issues.slice(0, 6).map((issue, index) => (
                <div key={`${issue.type ?? 'issue'}-${issue.courseId ?? 'scope'}-${issue.field ?? index}`} className="grid gap-3 px-4 py-3 md:grid-cols-[auto_1fr_auto]">
                  <StatusBadge tone={issue.severity === 'blocker' ? 'danger' : 'warning'}>
                    {issue.severity === 'blocker' ? 'Blocker' : 'Warning'}
                  </StatusBadge>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900">{issue.message}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      {issue.sheetName && <span>{issue.sheetName}</span>}
                      {issue.courseId && <span>Course {issue.courseId}</span>}
                      {issue.employeeId && <span>Learner {issue.employeeId}</span>}
                      {issue.field && <span>Field {issue.field}</span>}
                    </div>
                    {issue.recommendedFix && (
                      <div className="mt-2 text-xs leading-5 text-slate-600">{issue.recommendedFix}</div>
                    )}
                  </div>
                  {issue.ownerRole && (
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{issue.ownerRole}</div>
                  )}
                </div>
              ))}
            </div>
            {issues.length > 6 && (
              <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                Showing 6 of {issues.length} evidence issues.
              </div>
            )}
          </div>
        )}

        <div className="mt-5 grid gap-2">
          {sources.slice(0, 6).map((source) => (
            <div
              key={source.label}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Database className="size-4 shrink-0 text-slate-500" />
                <span className="truncate text-sm font-medium text-slate-800">{source.label}</span>
              </div>
              <StatusBadge tone={source.ready ? 'success' : 'danger'}>
                {source.ready ? 'Ready' : 'Needs attention'}
              </StatusBadge>
            </div>
          ))}
        </div>

        {(readiness?.sourceReadiness.length ?? 0) > 0 && (
          <div className="mt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen((value) => !value)}
              className="text-slate-600"
            >
              <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
              View source details
            </Button>
            {open && (
              <div className="mt-3 max-h-44 overflow-auto rounded-xl border border-slate-200 bg-white">
                {readiness?.sourceReadiness.map((source) => (
                  <div
                    key={source.sheetName}
                    className="grid gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0 sm:grid-cols-[1fr_auto]"
                  >
                    <div>
                      <div className="font-medium text-slate-800">
                        {SOURCE_LABELS[source.sheetName] ?? source.sheetName}
                      </div>
                      <div className="text-xs text-slate-500">
                        {source.sheetName} . {source.rowCount} rows
                      </div>
                    </div>
                    <StatusBadge tone={source.present && source.missingColumns.length === 0 ? 'success' : 'danger'}>
                      {source.present && source.missingColumns.length === 0 ? 'Ready' : 'Review'}
                    </StatusBadge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EvidenceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/75 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-base font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function buildSources(readiness: ReadinessResult | null, hasEvidence: boolean) {
  if (!readiness?.sourceReadiness.length) {
    return DEFAULT_SOURCES.map((label) => ({ label, ready: hasEvidence }));
  }
  return readiness.sourceReadiness
    .filter((source) => source.sheetName !== 'DS06_Course_Catalog')
    .map((source) => ({
      label: SOURCE_LABELS[source.sheetName] ?? source.sheetName,
      ready: source.present && source.missingColumns.length === 0,
    }));
}
