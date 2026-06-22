import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, 'evidence');
const testDir = join(evidence, '01_test-results');
await mkdir(testDir, { recursive: true });

const vitest = JSON.parse(await readFile(join(testDir, 'vitest-results.json'), 'utf8'));
const benchmark = JSON.parse(await readFile(join(evidence, '02_benchmark', 'benchmark-summary.json'), 'utf8'));
const edge = JSON.parse(await readFile(join(evidence, '05_edge-cases', 'edge-case-results.json'), 'utf8'));
const rbac = JSON.parse(await readFile(join(evidence, '03_rbac-human-review', 'rbac-results.json'), 'utf8'));
const assertions = vitest.testResults.flatMap((file) =>
  file.assertionResults.map((item) => ({
    name: item.fullName,
    status: item.status === 'passed' ? 'PASS' : item.status === 'pending' ? 'SKIP' : 'FAIL',
    durationMs: item.duration ?? null,
    evidence: file.name.replaceAll('\\', '/').split('/packages/ld-reporting/').at(-1),
    failureMessages: item.failureMessages,
  })),
);
const metricAssertions = benchmark.metricAssertions.map((item) => ({
  name: `Independent KPI validation: ${item.metric}`,
  status: item.passed ? 'PASS' : 'FAIL',
  evidence: `expected=${item.expected}, actual=${item.actual}, delta=${item.delta}, tolerance=${item.tolerance}`,
  ...item,
}));
const scenarios = [...assertions, ...metricAssertions].map((item, index) => ({
  id: `TC-${String(index + 1).padStart(3, '0')}`,
  ...item,
}));
const passed = scenarios.filter((item) => item.status === 'PASS').length;
const failed = scenarios.filter((item) => item.status === 'FAIL').length;
await writeFile(
  join(testDir, 'metrics-assertions.json'),
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalAssertions: scenarios.length,
    passedAssertions: passed,
    failedAssertions: failed,
    accuracy: scenarios.length ? passed / scenarios.length : null,
    testCases: assertions.length,
    metricChecks: metricAssertions.length,
    scenarios,
  }, null, 2)}\n`,
  'utf8',
);

const evidenceGateTests = assertions.filter((item) => item.name.includes('ld-reporting evidence gate'));
await writeFile(
  join(testDir, 'test-summary.md'),
  `# L&D Reporting automated test summary\n\n- Command: \`pnpm -F @seta/ld-reporting test\`\n- Test files: ${vitest.testResults.length}\n- Tests: ${vitest.numPassedTests}/${vitest.numTotalTests} passed; ${vitest.numFailedTests} failed; ${vitest.numPendingTests} pending.\n- Evidence Gate tests: ${evidenceGateTests.filter((item) => item.status === 'PASS').length}/${evidenceGateTests.length} passed.\n- Independent KPI checks: ${metricAssertions.filter((item) => item.status === 'PASS').length}/${metricAssertions.length} within declared precision tolerance; ${metricAssertions.filter((item) => item.exactMatch).length}/${metricAssertions.length} exact matches.\n\n## Test case list\n\n| ID | Scenario | Status | Duration (ms) | Source |\n|---|---|---|---:|---|\n${scenarios.map((item) => `| ${item.id} | ${escapeTable(item.name)} | ${item.status} | ${item.durationMs ?? 'N/A'} | ${escapeTable(item.evidence)} |`).join('\n')}\n\n## Manual evidence\n\nAuthenticated UI screenshots remain manual because this run did not create or bypass platform login sessions. See \`../03_rbac-human-review/manual-rbac-checklist.md\`. Domain and HTTP RBAC behavior is automated.\n`,
  'utf8',
);

