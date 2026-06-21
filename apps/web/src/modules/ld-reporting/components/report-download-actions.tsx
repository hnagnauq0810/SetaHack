import { Button } from '@seta/shared-ui';
import { Download, FileText, Presentation } from 'lucide-react';
import type { LdReport, LdRole } from '../api-client';

export function ReportDownloadActions({
  report,
  viewerRole,
}: {
  report: LdReport;
  viewerRole: LdRole;
}) {
  const finalized = report.status === 'FINAL';
  if (viewerRole === 'BOD' && !finalized) return null;

  const description =
    viewerRole === 'BOD'
      ? 'Published by L&D Manager. Files use the masked Board of Directors view.'
      : finalized
        ? 'Finalized artifacts ready for distribution.'
        : 'Draft exports for internal review. They are not visible to BOD.';

  return (
    <section
      aria-label="Report downloads"
      className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3"
    >
      <div className="flex items-start gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white text-blue-700 shadow-sm">
          <Download className="size-4" />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-950">
            {finalized ? 'Final report files' : 'Draft report files'}
          </h4>
          <p className="mt-0.5 text-xs leading-5 text-slate-600">{description}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="secondary" size="sm" className="bg-white">
          <a
            href={`/api/ld-reporting/reports/${report.reportId}/download/pptx`}
            aria-label="Download PPTX"
          >
            <Presentation className="size-3.5" />
            PPTX
          </a>
        </Button>
        <Button asChild variant="secondary" size="sm" className="bg-white">
          <a
            href={`/api/ld-reporting/reports/${report.reportId}/download/docx`}
            aria-label="Download DOCX"
          >
            <FileText className="size-3.5" />
            DOCX
          </a>
        </Button>
      </div>
    </section>
  );
}
