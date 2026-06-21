import { z } from 'zod';
import { defineAgentTool } from './define-agent-tool.ts';
import type { SpecializedAgentRunCtx } from './specialized-agent.ts';
import { wrapUpdateWorkingMemoryTool } from './working-memory-guard.ts';

export async function loadUserContextSection(ctx: SpecializedAgentRunCtx): Promise<string | null> {
  if (!ctx.userMemory || !ctx.threadId) return null;
  try {
    return await ctx.userMemory.memory.getSystemMessage({
      threadId: ctx.threadId,
      resourceId: ctx.actorUserId,
      memoryConfig: ctx.userMemory.memoryConfig,
    });
  } catch {
    return null;
  }
}

export function makeUpdateWorkingMemoryTool(ctx: SpecializedAgentRunCtx) {
  const handle = ctx.userMemory;
  const threadId = ctx.threadId;
  if (!handle || !threadId) return null;
  const inner = {
    execute: async ({ memory }: { memory: string }) => {
      await handle.memory.updateWorkingMemory({
        threadId,
        resourceId: ctx.actorUserId,
        workingMemory: memory,
        memoryConfig: handle.memoryConfig,
      });
      return { success: true };
    },
  };
  const guarded = wrapUpdateWorkingMemoryTool(inner as never);
  return defineAgentTool({
    id: 'updateWorkingMemory',
    name: 'Update working memory',
    description:
      'Persist durable user-context facts to working memory.\n\n' +
      'Use for: storing timezone, communication style, current focus, preferred task view, notes.\n' +
      'Pass the FULL working-memory JSON object as a string. Partial updates are not supported.',
    input: z.object({ memory: z.string() }),
    output: z.object({ success: z.boolean(), reason: z.string().optional() }),
    execute: async (input) =>
      (await guarded.execute(input, undefined)) as { success: boolean; reason?: string },
  });
}
