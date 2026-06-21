import { cn } from '@seta/shared-ui';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { BadgeTone } from './display-utils';
import { StatusBadge } from './status-badge';

interface MetricCardProps {
  label: string;
  value: string;
  benchmark: string;
  status: string;
  tone: BadgeTone;
  trend?: 'up' | 'down' | 'flat';
}

export function MetricCard({ label, value, benchmark, status, tone, trend = 'flat' }: MetricCardProps) {
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;
  return (
    <div className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-2 truncate text-2xl font-semibold text-slate-950">{value}</div>
        </div>
        <div
          className={cn(
            'flex size-8 items-center justify-center rounded-full',
            tone === 'success' && 'bg-emerald-50 text-emerald-700',
            tone === 'warning' && 'bg-amber-50 text-amber-700',
            tone === 'danger' && 'bg-red-50 text-red-700',
            tone === 'info' && 'bg-blue-50 text-blue-700',
            tone === 'neutral' && 'bg-slate-100 text-slate-600',
          )}
          aria-hidden
        >
          <TrendIcon className="size-4" />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-slate-500">{benchmark}</span>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>
    </div>
  );
}
