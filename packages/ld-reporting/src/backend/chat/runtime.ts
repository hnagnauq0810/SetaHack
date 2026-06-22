import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { ConsoleLogger, type LogLevel } from '@mastra/core/logger';
import { TokenLimiterProcessor } from '@mastra/core/processors';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraCompositeStore } from '@mastra/core/storage';
import { MastraStorageExporter, Observability } from '@mastra/observability';
import {
  type ApprovalCard,
  ApprovalCardSchema,
  actorFromContext,
  type Citation,
  defineAgentTool,
  loadUserContextSection,
  makeUpdateWorkingMemoryTool,
  RC_THREAD_ID,
  type SpecializedAgentRunCtx,
  sessionFromRequestContext,
  type TrustEnvelope,
} from '@seta/agent-sdk';
import type { ChatStreamRun } from '@seta/shared-orchestration';
import { z } from 'zod';
import {
  LdQnaRequestSchema,
  type LdRequest,
  LdRequestSchema,
  type LdRole,
  type ReportJson,
} from '../../models.ts';
import { LdReportingSpecialistAgent } from '../domain/orchestrator.ts';

type ToolSignals = {
  toolCalls: { payload: { toolName: string; args?: unknown } }[];
  toolResults: { payload: { toolName: string; result: unknown } }[];
  text?: string;
};

type DrainableStream = {
  fullStream: AsyncIterable<unknown>;
  toolCalls: Promise<ToolSignals['toolCalls']>;
  toolResults: Promise<ToolSignals['toolResults']>;
  text: Promise<string | undefined>;
};

type LdResumeDecision = {
  decision: 'approve' | 'reject' | 'modify';
  reportId?: string;
  note?: string;
};

type EvidenceGateRecord = {
  evidenceId: string;
  status: string;
  canGenerateFinalConclusion: boolean;
  missingEvidenceCount: number;
  checkedAt: string;
};

export interface LdReportingChatRuntimeDeps {
  mastraStorage: MastraCompositeStore;
  resolveModel: () => MastraModelConfig;
  agent?: LdReportingSpecialistAgent;
}

const ReviewInputSchema = z.object({
  reportId: z.string().min(1),
  note: z.string().optional(),
});

const ReviewResumeSchema = z.object({
  decision: z.enum(['approve', 'reject', 'modify']),
  reportId: z.string().min(1),
  note: z.string().optional(),
});

const ExportInputSchema = z.object({
  reportId: z.string().min(1),
  format: z.enum(['pptx', 'docx', 'both']).default('both'),
});

const ListReportsInputSchema = z.object({
  status: z.enum(['FINAL', 'DRAFT', 'REVISION_REQUESTED', 'all']).default('FINAL').optional(),
});

const SuspendSchema = z.object({ card: ApprovalCardSchema });

