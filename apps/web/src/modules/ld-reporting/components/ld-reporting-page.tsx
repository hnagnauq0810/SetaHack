import { PageChrome } from '@seta/shared-ui';
import { Bot } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  AgentMemoryPanel,
  AgentSidePanel,
  AgentThreadRail,
  useAgentContext,
} from '@/modules/agent';
import { useAgentSelection, usePanelUI } from '@/modules/agent/chat-experience/agent-provider';
import { useSession } from '@/modules/identity/components/SessionProvider';
import type { LdReport, LdRequestPayload, ReadinessResult } from '../api-client';
import {
  evidenceLabel,
  evidenceTone,
  reportStatusLabel,
  reportTone,
  roleLabel,
} from './display-utils';
import { ExportArtifactsCard } from './export-artifacts-card';
import { GovernanceAccessCard } from './governance-access-card';
import { PerformanceOverview } from './performance-overview';
import { ReadinessEvidenceCard } from './readiness-evidence-card';
import { ReportDraftCard } from './report-draft-card';
import { ReportScopeCard } from './report-scope-card';
import { StatusBadge } from './status-badge';
import { WorkflowStepper } from './workflow-stepper';

export function LdReportingPage() {
  const [period, setPeriod] = useState('2026-Q1');
  const [courseId, setCourseId] = useState('');
  const [team, setTeam] = useState('');
  const [readiness] = useState<ReadinessResult | null>(null);
  const [report] = useState<LdReport | null>(null);
  const session = useSession();
  const { selection } = useAgentSelection();
  const { setPanelOpen } = usePanelUI();
  const permissions = useMemo(() => new Set(session.permissions), [session.permissions]);

  const payload = useMemo<LdRequestPayload>(() => {
    const selectedCourseId = courseId.trim();
    const selectedPeriod = period.trim();
    return {
      scope: {
        period: selectedCourseId ? undefined : selectedPeriod || undefined,
        courseId: selectedCourseId || undefined,
        team: team.trim() || undefined,
        reportType: 'full',
      },
    };
  }, [period, courseId, team]);

  const scopeSelected = Boolean(
    payload.scope.period || payload.scope.courseId || payload.scope.team,
  );
  const evidence = report?.evidence ?? readiness?.evidence;
  const roleFromReport = report?.governance.role;
  const sessionRole = roleFromReport ?? deriveSessionRole(session.role_summary.roles, permissions);
  const canRead = permissions.has('ld-reporting.read');
  const canGenerate = permissions.has('ld-reporting.report.generate');
  const canFinalize = permissions.has('ld-reporting.report.finalize');
  const scopeSummary = scopeSummaryText(payload);
  const hasValidatedArtifact = Boolean(readiness || report);

  useAgentContext({
    kind: 'ld-reporting',
    id: report?.reportId ?? 'workspace',
    label: report?.title ?? 'Training Effectiveness Agent',
    summary: `${scopeSummary}; reportId=${report?.reportId ?? 'none'}; evidence=${evidence?.status ?? 'not_checked'}; status=${report?.status ?? 'no_draft'}`,
  });

  useEffect(() => {
    setPanelOpen(false);
  }, [setPanelOpen]);

  if (!canRead) {
    return (
      <PageChrome breadcrumb={['L&D Reporting']} title="Training Effectiveness Agent">
        <div className="min-h-full bg-slate-50 p-6">
          <section className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
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
      <div className="min-h-full bg-slate-50">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-6 p-6">
          <section className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
            <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:block">
              <AgentThreadRail
                activeThreadId={selection.threadId}
                stayInPlace
                className="h-full border-r-0 lg:w-full"
              />
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-6 py-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <Bot className="size-4 text-blue-600" />
                      L&D Reporting Agent
                    </div>
                    <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                      Training Effectiveness Agent
                    </h1>
                    <p className="mt-2 max-w-3xl text-base leading-7 text-slate-600">
                      Evidence, draft report, Q&A, export request and final approval are handled
                      through the conversation.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <StatusBadge tone={evidenceTone(evidence?.status)}>
                      Evidence: {evidenceLabel(evidence?.status)}
                    </StatusBadge>
                    <StatusBadge tone={reportTone(report?.status)}>
                      Report: {reportStatusLabel(report?.status)}
                    </StatusBadge>
                    <StatusBadge tone="info">View: {roleLabel(sessionRole)}</StatusBadge>
                    {!canGenerate && <StatusBadge tone="neutral">Read-only</StatusBadge>}
                    {canFinalize && <StatusBadge tone="success">Human review</StatusBadge>}
                    {report?.llm && !report.llm.enabled && (
                      <StatusBadge tone="warning">Deterministic mode</StatusBadge>
                    )}
                  </div>
                </div>
              </div>
              <div className="h-[620px] min-h-0 bg-white">
                <AgentSidePanel showThreadSwitcher={false} showEmptySuggestions={false} />
              </div>
            </div>

            <div className="hidden h-[744px] overflow-hidden rounded-2xl border border-slate-200 shadow-sm xl:block">
              <AgentMemoryPanel />
            </div>
          </section>

          {hasValidatedArtifact && (
            <WorkflowStepper readiness={readiness} report={report} scopeSelected={scopeSelected} />
          )}

          <ReportScopeCard
            period={period}
            courseId={courseId}
            team={team}
            readiness={readiness}
            report={report}
            onPeriodChange={setPeriod}
            onCourseIdChange={setCourseId}
            onTeamChange={setTeam}
          />

          {report && <PerformanceOverview report={report} />}

          {hasValidatedArtifact && (
            <div className="grid gap-6 xl:grid-cols-2">
              <ReadinessEvidenceCard readiness={readiness} report={report} />
              <GovernanceAccessCard report={report} />
            </div>
          )}

          {report && (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,0.95fr)]">
              <ReportDraftCard report={report} />
              <div className="space-y-6">
                <ExportArtifactsCard report={report} />
              </div>
            </div>
          )}
        </div>
      </div>
    </PageChrome>
  );
}

function scopeSummaryText(payload: LdRequestPayload): string {
  return [
    `period=${payload.scope.period ?? 'none'}`,
    `courseId=${payload.scope.courseId ?? 'none'}`,
    `team=${payload.scope.team ?? 'none'}`,
  ].join('; ');
}

function deriveSessionRole(roles: readonly string[], permissions: ReadonlySet<string>) {
  if (
    permissions.has('ld-reporting.sensitive.read') ||
    permissions.has('ld-reporting.report.generate') ||
    permissions.has('ld-reporting.report.finalize') ||
    roles.includes('ld-reporting.manager')
  ) {
    return 'LND_MANAGER' as const;
  }
  if (roles.includes('ld-reporting.trainer')) return 'TRAINER' as const;
  if (roles.includes('ld-reporting.bod')) return 'BOD' as const;
  return 'TEAM_MANAGER' as const;
}
