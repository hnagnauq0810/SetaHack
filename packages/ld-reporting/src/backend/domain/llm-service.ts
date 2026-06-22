import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { z } from 'zod';
import type { LdRole, NormalizedDataset, QnaAnswer, ReportJson } from '../../models.ts';
import { clamp, formatNumber, formatPct } from './utils.ts';

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
let cachedDotEnvOpenAiKey: string | null | undefined;

const ReportNarrativeSchema = z.object({
  managementInterpretation: z.preprocess(
    (value) => coerceText(value, 900),
    z.string().min(1).max(900),
  ),
  insights: z.preprocess(
    (value) => coerceTextList(value, 8, 350),
    z.array(z.string().min(1).max(350)).min(1).max(8),
  ),
  recommendations: z.preprocess(
    (value) => coerceTextList(value, 8, 350),
    z.array(z.string().min(1).max(350)).min(1).max(8),
  ),
});

const QnaLlmSchema = z.object({
  answer: z.string().min(1).max(1200),
  confidence: z.number().min(0).max(1).default(0.85),
  citations: z.array(z.string().min(1)).max(8).default([]),
  limitations: z.array(z.string().min(1)).max(6).default([]),
});

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export function isLdLlmEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.LD_REPORTING_USE_LLM?.toLowerCase() === 'false') return false;
  if (env.NODE_ENV === 'test' && env.LD_REPORTING_USE_LLM?.toLowerCase() !== 'true') return false;
  return Boolean(resolveLdOpenAiApiKey(env));
}

export function resolveLdLlmModel(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LD_REPORTING_LLM_MODEL) return env.LD_REPORTING_LLM_MODEL;
  // Keep the L&D module stable: AGENT_MODELS may contain labels like openai/gpt-x:balanced.
  // Use an explicit OpenAI model unless the L&D-specific model is set.
  return DEFAULT_MODEL;
}

export async function enrichReportWithLlm(input: {
  report: ReportJson;
  dataset: NormalizedDataset;
  env?: NodeJS.ProcessEnv;
}): Promise<ReportJson> {
  const env = input.env ?? process.env;
  const model = resolveLdLlmModel(env);
  if (!isLdLlmEnabled(env)) {
    input.report.llm = {
      enabled: false,
      model,
      usedFor: [],
      fallbackReason: 'OPENAI_API_KEY is not configured or LD_REPORTING_USE_LLM=false.',
    };
    return input.report;
  }

  try {
    const deterministicSummary = input.report.executiveSummary;
    const context = buildReportContext(input.report, input.dataset);
    const raw = await callOpenAiJson({
      env,
      model,
      messages: [
        {
          role: 'system',
          content: [
            'You are an L&D Training Effectiveness Reporting Specialist Agent.',
            'You write concise business-ready report narrative from validated metrics only.',
            'Never invent numbers, trainees, courses, rules, sources, or causal claims.',
            'Respect Evidence Gate: if evidence is BLOCKED or PARTIAL_PASS, keep conclusions limited.',
            'Respect RBAC: do not expose individual trainee identities when masked=true.',
            'Insights and recommendations must be complete business sentences, not raw metric rows, labels, tables, or symbols.',
            'Return strict JSON only with keys: managementInterpretation, insights, recommendations.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            task: 'Improve the report narrative and recommendations while preserving all validated numeric metrics exactly.',
            deterministicSummary,
            context,
          }),
        },
      ],
    });
    const parsed = ReportNarrativeSchema.parse(JSON.parse(raw));
    input.report.executiveSummary = `${deterministicSummary} Management interpretation: ${parsed.managementInterpretation}`;
    input.report.insights = mergeUnique(input.report.insights, parsed.insights, 10);
    input.report.recommendations = mergeUnique(
      input.report.recommendations,
      parsed.recommendations,
      10,
    );
    input.report.llm = {
      enabled: true,
      model,
      usedFor: ['report_narrative', 'pptx_content'],
      generatedAt: new Date().toISOString(),
    };
    return input.report;
  } catch (error) {
    input.report.llm = {
      enabled: false,
      model,
      usedFor: [],
      fallbackReason: `LLM narrative fallback: ${error instanceof Error ? error.message : String(error)}`,
    };
    return input.report;
  }
}