export function buildLdReportingChatRuntime(deps: LdReportingChatRuntimeDeps): {
  runStream: (
    runInput: { userText: string; taskId: string | null },
    ctx: SpecializedAgentRunCtx,
  ) => Promise<ChatStreamRun>;
  runResume: (
    resume: LdResumeDecision,
    ctx: SpecializedAgentRunCtx & {
      mastraRunId: string;
      toolCallId?: string;
    },
  ) => Promise<ChatStreamRun>;
} {
  const domainAgent = deps.agent ?? new LdReportingSpecialistAgent();

  async function build(
    input: { userText: string; taskId: string | null },
    ctx: SpecializedAgentRunCtx,
  ) {
    const rc = new RequestContext();
    rc.set('actor', { type: 'user', user_id: ctx.actorUserId });
    rc.set('tenant_id', ctx.tenantId);
    rc.set('role_summary', ctx.roleSummary ?? { roles: [], cross_tenant_read: false });
    rc.set('effective_permissions', ctx.effectivePermissions ?? new Set<string>());
    if (ctx.threadId) rc.set(RC_THREAD_ID, ctx.threadId);

    const defaultScope = extractScopeFromText(input.userText);
    const tools: Record<string, unknown> = makeLdChatTools({ agent: domainAgent, defaultScope });
    const wmTool = makeUpdateWorkingMemoryTool(ctx);
    if (wmTool) tools.updateWorkingMemory = wmTool;
    const wmSection = await loadUserContextSection(ctx);
    const agent = new Agent({
      id: 'ld-reporting.chat',
      name: 'L&D Reporting Agent',
      instructions: wmSection
        ? `${instructionsText(defaultScope)}\n\n${wmSection}`
        : instructionsText(defaultScope),
      model: ctx.model ?? deps.resolveModel(),
      tools: tools as never,
      ...(ctx.userMemory ? { memory: ctx.userMemory.memory } : {}),
      inputProcessors: [new TokenLimiterProcessor({ limit: 100_000 })],
    });
    const mastra = new Mastra({
      agents: { 'ld-reporting.chat': agent },
      storage: deps.mastraStorage,
      logger: new ConsoleLogger({
        name: 'Mastra',
        level: (process.env.MASTRA_LOG_LEVEL as LogLevel) ?? 'warn',
      }),
      observability: new Observability({
        configs: {
          default: {
            serviceName: 'seta-ld-reporting-chat',
            exporters: [new MastraStorageExporter()],
          },
        },
      }),
    });
    const boundAgent = mastra.getAgent('ld-reporting.chat');
    const message = [
      `User message: ${input.userText}`,
      `Default report scope: ${JSON.stringify(defaultScope)}`,
    ].join('\n');
    const runOptions: Record<string, unknown> = {
      requestContext: rc,
      maxSteps: 10,
      abortSignal: ctx.abortSignal,
      providerOptions: { openai: { reasoningSummary: 'auto' } },
      ...(ctx.userMemory && ctx.threadId
        ? {
            memory: {
              thread: ctx.threadId,
              resource: `${ctx.tenantId}:${ctx.actorUserId}`,
              options: { readOnly: true, workingMemory: { enabled: false } },
            },
          }
        : {}),
    };
    return { agent: boundAgent, message, runOptions };
  }

  return {
    runStream: async (runInput, ctx) => {
      const built = await build(runInput, ctx);
      const output = (await built.agent.stream(
        built.message,
        built.runOptions,
      )) as unknown as ChatStreamRun['output'];
      return {
        output,
        finalize: async () => finalizeLdResult(await drain(output)),
      };
    },
    runResume: async (resume, ctx) => {
      const built = await build({ userText: '', taskId: null }, ctx);
      const output = (await (
        built.agent as unknown as {
          resumeStream: (
            resumeData: LdResumeDecision,
            opts: { runId: string; toolCallId?: string; requestContext: RequestContext },
          ) => Promise<unknown>;
        }
      ).resumeStream(resume, {
        runId: ctx.mastraRunId,
        ...(ctx.toolCallId ? { toolCallId: ctx.toolCallId } : {}),
        requestContext: built.runOptions.requestContext as RequestContext,
      })) as ChatStreamRun['output'];
      return {
        output,
        finalize: async () => finalizeLdResult(await drain(output)),
      };
    },
  };
}

