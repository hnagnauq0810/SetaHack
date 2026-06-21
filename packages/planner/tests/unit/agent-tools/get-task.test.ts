import { describe, expect, it } from 'vitest';
import { plannerGetTaskTool } from '../../../src/backend/agent-tools/get-task.ts';

const UUID = '66be2be2-394d-4184-b106-c412289fd1e1';

// AgentTool is a union — cast to access the Mastra Tool's inputSchema property.
const tool = plannerGetTaskTool as unknown as {
  inputSchema?: { safeParse: (v: unknown) => { success: boolean } };
};

describe('plannerGetTaskTool input schema', () => {
  it('accepts a UUID as taskRef', () => {
    const result = tool.inputSchema?.safeParse({ taskRef: UUID });
    expect(result?.success).toBe(true);
  });
  it('accepts ordinal references as taskRef', () => {
    for (const ref of ['#1', 'first', 'last']) {
      const result = tool.inputSchema?.safeParse({ taskRef: ref });
      expect(result?.success).toBe(true);
    }
  });
  it('rejects empty / whitespace-only taskRef', () => {
    const result = tool.inputSchema?.safeParse({ taskRef: '   ' });
    expect(result?.success).toBe(false);
  });
});
