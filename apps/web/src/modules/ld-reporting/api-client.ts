type Json = Record<string, unknown>;

export type LdRole = 'BOD' | 'LND_MANAGER' | 'TEAM_MANAGER' | 'TRAINER';

export interface LdScope {
  courseId?: string;
  period?: string;
  team?: string;
  trainerId?: string;
  reportType?: 'executive' | 'course' | 'readiness' | 'full';
}

export interface LdRequestPayload {
  scope: LdScope;
}

export interface LdReport {
  reportId: string;
  datasetId: string;
  title: string;
  scope: LdScope;
  status: 'DRAFT' | 'FINAL' | 'REVISION_REQUESTED';
  generatedAt: string;
  finalizedAt?: string;
  approval?: {
    decision: 'approve' | 'revise' | 'regenerate';
    note?: string;
    actorUserId?: string;
    at: string;
  };
  executiveSummary: string;
  insights: string[];
  recommendations: string[];
  warnings: string[];
  evidence: {
    status: 'PASS' | 'PARTIAL_PASS' | 'BLOCKED';
    canGenerateFinalConclusion: boolean;
    missingEvidence: Array<{
      type?: string;
      severity: string;
      source?: string;
      sheetName?: string;
      rowNumber?: number;
      field?: string;
      courseId?: string;
      employeeId?: string;
      message: string;
      affectedCount?: number;
      expected?: string;
      actual?: string | number | boolean | null;
      ruleId?: string;
      recommendedFix?: string;
      ownerRole?: string;
    }>;
    checklist: Array<{ check: string; status: string; detail: string }>;
  };
  metrics: {
    overall: {
      totalCourses: number;
      completedCourses?: number;
      traineeCount: number;
      attendanceRate: number | null;
      completionRate: number | null;
      passRate: number | null;
      averageScore: number | null;
      feedbackRating: number | null;
      trainingHours: number;
      totalCostScaled: number;
      roiProxy: number | null;
      effectivenessScore: number | null;
    };
    courses: Array<{
      courseId: string;
      courseName: string;
      trainerId?: string;
      status?: string;
      traineeCount?: number;
      attendanceRate: number | null;
      completionRate: number | null;
      passRate: number | null;
      averageScore: number | null;
      feedbackRating?: number | null;
      trainingHours?: number;
      totalCostScaled?: number | null;
      roiProxy?: number | null;
      effectivenessScore: number | null;
    }>;
  };
  governance: {
    role: LdRole;
    classification: string;
    normFlags: Array<{ ruleId: string; priority: string; message: string; courseId?: string }>;
    outstandingTrainees: unknown[];
    supportNeededGroups: Array<{ courseId: string; count: number; reason: string }>;
    masked: boolean;
  };
  quality?: { status: string; issues: string[] };
  artifacts?: { pptxPath?: string; docxPath?: string };
  llm?: {
    enabled: boolean;
    model?: string;
    usedFor: Array<'report_narrative' | 'qna' | 'pptx_content'>;
    fallbackReason?: string;
    generatedAt?: string;
  };
}

export interface ReadinessResult {
  datasetId: string;
  evidence: LdReport['evidence'];
  sourceReadiness: Array<{
    source: string;
    sheetName: string;
    rowCount: number;
    present: boolean;
    missingColumns: string[];
  }>;
}

export interface QnaAnswer {
  answerId: string;
  reportId?: string;
  answer: string;
  confidence: number;
  limitations: string[];
  citations: string[];
  generatedAt?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as Json) : {};
  if (!res.ok) {
    const message = typeof body.message === 'string' ? body.message : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export const ldReportingClient = {
  checkReadiness(payload: LdRequestPayload): Promise<ReadinessResult> {
    return request('/api/ld-reporting/readiness', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  generateReport(payload: LdRequestPayload): Promise<LdReport> {
    return request('/api/ld-reporting/reports', { method: 'POST', body: JSON.stringify(payload) });
  },
  finalize(
    reportId: string,
    decision: 'approve' | 'revise' | 'regenerate',
    note?: string,
  ): Promise<LdReport> {
    return request(`/api/ld-reporting/reports/${reportId}/finalize`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    });
  },
  ask(reportId: string | undefined, question: string): Promise<QnaAnswer> {
    return request('/api/ld-reporting/qna', {
      method: 'POST',
      body: JSON.stringify({ reportId, question }),
    });
  },
};