function makeLdChatTools(input: {
  agent: LdReportingSpecialistAgent;
  defaultScope: LdRequest['scope'];
}) {
  const { agent, defaultScope } = input;
  const evidenceGateByScope = new Map<string, EvidenceGateRecord>();
  return {
    ld_checkReadiness: defineAgentTool({
      id: 'ld_checkReadiness',
      name: 'Check L&D Data Readiness',
      description:
        'Run the required Evidence Gate readiness check for an L&D report scope. Always use this before generating, exporting from scope, or finalizing conclusions.',
      input: LdRequestSchema,
      output: z.unknown(),
      rbac: 'ld-reporting.readiness.run',
      execute: async (payload, ctx) => {
        await requireToolPermission(ctx, 'ld-reporting.readiness.run');
        const request = withDefaultScope(payload, defaultScope);
        const readiness = await agent.ld_checkReadiness(request);
        evidenceGateByScope.set(scopeKey(request.scope), {
          evidenceId: readiness.evidence.evidenceId,
          status: readiness.evidence.status,
          canGenerateFinalConclusion: readiness.evidence.canGenerateFinalConclusion,
          missingEvidenceCount: readiness.evidence.missingEvidence.length,
          checkedAt: new Date().toISOString(),
        });
        return readiness;
      },
    }),
    ld_generateReport: defineAgentTool({
      id: 'ld_generateReport',
      name: 'Generate L&D Report Draft',
      description:
        'Generate a validated draft after ld_checkReadiness ran for the same scope. BLOCKED evidence produces a preliminary/readiness draft that cannot be finalized.',
      input: LdRequestSchema,
      output: z.unknown(),
      rbac: 'ld-reporting.report.generate',
      execute: async (payload, ctx) => {
        const access = await resolveToolAccess(ctx, 'ld-reporting.report.generate');
        const request = withDefaultScope(payload, defaultScope);
        const gate = evidenceGateByScope.get(scopeKey(request.scope));
        if (!gate) {
          return {
            status: 'EVIDENCE_GATE_REQUIRED',
            message:
              'Evidence Gate must be checked before generating this L&D report. Call ld_checkReadiness for the same scope first.',
            scope: request.scope,
          };
        }
        const report = await agent.ld_generateReport({ ...request, saveToWorkspace: false });
        return agent.viewReport(report, access);
      },
    }),
    ld_answerQuestion: defineAgentTool({
      id: 'ld_answerQuestion',
      name: 'Answer L&D Report Question',
      description:
        'Answer a question grounded only in a validated L&D report artifact. Include reportId when one is known.',
      input: LdQnaRequestSchema,
      output: z.unknown(),
      rbac: 'ld-reporting.qna.ask',
      execute: async (payload, ctx) => {
        const access = await resolveToolAccess(ctx, 'ld-reporting.qna.ask');
        return agent.ld_answerQuestion({
          ...payload,
          role: access.role,
        });
      },
    }),
    ld_listReports: defineAgentTool({
      id: 'ld_listReports',
      name: 'List L&D Reports',
      description:
        'List report artifacts visible to the current user. BOD sees finalized reports only; L&D Manager can see drafts and finalized reports.',
      input: ListReportsInputSchema,
      output: z.unknown(),
      rbac: 'ld-reporting.report.read',
      execute: async (payload, ctx) => {
        const access = await resolveToolAccess(ctx, 'ld-reporting.report.read');
        const reports = await agent.listReports(access);
        const status = payload.status ?? 'FINAL';
        return {
          reports: reports
            .filter((report) => status === 'all' || report.status === status)
            .map((report) => ({
              reportId: report.reportId,
              title: report.title,
              status: report.status,
              generatedAt: report.generatedAt,
              finalizedAt: report.finalizedAt ?? null,
              scope: report.scope,
              classification: report.governance.classification,
              evidenceStatus: report.evidence.status,
            })),
        };
      },
    }),
    ld_prepareExport: defineAgentTool({
      id: 'ld_prepareExport',
      name: 'Prepare L&D Report Export',
      description:
        'Return secure download links for a validated L&D report artifact. Use this when the user asks for PPTX, DOCX, slide deck, PowerPoint, Word, or report export.',
      input: ExportInputSchema,
      output: z.unknown(),
      rbac: 'ld-reporting.report.read',
      execute: async (payload, ctx) => {
        const access = await resolveToolAccess(ctx, 'ld-reporting.report.read');
        const report = await agent.getReport(payload.reportId);
        if (!report) {
          throw Object.assign(new Error(`Report not found: ${payload.reportId}`), {
            code: 'NOT_FOUND',
          });
        }
        if (!canReadReport(report, access.role)) {
          return {
            status: 'REPORT_NOT_PUBLISHED',
            message: 'This report is not finalized. BOD can only export finalized reports.',
            reportId: payload.reportId,
          };
        }
        const view = agent.viewReport(report, access);
        const formats =
          payload.format === 'both'
            ? (['pptx', 'docx'] as const)
            : ([payload.format] as Array<'pptx' | 'docx'>);
        return {
          reportId: view.reportId,
          status: view.status,
          masked: view.governance.masked,
          classification: view.governance.classification,
          downloads: formats.map((format) => ({
            format,
            url: `/api/ld-reporting/reports/${view.reportId}/download/${format}`,
          })),
        };
      },
    }),
    ld_reviewFinalizeReport: defineAgentTool({
      id: 'ld_reviewFinalizeReport',
      name: 'Review L&D Report Finalization',
      description:
        'Pause for human review before finalizing an L&D report. Use this whenever the user asks to approve, finalize, publish, or request revision for a report.',
      input: ReviewInputSchema,
      output: z.unknown(),
      suspendSchema: SuspendSchema,
      resumeSchema: ReviewResumeSchema,
      rbac: 'ld-reporting.report.finalize',
      execute: async (payload, ctx) => {
        const access = await resolveToolAccess(ctx, 'ld-reporting.report.finalize');
        const resume = ctx.agent?.resumeData as LdResumeDecision | undefined;
        if (resume) {
          const reportId = resume.reportId ?? payload.reportId;
          const decision =
            resume.decision === 'approve'
              ? 'approve'
              : resume.decision === 'modify'
                ? 'regenerate'
                : 'revise';
          const actor = actorFromContext(ctx);
          const report = await agent.ld_finalizeReport({
            reportId,
            body: { decision, note: resume.note ?? payload.note },
            actorUserId: actor.user_id,
          });
          return agent.viewReport(report, access);
        }

        const report = await agent.getReport(payload.reportId);
        if (!report) {
          throw Object.assign(new Error(`Report not found: ${payload.reportId}`), {
            code: 'NOT_FOUND',
          });
        }
        const actor = actorFromContext(ctx);
        const view = agent.viewReport(report, access);
        if (view.status === 'FINAL') return view;
        if (view.evidence.status === 'BLOCKED' || !view.evidence.canGenerateFinalConclusion) {
          return {
            reportId: view.reportId,
            status: 'FINALIZE_BLOCKED_BY_EVIDENCE',
            message:
              'Final approval is unavailable because Evidence Gate blocks the final conclusion.',
            evidence: view.evidence,
          };
        }
        if (view.quality?.status !== 'PASS') {
          return {
            reportId: view.reportId,
            status: 'FINALIZE_BLOCKED_BY_QUALITY',
            message: 'Final approval is unavailable until report quality is PASS.',
            quality: view.quality ?? null,
          };
        }
        const card = buildFinalizeApprovalCard(view, access.tenantId, actor.user_id, payload.note);
        if (typeof ctx.agent?.suspend !== 'function') {
          throw new Error('ld_reviewFinalizeReport: ctx.agent.suspend unavailable');
        }
        await ctx.agent.suspend({ card });
        return { reportId: payload.reportId, status: 'PENDING_REVIEW' };
      },
    }),
  };
}

