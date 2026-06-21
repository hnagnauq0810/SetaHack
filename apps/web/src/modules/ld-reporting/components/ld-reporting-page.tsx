import { Button, cn, Input, Label, PageChrome, Textarea } from '@seta/shared-ui';
import { FileText, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgentSidePanel, AgentThreadRail, useAgentContext } from '@/modules/agent';
import { useAgentSelection, usePanelUI } from '@/modules/agent/chat-experience/agent-provider';
import { useSession } from '@/modules/identity/components/SessionProvider';
import { type LdReport, type LdRole, ldReportingClient } from '../api-client';
import {
  classificationTone,
  evidenceLabel,
  evidenceTone,
  formatDateTime,
  formatNum,
  formatPct,
  reportStatusLabel,
  reportTone,
} from './display-utils';
import { StatusBadge } from './status-badge';

export function LdReportingPage() {
  const session = useSession();
  const permissions = useMemo(() => new Set(session.permissions), [session.permissions]);
  const canRead = permissions.has('ld-reporting.read');
  const role = deriveSessionRole(session.role_summary.roles, permissions);
  const canEditDraft = permissions.has('ld-reporting.report.generate');
  const { selection } = useAgentSelection();
  const { setPanelOpen } = usePanelUI();
  const [reports, setReports] = useState<LdReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);

  const selectedReport = useMemo(
    () => reports.find((report) => report.reportId === selectedReportId) ?? null,
    [reports, selectedReportId],
  );

  const loadReports = useCallback(async () => {
    if (!canRead) return;
    setReportsLoading(true);
    setReportsError(null);
    try {
      const result = await ldReportingClient.listReports();
      setReports(result.reports);
      setSelectedReportId((current) => {
        if (current && result.reports.some((report) => report.reportId === current)) {
          return current;
        }
        return result.reports[0]?.reportId ?? null;
      });
    } catch (err) {
      setReportsError(err instanceof Error ? err.message : 'Unable to load reports');
    } finally {
      setReportsLoading(false);
    }
  }, [canRead]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    setPanelOpen(false);
  }, [setPanelOpen]);

  const contextSummary = useMemo(() => {
    if (selectedReport) {
      const base =
        `Selected L&D reportId=${selectedReport.reportId}; title="${selectedReport.title}"; ` +
        `status=${selectedReport.status}; evidence=${selectedReport.evidence.status}; ` +
        `classification=${selectedReport.governance.classification}.`;
      if (role === 'BOD') {
        return `${base} BOD chat must answer only from this selected finalized report. Always use reportId=${selectedReport.reportId} for report Q&A and do not switch to draft, generated, or other report artifacts unless the user selects another finalized report in the workspace.`;
      }
      return `${base} L&D Manager can review this report, request manual edits already saved in the report artifact, ask for export, or finalize through human review. Prefer reportId=${selectedReport.reportId} for report-specific actions.`;
    }
    return role === 'LND_MANAGER'
      ? 'Chat-first L&D Manager workspace. Use chat to check evidence, generate draft reports, request exports, and finalize through human review. Draft edits made in the report panel update the report artifact before finalization.'
      : 'Chat-first BOD workspace. Only finalized L&D reports are visible and available for Q&A. Draft and revision-requested reports are excluded.';
  }, [role, selectedReport]);

  useAgentContext({
    kind: 'ld-reporting',
    id: selectedReport?.reportId ?? 'workspace',
    label: selectedReport?.title ?? 'Training Effectiveness Agent',
    summary: contextSummary,
  });

  const handleReportSaved = useCallback((updated: LdReport) => {
    setReports((current) => {
      const next = current.map((report) =>
        report.reportId === updated.reportId ? updated : report,
      );
      return next.some((report) => report.reportId === updated.reportId)
        ? next
        : [updated, ...next];
    });
    setSelectedReportId(updated.reportId);
  }, []);

  if (!canRead) {
    return (
      <PageChrome breadcrumb={['L&D Reporting']} title="Training Effectiveness Agent">
        <div className="min-h-full bg-slate-50 p-6">
          <section className="mx-auto max-w-3xl rounded-lg border border-red-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-semibold uppercase tracking-wide text-red-600">
              Access restricted
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">
              L&D reporting is not available for this account
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Your current session does not include the L&D reporting read permission.
            </p>
          </section>
        </div>
      </PageChrome>
    );
  }

  return (
    <PageChrome breadcrumb={['L&D Reporting']} title="Training Effectiveness Agent">
      <div className="min-h-[calc(100vh-92px)] bg-slate-50 p-3 sm:p-4 lg:p-5">
        <section className="mx-auto grid h-[calc(100vh-132px)] min-h-[660px] max-w-[1740px] min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(520px,1fr)_440px]">
          <aside className="hidden min-h-0 border-r border-slate-200 bg-slate-50/70 md:block">
            <AgentThreadRail
              activeThreadId={selection.threadId}
              stayInPlace
              className="h-full border-r-0 md:w-full"
            />
          </aside>

          <main className="min-h-0 bg-white">
            <AgentSidePanel showThreadSwitcher showEmptySuggestions />
          </main>

          <aside className="hidden min-h-0 border-l border-slate-200 bg-slate-50/80 2xl:flex">
            <ReportWorkspacePanel
              role={role}
              canEditDraft={canEditDraft}
              reports={reports}
              selectedReport={selectedReport}
              loading={reportsLoading}
              error={reportsError}
              onRefresh={loadReports}
              onSelectReport={setSelectedReportId}
              onReportSaved={handleReportSaved}
            />
          </aside>
        </section>

        <div className="mx-auto mt-4 max-w-[1500px] 2xl:hidden">
          <ReportWorkspacePanel
            role={role}
            canEditDraft={canEditDraft}
            reports={reports}
            selectedReport={selectedReport}
            loading={reportsLoading}
            error={reportsError}
            onRefresh={loadReports}
            onSelectReport={setSelectedReportId}
            onReportSaved={handleReportSaved}
          />
        </div>
      </div>
    </PageChrome>
  );
}

