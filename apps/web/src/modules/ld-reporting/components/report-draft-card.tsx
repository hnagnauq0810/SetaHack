import { Card, CardContent, Tabs, TabsContent, TabsList, TabsTrigger } from '@seta/shared-ui';
import { CheckCircle2, FileText, Lightbulb, ListChecks, ShieldCheck } from 'lucide-react';
import type { LdReport } from '../api-client';
import {
  evidenceLabel,
  evidenceTone,
  formatDateTime,
  llmFallbackLabel,
  reportStatusLabel,
  reportTone,
} from './display-utils';
import { StatusBadge } from './status-badge';

interface ReportDraftCardProps {
  report: LdReport | null;
}

export function ReportDraftCard({ report }: ReportDraftCardProps) {
  const llmFallback = report?.llm && !report.llm.enabled;
  const heading = reportHeading(report);
  const scope = reportScopeLabel(report);

  return (
    <Card className="rounded-lg border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-slate-700" />
            <h2 className="text-lg font-semibold text-slate-950">{heading}</h2>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="truncate">{scope}</span>
            <span className="text-slate-300">/</span>
            <span>{formatDateTime(report?.generatedAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={reportTone(report?.status)}>{reportStatusLabel(report?.status)}</StatusBadge>
          <StatusBadge tone={evidenceTone(report?.evidence.status)}>
            {evidenceLabel(report?.evidence.status)}
          </StatusBadge>
        </div>
      </div>

      <CardContent className="pt-5">
        {report ? (
          <div className="space-y-5">
            {llmFallback && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <div className="font-medium">AI narrative unavailable</div>
                <div className="mt-1 text-xs leading-5 text-amber-700">
                  {llmFallbackLabel(report.llm?.fallbackReason)}
                </div>
              </div>
            )}
            <Tabs defaultValue="summary">
              <TabsList className="w-full overflow-x-auto">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="insights">Insights</TabsTrigger>
                <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
                <TabsTrigger value="evidence">Evidence</TabsTrigger>
              </TabsList>
              <TabsContent value="summary" className="mt-5">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                  <h3 className="text-xl font-semibold text-slate-950">{report.title}</h3>
                  <p className="mt-4 text-sm leading-6 text-slate-700">{report.executiveSummary}</p>
                </div>
              </TabsContent>
              <TabsContent value="insights" className="mt-5">
                <InsightList items={report.insights} empty="No insights generated yet." />
              </TabsContent>
              <TabsContent value="recommendations" className="mt-5">
                <RecommendationList items={report.recommendations} />
              </TabsContent>
              <TabsContent value="evidence" className="mt-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <EvidenceTile label="Evidence status" value={evidenceLabel(report.evidence.status)} />
                  <EvidenceTile
                    label="Final conclusion"
                    value={report.evidence.canGenerateFinalConclusion ? 'Allowed' : 'Blocked'}
                  />
                  <EvidenceTile
                    label="Missing data"
                    value={String(report.evidence.missingEvidence.filter((item) => item.severity === 'blocker').length)}
                  />
                  <EvidenceTile
                    label="Warnings"
                    value={String(report.evidence.missingEvidence.filter((item) => item.severity !== 'blocker').length)}
                  />
                </div>
                <div className="mt-4 rounded-lg border border-slate-200 bg-white">
                  {report.evidence.checklist.slice(0, 6).map((item) => (
                    <div
                      key={item.check}
                      className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-900">{item.check}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.detail}</div>
                      </div>
                      <StatusBadge tone={item.status === 'PASS' ? 'success' : item.status === 'WARN' ? 'warning' : 'danger'}>
                        {item.status === 'PASS' ? 'Ready' : item.status === 'WARN' ? 'Warning' : 'Blocked'}
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <FileText className="size-5" />
            </div>
            <div className="mt-4 text-sm font-semibold text-slate-900">No draft report yet</div>
            <p className="mt-1 text-sm text-slate-500">
              Generate a draft to preview the evidence-based business report.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InsightList({ items, empty }: { items: string[]; empty: string }) {
  const displayItems = items.filter(isDisplayNarrative);
  if (displayItems.length === 0) return <div className="text-sm text-slate-500">{empty}</div>;
  return (
    <div className="space-y-3">
      {displayItems.slice(0, 5).map((item) => (
        <div key={item} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-blue-600" />
          <p className="text-sm leading-6 text-slate-700">{item}</p>
        </div>
      ))}
    </div>
  );
}

function RecommendationList({ items }: { items: string[] }) {
  const displayItems = items.filter(isDisplayNarrative);
  if (displayItems.length === 0) return <div className="text-sm text-slate-500">No action items generated yet.</div>;
  return (
    <div className="space-y-3">
      {displayItems.slice(0, 5).map((item, index) => (
        <div key={item} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white">
            {index + 1}
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">Recommended action</div>
            <p className="mt-1 text-sm leading-6 text-slate-700">{item}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function EvidenceTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {label === 'Evidence status' ? <ShieldCheck className="size-3.5" /> : <ListChecks className="size-3.5" />}
        {label}
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-950">
        <CheckCircle2 className="size-4 text-emerald-600" />
        {value}
      </div>
    </div>
  );
}

function reportHeading(report: LdReport | null): string {
  if (!report) return 'Report draft';
  if (report.status === 'FINAL') return 'Final report';
  if (report.status === 'REVISION_REQUESTED') return 'Report needs revision';
  return 'Report draft';
}

function reportScopeLabel(report: LdReport | null): string {
  if (!report) return 'No report generated yet';
  if (report.scope.courseId) return `Course: ${report.scope.courseId}`;
  if (report.scope.period) return `Period: ${report.scope.period}`;
  if (report.scope.team) return `Team: ${report.scope.team}`;
  return report.title;
}

function isDisplayNarrative(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 24) return false;
  const words = trimmed.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  const numbers = trimmed.match(/\b\d+(?:\.\d+)?%?\b/g) ?? [];
  return words.length >= 4 && numbers.length <= words.length;
}