function instructionsText(defaultScope: LdRequest['scope']): string {
  return [
    'You are the L&D Training Effectiveness Agent.',
    'Use tools for every operational action: readiness checks, draft generation, report Q&A, and final review.',
    'Never answer L&D course questions from general knowledge. If the user asks about a course, learner, metric, report, PPTX, DOCX, or "it" in this L&D thread, ground the answer in L&D tools and validated artifacts.',
    'If the user requests to generate a new report, or specifies a scope/course/period/team, always run ld_checkReadiness and ld_generateReport for that new scope. Do not restrict the user from creating new reports.',
    'An L&D course name or ID can look like a technical topic (e.g. "CloudAWS_03_2026", "AWS Cloud Architecture & Services", "DevOps Fundamentals", "DevOps_04_2026"). Never assume these are technical infrastructure, cloud operations, or server maintenance tasks. They are training courses! If the user asks to create, check, or generate a report for any such name, it is a course ID/scope. You MUST call the L&D tools (ld_checkReadiness first, then ld_generateReport) for it.',
    'BOD users are read-only. For BOD report reading, Q&A, history, or exports, call ld_listReports and ld_answerQuestion against finalized reports only. Never generate a draft for BOD.',
    'Evidence Gate is mandatory. For any generate, draft, export-from-scope, approval, or final conclusion request, call ld_checkReadiness first for the exact same scope.',
    'Call ld_generateReport only after ld_checkReadiness completed for the exact same scope in the same turn. PASS or PARTIAL_PASS may produce a finalizable draft; BLOCKED produces a clearly preliminary/readiness draft and must never be finalized.',
    'Generated drafts are previews and are not added to the Reports workspace automatically. After generating a draft, tell the user to review it and use Save Draft to Reports if they want to save it. Saving a draft is not final approval.',
    'If the user asks to export PPTX/DOCX but provides only a course, period, or team instead of a reportId, run ld_checkReadiness first, then generate the draft, then call ld_prepareExport.',
    'Never finalize or publish a report directly. When finalization is requested, call ld_reviewFinalizeReport so the human approval card can pause the run.',
    'When the user asks for PPTX, DOCX, PowerPoint, Word, slide deck, or export, call ld_prepareExport and return the download links.',
    'Never invent metrics, course names, learner identities, NORM flags, or evidence status.',
    'If the Evidence Gate is BLOCKED, describe the blocker and avoid final effectiveness conclusions.',
    'Report Q&A must be grounded only in report artifacts. If reportId is missing, use finalized reports via ld_listReports or ld_answerQuestion without reportId; generate a new draft only when an L&D Manager explicitly asks for a draft.',
    'RBAC is server-enforced. Do not ask the user to choose a role and do not reveal masked learner details.',
    `When a scope is omitted, use this default scope: ${JSON.stringify(defaultScope)}.`,
    'For metric or comparison questions, give a direct conclusion, the key validated values with absolute and relative differences when calculable, a short "Ý nghĩa:" interpretation without unsupported causal claims, and one "Khuyến nghị:" grounded next step.',
    'Keep simple answers business-readable and moderately detailed, normally 80 to 180 words; do not expand them into a full report unless the user asks.',
  ].join('\n');
}