function ReportWorkspacePanel({
  role,
  canEditDraft,
  reports,
  selectedReport,
  loading,
  error,
  onRefresh,
  onSelectReport,
  onReportSaved,
}: {
  role: LdRole;
  canEditDraft: boolean;
  reports: LdReport[];
  selectedReport: LdReport | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void | Promise<void>;
  onSelectReport: (reportId: string) => void;
  onReportSaved: (report: LdReport) => void;
}) {
  const title = role === 'BOD' ? 'Finalized reports' : 'Reports';

  return (
    <div className="flex h-full min-h-[560px] w-full min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white 2xl:rounded-none 2xl:border-0">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
            {role === 'BOD' ? <ShieldCheck className="size-4" /> : <FileText className="size-4" />}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-950">{title}</h2>
            <p className="truncate text-xs text-slate-500">
              {reports.length} {reports.length === 1 ? 'artifact' : 'artifacts'}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void onRefresh()}
          disabled={loading}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      <div className="shrink-0 border-b border-slate-200 p-3">
        <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
          {reports.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              {loading ? 'Loading reports...' : 'No report is available for this role.'}
            </div>
          ) : (
            reports.map((report) => (
              <ReportListButton
                key={report.reportId}
                report={report}
                selected={selectedReport?.reportId === report.reportId}
                onSelect={onSelectReport}
              />
            ))
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {selectedReport ? (
          <ReportDetail
            report={selectedReport}
            role={role}
            canEditDraft={canEditDraft}
            onReportSaved={onReportSaved}
          />
        ) : (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Select a report to view its finalized content.
          </div>
        )}
      </div>
    </div>
  );
}

