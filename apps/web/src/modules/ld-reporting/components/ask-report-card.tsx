import { Button, Card, CardContent, Textarea } from '@seta/shared-ui';
import { HelpCircle, Send } from 'lucide-react';
import type { LdReport, QnaAnswer } from '../api-client';
import { llmFallbackLabel } from './display-utils';
import { StatusBadge } from './status-badge';

interface AskReportCardProps {
  report: LdReport | null;
  question: string;
  answer: QnaAnswer | null;
  loading: string | null;
  onQuestionChange: (value: string) => void;
  onAsk: () => void;
}

export function AskReportCard({
  report,
  question,
  answer,
  loading,
  onQuestionChange,
  onAsk,
}: AskReportCardProps) {
  const fallback = report?.llm && !report.llm.enabled;

  return (
    <Card className="rounded-2xl border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <HelpCircle className="size-5 text-slate-700" />
            <h2 className="text-lg font-semibold text-slate-950">Ask this report</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Ask questions grounded in the validated report artifact.
          </p>
        </div>
        <StatusBadge tone={report ? 'success' : 'neutral'}>
          {report ? 'Artifact ready' : 'No artifact'}
        </StatusBadge>
      </div>

      <CardContent className="pt-5">
        <div className="space-y-3">
          {fallback && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {llmFallbackLabel(report.llm?.fallbackReason)}
            </div>
          )}
          <Textarea
            className="min-h-28 rounded-2xl border-slate-200 bg-white text-sm"
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            placeholder="Ask about risks, course performance, recommendations..."
          />
          <Button
            type="button"
            onClick={onAsk}
            disabled={loading !== null || question.trim().length === 0}
            className="h-10 w-full bg-slate-950 text-white hover:bg-slate-800"
          >
            <Send className="size-4" />
            {loading === 'qna' ? 'Answering...' : 'Ask'}
          </Button>

          {answer && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-950">Answer</div>
                <StatusBadge tone="info">Confidence {Math.round(answer.confidence * 100)}%</StatusBadge>
              </div>
              <p className="text-sm leading-6 text-slate-700">{answer.answer}</p>
              <div className="mt-4 grid gap-3">
                <AnswerMeta label="Evidence used" value={answer.citations.join(', ') || 'Validated report artifact'} />
                {answer.limitations.length > 0 && (
                  <AnswerMeta label="Limitations" value={answer.limitations.join(' | ')} tone="warning" />
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AnswerMeta({ label, value, tone = 'info' }: { label: string; value: string; tone?: 'info' | 'warning' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-1">
        <StatusBadge tone={tone}>{label}</StatusBadge>
      </div>
      <div className="text-xs leading-5 text-slate-600">{value}</div>
    </div>
  );
}
