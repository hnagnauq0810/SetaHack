import type { ApprovalCard } from '@seta/agent-sdk';
import type { ChatStreamRun } from '@seta/shared-orchestration';

export interface UiStreamWriter {
  write(chunk: unknown): void;
}

/** A persisted assistant-message part. The streamed `text` prose is the answer;
 *  `data-result` carries the structured payload for cards; `data-trust` carries
 *  confidence + citations. */
export type OrchestrationAssistantPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool-invocation';
      toolInvocation: {
        toolCallId: string;
        toolName: string;
        state?: unknown;
        args?: unknown;
        result?: unknown;
        errorText?: string;
      };
    }
  | { type: 'data-result'; id: 'result'; data: unknown }
  | { type: 'data-trust'; id: 'trust'; data: unknown }
  | {
      type: 'data-thinking-timing';
      id: 'thinking-timing';
      data: { durationMs: number };
    };

/** The suspend signal as it survives `@mastra/ai-sdk` conversion: a data part
 *  carrying the run id, tool-call id, and the tool's suspend payload (our card). */
interface SuspendData {
  runId: string;
  toolCallId: string;
  suspendPayload: { card: ApprovalCard };
}

export interface ApprovalEvent {
  card: ApprovalCard;
  mastraRunId: string;
  toolCallId: string;
}

/**
 * Pump an AI SDK v6 UIMessage part stream into the writer, accumulating the
 * answer prose for persistence and detecting native HITL suspend.
 *
 * - Every part is written through (live streaming to the client).
 * - `text-delta` parts accumulate into the persisted answer text.
 * - A `data-tool-call-suspended` part means the run paused for approval: the
 *   `onApproval` hook fires (writes the read-model row) and `finalize` is NOT
 *   called (a suspended turn has no assembled result).
 * - On normal completion, `finalize()` produces the structured result + trust,
 *   written as reconciled `data-result` / `data-trust` cards.
 */
export async function pumpOrchestrationStream(
  writer: UiStreamWriter,
  parts: AsyncIterable<StreamPart>,
  opts: {
    finalize: ChatStreamRun['finalize'];
    onApproval: (e: ApprovalEvent) => Promise<void>;
    timing?: { startedAtMs: number; now?: () => number };
  },
): Promise<{ assistantParts: OrchestrationAssistantPart[] }> {
  const assistantParts: OrchestrationAssistantPart[] = [];
  const timelineParts: OrchestrationAssistantPart[] = [];
  const reasoningById = new Map<
    string,
    { part: Extract<OrchestrationAssistantPart, { type: 'reasoning' }> }
  >();
  const toolById = new Map<
    string,
    Extract<OrchestrationAssistantPart, { type: 'tool-invocation' }>
  >();
  let answer = '';
  let suspend: ApprovalEvent | undefined;

  for await (const part of parts) {
    if (part.type === 'data-tool-call-suspended') {
      const d = part.data as SuspendData;
      suspend = { card: d.suspendPayload.card, mastraRunId: d.runId, toolCallId: d.toolCallId };
      continue;
    }
    writer.write(part);
    captureReasoningPart(part, reasoningById, timelineParts);
    captureToolPart(part, toolById, timelineParts);
    if (part.type === 'text-delta')
      answer += stringField(part, 'delta') ?? stringField(part, 'text') ?? '';
  }

  let timingPart: Extract<OrchestrationAssistantPart, { type: 'data-thinking-timing' }> | undefined;

  if (opts.timing) {
    const durationMs = Math.max(
      0,
      Math.round((opts.timing.now ?? Date.now)() - opts.timing.startedAtMs),
    );
    timingPart = {
      type: 'data-thinking-timing' as const,
      id: 'thinking-timing' as const,
      data: { durationMs },
    };
    writer.write(timingPart);
  }

  if (suspend) {
    assistantParts.push(...timelineParts);
    if (answer) assistantParts.push({ type: 'text', text: answer });
    if (timingPart) assistantParts.push(timingPart);
    await opts.onApproval(suspend);
    return { assistantParts };
  }

  const { result, trust } = await opts.finalize();
  markInputOnlyToolsComplete(timelineParts);
  backfillToolPartsFromTrust(trust, toolById, timelineParts);
  assistantParts.push(...timelineParts);
  if (answer) assistantParts.push({ type: 'text', text: answer });
  if (timingPart) assistantParts.push(timingPart);
  writer.write({ type: 'data-result', id: 'result', data: result });
  writer.write({ type: 'data-trust', id: 'trust', data: trust });
  assistantParts.push({ type: 'data-result', id: 'result', data: result });
  assistantParts.push({ type: 'data-trust', id: 'trust', data: trust });
  return { assistantParts };
}

type StreamPart = { type: string; [key: string]: unknown };

type ReasoningPart = Extract<OrchestrationAssistantPart, { type: 'reasoning' }>;
type ToolInvocationPart = Extract<OrchestrationAssistantPart, { type: 'tool-invocation' }>;

