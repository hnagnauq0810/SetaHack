import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LdReportingSpecialistAgent } from '../src/backend/domain/orchestrator.ts';
import { buildReportModel } from '../src/backend/domain/report-model.ts';
import { LdReportingStore } from '../src/backend/domain/storage.ts';

describe('report recommendations', () => {
  it('gives every expected outcome a measurable baseline and target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ld-reporting-model-test-'));
    const agent = new LdReportingSpecialistAgent({ store: new LdReportingStore(root) });
    const report = await agent.ld_generateReport({ scope: { period: '2026-Q1' } });
    const model = buildReportModel(report);

    expect(model.recommendations.length).toBeGreaterThan(0);
    for (const recommendation of model.recommendations) {
      expect(recommendation.expectedOutcome).toMatch(/\d/);
      expect(recommendation.expectedOutcome).toMatch(/current|from|target|reduce|maintain/i);
    }

    const final = await agent.ld_finalizeReport({
      reportId: report.reportId,
      body: { decision: 'approve' },
      actorUserId: 'ldm001',
    });
    const bodModel = buildReportModel(agent.viewReport(final, { role: 'BOD' }));
    expect(bodModel.recommendations.every((item) => /\d/.test(item.expectedOutcome))).toBe(true);
    expect(JSON.stringify(bodModel.recommendations)).not.toMatch(/EMP-/i);
  });
});
