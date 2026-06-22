import { Button, Card, CardContent, cn } from '@seta/shared-ui';
import { AlertTriangle, Check, CheckCircle2, Clock3, RotateCcw } from 'lucide-react';
import type { LdReport } from '../api-client';
import { reportStatusLabel, reportTone } from './display-utils';
import { StatusBadge } from './status-badge';

interface ReviewApprovalCardProps {
  report: LdReport | null;
  loading: string | null;
  error?: string | null;
  onFinalize: (decision: 'approve' | 'revise' | 'regenerate') => void;
}

export function ReviewApprovalCard({ report, loading, error, onFinalize }: ReviewApprovalCardProps) {
  const finalized = report?.status === 'FINAL';
  const revision = report?.status === 'REVISION_REQUESTED';
  const evidenceReady =
    report?.evidence.status !== 'BLOCKED' && report?.evidence.canGenerateFinalConclusion === true;
  const qualityReady = report?.quality?.status === 'PASS';
  const approvalReady = Boolean(report && evidenceReady && qualityReady);
  const blockedReason = !report
    ? null
    : !evidenceReady
      ? 'Evidence Gate is blocking the final conclusion. Resolve blocker evidence before approval.'
      : !qualityReady
        ? `Quality Gate must be PASS before approval (current: ${report.quality?.status ?? 'NOT_CHECKED'}).`
        : null;

  return (
    <Card className="rounded-2xl border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-slate-700" />
            <h2 className="text-lg font-semibold text-slate-950">Review & approval</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">Finalize the draft after L&D review.</p>
        </div>
        <StatusBadge tone={reportTone(report?.status)}>{reportStatusLabel(report?.status)}</StatusBadge>
      </div>

      <CardContent className="pt-5">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-950">
              {finalized
                ? 'Report finalized'
                : revision
                  ? 'Revision requested'
                  : report
                    ? 'Awaiting L&D review'
                    : 'Draft not generated'}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {finalized
                ? 'Export the final artifacts for distribution.'
                : report
                  ? 'Review the generated draft, evidence and recommendations before final approval.'
                  : 'Generate a draft report to begin the review workflow.'}
            </p>
          </div>

          <Timeline report={report} />

          {blockedReason ? (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{blockedReason}</span>
            </div>
          ) : null}
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="grid gap-2">
            <Button
              type="button"
              onClick={() => onFinalize('approve')}
              disabled={!approvalReady || finalized || loading !== null}
              className="h-10 bg-emerald-700 text-white hover:bg-emerald-800"
            >
              <Check className="size-4" />
              {loading === 'approve' ? 'Approving...' : 'Approve final report'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onFinalize('revise')}
              disabled={!report || finalized || loading !== null}
              className="h-10"
            >
              Request revision
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onFinalize('regenerate')}
              disabled={!report || finalized || loading !== null}
              className="h-10"
            >
              <RotateCcw className="size-4" />
              {finalized ? 'Report finalized' : loading === 'regenerate' ? 'Updating...' : 'Return to draft'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Timeline({ report }: { report: LdReport | null }) {
  const items = [
    { label: 'Readiness checked', done: Boolean(report?.evidence) },
    { label: 'Metrics calculated', done: Boolean(report?.metrics) },
    { label: 'Draft generated', done: Boolean(report) },
    { label: report?.status === 'FINAL' ? 'Approved' : 'Awaiting approval', done: report?.status === 'FINAL' },
  ];
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3 text-sm">
          <span
            className={cn(
              'flex size-6 items-center justify-center rounded-full border',
              item.done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-400',
            )}
          >
            {item.done ? <Check className="size-3.5" /> : <Clock3 className="size-3.5" />}
          </span>
          <span className={item.done ? 'font-medium text-slate-800' : 'text-slate-500'}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