function withDefaultScope(payload: LdRequest, defaultScope: LdRequest['scope']): LdRequest {
  const scope = payload.scope ?? {};
  const hasScope = Boolean(scope.courseId || scope.period || scope.team || scope.trainerId);
  return hasScope ? payload : { ...payload, scope: defaultScope };
}

function scopeKey(scope: LdRequest['scope'] | undefined): string {
  return JSON.stringify({
    period: scope?.period ?? null,
    courseId: scope?.courseId ?? null,
    team: scope?.team ?? null,
    trainerId: scope?.trainerId ?? null,
    reportType: scope?.reportType ?? 'full',
  });
}

function extractScopeFromText(text: string): LdRequest['scope'] {
  const scope: LdRequest['scope'] = { reportType: 'full' };
  const summary = text.match(/Summary:\s*([^\]]+)/i)?.[1] ?? text;
  const period = summary.match(/\bperiod=([^\s,;]+)/i)?.[1];
  const courseId = summary.match(/\bcourseId=([^\s,;]+)/i)?.[1];
  const team = summary.match(/\bteam=([^\s,;]+)/i)?.[1];
  if (period && period !== 'none') scope.period = period;
  if (courseId && courseId !== 'none') scope.courseId = courseId;
  if (team && team !== 'none') scope.team = team;
  return scope;
}

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
): Promise<{ role: LdRole; tenantId: string }> {
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
    return { role: 'LND_MANAGER', tenantId: session.tenantId };
  }
  if (roles.has('ld-reporting.bod')) return { role: 'BOD', tenantId: session.tenantId };
  return { role: 'BOD', tenantId: session.tenantId };
}

function canReadReport(report: ReportJson, role: LdRole): boolean {
  return role === 'LND_MANAGER' || report.status === 'FINAL';
}

function buildFinalizeApprovalCard(
  report: ReportJson,
  tenantId: string,
  userId: string,
  note: string | undefined,
): ApprovalCard {
  return {
    toolCallId: `ld-reporting-finalize:${report.reportId}`,
    intent: `Finalize "${report.title}"`,
    riskBadge: 'write',
    summary: `Evidence ${report.evidence.status}; classification ${report.governance.classification}; status ${report.status}.`,
    details: [
      {
        kind: 'kvTable',
        rows: [
          { k: 'Report ID', v: report.reportId },
          { k: 'Evidence', v: report.evidence.status },
          { k: 'Quality', v: report.quality?.status ?? 'NOT_CHECKED' },
          {
            k: 'Final conclusion',
            v: report.evidence.canGenerateFinalConclusion ? 'Allowed' : 'Blocked',
          },
          { k: 'Classification', v: report.governance.classification },
          { k: 'Scope', v: scopeLabel(report) },
          { k: 'Review note', v: note?.trim() || 'N/A' },
        ],
      },
      {
        kind: 'text',
        body: 'Approving records the report as FINAL. Declining records REVISION_REQUESTED so L&D can adjust evidence, narrative, or recommendations.',
      },
      {
        kind: 'confidence',
        score: report.evidence.canGenerateFinalConclusion ? 0.9 : 0.35,
        label: report.evidence.canGenerateFinalConclusion
          ? 'Ready for approval'
          : 'Evidence blocked',
      },
      {
        kind: 'citations',
        items: [
          { kind: 'doc', id: report.reportId, label: 'Validated L&D report artifact' },
          { kind: 'doc', id: report.evidenceId, label: 'Evidence Gate decision' },
        ],
      },
    ],
    primary: {
      label: 'Approve final report',
      argsPatch: { decision: 'approve', reportId: report.reportId },
    },
    alternates: [],
    decline: {
      label: 'Request revision',
      argsPatch: { decision: 'reject', reportId: report.reportId },
    },
    meta: {
      tenantId,
      userId,
      agentPath: ['ld-reporting', 'chat'],
      toolId: 'ld-reporting_finalizeReport',
      ts: new Date().toISOString(),
    },
  };
}

