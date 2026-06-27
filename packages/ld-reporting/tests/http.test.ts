import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RouteBuildDeps, SessionEnv, SessionScope } from '@seta/core';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLdReportingRoutes } from '../src/backend/http/index.ts';

function buildApp(): Hono<SessionEnv> {
  const session: SessionScope = {
    session_id: crypto.randomUUID(),
    user_id: 'ldm001',
    tenant_id: crypto.randomUUID(),
    email: 'ldm001@test.local',
    display_name: 'L&D Manager',
    role_summary: { roles: ['ld-reporting.manager'], cross_tenant_read: false },
    role_summary_hash: 'test-role-summary',
    permissions: new Set([
      'ld-reporting.read',
      'ld-reporting.report.read',
      'ld-reporting.report.generate',
      'ld-reporting.report.finalize',
      'ld-reporting.readiness.run',
    ]),
    accessible_group_ids: [],
    cross_tenant_read: false,
    built_at: new Date(),
    invalidated_at: null,
  };
  const app = new Hono<SessionEnv>();
  app.use('*', async (c, next) => {
    c.set('user', session);
    await next();
  });
  app.route('/', buildLdReportingRoutes({} as RouteBuildDeps));
  return app;
}

describe('L&D report finalization HTTP contract', () => {
  beforeEach(async () => {
    process.env.LD_REPORTING_STORAGE_DIR = await mkdtemp(join(tmpdir(), 'ld-reporting-http-test-'));
  });

  afterEach(() => {
    delete process.env.LD_REPORTING_STORAGE_DIR;
  });

  it('returns 400 when report generation scope is ambiguous', async () => {
    const app = buildApp();
    const response = await app.request('/api/ld-reporting/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: {} }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'SCOPE_REQUIRED',
      reason: 'MISSING_SCOPE',
      message: 'Which period or course should I use for the report?',
    });

    const readiness = await app.request('/api/ld-reporting/readiness', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: { period: 'latest' } }),
    });
    expect(readiness.status).toBe(400);
    await expect(readiness.json()).resolves.toMatchObject({
      error: 'SCOPE_REQUIRED',
      reason: 'AMBIGUOUS_SCOPE',
    });

    const unsupportedTeam = await app.request('/api/ld-reporting/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: { team: 'Platform Engineering' } }),
    });
    expect(unsupportedTeam.status).toBe(400);
    await expect(unsupportedTeam.json()).resolves.toMatchObject({
      error: 'SCOPE_REQUIRED',
      reason: 'UNSUPPORTED_SCOPE',
      message: 'Which period or course should I use for the report?',
    });
  });

  it('returns 409 when blocked evidence is approved', async () => {
    const app = buildApp();
    const generated = await app.request('/api/ld-reporting/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: { courseId: 'Leadership_06_2026' } }),
    });
    expect(generated.status).toBe(201);
    const report = (await generated.json()) as { reportId: string; status: string };

    const finalized = await app.request(`/api/ld-reporting/reports/${report.reportId}/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });

    expect(finalized.status).toBe(409);
    await expect(finalized.json()).resolves.toMatchObject({
      error: 'FINALIZE_BLOCKED_BY_EVIDENCE',
    });
  });
});
