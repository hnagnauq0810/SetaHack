import { Button, Card, CardContent } from '@seta/shared-ui';
import { Download, FileText, Presentation } from 'lucide-react';
import type * as React from 'react';
import type { LdReport } from '../api-client';
import { reportStatusLabel, reportTone } from './display-utils';
import { StatusBadge } from './status-badge';

interface ExportArtifactsCardProps {
  report: LdReport | null;
}

export function ExportArtifactsCard({ report }: ExportArtifactsCardProps) {
  const finalized = report?.status === 'FINAL';

  return (
    <Card className="rounded-2xl border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Download className="size-5 text-slate-700" />
            <h2 className="text-lg font-semibold text-slate-950">Export artifacts</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">Download executive and detailed report outputs.</p>
        </div>
        <StatusBadge tone={reportTone(report?.status)}>{reportStatusLabel(report?.status)}</StatusBadge>
      </div>

      <CardContent className="pt-5">
        <div className="grid gap-3">
          <ExportRow
            icon={<Presentation className="size-5" />}
            title="Executive slide deck"
            description="PPTX deck aligned to the DS12 report structure."
            href={report ? `/api/ld-reporting/reports/${report.reportId}/download/pptx` : undefined}
            label={finalized ? 'Download final PPTX' : 'Download PPTX'}
          />
          <ExportRow
            icon={<FileText className="size-5" />}
            title="Detailed report"
            description="DOCX report with metrics, evidence, recommendations and appendix."
            href={report ? `/api/ld-reporting/reports/${report.reportId}/download/docx` : undefined}
            label={finalized ? 'Download final Word' : 'Download Word'}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ExportRow({
  icon,
  title,
  description,
  href,
  label,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  href?: string;
  label: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-950">{title}</div>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
          {href ? (
            <Button asChild variant="secondary" size="lg" className="mt-3 h-10 w-full bg-white sm:w-auto">
              <a href={href}>
                <Download className="size-4" />
                {label}
              </a>
            </Button>
          ) : (
            <Button variant="secondary" size="lg" className="mt-3 h-10 w-full bg-white sm:w-auto" disabled>
              <Download className="size-4" />
              Generate draft first
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
