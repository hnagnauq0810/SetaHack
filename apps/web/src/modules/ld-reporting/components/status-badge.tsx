import { cn } from '@seta/shared-ui';
import type * as React from 'react';
import type { BadgeTone } from './display-utils';

const TONE_CLASS: Record<BadgeTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-700',
  neutral: 'border-slate-200 bg-slate-100 text-slate-700',
  info: 'border-blue-200 bg-blue-50 text-blue-700',
};

export function StatusBadge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-medium',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