function captureReasoningPart(
  part: StreamPart,
  reasoningById: Map<string, { part: ReasoningPart }>,
  timelineParts: OrchestrationAssistantPart[],
): void {
  if (!part.type.includes('reasoning')) return;
  const id = stringField(part, 'id') ?? 'reasoning';
  const text = stringField(part, 'delta') ?? stringField(part, 'text');
  if (!text) return;
  let entry = reasoningById.get(id);
  if (!entry) {
    entry = { part: { type: 'reasoning', text: '' } };
    reasoningById.set(id, entry);
    timelineParts.push(entry.part);
  }
  entry.part.text += text;
}

function captureToolPart(
  part: StreamPart,
  toolById: Map<string, ToolInvocationPart>,
  timelineParts: OrchestrationAssistantPart[],
): void {
  if (!part.type.startsWith('tool-')) return;
  const data = recordField(part, 'data');
  const toolCallId =
    stringField(part, 'toolCallId') ?? stringField(data, 'toolCallId') ?? stringField(part, 'id');
  if (!toolCallId) return;

  let persisted = toolById.get(toolCallId);
  if (!persisted) {
    const toolName =
      stringField(part, 'toolName') ?? stringField(data, 'toolName') ?? toolNameFromPartType(part);
    if (!toolName) return;
    persisted = {
      type: 'tool-invocation',
      toolInvocation: { toolCallId, toolName, state: 'input-available' },
    };
    toolById.set(toolCallId, persisted);
    timelineParts.push(persisted);
  }

  const input =
    unknownField(part, 'input') ??
    unknownField(part, 'args') ??
    unknownField(data, 'input') ??
    unknownField(data, 'args');
  if (input !== undefined) persisted.toolInvocation.args = input;

  const output =
    unknownField(part, 'output') ??
    unknownField(part, 'result') ??
    unknownField(data, 'output') ??
    unknownField(data, 'result');
  if (output !== undefined) {
    persisted.toolInvocation.result = output;
    persisted.toolInvocation.state = 'output-available';
  }

  const errorText = stringField(part, 'errorText') ?? stringField(data, 'errorText');
  if (errorText) {
    persisted.toolInvocation.errorText = errorText;
    persisted.toolInvocation.state = 'output-error';
  }
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  const field = unknownField(value, key);
  return field && typeof field === 'object' && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const field = unknownField(value, key);
  return typeof field === 'string' && field.length > 0 ? field : undefined;
}

function unknownField(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}
type TrustTraceLike = { reasoningTrace?: unknown };

function markInputOnlyToolsComplete(timelineParts: OrchestrationAssistantPart[]): void {
  for (const part of timelineParts) {
    if (part.type !== 'tool-invocation') continue;
    const invocation = part.toolInvocation;
    if (invocation.errorText || invocation.result !== undefined) continue;
    invocation.state = 'output-available';
    invocation.result = null;
  }
}

function backfillToolPartsFromTrust(
  trust: unknown,
  toolById: Map<string, ToolInvocationPart>,
  timelineParts: OrchestrationAssistantPart[],
): void {
  const trace = (trust as TrustTraceLike | null)?.reasoningTrace;
  if (!Array.isArray(trace)) return;

  const existingByTool = new Map<string, number>();
  for (const part of timelineParts) {
    if (part.type !== 'tool-invocation') continue;
    const toolName = part.toolInvocation.toolName;
    existingByTool.set(toolName, (existingByTool.get(toolName) ?? 0) + 1);
  }
  const seenByTool = new Map<string, number>();

  for (let i = 0; i < trace.length; i++) {
    const item = trace[i];
    if (!item || typeof item !== 'object') continue;
    const step = (item as { step?: unknown }).step;
    if (typeof step !== 'string' || step.length === 0) continue;

    const seen = seenByTool.get(step) ?? 0;
    seenByTool.set(step, seen + 1);
    if (seen < (existingByTool.get(step) ?? 0)) continue;

    const toolCallId = `trust-${i}-${step.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
    if (toolById.has(toolCallId)) continue;
    const invocation: ToolInvocationPart = {
      type: 'tool-invocation',
      toolInvocation: {
        toolCallId,
        toolName: step,
        state: 'output-available',
        args: argsFromTraceDetail((item as { detail?: unknown }).detail),
        result: null,
      },
    };
    toolById.set(toolCallId, invocation);
    timelineParts.push(invocation);
  }
}

function argsFromTraceDetail(detail: unknown): unknown {
  if (typeof detail !== 'string' || !detail.startsWith('args=')) return undefined;
  try {
    return JSON.parse(detail.slice('args='.length));
  } catch {
    return undefined;
  }
}
function toolNameFromPartType(part: StreamPart): string | undefined {
  const type = part.type;
  if (!type.startsWith('tool-')) return undefined;
  if (
    type === 'tool-input-available' ||
    type === 'tool-output-available' ||
    type === 'tool-input-start' ||
    type === 'tool-input-delta' ||
    type === 'tool-error'
  ) {
    return undefined;
  }
  return type.slice('tool-'.length) || undefined;
}
