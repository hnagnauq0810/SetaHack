import type * as React from 'react';
import type { LdReport } from '../api-client';
import { formatNum, formatPct } from './display-utils';
import { MetricCard } from './metric-card';

interface PerformanceOverviewProps {
  report: LdReport | null;
}

export function PerformanceOverview({ report }: PerformanceOverviewProps) {
  const o = report?.metrics.overall;
  const metrics = [
    {
      label: 'Attendance',
      value: formatPct(o?.attendanceRate),
      benchmark: 'Target >= 85%',
      ...rateStatus(o?.attendanceRate, 0.85, 0.75),
    },
    {
      label: 'Completion',
      value: formatPct(o?.completionRate),
      benchmark: 'Target >= 90%',
      ...rateStatus(o?.completionRate, 0.9, 0.8),
    },
    {
      label: 'Pass rate',
      value: formatPct(o?.passRate),
      benchmark: 'Target >= 80%',
      ...rateStatus(o?.passRate, 0.8, 0.7),
    },
    {
      label: 'Avg score',
      value: o?.averageScore == null ? 'N/A' : `${formatNum(o.averageScore, 2)}/10`,
      benchmark: 'Threshold 6.5',
      ...scoreStatus(o?.averageScore),
    },
    {
      label: 'Satisfaction',
      value: o?.feedbackRating == null ? 'N/A' : `${formatNum(o.feedbackRating, 2)}/5`,
      benchmark: 'Target >= 4.0',
      ...scoreStatus(o?.feedbackRating, 4, 3.5),
    },
    {
      label: 'Training hours',
      value: formatNum(o?.trainingHours, 1),
      benchmark: 'Validated attendance hours',
      status: o ? 'Calculated' : 'Pending',
      tone: o ? 'info' : 'neutral',
      trend: 'flat' as const,
    },
    {
      label: 'Cost',
      value: formatNum(o?.totalCostScaled, 1),
      benchmark: 'Scaled training cost',
      status: o ? 'Tracked' : 'Pending',
      tone: o ? 'info' : 'neutral',
      trend: 'flat' as const,
    },
    {
      label: 'ROI proxy',
      value: formatNum(o?.roiProxy, 4),
      benchmark: 'Relative KPI signal',
      status: o?.roiProxy == null ? 'Pending' : o.roiProxy > 0 ? 'Monitor' : 'Review',
      tone: o?.roiProxy == null ? 'neutral' : o.roiProxy > 0 ? 'warning' : 'danger',
      trend: o?.roiProxy == null ? 'flat' : o.roiProxy > 0 ? 'up' : 'down',
    },
  ] satisfies Array<React.ComponentProps<typeof MetricCard>>;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Performance overview</h2>
          <p className="text-sm text-slate-500">Validated metrics with business targets and status.</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>
    </section>
  );
}

function rateStatus(value: number | null | undefined, good: number, monitor: number) {
  if (value == null) return { status: 'Pending', tone: 'neutral' as const, trend: 'flat' as const };
  if (value >= Math.max(good + 0.08, 0.98)) {
    return { status: 'Excellent', tone: 'success' as const, trend: 'up' as const };
  }
  if (value >= good) return { status: 'Good', tone: 'success' as const, trend: 'up' as const };
  if (value >= monitor) return { status: 'Monitor', tone: 'warning' as const, trend: 'flat' as const };
  return { status: 'Risk', tone: 'danger' as const, trend: 'down' as const };
}

function scoreStatus(value: number | null | undefined, good = 6.5, monitor = 5.5) {
  if (value == null) return { status: 'Pending', tone: 'neutral' as const, trend: 'flat' as const };
  if (value >= good + 1.5) return { status: 'Excellent', tone: 'success' as const, trend: 'up' as const };
  if (value >= good) return { status: 'Good', tone: 'success' as const, trend: 'up' as const };
  if (value >= monitor) return { status: 'Monitor', tone: 'warning' as const, trend: 'flat' as const };
  return { status: 'Risk', tone: 'danger' as const, trend: 'down' as const };
}
