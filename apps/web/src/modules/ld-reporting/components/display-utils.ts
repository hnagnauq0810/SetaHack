import type { LdReport, LdRole } from '../api-client';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

export function roleLabel(role: LdRole | undefined): string {
  if (role === 'LND_MANAGER') return 'L&D Manager';
  if (role === 'BOD') return 'Board of Directors';
  return 'L&D Manager';
}

export function evidenceLabel(status: LdReport['evidence']['status'] | undefined): string {
  if (status === 'PASS') return 'Passed';
  if (status === 'PARTIAL_PASS') return 'Passed with warnings';
  if (status === 'BLOCKED') return 'Blocked';
  return 'Not checked';
}

export function evidenceTone(status: LdReport['evidence']['status'] | undefined): BadgeTone {
  if (status === 'PASS') return 'success';
  if (status === 'PARTIAL_PASS') return 'warning';
  if (status === 'BLOCKED') return 'danger';
  return 'neutral';
}

export function evidenceBusinessLabel(status: LdReport['evidence']['status'] | undefined): string {
  if (status === 'PASS') return 'Ready for final conclusion';
  if (status === 'PARTIAL_PASS') return 'Ready with warnings';
  if (status === 'BLOCKED') return 'Conclusion blocked';
  return 'Run readiness to validate evidence';
}

export function reportStatusLabel(status: LdReport['status'] | undefined): string {
  if (status === 'FINAL') return 'Finalized';
  if (status === 'REVISION_REQUESTED') return 'Revision requested';
  if (status === 'DRAFT') return 'Draft';
  return 'No draft';
}

export function reportTone(status: LdReport['status'] | undefined): BadgeTone {
  if (status === 'FINAL') return 'success';
  if (status === 'REVISION_REQUESTED') return 'warning';
  if (status === 'DRAFT') return 'info';
  return 'neutral';
}

export function classificationTone(value: string | undefined): BadgeTone {
  const normalized = value?.toLowerCase() ?? '';
  if (normalized.includes('effective')) return 'success';
  if (normalized.includes('improvement')) return 'warning';
  if (normalized.includes('risk') || normalized.includes('not reportable')) return 'danger';
  return 'neutral';
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return `${Math.round(value * 1000) / 10}%`;
}

export function formatNum(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function formatDateTime(value: string | undefined): string {
  if (!value) return 'Not generated';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not generated';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function llmFallbackLabel(reason: string | undefined): string {
  const normalized = reason?.toLowerCase() ?? '';
  if (normalized.includes('insufficient_quota') || normalized.includes('quota exhausted')) {
    return 'OpenAI quota is exhausted for the configured API key. Deterministic report content is still available.';
  }
  if (
    normalized.includes('openai_api_key is not configured') ||
    normalized.includes('ld_reporting_use_llm=false')
  ) {
    return 'OpenAI is not enabled for this runtime. Check OPENAI_API_KEY and LD_REPORTING_USE_LLM.';
  }
  if (
    normalized.includes('api key was rejected') ||
    normalized.includes('invalid_api_key') ||
    normalized.includes('401')
  ) {
    return 'OpenAI rejected the configured API key. Check OPENAI_API_KEY.';
  }
  if (normalized.includes('rate limit') || normalized.includes('429')) {
    return 'OpenAI rate limit was reached. Try again later or reduce request frequency.';
  }
  if (reason) return reason.length > 180 ? `${reason.slice(0, 177)}...` : reason;
  return 'AI narrative is unavailable. Deterministic report content is still available.';
}