function scopeLabel(report: ReportJson): string {
  return (
    [
      report.scope.period ? `period=${report.scope.period}` : undefined,
      report.scope.courseId ? `courseId=${report.scope.courseId}` : undefined,
      report.scope.team ? `team=${report.scope.team}` : undefined,
      report.scope.trainerId ? `trainerId=${report.scope.trainerId}` : undefined,
    ]
      .filter(Boolean)
      .join(', ') || 'all available training data'
  );
}

async function drain(output: ChatStreamRun['output']): Promise<ToolSignals> {
  const stream = output as unknown as DrainableStream;
  return {
    toolCalls: await stream.toolCalls,
    toolResults: await stream.toolResults,
    text: await stream.text,
  };
}

function finalizeLdResult(res: ToolSignals): { result: unknown; trust: TrustEnvelope } {
  return {
    result: assembleLdResult(res),
    trust: trustFromToolSignals(res),
  };
}

function assembleLdResult(res: ToolSignals): unknown {
  const report = lastResult<ReportJson>(res, isReport);
  if (report) {
    return {
      reportId: report.reportId,
      status: report.status,
      evidenceStatus: report.evidence.status,
      canGenerateFinalConclusion: report.evidence.canGenerateFinalConclusion,
      classification: report.governance.classification,
      masked: report.governance.masked,
      scope: report.scope,
    };
  }
  const qna = lastNamedResult(res, 'ld_answerQuestion');
  if (qna) return qna;
  const exportLinks = lastNamedResult(res, 'ld_prepareExport');
  if (exportLinks) return exportLinks;
  const reports = lastNamedResult(res, 'ld_listReports');
  if (reports) return reports;
  const readiness = lastNamedResult(res, 'ld_checkReadiness');
  if (readiness) return readiness;
  const text = res.text?.trim();
  return { message: text || 'L&D reporting request completed.' };
}

function lastNamedResult(res: ToolSignals, toolName: string): unknown {
  return [...res.toolResults].reverse().find((item) => item.payload.toolName === toolName)?.payload
    .result;
}

function lastResult<T>(res: ToolSignals, predicate: (value: unknown) => value is T): T | undefined {
  return [...res.toolResults]
    .reverse()
    .map((item) => item.payload.result)
    .find(predicate);
}

function isReport(value: unknown): value is ReportJson {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as { reportId?: unknown }).reportId === 'string' &&
      typeof (value as { evidenceId?: unknown }).evidenceId === 'string',
  );
}

function trustFromToolSignals(res: ToolSignals): TrustEnvelope {
  const at = new Date().toISOString();
  const citations: Citation[] = [];
  const report = lastResult<ReportJson>(res, isReport);
  if (report) {
    citations.push({ kind: 'doc', id: report.reportId, label: report.title });
    citations.push({ kind: 'doc', id: report.evidenceId, label: 'Evidence Gate decision' });
  }
  return {
    reasoningTrace: res.toolCalls.map((call) => ({
      step: call.payload.toolName,
      detail: `args=${JSON.stringify(call.payload.args ?? {})}`,
      at,
    })),
    evidenceCitations: citations,
    confidenceScore: report?.evidence.canGenerateFinalConclusion === false ? 0.55 : 0.85,
  };
}