function ReportListButton({
  report,
  selected,
  onSelect,
}: {
  report: LdReport;
  selected: boolean;
  onSelect: (reportId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(report.reportId)}
      className={cn(
        'w-full rounded-md border px-3 py-2 text-left transition-colors',
        selected
          ? 'border-blue-300 bg-blue-50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-950">{report.title}</div>
          <div className="mt-0.5 truncate text-xs text-slate-500">{scopeLabel(report)}</div>
        </div>
        <StatusBadge tone={reportTone(report.status)} className="h-5 shrink-0 px-2 text-[11px]">
          {reportStatusLabel(report.status)}
        </StatusBadge>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
          {formatDateTime(report.finalizedAt ?? report.lastEditedAt ?? report.generatedAt)}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
          {report.governance.classification}
        </span>
      </div>
    </button>
  );
}

function ReportDetail({
  report,
  role,
  canEditDraft,
  onReportSaved,
}: {
  report: LdReport;
  role: LdRole;
  canEditDraft: boolean;
  onReportSaved: (report: LdReport) => void;
}) {
  const metrics = report.metrics.overall;
  const canEdit = role === 'LND_MANAGER' && canEditDraft && report.status !== 'FINAL';

  return (
    <div className="space-y-4">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={reportTone(report.status)}>
            {reportStatusLabel(report.status)}
          </StatusBadge>
          <StatusBadge tone={evidenceTone(report.evidence.status)}>
            Evidence {evidenceLabel(report.evidence.status)}
          </StatusBadge>
          <StatusBadge tone={classificationTone(report.governance.classification)}>
            {report.governance.classification}
          </StatusBadge>
        </div>
        <div>
          <h3 className="text-base font-semibold leading-6 text-slate-950">{report.title}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {scopeLabel(report)} · generated {formatDateTime(report.generatedAt)}
            {report.finalizedAt ? ` · finalized ${formatDateTime(report.finalizedAt)}` : ''}
            {report.lastEditedAt ? ` · edited ${formatDateTime(report.lastEditedAt)}` : ''}
          </p>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <MetricTile label="Attendance" value={formatPct(metrics.attendanceRate)} />
        <MetricTile label="Completion" value={formatPct(metrics.completionRate)} />
        <MetricTile label="Pass rate" value={formatPct(metrics.passRate)} />
        <MetricTile label="Avg score" value={formatNum(metrics.averageScore, 2)} />
        <MetricTile label="Feedback" value={formatNum(metrics.feedbackRating, 2)} />
        <MetricTile label="Effectiveness" value={formatNum(metrics.effectivenessScore, 2)} />
      </section>

      <SectionBlock title="Executive summary">
        <p className="text-sm leading-6 text-slate-700">{report.executiveSummary}</p>
      </SectionBlock>

      <SectionBlock title="Insights">
        <BulletList items={report.insights} empty="No insight recorded." />
      </SectionBlock>

      <SectionBlock title="Recommendations">
        <BulletList items={report.recommendations} empty="No recommendation recorded." />
      </SectionBlock>

      {report.warnings.length > 0 ? (
        <SectionBlock title="Warnings">
          <BulletList items={report.warnings} empty="No warning recorded." />
        </SectionBlock>
      ) : null}

      {canEdit ? (
        <DraftEditor key={report.reportId} report={report} onReportSaved={onReportSaved} />
      ) : null}
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function SectionBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-1.5 text-sm leading-6 text-slate-700">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-400" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function DraftEditor({
  report,
  onReportSaved,
}: {
  report: LdReport;
  onReportSaved: (report: LdReport) => void;
}) {
  const [title, setTitle] = useState(report.title);
  const [summary, setSummary] = useState(report.executiveSummary);
  const [insights, setInsights] = useState(joinLines(report.insights));
  const [recommendations, setRecommendations] = useState(joinLines(report.recommendations));
  const [warnings, setWarnings] = useState(joinLines(report.warnings));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    title !== report.title ||
    summary !== report.executiveSummary ||
    insights !== joinLines(report.insights) ||
    recommendations !== joinLines(report.recommendations) ||
    warnings !== joinLines(report.warnings);

  async function saveDraft() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await ldReportingClient.updateDraft(report.reportId, {
        title,
        executiveSummary: summary,
        insights: splitLines(insights),
        recommendations: splitLines(recommendations),
        warnings: splitLines(warnings),
      });
      onReportSaved(updated);
      setMessage('Draft saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save draft');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-md border border-blue-200 bg-blue-50/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-slate-950">Manual draft edit</h4>
        <Button type="button" size="sm" onClick={saveDraft} disabled={!dirty || saving}>
          <Save className="size-3.5" />
          {saving ? 'Saving' : 'Save'}
        </Button>
      </div>

      <div className="mt-3 space-y-3">
        <Field label="Title">
          <Input value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
        </Field>
        <Field label="Executive summary">
          <Textarea
            value={summary}
            onChange={(event) => setSummary(event.currentTarget.value)}
            rows={5}
          />
        </Field>
        <Field label="Insights">
          <Textarea
            value={insights}
            onChange={(event) => setInsights(event.currentTarget.value)}
            rows={5}
          />
        </Field>
        <Field label="Recommendations">
          <Textarea
            value={recommendations}
            onChange={(event) => setRecommendations(event.currentTarget.value)}
            rows={5}
          />
        </Field>
        <Field label="Warnings">
          <Textarea
            value={warnings}
            onChange={(event) => setWarnings(event.currentTarget.value)}
            rows={3}
          />
        </Field>
      </div>

      {message ? <p className="mt-3 text-xs font-medium text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-3 text-xs font-medium text-red-700">{error}</p> : null}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-slate-600">{label}</Label>
      {children}
    </div>
  );
}

function deriveSessionRole(roles: readonly string[], permissions: ReadonlySet<string>): LdRole {
  if (
    permissions.has('ld-reporting.sensitive.read') ||
    permissions.has('ld-reporting.report.generate') ||
    permissions.has('ld-reporting.report.finalize') ||
    roles.includes('ld-reporting.manager')
  ) {
    return 'LND_MANAGER';
  }
  return 'BOD';
}

function scopeLabel(report: LdReport): string {
  const parts = [
    report.scope.courseId ? `Course ${report.scope.courseId}` : null,
    report.scope.period ?? null,
    report.scope.team ? `Team ${report.scope.team}` : null,
    report.scope.reportType ?? null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Full scope';
}

function joinLines(items: string[]): string {
  return items.join('\n');
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
