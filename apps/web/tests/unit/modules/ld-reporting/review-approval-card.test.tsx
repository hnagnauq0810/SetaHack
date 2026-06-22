import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LdReport } from '../../../../src/modules/ld-reporting/api-client';
import { ReviewApprovalCard } from '../../../../src/modules/ld-reporting/components/review-approval-card';

function report(overrides: Partial<LdReport> = {}): LdReport {
  return {
    reportId: 'rpt_review_123',
    status: 'DRAFT',
    evidence: {
      status: 'PASS',
      canGenerateFinalConclusion: true,
      missingEvidence: [],
      checklist: [],
    },
    quality: { status: 'PASS', issues: [] },
    ...overrides,
  } as LdReport;
}

describe('ReviewApprovalCard', () => {
  it('blocks approval and explains the Evidence Gate failure', () => {
    const onFinalize = vi.fn();
    render(
      <ReviewApprovalCard
        report={report({
          evidence: {
            status: 'BLOCKED',
            canGenerateFinalConclusion: false,
            missingEvidence: [],
            checklist: [],
          },
        })}
        loading={null}
        onFinalize={onFinalize}
      />,
    );

    expect(screen.getByRole('button', { name: 'Approve final report' })).toBeDisabled();
    expect(screen.getByText(/Evidence Gate is blocking/i)).toBeInTheDocument();
  });

  it('allows PARTIAL_PASS approval when final conclusions and quality are allowed', () => {
    const onFinalize = vi.fn();
    render(
      <ReviewApprovalCard
        report={report({
          evidence: {
            status: 'PARTIAL_PASS',
            canGenerateFinalConclusion: true,
            missingEvidence: [],
            checklist: [],
          },
        })}
        loading={null}
        onFinalize={onFinalize}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve final report' }));
    expect(onFinalize).toHaveBeenCalledWith('approve');
  });
});
