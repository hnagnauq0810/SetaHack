import { Badge } from '@seta/shared-ui';
import { Brain, Clock3, Database, Layers3, MessageSquareText } from 'lucide-react';
import type * as React from 'react';
import { useAgentMemory } from '../hooks/use-agent-memory';
import { useAgentSelection, usePageContext } from './agent-provider';

export function AgentMemoryPanel() {
  const { selection } = useAgentSelection();
  const { pageContext } = usePageContext();
  const memory = useAgentMemory(selection.threadId, !selection.isThreadFresh);
  const data = memory.data;
  const activeContext = pageContext ?? data?.activeContext ?? null;
  const userContext = data?.workingMemory.userContext;
  const contextRows = userContext
    ? [
        ['Timezone', userContext.timezone],
        ['Style', userContext.communicationStyle],
        ['Focus', userContext.currentFocus],
        ['Task view', userContext.preferredTaskView],
        ['Notes', userContext.notes],
      ]
    : [];

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain className="size-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-slate-950">Memory</h2>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Conversation context, recall, and working memory for this chat.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <MemorySection icon={<Layers3 className="size-4" />} title="Active Context">
          {activeContext ? (
            <div className="space-y-2 text-sm">
              <div className="font-medium text-slate-900">{activeContext.label}</div>
              <div className="text-xs text-slate-500">{activeContext.kind}</div>
              {activeContext.summary && (
                <p className="rounded-lg bg-slate-50 p-2 text-xs leading-5 text-slate-600">
                  {activeContext.summary}
                </p>
              )}
            </div>
          ) : (
            <EmptyText>No page context attached.</EmptyText>
          )}
        </MemorySection>

        <MemorySection icon={<Clock3 className="size-4" />} title="Short-Term">
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="secondary">last {String(data?.shortTerm.lastMessages ?? 0)}</Badge>
          </div>
          {selection.isThreadFresh ? (
            <EmptyText>Starts after the first message.</EmptyText>
          ) : data?.shortTerm.recentMessages.length ? (
            <div className="space-y-2">
              {data.shortTerm.recentMessages.slice(-5).map((message) => (
                <div key={message.id} className="rounded-lg border border-slate-200 p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {message.role}
                  </div>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-700">
                    {message.text}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyText>No recent persisted turns yet.</EmptyText>
          )}
        </MemorySection>

        <MemorySection icon={<Database className="size-4" />} title="Long-Term">
          <div className="flex flex-wrap gap-2">
            <Badge variant={data?.longTerm.enabled ? 'default' : 'secondary'}>
              {data?.longTerm.enabled ? 'Semantic recall on' : 'Semantic recall off'}
            </Badge>
            {data?.longTerm.topK !== null && data?.longTerm.topK !== undefined && (
              <Badge variant="secondary">topK {data.longTerm.topK}</Badge>
            )}
            {data?.longTerm.messageRange !== null && data?.longTerm.messageRange !== undefined && (
              <Badge variant="secondary">range {data.longTerm.messageRange}</Badge>
            )}
          </div>
        </MemorySection>

        <MemorySection icon={<Brain className="size-4" />} title="Working Memory">
          {contextRows.length ? (
            <div className="space-y-2">
              {contextRows.map(([label, value]) => (
                <div key={label} className="rounded-lg bg-slate-50 p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {label}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-700">{value || 'Not set'}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyText>Working memory is empty for this user.</EmptyText>
          )}
        </MemorySection>

        <MemorySection icon={<MessageSquareText className="size-4" />} title="Conversation State">
          {data?.conversationMemory.recentTasks.length ? (
            <div className="space-y-2">
              {data.conversationMemory.recentTasks.slice(0, 5).map((task) => (
                <div key={task.taskId} className="rounded-lg border border-slate-200 p-2">
                  <div className="truncate text-xs font-medium text-slate-800">{task.title}</div>
                  <div className="mt-1 truncate text-[11px] text-slate-500">{task.taskId}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyText>No thread entities recorded.</EmptyText>
          )}
        </MemorySection>
      </div>
    </aside>
  );
}

function MemorySection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="text-slate-500">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-5 text-slate-500">{children}</p>;
}