export async function answerQuestionWithLlm(input: {
  report: ReportJson;
  question: string;
  role: LdRole;
  deterministicAnswer: Omit<QnaAnswer, 'answerId' | 'generatedAt' | 'reportId'>;
  env?: NodeJS.ProcessEnv;
}): Promise<Omit<QnaAnswer, 'answerId' | 'generatedAt' | 'reportId'>> {
  const env = input.env ?? process.env;
  const model = resolveLdLlmModel(env);
  if (!isLdLlmEnabled(env)) return input.deterministicAnswer;

  try {
    const context = buildQnaContext(input.report, input.role);
    const raw = await callOpenAiJson({
      env,
      model,
      messages: [
        {
          role: 'system',
          content: [
            'You answer questions about an L&D training effectiveness report.',
            'Answer only from the supplied validated report artifact JSON.',
            'Do not use outside knowledge. Do not invent numbers.',
            'If the artifact does not support the answer, say the report does not contain enough evidence.',
            'Respect RBAC strictly: for every non-LND_MANAGER role, do not reveal employee IDs, individual scores, or personal comments.',
            'For metric or comparison questions, write a business-ready answer with: (1) a direct conclusion, (2) the key validated values and both absolute and relative differences when calculable, (3) a short section labelled "Ý nghĩa:" that interprets the result without claiming an unsupported cause, and (4) a short section labelled "Khuyến nghị:" with one evidence-grounded next step.',
            'Keep simple answers compact, normally 80 to 180 words, and omit a section only when the artifact cannot support it.',
            'Return strict JSON only with keys: answer, confidence, citations, limitations.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            question: input.question,
            role: input.role,
            validatedArtifact: context,
            deterministicFallback: input.deterministicAnswer,
          }),
        },
      ],
    });
    const parsed = QnaLlmSchema.parse(JSON.parse(raw));
    return {
      answer: parsed.answer,
      confidence: clamp(parsed.confidence, 0, 0.96),
      citations:
        parsed.citations.length > 0 ? parsed.citations : input.deterministicAnswer.citations,
      limitations: mergeUnique(input.deterministicAnswer.limitations, parsed.limitations, 8),
    };
  } catch (_error) {
    return {
      ...input.deterministicAnswer,
      limitations: mergeUnique(
        input.deterministicAnswer.limitations,
        ['LLM Q&A fallback was used because the model call failed.'],
        8,
      ),
    };
  }
}

async function callOpenAiJson(input: {
  env: NodeJS.ProcessEnv;
  model: string;
  messages: ChatMessage[];
}): Promise<string> {
  const apiKey = resolveLdOpenAiApiKey(input.env);
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for L&D LLM generation.');
  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: input.messages,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(formatOpenAiError(response.status, text));
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI response did not include message.content.');
  return content;
}

function resolveLdOpenAiApiKey(env: NodeJS.ProcessEnv): string | undefined {
  if (env.LD_REPORTING_OPENAI_API_KEY) return env.LD_REPORTING_OPENAI_API_KEY;
  if (env.NODE_ENV !== 'production') return readDotEnvOpenAiApiKey() ?? env.OPENAI_API_KEY;
  return env.OPENAI_API_KEY;
}

function readDotEnvOpenAiApiKey(): string | undefined {
  if (cachedDotEnvOpenAiKey !== undefined) return cachedDotEnvOpenAiKey ?? undefined;
  const path = findDotEnv(process.cwd());
  if (!path) {
    cachedDotEnvOpenAiKey = null;
    return undefined;
  }
  try {
    cachedDotEnvOpenAiKey = readEnvValue(readFileSync(path, 'utf8'), 'OPENAI_API_KEY') ?? null;
  } catch {
    cachedDotEnvOpenAiKey = null;
  }
  return cachedDotEnvOpenAiKey ?? undefined;
}

function findDotEnv(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir || parse(dir).root === dir) return undefined;
    dir = parent;
  }
}

function readEnvValue(text: string, name: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const pattern = new RegExp(`^\\s*${name}\\s*=`);
  let line: string | undefined;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (pattern.test(lines[index] ?? '')) {
      line = lines[index];
      break;
    }
  }
  if (!line) return undefined;
  const value = line
    .replace(new RegExp(`^\\s*${name}\\s*=`), '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  return value || undefined;
}

function formatOpenAiError(status: number, body: string): string {
  const parsed = parseOpenAiError(body);
  const code = parsed.code ? ` (${parsed.code})` : '';
  if (status === 401) return `OpenAI API key was rejected${code}. Check OPENAI_API_KEY.`;
  if (status === 403) return `OpenAI API key does not have access to this model or project${code}.`;
  if (status === 429 && parsed.code === 'insufficient_quota') {
    return 'OpenAI quota exhausted for the configured API key (insufficient_quota). Check billing, project budget, or use another key.';
  }
  if (status === 429)
    return `OpenAI rate limit reached${code}. Try again later or reduce request frequency.`;
  if (status >= 500) return `OpenAI service error ${status}${code}. Try again later.`;
  return `OpenAI request failed ${status}${code}: ${parsed.message || body.slice(0, 180)}`;
}