const pptx = await stat(join(evidence, '04_artifacts', 'generated-report.pptx'));
const docx = await stat(join(evidence, '04_artifacts', 'generated-report.docx'));
const report = JSON.parse(await readFile(join(evidence, '04_artifacts', 'generated-report.json'), 'utf8'));
const commit = safeCommand('git', ['rev-parse', '--short', 'HEAD']) || 'unavailable';
const pnpm = safeCommand(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--version']) || 'unavailable';
const generation = benchmark.operations.generate_report_with_artifacts;
const metricPassed = metricAssertions.filter((item) => item.status === 'PASS').length;
const exactMetrics = metricAssertions.filter((item) => item.exactMatch).length;

await writeFile(
  join(evidence, 'results-summary.md'),
  `# L&D Reporting Agent — Results & Metrics Evidence Pack\n\n## Evaluation Date\n\n${new Date().toISOString()}\n\n## Environment\n\n- Node: ${process.version} (repository target: Node 24 LTS)\n- pnpm: ${pnpm}\n- OS: ${process.platform}/${process.arch}\n- Commit SHA: ${commit}\n- LLM enabled: false\n- Model: deterministic fallback; no external LLM call measured\n- Dataset: \`packages/ld-reporting/mock-data/LnD_07_Training_Effectiveness.xlsx\`\n- Test command: \`pnpm -F @seta/ld-reporting test\`\n- Benchmark runs per operation: ${benchmark.runsPerOperation}\n\n## Results Overview\n\n| Metric | Result | Evidence |\n|---|---:|---|\n| Automated test pass rate | ${vitest.numPassedTests}/${vitest.numTotalTests} (${percent(vitest.numPassedTests, vitest.numTotalTests)}) | \`01_test-results/vitest-output.txt\` |\n| Output quality / metric accuracy | ${metricPassed}/${metricAssertions.length} within declared tolerance; ${exactMetrics}/${metricAssertions.length} exact | \`01_test-results/metrics-assertions.json\` |\n| Evidence Gate automated tests | ${evidenceGateTests.filter((item) => item.status === 'PASS').length}/${evidenceGateTests.length} | \`01_test-results/test-summary.md\` |\n| Processing speed | avg ${generation.avgMs} ms; p95 ${generation.p95Ms} ms (${generation.runs} runs) | \`02_benchmark/benchmark.csv\` |\n| Test coverage list | ${assertions.length} automated scenarios | \`01_test-results/test-summary.md\` |\n| Edge case handling | ${edge.passed}/${edge.totalEdgeCases} | \`05_edge-cases/edge-case-results.json\` |\n| RBAC/HITL runtime checks | ${rbac.passed}/${rbac.total} | \`03_rbac-human-review/rbac-results.json\` |\n| Artifact generation | PASS — PPTX ${pptx.size} bytes; DOCX ${docx.size} bytes | \`04_artifacts/artifact-verification.txt\` |\n\nMetric accuracy uses an independent calculation from normalized rows. Feedback rating differs by 0.01 (${metricAssertions.find((item) => item.metric === 'feedbackRating')?.expected} raw-order calculation vs ${metricAssertions.find((item) => item.metric === 'feedbackRating')?.actual} pipeline result) because the pipeline rounds course ratings before overall aggregation; it passes the declared 0.01 display-precision tolerance and is not counted as an exact match.\n\n## Before/After Efficiency Comparison\n\nNo observed or team-estimated manual baseline was supplied, so no time-saving percentage is claimed.\n\n| Workflow Step | Manual Baseline | Agent Workflow (measured) | Evidence |\n|---|---:|---:|---|\n| Load and normalize data | Not measured | avg ${benchmark.operations.load_normalize_dataset.avgMs} ms | \`02_benchmark/benchmark.csv\` |\n| Evidence Gate | Not measured | avg ${benchmark.operations.evidence_gate.avgMs} ms | \`02_benchmark/benchmark.csv\` |\n| Metric calculation | Not measured | avg ${benchmark.operations.metrics_calculation.avgMs} ms | \`02_benchmark/benchmark.csv\` |\n| Complete draft + PPTX/DOCX | Not measured | avg ${generation.avgMs} ms | \`02_benchmark/benchmark.csv\` |\n| Finalize state transition | Not measured | avg ${benchmark.operations.finalize.avgMs} ms | \`02_benchmark/benchmark.csv\` |\n\nEfficiency improvement cannot be calculated until a real or explicitly team-estimated manual baseline is recorded.\n\n## Evaluated Report Snapshot\n\n- Report ID: ${report.reportId}\n- Status: ${report.status}\n- Evidence: ${report.evidence.status}\n- Quality: ${report.quality?.status ?? 'NOT_CHECKED'}\n- Courses: ${report.metrics.overall.totalCourses}\n- Trainee-course records: ${report.metrics.overall.traineeCount}\n- Attendance: ${report.metrics.overall.attendanceRate}\n- Completion: ${report.metrics.overall.completionRate}\n- Pass rate: ${report.metrics.overall.passRate}\n- Effectiveness score: ${report.metrics.overall.effectivenessScore}\n\n## Key Evidence Links\n\n- Test output: \`01_test-results/vitest-output.txt\`\n- Machine-readable tests: \`01_test-results/vitest-results.json\`\n- Metric assertions: \`01_test-results/metrics-assertions.json\`\n- Benchmark CSV: \`02_benchmark/benchmark.csv\`\n- RBAC/HITL evidence: \`03_rbac-human-review/rbac-api-test-output.txt\`\n- Generated PPTX: \`04_artifacts/generated-report.pptx\`\n- Generated DOCX: \`04_artifacts/generated-report.docx\`\n- Edge cases: \`05_edge-cases/edge-case-results.json\`\n\n## Limitations\n\n- Runtime is Node ${process.version}; repository target is Node 24 LTS.\n- LLM was disabled, so benchmark measures deterministic fallback and excludes network/model latency.\n- No authenticated UI screenshots were generated; API/domain checks and a manual screenshot checklist are provided instead.\n- Manual processing baseline was not measured or provided, so no efficiency-improvement percentage is claimed.\n- Benchmark is local development performance, not production load testing.\n`,
  'utf8',
);

console.log(vitest.success && failed === 0 ? 'EVIDENCE PACK GENERATED' : 'EVIDENCE PACK PARTIALLY GENERATED');
console.log('\nSummary:');
console.log(`- Test pass rate: ${vitest.numPassedTests}/${vitest.numTotalTests} (${percent(vitest.numPassedTests, vitest.numTotalTests)})`);
console.log(`- Metric accuracy: ${metricPassed}/${metricAssertions.length} within tolerance; ${exactMetrics}/${metricAssertions.length} exact`);
console.log(`- Evidence Gate accuracy: ${evidenceGateTests.filter((item) => item.status === 'PASS').length}/${evidenceGateTests.length}`);
console.log(`- Avg report generation time: ${generation.avgMs} ms`);
console.log(`- Artifact generation: PPTX ${pptx.size} bytes; DOCX ${docx.size} bytes`);
console.log(`- RBAC/HITL: ${rbac.passed}/${rbac.total}`);
console.log('- Evidence folder: evidence/');

function safeCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim();
  } catch {
    return '';
  }
}
function percent(numerator, denominator) { return denominator ? `${((numerator / denominator) * 100).toFixed(1)}%` : 'N/A'; }
function escapeTable(value) { return String(value).replaceAll('|', '\\|').replaceAll('\n', ' '); }
