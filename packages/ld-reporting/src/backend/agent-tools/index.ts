import { actorFromContext, defineAgentTool, sessionFromRequestContext } from '@seta/agent-sdk';
import { z } from 'zod';
import {
  FinalizeDecisionSchema,
  LdQnaRequestSchema,
  LdRequestSchema,
  type LdRole,
  ScopeInputSchema,
} from '../../models.ts';
import { LdReportingSpecialistAgent } from '../domain/orchestrator.ts';

const agent = new LdReportingSpecialistAgent();

export const ldCheckReadinessTool = defineAgentTool({
  id: 'ld_checkReadiness',
  name: 'Check L&D Data Readiness',
  description:
    'Run Data Readiness + Evidence Gate for the L&D training effectiveness mock workbook. Use when user asks whether a course/period can be reported.',
  input: LdRequestSchema,
  output: z.unknown(),
  rbac: 'ld-reporting.readiness.run',
  execute: async (input, ctx) => {
    await requireToolPermission(ctx, 'ld-reporting.readiness.run');
    return agent.ld_checkReadiness(input);
  },
});

export const ldGenerateReportTool = defineAgentTool({
  id: 'ld_generateReport',
  name: 'Generate L&D Effectiveness Report',
  description:
    'Run the full L&D reporting pipeline as an unsaved preview draft: load Excel, normalize, evidence gate, metrics, NORM/RBAC, quality check and PPTX/DOCX artifact generation.',
  input: LdRequestSchema,
  output: z.unknown(),
  rbac: 'ld-reporting.report.generate',
  execute: async (input, ctx) => {
    const access = await resolveToolAccess(ctx, 'ld-reporting.report.generate');
    const report = await agent.ld_generateReport({ ...input, saveToWorkspace: false });
    return agent.viewReport(report, access);
  },
});

export const ldAnswerQuestionTool = defineAgentTool({
  id: 'ld_answerQuestion',
  name: 'Answer L&D Report Question',
  description:
    'Answer questions only from validated report artifacts. Do not answer from raw data if no reportId is available.',
  input: LdQnaRequestSchema,
  output: z.unknown(),
  rbac: 'ld-reporting.qna.ask',
  execute: async (input, ctx) => {
    const access = await resolveToolAccess(ctx, 'ld-reporting.qna.ask');
    return agent.ld_answerQuestion({
      ...input,
      role: access.role,
    });
  },
});

export const ldFinalizeReportTool = defineAgentTool({
  id: 'ld_finalizeReport',
  name: 'Finalize L&D Report',
  description:
    'Human review gate for L&D report artifacts. Approve, request revision, or mark draft for regeneration.',
  input: z.object({
    reportId: z.string().min(1),
    scope: ScopeInputSchema.optional(),
    decision: FinalizeDecisionSchema,
    note: z.string().optional(),
  }),
  output: z.unknown(),
  rbac: 'ld-reporting.report.finalize',
  needsApproval: true,
  execute: async (input, ctx) => {
    await requireToolPermission(ctx, 'ld-reporting.report.finalize');
    const actor = actorFromContext(ctx);
    const access = await resolveToolAccess(ctx, 'ld-reporting.report.finalize');
    const report = await agent.ld_finalizeReport({
      reportId: input.reportId,
      body: { decision: input.decision, note: input.note },
      actorUserId: actor.user_id,
    });
    return agent.viewReport(report, access);
  },
});

export const ldReportingAgentTools = [
  ldCheckReadinessTool,
  ldGenerateReportTool,
  ldAnswerQuestionTool,
  ldFinalizeReportTool,
];

async function requireToolPermission(
  ctx: Parameters<typeof actorFromContext>[0],
  permission: string,
): Promise<Awaited<ReturnType<typeof sessionFromRequestContext>>> {
  if (!ctx.requestContext) throw Object.assign(new Error('unauthenticated'), { code: 'FORBIDDEN' });
  const session = await sessionFromRequestContext(ctx.requestContext);
  if (!session.effectivePermissions.has(permission)) {
    throw Object.assign(new Error(`${permission} required`), { code: 'FORBIDDEN' });
  }
  return session;
}

async function resolveToolAccess(
  ctx: Parameters<typeof actorFromContext>[0],
  permission: string,
): Promise<{ role: LdRole }> {
  const session = await requireToolPermission(ctx, permission);
  if (!session.effectivePermissions.has('ld-reporting.read')) {
    throw Object.assign(new Error('ld-reporting.read required'), { code: 'FORBIDDEN' });
  }
  const roles = new Set(session.roleSummary.roles);
  if (
    session.effectivePermissions.has('ld-reporting.sensitive.read') ||
    session.effectivePermissions.has('ld-reporting.report.generate') ||
    session.effectivePermissions.has('ld-reporting.report.finalize') ||
    roles.has('ld-reporting.manager')
  ) {
    return { role: 'LND_MANAGER' };
  }
  if (roles.has('ld-reporting.bod')) return { role: 'BOD' };
  return { role: 'BOD' };
}
