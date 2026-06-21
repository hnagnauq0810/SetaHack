import { createHash, randomUUID } from 'node:crypto';

export function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

export function round(value: number | null | undefined, digits = 4): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function average(values: Array<number | null | undefined>): number | null {
  const numeric = values.filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  if (numeric.length === 0) return null;
  return numeric.reduce((sum, v) => sum + v, 0) / numeric.length;
}

export function ratio(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return numerator / denominator;
}

export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isNaN(n) ? null : n;
}

export function stringOrEmpty(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

export function stringOrNull(value: unknown): string | null {
  const s = stringOrEmpty(value);
  return s ? s : null;
}

export function boolOrNull(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'pass', 'passed'].includes(s)) return true;
  if (['false', 'no', 'n', '0', 'fail', 'failed'].includes(s)) return false;
  return null;
}

export function unique<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  return `${Math.round(value * 1000) / 10}%`;
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function maskEmployeeId(employeeId: string): string {
  const tail = employeeId.slice(-2).padStart(2, '*');
  return `EMP-***${tail}`;
}
