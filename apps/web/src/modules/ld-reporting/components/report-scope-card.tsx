import { Input, Label } from '@seta/shared-ui';
import type * as React from 'react';
import type { LdReport, ReadinessResult } from '../api-client';
import { formatNum } from './display-utils';
import { StatusBadge } from './status-badge';

interface ReportScopeCardProps {
  period: string;
  courseId: string;
  team: string;
  readiness: ReadinessResult | null;
  report: LdReport | null;
  onPeriodChange: (value: string) => void;
  onCourseIdChange: (value: string) => void;
  onTeamChange: (value: string) => void;
}

export function ReportScopeCard({
  period,
  courseId,
  team,
  readiness,
  report,
  onPeriodChange,
  onCourseIdChange,
  onTeamChange,
}: ReportScopeCardProps) {
  const courseCount = report?.metrics.overall.totalCourses;
  const learnerCount = report?.metrics.overall.traineeCount;
  const completedCourses = report?.metrics.overall.completedCourses;
  const hasValidation = Boolean(readiness || report);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Report scope</h2>
          <p className="mt-1 text-sm text-slate-500">
            Select the reporting window for the validated L&D artifact.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={courseCount ? 'info' : 'neutral'}>
            {courseCount ? `${courseCount} course${courseCount === 1 ? '' : 's'}` : 'Course scope'}
          </StatusBadge>
          <StatusBadge tone={learnerCount ? 'info' : 'neutral'}>
            {learnerCount ? `${formatNum(learnerCount, 0)} learners` : 'Learners pending'}
          </StatusBadge>
          <StatusBadge tone={completedCourses ? 'success' : 'neutral'}>
            {completedCourses
              ? `${completedCourses} completed`
              : hasValidation
                ? 'Evidence checked'
                : 'Not checked'}
          </StatusBadge>
          <StatusBadge tone="neutral">Template DS12</StatusBadge>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Period">
          <Input
            size="lg"
            value={period}
            onChange={(event) => onPeriodChange(event.target.value)}
            placeholder="2026-Q1 or 2026-01"
          />
        </Field>
        <Field label="Course">
          <Input
            size="lg"
            value={courseId}
            onChange={(event) => onCourseIdChange(event.target.value)}
            placeholder="Optional course ID"
          />
        </Field>
        <Field label="Team">
          <Input
            size="lg"
            value={team}
            onChange={(event) => onTeamChange(event.target.value)}
            placeholder="Optional team"
          />
        </Field>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </Label>
      {children}
    </div>
  );
}
