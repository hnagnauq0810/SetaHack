import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateEvidence } from '../src/backend/domain/evidence-gate.ts';
import { loadAndNormalizeDataset } from '../src/backend/domain/excel-loader.ts';
import { applyGovernanceAndRbac } from '../src/backend/domain/governance-service.ts';
import { answerQuestionWithLlm } from '../src/backend/domain/llm-service.ts';
import { calculateMetrics } from '../src/backend/domain/metrics-service.ts';
import { buildReportJson } from '../src/backend/domain/report-builder.ts';

describe('L&D Q&A LLM response handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a structured answer object instead of falling back', async () => {
    const dataset = await loadAndNormalizeDataset({ scope: { courseId: 'AIAgent_05_2026' } });
    const evidence = evaluateEvidence(dataset);
    const metrics = calculateMetrics(dataset);
    const governance = applyGovernanceAndRbac(dataset, metrics, evidence, 'LND_MANAGER');
    const report = buildReportJson({ dataset, evidence, metrics, governance });

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      answer: {
                        'NORM-07': {
                          priority: 'High',
                          category: 'Individual',
                          message: 'Trainee needs 1:1 support.',
                          action: 'Flag for coaching; assign buddy or practice resources',
                        },
                        coachingRecommendation:
                          'Assign a coaching owner, buddy support, and targeted practice resources.',
                      },
                      confidence: 0.95,
                      citations: ['governance.normFlags', 'recommendations'],
                      limitations: [],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const answer = await answerQuestionWithLlm({
      report,
      question: 'Thông tin chi tiết về NORM-07 và ai cần coaching 1:1',
      role: 'LND_MANAGER',
      deterministicAnswer: {
        answer: 'Deterministic fallback',
        confidence: 0.92,
        citations: ['governance.normFlags'],
        limitations: [],
      },
      env: {
        NODE_ENV: 'test',
        LD_REPORTING_USE_LLM: 'true',
        OPENAI_API_KEY: 'test-key',
      },
    });

    expect(answer.answer).toContain('NORM-07');
    expect(answer.answer).toContain('Trainee needs 1:1 support.');
    expect(answer.answer).toContain('Assign a coaching owner');
    expect(answer.answer).not.toBe('Deterministic fallback');
    expect(answer.limitations).not.toContain(
      'LLM Q&A fallback was used because the model call failed.',
    );
  });

  it('includes coaching identities only in manager Q&A context', async () => {
    const dataset = await loadAndNormalizeDataset({ scope: { courseId: 'AIAgent_05_2026' } });
    const evidence = evaluateEvidence(dataset);
    const metrics = calculateMetrics(dataset);
    const governance = applyGovernanceAndRbac(dataset, metrics, evidence, 'LND_MANAGER');
    const report = buildReportJson({ dataset, evidence, metrics, governance });
    const requestBodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answer: 'Grounded answer',
                    confidence: 0.9,
                    citations: ['governance.normFlags'],
                    limitations: [],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const deterministicAnswer = {
      answer: 'Fallback',
      confidence: 0.9,
      citations: ['governance.normFlags'],
      limitations: [],
    };
    const env = {
      NODE_ENV: 'test',
      LD_REPORTING_USE_LLM: 'true',
      OPENAI_API_KEY: 'test-key',
    };
    await answerQuestionWithLlm({
      report,
      question: 'Who needs coaching for NORM-07?',
      role: 'LND_MANAGER',
      deterministicAnswer,
      env,
    });
    await answerQuestionWithLlm({
      report,
      question: 'Who needs coaching for NORM-07?',
      role: 'BOD',
      deterministicAnswer,
      env,
    });

    const managerRequest = requestBodies[0];
    const bodRequest = requestBodies[1];
    if (!managerRequest || !bodRequest) throw new Error('Expected manager and BOD model requests');
    const managerContext = qnaContext(managerRequest);
    const bodContext = qnaContext(bodRequest);
    expect(managerContext.governance.normFlags[0]?.employeeId).toBe('EMP-076');
    expect(managerContext.governance.supportNeededTrainees[0]?.employeeId).toBe('EMP-076');
    expect(bodContext.governance.normFlags[0]?.employeeId).toBeUndefined();
    expect(bodContext.governance.supportNeededTrainees).toEqual([
      { count: 1, note: 'Masked by RBAC.' },
    ]);
  });
});

function qnaContext(body: { messages: Array<{ role: string; content: string }> }): {
  governance: {
    normFlags: Array<{ employeeId?: string }>;
    supportNeededTrainees: Array<{ employeeId?: string; count?: number; note?: string }>;
  };
} {
  const userMessage = body.messages.find((message) => message.role === 'user');
  if (!userMessage) throw new Error('Expected a user message');
  return JSON.parse(userMessage.content).validatedArtifact;
}