function parseOpenAiError(body: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } };
    return {
      code: typeof parsed.error?.code === 'string' ? parsed.error.code : undefined,
      message: typeof parsed.error?.message === 'string' ? parsed.error.message : undefined,
    };
  } catch {
    return {};
  }
}

function buildReportContext(report: ReportJson, dataset: NormalizedDataset) {
  return {
    scope: report.scope,
    generatedAt: report.generatedAt,
    evidence: {
      status: report.evidence.status,
      canGenerateFinalConclusion: report.evidence.canGenerateFinalConclusion,
      missingEvidence: report.evidence.missingEvidence.map((item) => ({
        type: item.type,
        severity: item.severity,
        courseId: item.courseId,
        affectedCount: item.affectedCount,
        message: item.message,
      })),
      checklist: report.evidence.checklist,
    },
    metrics: {
      overall: renderOverallMetrics(report),
      courses: report.metrics.courses.map((course) => ({
        courseId: course.courseId,
        courseName: course.courseName,
        status: course.status,
        traineeCount: course.traineeCount,
        attendanceRate: formatPct(course.attendanceRate),
        completionRate: formatPct(course.completionRate),
        passRate: formatPct(course.passRate),
        averageScore: `${formatNumber(course.averageScore, 2)}/10`,
        feedbackRating: `${formatNumber(course.feedbackRating, 2)}/5`,
        trainingHours: course.trainingHours,
        totalCostScaled: course.totalCostScaled,
        roiProxy: course.roiProxy,
        effectivenessScore: course.effectivenessScore,
      })),
    },
    governance: {
      role: report.governance.role,
      classification: report.governance.classification,
      masked: report.governance.masked,
      normFlags: report.governance.normFlags.map((flag) => ({
        ruleId: flag.ruleId,
        priority: flag.priority,
        category: flag.category,
        courseId: flag.courseId,
        message: flag.message,
        action: flag.action,
      })),
      outstandingCount: report.governance.outstandingTrainees.length,
      supportNeededGroups: report.governance.supportNeededGroups,
    },
    templateSections: dataset.templateSections.map((section) => ({
      sectionId: section.sectionId,
      sectionName: section.sectionName,
      required: section.required,
      dataSource: section.dataSource,
      contentDescription: section.contentDescription,
    })),
    rules: dataset.normRules.map((rule) => ({
      ruleId: rule.ruleId,
      category: rule.category,
      threshold: rule.threshold,
      actionIfTriggered: rule.actionIfTriggered,
      priority: rule.priority,
    })),
  };
}

function buildQnaContext(report: ReportJson, role: LdRole) {
  const safeGovernance = {
    role,
    classification: report.governance.classification,
    masked: role !== 'LND_MANAGER' || report.governance.masked,
    normFlags: report.governance.normFlags.map((flag) => ({
      ruleId: flag.ruleId,
      priority: flag.priority,
      category: flag.category,
      courseId: flag.courseId,
      message: stripEmployeeIds(flag.message),
      action: flag.action,
    })),
    outstandingTrainees:
      role === 'LND_MANAGER'
        ? report.governance.outstandingTrainees
        : [{ count: report.governance.outstandingTrainees.length, note: 'Masked by RBAC.' }],
    supportNeededGroups: report.governance.supportNeededGroups,
  };
  return {
    title: report.title,
    status: report.status,
    executiveSummary: report.executiveSummary,
    insights: report.insights,
    recommendations: report.recommendations,
    warnings: report.warnings,
    evidence: report.evidence,
    metrics: report.metrics,
    governance: safeGovernance,
    allowedCitationPrefixes: [
      'metrics',
      'evidence',
      'governance',
      'report.executiveSummary',
      'report.insights',
      'report.recommendations',
    ],
  };
}

function renderOverallMetrics(report: ReportJson) {
  const o = report.metrics.overall;
  return {
    totalCourses: o.totalCourses,
    completedCourses: o.completedCourses,
    traineeCount: o.traineeCount,
    attendanceRate: formatPct(o.attendanceRate),
    completionRate: formatPct(o.completionRate),
    passRate: formatPct(o.passRate),
    averageScore: `${formatNumber(o.averageScore, 2)}/10`,
    feedbackRating: `${formatNumber(o.feedbackRating, 2)}/5`,
    trainingHours: o.trainingHours,
    totalCostScaled: o.totalCostScaled,
    roiProxy: o.roiProxy,
    effectivenessScore: o.effectivenessScore,
  };
}

