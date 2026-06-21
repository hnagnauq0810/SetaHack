import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LdReport } from '../../../../src/modules/ld-reporting/api-client';
import { ReportDownloadActions } from '../../../../src/modules/ld-reporting/components/report-download-actions';

function report(status: LdReport['status']): LdReport {
  return { reportId: 'rpt_final_123', status } as LdReport;
}

describe('ReportDownloadActions', () => {
  it('shows finalized PPTX and DOCX downloads to BOD', () => {
    render(<ReportDownloadActions report={report('FINAL')} viewerRole="BOD" />);

    expect(screen.getByRole('link', { name: 'Download PPTX' })).toHaveAttribute(
      'href',
      '/api/ld-reporting/reports/rpt_final_123/download/pptx',
    );
    expect(screen.getByRole('link', { name: 'Download DOCX' })).toHaveAttribute(
      'href',
      '/api/ld-reporting/reports/rpt_final_123/download/docx',
    );
    expect(screen.getByText(/published by L&D Manager/i)).toBeInTheDocument();
  });

  it('does not expose draft downloads to BOD', () => {
    const { container } = render(
      <ReportDownloadActions report={report('DRAFT')} viewerRole="BOD" />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps draft export available to L&D Manager for internal review', () => {
    render(<ReportDownloadActions report={report('DRAFT')} viewerRole="LND_MANAGER" />);

    expect(screen.getByRole('link', { name: 'Download PPTX' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download DOCX' })).toBeInTheDocument();
    expect(screen.getByText(/not visible to BOD/i)).toBeInTheDocument();
  });
});
