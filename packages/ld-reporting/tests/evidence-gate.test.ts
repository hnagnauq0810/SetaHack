import { describe, expect, it } from 'vitest';
import type { NormalizedDataset } from '../src/models.ts';
import { evaluateEvidence } from '../src/backend/domain/evidence-gate.ts';
import { loadAndNormalizeDataset } from '../src/backend/domain/excel-loader.ts';

describe('ld-reporting evidence gate', () => {
  it('passes completed Q1 data from the default workbook', async () => {
    const dataset = await q1Dataset();
    const evidence = evaluateEvidence(dataset);

    expect(evidence.status).toBe('PASS');
    expect(evidence.canGenerateFinalConclusion).toBe(true);
    expect(evidence.missingEvidence).toEqual([]);
  });

  it('blocks when a required source sheet is missing', async () => {
    const dataset = await q1Dataset();
    dataset.sources = dataset.sources.map((source) =>
      source.sheetName === 'DS07_Attendance_Log' ? { ...source, present: false } : source,
    );

    const evidence = evaluateEvidence(dataset);

    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.canGenerateFinalConclusion).toBe(false);
    expect(evidence.missingEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'MISSING_SOURCE', severity: 'blocker' })]),
    );
  });

  it('blocks when a required column is missing', async () => {
    const dataset = await q1Dataset();
    dataset.sources = dataset.sources.map((source) =>
      source.sheetName === 'DS08_Assessment_Score'
        ? { ...source, missingColumns: ['Pass_Status'] }
        : source,
    );

    const evidence = evaluateEvidence(dataset);

    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.missingEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'MISSING_COLUMN', severity: 'blocker' })]),
    );
  });

  it('blocks final conclusion for an in-progress course', async () => {
    const dataset = await loadAndNormalizeDataset({ scope: { courseId: 'Leadership_06_2026' } });

    const evidence = evaluateEvidence(dataset);

    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.canGenerateFinalConclusion).toBe(false);
    expect(evidence.missingEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'IN_PROGRESS_COURSE', severity: 'blocker' })]),
    );
  });

  it('blocks conflicting scope filters that match no courses', async () => {
    const dataset = await loadAndNormalizeDataset({
      scope: { period: '2026-Q1', courseId: 'Leadership_06_2026' },
    });

    const evidence = evaluateEvidence(dataset);

    expect(dataset.courses).toHaveLength(0);
    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.canGenerateFinalConclusion).toBe(false);
    expect(evidence.missingEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'NO_COURSES_IN_SCOPE', severity: 'blocker' })]),
    );
  });

  it('blocks completed courses with missing attendance rows', async () => {
    const dataset = await q1Dataset();
    const courseId = firstCourseId(dataset);
    dataset.attendance = dataset.attendance.filter((row, index) => row.courseId !== courseId || index !== 0);

    const evidence = evaluateEvidence(dataset);

    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.missingEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'MISSING_ATTENDANCE', severity: 'blocker', courseId })]),
    );
  });

  it('blocks completed courses with missing assessment rows', async () => {
    const dataset = await q1Dataset();
    const courseId = firstCourseId(dataset);
    const removedEmployee = dataset.assessments.find((row) => row.courseId === courseId)?.employeeId;
    dataset.assessments = dataset.assessments.filter(
      (row) => !(row.courseId === courseId && row.employeeId === removedEmployee),
    );

    const evidence = evaluateEvidence(dataset);

    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.missingEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'MISSING_ASSESSMENT', severity: 'blocker', courseId })]),
    );
  });

  it('warns but still allows final conclusion when feedback response is below threshold', async () => {
    const dataset = await q1Dataset();
    const courseId = firstCourseId(dataset);
    dataset.feedback = dataset.feedback.filter((row, index) => row.courseId !== courseId || index === 0);

    const evidence = evaluateEvidence(dataset);

    expect(evidence.status).toBe('PARTIAL_PASS');
    expect(evidence.canGenerateFinalConclusion).toBe(true);
    expect(evidence.missingEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'INSUFFICIENT_FEEDBACK', severity: 'warning', courseId })]),
    );
  });

  it('blocks pass status values that conflict with score threshold', async () => {
    const dataset = await q1Dataset();
    const assessment = dataset.assessments.find((row) => row.score !== null && row.passStatus !== null);
    expect(assessment).toBeDefined();
    if (!assessment) return;
    assessment.passStatus = !assessment.passStatus;

    const evidence = evaluateEvidence(dataset);

    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.missingEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'SCORE_INCONSISTENCY',
          severity: 'blocker',
          courseId: assessment.courseId,
          employeeId: assessment.employeeId,
        }),
      ]),
    );
  });

  it('blocks cross-source rows that reference an unknown course id', async () => {
    const dataset = await q1Dataset();
    const source = dataset.attendance[0];
    expect(source).toBeDefined();
    if (!source) return;
    dataset.attendance.push({ ...source, courseId: 'UNKNOWN_COURSE' });

    const evidence = evaluateEvidence(dataset);

    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.missingEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'CONSISTENCY_ERROR', severity: 'blocker', courseId: 'UNKNOWN_COURSE' }),
      ]),
    );
  });

  it('blocks duplicate attendance rows', async () => {
    const dataset = await q1Dataset();
    const source = dataset.attendance[0];
    expect(source).toBeDefined();
    if (!source) return;
    dataset.attendance.push({ ...source });

    const evidence = evaluateEvidence(dataset);

    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.missingEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'DUPLICATE_ATTENDANCE', severity: 'blocker' })]),
    );
  });

  it('blocks duplicate assessment rows', async () => {
    const dataset = await q1Dataset();
    const source = dataset.assessments[0];
    expect(source).toBeDefined();
    if (!source) return;
    dataset.assessments.push({ ...source });

    const evidence = evaluateEvidence(dataset);

    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.missingEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'DUPLICATE_ASSESSMENT', severity: 'blocker' })]),
    );
  });

  it('blocks null assessment values in completed courses', async () => {
    const dataset = await q1Dataset();
    const assessment = dataset.assessments[0];
    expect(assessment).toBeDefined();
    if (!assessment) return;
    assessment.score = null;
    assessment.passStatus = null;

    const evidence = evaluateEvidence(dataset);

    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.missingEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'MISSING_SCORE', severity: 'blocker' })]),
    );
  });

  it('blocks score values outside the 0-10 range', async () => {
    const dataset = await q1Dataset();
    const assessment = dataset.assessments[0];
    expect(assessment).toBeDefined();
    if (!assessment) return;
    assessment.score = 11;
    assessment.passStatus = true;

    const evidence = evaluateEvidence(dataset);

    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.missingEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'INVALID_SCORE_RANGE', severity: 'blocker' })]),
    );
  });

  it('warns for feedback ratings outside the 1-5 range', async () => {
    const dataset = await q1Dataset();
    const feedback = dataset.feedback[0];
    expect(feedback).toBeDefined();
    if (!feedback) return;
    feedback.trainerRating = 6;

    const evidence = evaluateEvidence(dataset);

    expect(evidence.status).toBe('PARTIAL_PASS');
    expect(evidence.canGenerateFinalConclusion).toBe(true);
    expect(evidence.missingEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'INVALID_RATING_RANGE', severity: 'warning' })]),
    );
  });

  it('blocks negative cost values', async () => {
    const dataset = await q1Dataset();
    const cost = dataset.costs[0];
    expect(cost).toBeDefined();
    if (!cost) return;
    cost.totalCostScaled = -1;

    const evidence = evaluateEvidence(dataset);

    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.missingEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'INVALID_COST_VALUE', severity: 'blocker' })]),
    );
  });
});

async function q1Dataset(): Promise<NormalizedDataset> {
  return structuredClone(await loadAndNormalizeDataset({ scope: { period: '2026-Q1' } }));
}

function firstCourseId(dataset: NormalizedDataset): string {
  const courseId = dataset.courses[0]?.courseId;
  if (!courseId) throw new Error('Expected at least one course in test dataset.');
  return courseId;
}