function mergeUnique(a: string[], b: string[], limit: number): string[] {
  const out: string[] = [];
  for (const value of [...a, ...b]) {
    const trimmed = value.trim();
    if (!isUsableNarrative(trimmed)) continue;
    if (
      !out.some(
        (existing) =>
          existing.toLowerCase() === trimmed.toLowerCase() || isNearDuplicate(existing, trimmed),
      )
    ) {
      out.push(trimmed);
    }
    if (out.length >= limit) break;
  }
  return out;
}

function coerceText(value: unknown, maxLength: number): string {
  if (typeof value === 'string') return value.trim().slice(0, maxLength);
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value).slice(0, maxLength);
  if (value && typeof value === 'object') {
    const values = Object.values(value);
    const text = values
      .map((item) => coerceText(item, maxLength))
      .filter(Boolean)
      .join(' ');
    if (text) return text.slice(0, maxLength);
  }
  return '';
}

function coerceTextList(value: unknown, limit: number, itemMaxLength: number): string[] {
  const values = listCandidateValues(value);
  const out: string[] = [];
  for (const item of values) {
    const text = coerceNarrativeCandidate(item, itemMaxLength);
    if (!isUsableNarrative(text)) continue;
    if (!out.some((existing) => existing.toLowerCase() === text.toLowerCase())) out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function listCandidateValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/\n+|(?<=\.)\s+(?=[A-Z])/);
  if (!value || typeof value !== 'object') return [];

  const direct = extractNarrativeField(value);
  if (direct) return [direct];

  return Object.values(value).flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (Array.isArray(item)) return item;
    if (item && typeof item === 'object') {
      const nested = extractNarrativeField(item);
      return nested ? [nested] : [];
    }
    return [];
  });
}

function extractNarrativeField(value: object): string {
  const record = value as Record<string, unknown>;
  const keys = [
    'insight',
    'recommendation',
    'action',
    'text',
    'statement',
    'headline',
    'summary',
    'description',
    'rationale',
    'message',
    'implication',
  ];
  for (const key of keys) {
    const field = record[key];
    if (typeof field === 'string' && field.trim()) return field;
  }
  return '';
}

function coerceNarrativeCandidate(value: unknown, itemMaxLength: number): string {
  return coerceText(value, itemMaxLength)
    .replace(/^[-*\d.)\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsableNarrative(value: string): boolean {
  if (value.length < 24) return false;
  const letters = value.match(/[A-Za-z]/g)?.length ?? 0;
  if (letters < 12) return false;
  const words = value.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  if (words.length < 4) return false;
  const numericTokens = value.match(/\b\d+(?:\.\d+)?%?\b/g)?.length ?? 0;
  if (numericTokens > words.length) return false;
  return true;
}

function isNearDuplicate(a: string, b: string): boolean {
  if (hasSharedActionTheme(a, b)) return true;
  const aTokens = meaningfulTokens(a);
  const bTokens = meaningfulTokens(b);
  if (aTokens.size < 4 || bTokens.size < 4) return false;
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  const smaller = Math.min(aTokens.size, bTokens.size);
  return overlap / smaller >= 0.58;
}

function hasSharedActionTheme(a: string, b: string): boolean {
  const themes = [
    ['coach', 'coaching', 'buddy', 'practice', 'support'],
    ['reenroll', 're-enrollment', 'incomplete', 'cohort'],
    ['attendance', 'manager', 'direct manager'],
    ['content', 'materials', 'delivery', 'method'],
    ['feedback', 'rating', 'survey'],
  ];
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return themes.some(
    (theme) =>
      theme.some((token) => left.includes(token)) && theme.some((token) => right.includes(token)),
  );
}

function meaningfulTokens(value: string): Set<string> {
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'from',
    'into',
    'are',
    'was',
    'were',
    'has',
    'have',
    'had',
    'will',
    'need',
    'needs',
    'based',
    'course',
    'courses',
    'trainee',
    'trainees',
    'learner',
    'learners',
  ]);
  const tokens = value.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
  return new Set(tokens.filter((token) => !stopWords.has(token)));
}

function stripEmployeeIds(value: string): string {
  return value.replace(/EMP-[A-Za-z0-9-]+/g, 'individual learner');
}
