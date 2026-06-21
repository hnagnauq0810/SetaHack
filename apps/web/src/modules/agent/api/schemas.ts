import { z } from 'zod';

export const ThreadSummary = z.object({
  id: z.string(),
  title: z.string().nullable(),
  updatedAt: z.string(),
});
export type ThreadSummary = z.infer<typeof ThreadSummary>;

export const ThreadsResponse = z.object({ threads: z.array(ThreadSummary) });

export const AgentMemoryResponse = z.object({
  thread: z
    .object({
      id: z.string(),
      title: z.string().nullable(),
      updatedAt: z.string().nullable(),
    })
    .nullable(),
  activeContext: z
    .object({
      kind: z.string(),
      id: z.string(),
      label: z.string(),
      summary: z.string().optional(),
    })
    .nullable(),
  shortTerm: z.object({
    lastMessages: z.union([z.number(), z.boolean()]).nullable(),
    recentMessages: z.array(
      z.object({
        id: z.string(),
        role: z.enum(['user', 'assistant']),
        text: z.string(),
      }),
    ),
  }),
  longTerm: z.object({
    enabled: z.boolean(),
    topK: z.number().nullable(),
    messageRange: z.number().nullable(),
    scope: z.string().nullable(),
  }),
  workingMemory: z.object({
    userContext: z.object({
      timezone: z.string().nullable(),
      communicationStyle: z.string().nullable(),
      currentFocus: z.string().nullable(),
      preferredTaskView: z.string().nullable(),
      notes: z.string().nullable(),
    }),
  }),
  conversationMemory: z.object({
    recentTasks: z.array(
      z.object({
        taskId: z.string(),
        title: z.string(),
        lastSeenAt: z.string(),
      }),
    ),
    lastDiscussedTaskId: z.string().nullable(),
    lastProposedCandidateUserId: z.string().nullable(),
    pendingDecision: z
      .object({
        taskId: z.string(),
        userId: z.string(),
      })
      .nullable(),
    rejectedCandidates: z.array(
      z.object({
        taskId: z.string(),
        userId: z.string(),
      }),
    ),
  }),
  capabilities: z.object({
    lastMessages: z.union([z.number(), z.boolean()]).nullable(),
    semanticRecall: z.object({
      enabled: z.boolean(),
      topK: z.number().nullable(),
      messageRange: z.number().nullable(),
      scope: z.string().nullable(),
    }),
    workingMemory: z.object({
      enabled: z.boolean(),
      scope: z.string().nullable(),
    }),
  }),
});
export type AgentMemoryResponse = z.infer<typeof AgentMemoryResponse>;
