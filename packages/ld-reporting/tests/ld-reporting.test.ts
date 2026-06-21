import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { LdReportingSpecialistAgent } from '../src/backend/domain/orchestrator.ts';

describe('ld-reporting pipeline', () => {
  it('generates a report for completed Q1 courses', async () => {
    const agent = new LdReportingSpecialistAgent();
    const report = await agent.ld_generateReport({ scope: { period: '2026-Q1' } });
    expect(report.metrics.overall.totalCourses).toBeGreaterThan(0);
    expect(report.metrics.overall.traineeCount).toBeGreaterThan(0);
    expect(report.quality?.status).toBe('PASS');
    expect(report.artifacts?.docxPath).toBeTruthy();
    expect(report.artifacts?.pptxPath).toBeTruthy();
    const docxStats = await stat(report.artifacts?.docxPath ?? '');
    const pptxStats = await stat(report.artifacts?.pptxPath ?? '');
    expect(docxStats.isFile()).toBe(true);
    expect(pptxStats.isFile()).toBe(true);
    expect(docxStats.size).toBeGreaterThan(8_000);
    expect(pptxStats.size).toBeGreaterThan(100_000);
    await expect(
      countZipEntries(report.artifacts?.docxPath ?? '', 'word/document.xml'),
    ).resolves.toBe(1);
    await expect(
      countZipEntries(report.artifacts?.pptxPath ?? '', String.raw`ppt/slides/slide\d+\.xml`),
    ).resolves.toBeGreaterThanOrEqual(11);
  });

  it('blocks final conclusion for in-progress courses', async () => {
    const agent = new LdReportingSpecialistAgent();
    const report = await agent.ld_generateReport({
      scope: { courseId: 'Leadership_06_2026' },
    });
    expect(report.evidence.status).toBe('BLOCKED');
    expect(report.evidence.canGenerateFinalConclusion).toBe(false);
    expect(report.governance.classification).toBe('Not reportable');
  });

  it('accepts natural course names as course scope in chat-style requests', async () => {
    const agent = new LdReportingSpecialistAgent();
    const readiness = await agent.ld_checkReadiness({
      scope: { courseId: 'AI Agent & LLM Application Development' },
    });
    expect(readiness.evidence.status).toBe('PASS');

    const report = await agent.ld_generateReport({
      scope: { courseId: 'AI Agent & LLM Application Development' },
    });
    expect(report.metrics.overall.totalCourses).toBe(1);
    expect(report.metrics.courses[0]?.courseId).toBe('AIAgent_05_2026');
  });

  it('masks learner-level view for BOD', async () => {
    const agent = new LdReportingSpecialistAgent();
    const report = await agent.ld_generateReport({ scope: { period: '2026-Q1' } });
    const view = agent.viewReport(report, { role: 'BOD' });
    expect(report.governance.masked).toBe(false);
    expect(view.governance.masked).toBe(true);
    expect(view.artifacts).toBeUndefined();
  });

  it('scopes trainer views to courses taught by the current trainer', async () => {
    const agent = new LdReportingSpecialistAgent();
    const report = await agent.ld_generateReport({ scope: { period: '2026-Q1' } });
    const trainerId = report.metrics.courses.find((course) => course.trainerId)?.trainerId;
    expect(trainerId).toBeTruthy();
    if (!trainerId) return;

    const view = agent.viewReport(report, { role: 'TRAINER', trainerId });

    expect(view.governance.role).toBe('TRAINER');
    expect(view.governance.masked).toBe(true);
    expect(view.scope.trainerId).toBe(trainerId);
    expect(view.metrics.courses.length).toBeGreaterThan(0);
    expect(view.metrics.courses.every((course) => course.trainerId === trainerId)).toBe(true);
  });
});

async function countZipEntries(path: string, pattern: string): Promise<number> {
  const text = await readFile(path, 'latin1');
  return new Set([...text.matchAll(new RegExp(pattern, 'g'))].map(([match]) => match)).size;
}
