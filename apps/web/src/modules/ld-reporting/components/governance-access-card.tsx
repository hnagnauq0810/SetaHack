import { Card, CardContent } from '@seta/shared-ui';
import { Eye, EyeOff, ShieldAlert } from 'lucide-react';
import type * as React from 'react';
import type { LdReport } from '../api-client';
import { classificationTone, roleLabel } from './display-utils';
import { StatusBadge } from './status-badge';

interface GovernanceAccessCardProps {
  report: LdReport | null;
}

export function GovernanceAccessCard({ report }: GovernanceAccessCardProps) {
  const highPriority = report?.governance.normFlags.filter((flag) => flag.priority === 'High').length ?? 0;
  const keyFlag = report?.governance.normFlags[0];
  const masked = report?.governance.masked ?? false;

  return (
    <Card className="rounded-2xl border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-slate-700" />
            <h2 className="text-lg font-semibold text-slate-950">Governance & Access</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            L&D NORM flags and role-based access for this report view.
          </p>
        </div>
        <StatusBadge tone={classificationTone(report?.governance.classification)}>
          {report?.governance.classification ?? 'Pending'}
        </StatusBadge>
      </div>

      <CardContent className="pt-5">
        {report ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Overall classification
              </div>
              <div className="mt-1 text-xl font-semibold text-slate-950">
                {report.governance.classification}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {highPriority > 0
                  ? `${highPriority} high-priority L&D rule${highPriority === 1 ? ' was' : 's were'} triggered.`
                  : 'No high-priority L&D rules were triggered.'}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Key flag</div>
              {keyFlag ? (
                <div className="mt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={keyFlag.priority === 'High' ? 'danger' : 'warning'}>
                      {keyFlag.ruleId}
                    </StatusBadge>
                    <span className="text-sm font-medium text-slate-900">{keyFlag.priority}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{keyFlag.message}</p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-600">No NORM flags were triggered for this scope.</p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <AccessTile label="Role" value={roleLabel(report.governance.role)} />
              <AccessTile
                label="Sensitive details"
                value={masked ? 'Masked' : 'Visible'}
                icon={masked ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              />
              <AccessTile label="Raw appendix" value={masked ? 'Restricted' : 'Allowed'} />
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
            Generate a draft to evaluate NORM rules and role-based visibility.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AccessTile({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
        {icon}
        {value}
      </div>
    </div>
  );
}
