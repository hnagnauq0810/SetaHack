import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LdReportingSpecialistAgent } from '../src/backend/domain/orchestrator.ts';
import { LdReportingStore } from '../src/backend/domain/storage.ts';

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
    expect(docxStats.size).toBeGreaterThan(50_000);
    expect(pptxStats.size).toBeGreaterThan(100_000);
    await expect(
      countZipEntries(report.artifacts?.docxPath ?? '', 'word/document.xml'),
    ).resolves.toBe(1);
    await expect(
      countZipEntries(report.artifacts?.pptxPath ?? '', String.raw`ppt/slides/slide\d+\.xml`),
    ).resolves.toBeGreaterThanOrEqual(13);
    await expect(
      countZipEntries(report.artifacts?.docxPath ?? '', String.raw`word/media/.*\.svg`),
    ).resolves.toBe(0);
    await expect(
      countZipEntries(report.artifacts?.docxPath ?? '', String.raw`word/media/.*\.png`),
    ).resolves.toBeGreaterThanOrEqual(3);
    await expect(zipContains(report.artifacts?.pptxPath ?? '', 'Visual analytics')).resolves.toBe(
      true,
    );
    await expect(
      zipContains(report.artifacts?.pptxPath ?? '', 'Distribution and risk signals'),
    ).resolves.toBe(true);
    await expect(
      countZipEntries(report.artifacts?.pptxPath ?? '', String.raw`ppt/media/.*\.svg`),
    ).resolves.toBe(0);
    await expect(
      countZipEntries(report.artifacts?.pptxPath ?? '', String.raw`ppt/charts/chart\d+\.xml`),
    ).resolves.toBeGreaterThanOrEqual(1);
  });

  it('blocks final conclusion for in-progress courses', async () => {
    const agent = await isolatedAgent();
    const report = await agent.ld_generateReport({
      scope: { courseId: 'Leadership_06_2026' },
    });
    expect(report.evidence.status).toBe('BLOCKED');
    expect(report.evidence.canGenerateFinalConclusion).toBe(false);
    expect(report.governance.classification).toBe('Not reportable');

    await expect(
      agent.ld_finalizeReport({
        reportId: report.reportId,
        body: { decision: 'approve' },
        actorUserId: 'ldm001',
      }),
    ).rejects.toMatchObject({ code: 'FINALIZE_BLOCKED_BY_EVIDENCE' });

    const unchanged = await agent.getReport(report.reportId);
    expect(unchanged).toMatchObject({ status: 'DRAFT' });
    expect(unchanged).not.toHaveProperty('finalizedAt');
    expect(unchanged).not.toHaveProperty('approval');
  });

  it('blocks finalization when report quality is not PASS', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ld-reporting-test-'));
    const store = new LdReportingStore(root);
    const agent = new LdReportingSpecialistAgent({ store });
    const report = await agent.ld_generateReport({ scope: { period: '2026-Q1' } });
    expect(report.evidence.canGenerateFinalConclusion).toBe(true);

    report.quality = {
      qualityId: 'quality-failed-for-test',
      status: 'REVISION_REQUIRED',
      generatedAt: new Date().toISOString(),
      issues: ['Executive summary must be revised.'],
    };
    await store.saveReport(report);

    await expect(
      agent.ld_finalizeReport({
        reportId: report.reportId,
        body: { decision: 'approve' },
        actorUserId: 'ldm001',
      }),
    ).rejects.toMatchObject({ code: 'FINALIZE_BLOCKED_BY_QUALITY' });

    await expect(agent.getReport(report.reportId)).resolves.toMatchObject({ status: 'DRAFT' });
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
    await expect(
      zipContains(report.artifacts?.pptxPath ?? '', 'Course performance profile'),
    ).resolves.toBe(true);
  });

  it('masks learner-level view for BOD', async () => {
    const agent = new LdReportingSpecialistAgent();
    const report = await agent.ld_generateReport({ scope: { period: '2026-Q1' } });
    const view = agent.viewReport(report, { role: 'BOD' });
    expect(report.governance.masked).toBe(false);
    expect(view.governance.masked).toBe(true);
    expect(view.artifacts).toBeUndefined();
  });

  it('turns a score comparison into a business interpretation and recommendation', async () => {
    const agent = await isolatedAgent();
    const report = await agent.ld_generateReport({ scope: { period: '2026-Q1' } });

    const answer = await agent.ld_answerQuestion({
      reportId: report.reportId,
      role: 'LND_MANAGER',
      question:
        'So sánh điểm trung bình của AWS Cloud Architecture & Services với báo cáo hiện tại',
    });

    expect(answer.answer).toContain('Ý nghĩa:');
    expect(answer.answer).toContain('Khuyến nghị:');
    expect(answer.answer).toContain('AWS Cloud Architecture & Services');
    expect(answer.answer).toMatch(/\d+(?:[.,]\d+)?%/);
    expect(answer.citations).toContain('metrics.overall.averageScore');
    expect(answer.citations).toContain('metrics.courses.averageScore');
  });

  it('keeps BOD on finalized reports while L&D Manager can review drafts', async () => {
    const agent = await isolatedAgent();
    const draft = await agent.ld_generateReport({ scope: { period: '2026-Q1' } });

    expect(draft.status).toBe('DRAFT');
    await expect(agent.listReports({ role: 'LND_MANAGER' })).resolves.toHaveLength(1);
    await expect(agent.listReports({ role: 'BOD' })).resolves.toHaveLength(0);
    await expect(
      agent.writeArtifactForRole(draft.reportId, 'docx', { role: 'BOD' }),
    ).resolves.toBeNull();

    const edited = await agent.updateDraftReport({
      reportId: draft.reportId,
      patch: {
        executiveSummary: 'Manual executive summary approved by the L&D manager.',
        insights: ['Manual insight 1', 'Manual insight 2'],
        recommendations: ['Manual recommendation 1'],
      },
      actorUserId: 'ldm001',
    });
    expect(edited.executiveSummary).toBe('Manual executive summary approved by the L&D manager.');
    expect(edited.insights).toEqual(['Manual insight 1', 'Manual insight 2']);
    expect(edited.lastEditedAt).toBeTruthy();

    const blocked = await agent.ld_answerQuestion({
      reportId: draft.reportId,
      role: 'BOD',
      question: 'What is the completion rate?',
    });
    expect(blocked.answer).toContain('chua duoc finalized');

    const final = await agent.ld_finalizeReport({
      reportId: draft.reportId,
      body: { decision: 'approve', note: 'Approved for BOD review' },
      actorUserId: 'ldm001',
    });
    expect(final.status).toBe('FINAL');
    expect(final.executiveSummary).toBe('Manual executive summary approved by the L&D manager.');

    const bodReports = await agent.listReports({ role: 'BOD' });
    expect(bodReports).toHaveLength(1);
    expect(bodReports[0]?.status).toBe('FINAL');
    expect(bodReports[0]?.executiveSummary).toBe(
      'Manual executive summary approved by the L&D manager.',
    );
    expect(bodReports[0]?.governance.masked).toBe(true);

    const bodArtifact = await agent.writeArtifactForRole(final.reportId, 'docx', { role: 'BOD' });
    expect(bodArtifact).not.toBeNull();
    const bodArtifactStats = await stat(bodArtifact?.path ?? '');
    expect(bodArtifactStats.isFile()).toBe(true);

    const answer = await agent.ld_answerQuestion({
      role: 'BOD',
      question: 'Give me an overall view from previous finalized reports',
    });
    expect(answer.citations).toContain(final.reportId);
    expect(answer.answer).toContain('finalized L&D report');

    await expect(
      agent.updateDraftReport({
        reportId: final.reportId,
        patch: { executiveSummary: 'Should be rejected.' },
      }),
    ).rejects.toThrow('Finalized reports cannot be edited.');
  });

  it('supports unsaved preview drafts and saving drafts', async () => {
    const agent = await isolatedAgent();
    const draft = await agent.ld_generateReport({
      scope: { period: '2026-Q1' },
      saveToWorkspace: false,
    });
    expect(draft.saved).toBe(false);

    const listBefore = await agent.listReports({ role: 'LND_MANAGER' });
    expect(listBefore.map((r) => r.reportId)).not.toContain(draft.reportId);

    const saved = await agent.ld_saveReport(draft.reportId);
    expect(saved.saved).toBe(true);

    const listAfter = await agent.listReports({ role: 'LND_MANAGER' });
    expect(listAfter.map((r) => r.reportId)).toContain(draft.reportId);
  });
});

async function isolatedAgent(): Promise<LdReportingSpecialistAgent> {
  const root = await mkdtemp(join(tmpdir(), 'ld-reporting-test-'));
  return new LdReportingSpecialistAgent({ store: new LdReportingStore(root) });
}

async function countZipEntries(path: string, pattern: string): Promise<number> {
  const text = await readFile(path, 'latin1');
  return new Set([...text.matchAll(new RegExp(pattern, 'g'))].map(([match]) => match)).size;
}

async function zipContains(path: string, value: string): Promise<boolean> {
  const text = await readFile(path, 'latin1');
  return text.includes(value);
}
