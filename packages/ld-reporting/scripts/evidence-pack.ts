import { copyFile, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { NormalizedDataset, ReportJson } from '../src/models.ts';
import { evaluateEvidence } from '../src/backend/domain/evidence-gate.ts';
import { loadAndNormalizeDataset } from '../src/backend/domain/excel-loader.ts';
import { applyGovernanceAndRbac } from '../src/backend/domain/governance-service.ts';
import { calculateMetrics } from '../src/backend/domain/metrics-service.ts';
import { LdReportingSpecialistAgent } from '../src/backend/domain/orchestrator.ts';
import { buildReportJson } from '../src/backend/domain/report-builder.ts';
import { LdReportingStore } from '../src/backend/domain/storage.ts';

process.env.LD_REPORTING_USE_LLM = 'false';

const RUNS = 5;
const repoRoot = resolve(import.meta.dirname, '../../..');
const evidenceRoot = join(repoRoot, 'evidence');
const benchmarkDir = join(evidenceRoot, '02_benchmark');
const rbacDir = join(evidenceRoot, '03_rbac-human-review');
const artifactsDir = join(evidenceRoot, '04_artifacts');
const edgeDir = join(evidenceRoot, '05_edge-cases');
const workDir = await mkdtemp(join(tmpdir(), 'ld-reporting-evidence-'));
const store = new LdReportingStore(workDir);
const agent = new LdReportingSpecialistAgent({ store });

for (const dir of [benchmarkDir, rbacDir, artifactsDir, edgeDir]) await mkdir(dir, { recursive: true });

type BenchmarkRow = {
  operation: string;
  runIndex: number;
  durationMs: number;
  status: 'PASS' | 'FAIL';
  error: string;
};
const rows: BenchmarkRow[] = [];

async function measure<T>(operation: string, runIndex: number, fn: () => Promise<T> | T): Promise<T | undefined> {
  const start = performance.now();
  try {
    const value = await fn();
    rows.push({ operation, runIndex, durationMs: round(performance.now() - start, 2), status: 'PASS', error: '' });
    return value;
  } catch (error) {
    rows.push({
      operation,
      runIndex,
      durationMs: round(performance.now() - start, 2),
      status: 'FAIL',
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

const baselineDataset = await loadAndNormalizeDataset({ scope: { period: '2026-Q1' } });
for (let index = 1; index <= RUNS; index += 1) {
  await measure('load_normalize_dataset', index, () =>
    loadAndNormalizeDataset({ scope: { period: '2026-Q1' } }),
  );
  await measure('evidence_gate', index, () => evaluateEvidence(structuredClone(baselineDataset)));
  await measure('metrics_calculation', index, () => calculateMetrics(structuredClone(baselineDataset)));
  await measure('build_report_json', index, () => {
    const dataset = structuredClone(baselineDataset);
    const evidence = evaluateEvidence(dataset);
    const metrics = calculateMetrics(dataset);
    const governance = applyGovernanceAndRbac(dataset, metrics, evidence, 'LND_MANAGER');
    return buildReportJson({ dataset, evidence, metrics, governance });
  });
  await measure('readiness', index, () => agent.ld_checkReadiness({ scope: { period: '2026-Q1' } }));
}

const generatedReports: ReportJson[] = [];
for (let index = 1; index <= RUNS; index += 1) {
  const report = await measure('generate_report_with_artifacts', index, () =>
    agent.ld_generateReport({ scope: { period: '2026-Q1' } }),
  );
  if (report) generatedReports.push(report);
}
if (generatedReports.length === 0) throw new Error('No report was generated; artifact evidence cannot be produced.');

const draft = generatedReports[0]!;
const rawEmployeeIds = collectRawEmployeeIds(draft);
const managerDraftVisible = (await agent.listReports({ role: 'LND_MANAGER' })).some(
  (report) => report.reportId === draft.reportId,
);
const bodDraftVisible = (await agent.listReports({ role: 'BOD' })).some(
  (report) => report.reportId === draft.reportId,
);
const bodDraftAnswer = await agent.ld_answerQuestion({
  reportId: draft.reportId,
  role: 'BOD',
  question: 'What is the completion rate?',
});

for (let index = 0; index < generatedReports.length; index += 1) {
  await measure('finalize', index + 1, () =>
    agent.ld_finalizeReport({
      reportId: generatedReports[index]!.reportId,
      body: { decision: 'approve', note: 'Evidence pack benchmark approval' },
      actorUserId: 'evidence-runner',
    }),
  );
}
const finalized = (await agent.getReport(draft.reportId))!;
for (let index = 1; index <= RUNS; index += 1) {
  await measure('qna_finalized', index, () =>
    agent.ld_answerQuestion({
      reportId: finalized.reportId,
      role: 'BOD',
      question: 'Summarize the finalized report.',
    }),
  );
  await measure('generate_artifact_bod_docx', index, () =>
    agent.writeArtifactForRole(finalized.reportId, 'docx', { role: 'BOD' }),
  );
}

const bodReports = await agent.listReports({ role: 'BOD' });
const bodView = agent.viewReport(finalized, { role: 'BOD' });
const bodJson = JSON.stringify(bodView);
const rbacChecks = [
  result('Manager sees draft', managerDraftVisible, String(managerDraftVisible)),
  result('BOD cannot see draft', !bodDraftVisible, String(bodDraftVisible)),
  result('Manager finalizes valid report', finalized.status === 'FINAL', finalized.status),
  result('BOD sees finalized report', bodReports.some((r) => r.reportId === finalized.reportId), String(bodReports.length)),
  result('BOD view masks raw employee IDs', rawEmployeeIds.every((id) => !bodJson.includes(id)), `${rawEmployeeIds.length} raw IDs checked`),
  result('BOD view omits internal artifact paths', !('artifacts' in bodView), String('artifacts' in bodView)),
  result('BOD Q&A rejects draft', /chua duoc finalized|not finalized/i.test(bodDraftAnswer.answer), bodDraftAnswer.answer),
];

const metricAssertions = validateMetricsIndependently(baselineDataset, finalized);
const edgeCases = await evaluateEdgeCases();

const artifactPptx = finalized.artifacts?.pptxPath;
const artifactDocx = finalized.artifacts?.docxPath;
if (!artifactPptx || !artifactDocx) throw new Error('Generated report is missing PPTX or DOCX path.');
const outputPptx = join(artifactsDir, 'generated-report.pptx');
const outputDocx = join(artifactsDir, 'generated-report.docx');
const outputJson = join(artifactsDir, 'generated-report.json');
await copyFile(artifactPptx, outputPptx);
await copyFile(artifactDocx, outputDocx);
await writeJson(outputJson, finalized);
const [pptxStat, docxStat, jsonStat] = await Promise.all([stat(outputPptx), stat(outputDocx), stat(outputJson)]);
await writeFile(
  join(artifactsDir, 'artifact-verification.txt'),
  [
    'PPTX exists: true',
    `PPTX size bytes: ${pptxStat.size}`,
    'DOCX exists: true',
    `DOCX size bytes: ${docxStat.size}`,
    'Report JSON exists: true',
    `Report JSON size bytes: ${jsonStat.size}`,
    `Source report ID: ${finalized.reportId}`,
  ].join('\n') + '\n',
  'utf8',
);

const benchmarkSummary = summarize(rows);
await writeFile(join(benchmarkDir, 'benchmark.csv'), toCsv(rows), 'utf8');
await writeJson(join(benchmarkDir, 'benchmark-summary.json'), {
  measuredAt: new Date().toISOString(),
  runsPerOperation: RUNS,
  environment: {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    llmEnabled: false,
    llmMode: 'deterministic fallback (LD_REPORTING_USE_LLM=false)',
    dataset: 'packages/ld-reporting/mock-data/LnD_07_Training_Effectiveness.xlsx',
  },
  operations: benchmarkSummary,
  metricAssertions,
});
await writeFile(
  join(benchmarkDir, 'benchmark-output.txt'),
  Object.entries(benchmarkSummary)
    .map(([name, value]) => `${name}: ${value.success}/${value.runs} PASS, avg=${value.avgMs}ms, p95=${value.p95Ms}ms`)
    .join('\n') + '\n',
  'utf8',
);

await writeJson(join(edgeDir, 'edge-case-results.json'), {
  totalEdgeCases: edgeCases.length,
  passed: edgeCases.filter((item) => item.passed).length,
  failed: edgeCases.filter((item) => !item.passed).length,
  cases: edgeCases,
});
await writeFile(
  join(edgeDir, 'edge-case-summary.md'),
  `# Edge-case evidence\n\nGenerated from direct calls to \`evaluateEvidence\` and the report pipeline.\n\n| ID | Case | Expected | Actual | Result |\n|---|---|---|---|---|\n${edgeCases.map((item) => `| ${item.id} | ${item.name} | ${item.expectedStatus} | ${item.actualStatus} | ${item.passed ? 'PASS' : 'FAIL'} |`).join('\n')}\n\nLLM fallback was verified from the generated report metadata with \`LD_REPORTING_USE_LLM=false\`.\n`,
  'utf8',
);

await writeFile(
  join(rbacDir, 'rbac-api-test-output.txt'),
  rbacChecks.map((item) => `${item.passed ? 'PASS' : 'FAIL'} | ${item.name} | ${item.actual}`).join('\n') + '\n',
  'utf8',
);
await writeJson(join(rbacDir, 'rbac-results.json'), {
  measuredAt: new Date().toISOString(),
  passed: rbacChecks.filter((item) => item.passed).length,
  total: rbacChecks.length,
  checks: rbacChecks,
});
await writeFile(
  join(rbacDir, 'rbac-source-verification.md'),
  `# RBAC and human-review source verification\n\n- Role masking and artifact-path removal: \`packages/ld-reporting/src/backend/domain/access-control.ts\` — \`applyReportAccessView\`.\n- Manager/BOD finalized-only filtering: \`packages/ld-reporting/src/backend/domain/orchestrator.ts\` — \`listReports\`, \`canUseReportForRole\`.\n- Evidence/quality finalize gate: \`packages/ld-reporting/src/backend/domain/orchestrator.ts\` — \`ld_finalizeReport\`.\n- HTTP finalize endpoint and 409 mapping: \`packages/ld-reporting/src/backend/http/index.ts\`.\n- BOD finalized-only Q&A: \`packages/ld-reporting/src/backend/domain/orchestrator.ts\` — \`ld_answerQuestion\`.\n- Automated API contract: \`packages/ld-reporting/tests/http.test.ts\`.\n\nSee \`rbac-api-test-output.txt\` for runtime results. UI screenshots were not generated because this runner does not create or bypass authenticated user sessions.\n`,
  'utf8',
);
await writeFile(
  join(rbacDir, 'manual-rbac-checklist.md'),
  `# Manual UI evidence checklist\n\nUse seeded Manager and BOD accounts; do not mark a step complete without a real screenshot.\n\n- [ ] Manager generates and sees a DRAFT report.\n- [ ] Manager sees Evidence and Quality status.\n- [ ] Manager approves a valid report; status changes to FINAL.\n- [ ] Manager approval is blocked for BLOCKED evidence.\n- [ ] BOD report list excludes drafts.\n- [ ] BOD sees the finalized report and download buttons.\n- [ ] BOD Q&A uses the selected finalized report and exposes no raw employee ID.\n\nAutomated domain/API equivalents are recorded in \`rbac-results.json\`.\n`,
  'utf8',
);

console.log('EVIDENCE RUNTIME MEASUREMENTS GENERATED');
console.log(`Benchmark rows: ${rows.length}`);
console.log(`Metric assertions: ${metricAssertions.filter((item) => item.passed).length}/${metricAssertions.length}`);
console.log(`Edge cases: ${edgeCases.filter((item) => item.passed).length}/${edgeCases.length}`);
console.log(`RBAC/HITL: ${rbacChecks.filter((item) => item.passed).length}/${rbacChecks.length}`);
console.log(`Artifact: ${basename(outputPptx)}, ${basename(outputDocx)}`);

async function evaluateEdgeCases() {
  const definitions: Array<{
    id: string;
    name: string;
    expectedStatus: string;
    mutate?: (dataset: NormalizedDataset) => void;
    scope?: { courseId?: string; period?: string };
    expectedItems: string[];
  }> = [
    { id: 'EC-001', name: 'Missing attendance', expectedStatus: 'BLOCKED', expectedItems: ['MISSING_ATTENDANCE'], mutate: (d) => { const c = d.courses[0]!.courseId; d.attendance = d.attendance.filter((r, i) => r.courseId !== c || i !== 0); } },
    { id: 'EC-002', name: 'Missing assessment', expectedStatus: 'BLOCKED', expectedItems: ['MISSING_ASSESSMENT'], mutate: (d) => { const row = d.assessments[0]!; d.assessments = d.assessments.filter((r) => r !== row); } },
    { id: 'EC-003', name: 'In-progress course', expectedStatus: 'BLOCKED', expectedItems: ['IN_PROGRESS_COURSE'], scope: { courseId: 'Leadership_06_2026' } },
    { id: 'EC-004', name: 'Insufficient feedback', expectedStatus: 'PARTIAL_PASS', expectedItems: ['INSUFFICIENT_FEEDBACK'], mutate: (d) => { const c = d.courses[0]!.courseId; d.feedback = d.feedback.filter((r, i) => r.courseId !== c || i === 0); } },
    { id: 'EC-005', name: 'Unknown course ID', expectedStatus: 'BLOCKED', expectedItems: ['NO_COURSES_IN_SCOPE'], scope: { courseId: 'UNKNOWN_COURSE' } },
    { id: 'EC-006', name: 'Duplicate attendance', expectedStatus: 'BLOCKED', expectedItems: ['DUPLICATE_ATTENDANCE'], mutate: (d) => { d.attendance.push({ ...d.attendance[0]! }); } },
    { id: 'EC-007', name: 'Invalid score and rating', expectedStatus: 'BLOCKED', expectedItems: ['INVALID_SCORE_RANGE', 'INVALID_RATING_RANGE'], mutate: (d) => { d.assessments[0]!.score = 11; d.assessments[0]!.passStatus = true; d.feedback[0]!.trainerRating = 6; } },
  ];
  const cases = [];
  for (const definition of definitions) {
    const dataset = structuredClone(
      await loadAndNormalizeDataset({ scope: definition.scope ?? { period: '2026-Q1' } }),
    );
    definition.mutate?.(dataset);
    const evidence = evaluateEvidence(dataset);
    const evidenceItems = evidence.missingEvidence.map((item) => item.type);
    cases.push({
      id: definition.id,
      name: definition.name,
      expectedStatus: definition.expectedStatus,
      actualStatus: evidence.status,
      passed:
        evidence.status === definition.expectedStatus &&
        definition.expectedItems.every((item) => evidenceItems.includes(item as never)),
      evidenceItems,
    });
  }
  const fallbackReport = await agent.ld_generateReport({ scope: { courseId: 'CloudAWS_03_2026' } });
  cases.push({
    id: 'EC-008',
    name: 'LLM unavailable / deterministic fallback',
    expectedStatus: 'FALLBACK',
    actualStatus: fallbackReport.llm?.enabled === false ? 'FALLBACK' : 'LLM_ENABLED',
    passed: fallbackReport.llm?.enabled === false && Boolean(fallbackReport.llm.fallbackReason),
    evidenceItems: [fallbackReport.llm?.fallbackReason ?? 'No fallback reason'],
  });
  return cases;
}

function validateMetricsIndependently(dataset: NormalizedDataset, report: ReportJson) {
  const courses = dataset.courses.map((course) => {
    const trainees = dataset.trainees.filter((item) => item.courseId === course.courseId);
    const attendanceRate = average(trainees.map((item) => item.attendanceRate));
    const completionRate = ratio(trainees.filter((item) => item.completed).length, trainees.length);
    const passRate = ratio(trainees.filter((item) => item.passStatus === true).length, trainees.length);
    const averageScore = average(trainees.map((item) => item.score));
    const trainer = average(trainees.map((item) => item.trainerRating));
    const content = average(trainees.map((item) => item.contentRating));
    const feedbackRating = average([trainer, content]);
    const cost = dataset.costs.find((item) => item.courseId === course.courseId);
    const perf = cost?.postTrainingPerfDelta == null ? null : clamp(cost.postTrainingPerfDelta / 0.05, 0, 1);
    const effectivenessScore = weightedAvailable([
      [attendanceRate, 0.2], [completionRate, 0.2], [passRate, 0.25],
      [averageScore == null ? null : averageScore / 10, 0.2],
      [feedbackRating == null ? null : feedbackRating / 5, 0.1], [perf, 0.05],
    ]) * 100;
    return {
      count: trainees.length,
      attendanceRate: roundNullable(attendanceRate, 4),
      completionRate: roundNullable(completionRate, 4),
      passRate: roundNullable(passRate, 4),
      averageScore: roundNullable(averageScore, 2),
      feedbackRating: roundNullable(feedbackRating, 2),
      trainingHours: round(trainees.reduce((sum, item) => sum + item.attendedUnits * course.hoursPerSession, 0), 2),
      effectivenessScore: roundNullable(effectivenessScore, 2),
    };
  });
  const expected = {
    totalCourses: dataset.courses.length,
    traineeCount: new Set(dataset.trainees.map((item) => `${item.courseId}:${item.employeeId}`)).size,
    attendanceRate: roundNullable(weightedAverage(courses, 'attendanceRate'), 4),
    completionRate: roundNullable(weightedAverage(courses, 'completionRate'), 4),
    passRate: roundNullable(weightedAverage(courses, 'passRate'), 4),
    averageScore: roundNullable(weightedAverage(courses, 'averageScore'), 2),
    feedbackRating: roundNullable(weightedAverage(courses, 'feedbackRating'), 2),
    trainingHours: round(courses.reduce((sum, item) => sum + item.trainingHours, 0), 2),
    effectivenessScore: roundNullable(average(courses.map((item) => item.effectivenessScore)), 2),
  };
  return Object.entries(expected).map(([metric, value]) => {
    const actual = report.metrics.overall[metric as keyof typeof report.metrics.overall];
    const tolerance = metric === 'totalCourses' || metric === 'traineeCount' || metric === 'trainingHours'
      ? 0
      : metric.endsWith('Rate')
        ? 0.0001
        : 0.01;
    const delta = typeof value === 'number' && typeof actual === 'number' ? Math.abs(value - actual) : null;
    const reportedDelta = delta === null ? null : round(delta, 6);
    return {
      metric,
      expected: value,
      actual,
      delta: reportedDelta,
      tolerance,
      exactMatch: value === actual,
      passed: value === actual || (reportedDelta !== null && reportedDelta <= tolerance),
    };
  });
}

function collectRawEmployeeIds(report: ReportJson): string[] {
  return [...new Set([
    ...report.governance.normFlags.map((item) => item.employeeId),
    ...report.governance.outstandingTrainees.map((item) => item.employeeId),
    ...report.governance.supportNeededTrainees.map((item) => item.employeeId),
  ].filter((item): item is string => Boolean(item)))];
}

function result(name: string, passed: boolean, actual: string) { return { name, passed, actual }; }
function round(value: number, digits: number) { return Number(value.toFixed(digits)); }
function roundNullable(value: number | null, digits: number) { return value == null ? null : round(value, digits); }
function ratio(numerator: number, denominator: number) { return denominator === 0 ? null : numerator / denominator; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function average(values: Array<number | null | undefined>) {
  const usable = values.filter((value): value is number => typeof value === 'number' && !Number.isNaN(value));
  return usable.length === 0 ? null : usable.reduce((sum, value) => sum + value, 0) / usable.length;
}
function weightedAvailable(parts: Array<[number | null, number]>) {
  const usable = parts.filter((part): part is [number, number] => part[0] != null);
  const weights = usable.reduce((sum, [, weight]) => sum + weight, 0);
  return usable.reduce((sum, [value, weight]) => sum + value * weight, 0) / weights;
}
function weightedAverage<T extends { count: number }>(items: T[], key: keyof T) {
  const usable = items.filter((item) => typeof item[key] === 'number');
  const count = usable.reduce((sum, item) => sum + item.count, 0);
  return count === 0 ? null : usable.reduce((sum, item) => sum + Number(item[key]) * item.count, 0) / count;
}
function summarize(input: BenchmarkRow[]) {
  return Object.fromEntries([...new Set(input.map((row) => row.operation))].map((operation) => {
    const operationRows = input.filter((row) => row.operation === operation);
    const successful = operationRows.filter((row) => row.status === 'PASS');
    const sorted = successful.map((row) => row.durationMs).sort((a, b) => a - b);
    return [operation, {
      runs: operationRows.length,
      success: successful.length,
      avgMs: round(successful.reduce((sum, row) => sum + row.durationMs, 0) / Math.max(successful.length, 1), 2),
      p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
    }];
  })) as Record<string, { runs: number; success: number; avgMs: number; p95Ms: number | null }>;
}
function toCsv(input: BenchmarkRow[]) {
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  return `operation,runIndex,durationMs,status,error\n${input.map((row) => [row.operation, row.runIndex, row.durationMs, row.status, row.error].map(escape).join(',')).join('\n')}\n`;
}
async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
