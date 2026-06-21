import { cn } from '@seta/shared-ui';
import { Check, Circle, FileText, ShieldCheck } from 'lucide-react';
import type { LdReport, ReadinessResult } from '../api-client';

interface WorkflowStepperProps {
  readiness: ReadinessResult | null;
  report: LdReport | null;
  scopeSelected: boolean;
}

export function WorkflowStepper({ readiness, report, scopeSelected }: WorkflowStepperProps) {
  const evidence = report?.evidence ?? readiness?.evidence;
  const steps = [
    { label: 'Scope', detail: scopeSelected ? 'Scope selected' : 'Select report scope', done: scopeSelected },
    {
      label: 'Readiness',
      detail: evidence ? evidenceStatusText(evidence.status) : 'Evidence not checked',
      done: evidence?.status === 'PASS' || evidence?.status === 'PARTIAL_PASS',
      warning: evidence?.status === 'BLOCKED',
    },
    {
      label: 'Report Draft',
      detail: report ? 'Draft generated' : 'Generate draft',
      done: Boolean(report),
    },
    {
      label: 'Review & Export',
      detail: report?.status === 'FINAL' ? 'Approved and finalized' : report ? 'Awaiting approval' : 'Not ready',
      done: report?.status === 'FINAL',
    },
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-4">
        {steps.map((step, index) => {
          const Icon = index === 0 ? Circle : index === 1 ? ShieldCheck : index === 2 ? FileText : Check;
          return (
            <div key={step.label} className="flex items-center gap-3">
              <div
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full border',
                  step.done && 'border-emerald-200 bg-emerald-50 text-emerald-700',
                  step.warning && 'border-red-200 bg-red-50 text-red-700',
                  !step.done && !step.warning && 'border-slate-200 bg-slate-50 text-slate-500',
                )}
              >
                {step.done ? <Check className="size-4" /> : <Icon className="size-4" />}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {index + 1}. {step.label}
                </div>
                <div className="truncate text-xs text-slate-500">{step.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function evidenceStatusText(status: LdReport['evidence']['status']): string {
  if (status === 'PASS') return 'Evidence passed';
  if (status === 'PARTIAL_PASS') return 'Evidence passed with warnings';
  return 'Conclusion blocked';
}
