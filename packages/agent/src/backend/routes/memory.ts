import {
  EMPTY_ENTITIES,
  EMPTY_WORKING_MEMORY,
  parseEntities,
  parseWorkingMemory,
} from '@seta/agent-sdk';
import type { Hono } from 'hono';
import {
  type AgentRouteDeps,
  type AgentRouteEnv,
  checkPerm,
  getMemoryStore,
  toUIMessage,
  type UIMessageLike,
} from './_shared.ts';

type PageContextView = {
  kind: string;
  id: string;
  label: string;
  summary?: string;
};

type MemoryConfigView = {
  lastMessages: number | boolean | null;
  semanticRecall: {
    enabled: boolean;
    topK: number | null;
    messageRange: number | null;
    scope: string | null;
  };
  workingMemory: {
    enabled: boolean;
    scope: string | null;
  };
};

export function mountMemoryRoutes(app: Hono<AgentRouteEnv>, deps: AgentRouteDeps): void {
  app.get('/api/agent/v1/memory', async (c) => {
    const check = checkPerm(
      c.get('session') as import('../types.ts').SessionLike | undefined,
      'agent.thread.read.self',
    );
    if (!check.ok) return c.json(check.denied.body, check.denied.status);

    const threadId = c.req.query('threadId')?.trim();
    const storage = getMemoryStore(deps.mastra);
    const resourceId = `${check.session.tenant_id}:${check.session.user_id}`;
    const thread =
      storage && threadId ? await storage.getThreadById({ threadId, resourceId }) : null;
    if (threadId && !thread) {
      return c.json({ error: 'not_found', message: 'thread not found' }, 404);
    }

    const messagesResult =
      storage && thread
        ? await storage.listMessages({ threadId: thread.id, page: 0, perPage: 20 })
        : { messages: [] };
    const messages = messagesResult.messages
      .map((m, i) => toUIMessage(m, i))
      .filter((m): m is UIMessageLike => m !== null);

    const rawWorkingMemory =
      deps.userMemory && deps.userMemoryConfig && threadId
        ? await deps.userMemory
            .getWorkingMemory({
              threadId,
              resourceId: check.session.user_id,
              memoryConfig: deps.userMemoryConfig,
            })
            .catch(() => null)
        : null;

    const threadMetadata = (thread?.metadata ?? {}) as { workingMemory?: unknown };
    const rawEntities =
      typeof threadMetadata.workingMemory === 'string' ? threadMetadata.workingMemory : null;

    return c.json({
      thread: thread
        ? {
            id: thread.id,
            title: thread.title ?? null,
            updatedAt: thread.updatedAt ?? null,
          }
        : null,
      activeContext: latestPageContext(messages),
      shortTerm: {
        lastMessages: memoryConfigView(deps).lastMessages,
        recentMessages: recentMessages(messages),
      },
      longTerm: memoryConfigView(deps).semanticRecall,
      workingMemory: parseWorkingMemory(rawWorkingMemory),
      conversationMemory: parseEntities(rawEntities),
      capabilities: memoryConfigView(deps),
    });
  });
}

function memoryConfigView(deps: AgentRouteDeps): MemoryConfigView {
  const cfg = deps.userMemoryConfig as
    | {
        lastMessages?: number | boolean;
        semanticRecall?: false | { topK?: number; messageRange?: number; scope?: string };
        workingMemory?: false | { enabled?: boolean; scope?: string };
      }
    | undefined;
  const semanticRecall =
    cfg?.semanticRecall && typeof cfg.semanticRecall === 'object' ? cfg.semanticRecall : null;
  const workingMemory =
    cfg?.workingMemory && typeof cfg.workingMemory === 'object' ? cfg.workingMemory : null;

  return {
    lastMessages: cfg?.lastMessages ?? null,
    semanticRecall: {
      enabled: Boolean(semanticRecall),
      topK: semanticRecall?.topK ?? null,
      messageRange: semanticRecall?.messageRange ?? null,
      scope: semanticRecall?.scope ?? null,
    },
    workingMemory: {
      enabled: workingMemory?.enabled === true,
      scope: workingMemory?.scope ?? null,
    },
  };
}

function latestPageContext(messages: UIMessageLike[]): PageContextView | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    for (let j = message.parts.length - 1; j >= 0; j--) {
      const part = message.parts[j];
      if (part?.type !== 'data-page-context') continue;
      return part.data;
    }
  }
  return null;
}

function recentMessages(messages: UIMessageLike[]) {
  return messages
    .slice(-8)
    .map((message) => ({
      id: message.id,
      role: message.role,
      text: message.parts
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240),
    }))
    .filter((message) => message.text.length > 0);
}

export const EMPTY_AGENT_MEMORY_RESPONSE = {
  thread: null,
  activeContext: null,
  shortTerm: { lastMessages: null, recentMessages: [] },
  longTerm: { enabled: false, topK: null, messageRange: null, scope: null },
  workingMemory: EMPTY_WORKING_MEMORY,
  conversationMemory: EMPTY_ENTITIES,
  capabilities: {
    lastMessages: null,
    semanticRecall: { enabled: false, topK: null, messageRange: null, scope: null },
    workingMemory: { enabled: false, scope: null },
  },
};
