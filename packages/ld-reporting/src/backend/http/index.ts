import { readFile } from 'node:fs/promises';
import type { RouteBuildDeps, SessionEnv } from '@seta/core';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import {
  LdFinalizeRequestSchema,
  LdQnaRequestSchema,
  LdRequestSchema,
  type LdRole,
} from '../../models.ts';
import type { LdReportAccessContext } from '../domain/access-control.ts';
import { LdReportingSpecialistAgent } from '../domain/orchestrator.ts';

const reportIdParamSchema = z.object({ id: z.string().min(1) });

export function buildLdReportingRoutes(_deps: RouteBuildDeps): Hono<SessionEnv> {
  const app = new Hono<SessionEnv>();
  const agent = new LdReportingSpecialistAgent();

  app.post('/api/ld-reporting/readiness', async (c) => {
    try {
      requirePermission(c.get('user'), 'ld-reporting.readiness.run');
      const body = LdRequestSchema.parse(await c.req.json().catch(() => ({})));
      const result = await agent.ld_checkReadiness(
        applyScopeAccess(body, resolveAccess(c.get('user'))),
      );
      return c.json(result);
    } catch (err) {
      return handleLdError(c, err);
    }
  });

  app.post('/api/ld-reporting/reports', async (c) => {
    try {
      requirePermission(c.get('user'), 'ld-reporting.report.generate');
      const access = resolveAccess(c.get('user'));
      const body = LdRequestSchema.parse(await c.req.json().catch(() => ({})));
      const report = await agent.ld_generateReport(applyScopeAccess(body, access));
      const view = agent.viewReport(report, access);
      return c.json(view, report.quality?.status === 'FAIL' ? 422 : 201);
    } catch (err) {
      return handleLdError(c, err);
    }
  });

  app.get('/api/ld-reporting/reports/:id', async (c) => {
    try {
      requirePermission(c.get('user'), 'ld-reporting.report.read');
      const access = resolveAccess(c.get('user'));
      const { id } = reportIdParamSchema.parse(c.req.param());
      const report = await agent.getReport(id);
      if (!report) return c.json({ error: 'NOT_FOUND', message: `Report not found: ${id}` }, 404);
      return c.json(agent.viewReport(report, access));
    } catch (err) {
      return handleLdError(c, err);
    }
  });

  app.post('/api/ld-reporting/reports/:id/finalize', async (c) => {
    try {
      requirePermission(c.get('user'), 'ld-reporting.report.finalize');
      const access = resolveAccess(c.get('user'));
      const { id } = reportIdParamSchema.parse(c.req.param());
      const body = LdFinalizeRequestSchema.parse(await c.req.json());
      const report = await agent.ld_finalizeReport({
        reportId: id,
        body,
        actorUserId: c.get('user').user_id,
      });
      return c.json(agent.viewReport(report, access));
    } catch (err) {
      return handleLdError(c, err);
    }
  });

  app.post('/api/ld-reporting/qna', async (c) => {
    try {
      requirePermission(c.get('user'), 'ld-reporting.qna.ask');
      const access = resolveAccess(c.get('user'));
      const body = LdQnaRequestSchema.parse(await c.req.json());
      const answer = await agent.ld_answerQuestion({
        ...body,
        role: access.role,
        trainerId: access.trainerId,
      });
      return c.json(answer);
    } catch (err) {
      return handleLdError(c, err);
    }
  });

  app.get('/api/ld-reporting/reports/:id/download/pptx', async (c) => downloadArtifact(c, 'pptx'));
  app.get('/api/ld-reporting/reports/:id/download/docx', async (c) => downloadArtifact(c, 'docx'));

  async function downloadArtifact(c: Context<SessionEnv>, kind: 'pptx' | 'docx') {
    try {
      requirePermission(c.get('user'), 'ld-reporting.report.read');
      const access = resolveAccess(c.get('user'));
      const { id } = reportIdParamSchema.parse(c.req.param());
      const report = await agent.getReport(id);
      if (!report) return c.json({ error: 'NOT_FOUND', message: `Report not found: ${id}` }, 404);
      const view = agent.viewReport(report, access);
      const artifact = await agent.writeArtifactForView(view, kind);
      const file = await readFile(artifact.path);
      return new Response(new Uint8Array(file), {
        status: 200,
        headers: {
          'content-type': artifact.mediaType,
          'content-disposition': `attachment; filename="${artifact.filename}"`,
        },
      });
    } catch (err) {
      return handleLdError(c, err);
    }
  }

  return app;
}

function applyScopeAccess<T extends { scope: Record<string, unknown> }>(
  body: T,
  access: LdReportAccessContext,
): T {
  if (access.role !== 'TRAINER' || !access.trainerId) return body;
  return {
    ...body,
    scope: {
      ...body.scope,
      trainerId: access.trainerId,
    },
  };
}

function resolveAccess(session: SessionEnv['Variables']['user']): LdReportAccessContext {
  requirePermission(session, 'ld-reporting.read');
  const role = resolveRole(session);
  return role === 'TRAINER' ? { role, trainerId: session.user_id } : { role };
}

function resolveRole(session: SessionEnv['Variables']['user']): LdRole {
  const roles = new Set(session.role_summary.roles);
  const perms = session.permissions;
  if (
    perms.has('ld-reporting.sensitive.read') ||
    perms.has('ld-reporting.report.generate') ||
    perms.has('ld-reporting.report.finalize') ||
    roles.has('ld-reporting.manager')
  ) {
    return 'LND_MANAGER';
  }
  if (roles.has('ld-reporting.trainer')) return 'TRAINER';
  if (roles.has('ld-reporting.bod')) return 'BOD';
  if (roles.has('ld-reporting.team_manager')) return 'TEAM_MANAGER';
  return 'TEAM_MANAGER';
}

function requirePermission(session: SessionEnv['Variables']['user'], permission: string): void {
  if (!session.permissions.has(permission)) {
    throw new LdHttpError(403, 'FORBIDDEN', `${permission} required`);
  }
}

class LdHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function handleLdError(c: Context<SessionEnv>, err: unknown): Response {
  if (err instanceof LdHttpError) {
    return c.json({ error: err.code, message: err.message }, 403);
  }
  throw err;
}
