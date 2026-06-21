import { z } from 'zod';

export const LdRoleSchema = z.enum(['BOD', 'LND_MANAGER']);
export type LdRole = z.infer<typeof LdRoleSchema>;

export const EvidenceStatusSchema = z.enum(['PASS', 'PARTIAL_PASS', 'BLOCKED']);
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;

export const QualityStatusSchema = z.enum(['PASS', 'REVISION_REQUIRED', 'FAIL']);
export type QualityStatus = z.infer<typeof QualityStatusSchema>;

export const EffectivenessClassSchema = z.enum([
  'Effective',
  'Needs improvement',
  'Risk',
  'Not reportable',
]);
export type EffectivenessClass = z.infer<typeof EffectivenessClassSchema>;

export const ScopeInputSchema = z.object({
  courseId: z.string().trim().min(1).optional(),
  period: z.string().trim().min(1).optional(),
  team: z.string().trim().min(1).optional(),
  trainerId: z.string().trim().min(1).optional(),
  reportType: z.enum(['executive', 'course', 'readiness', 'full']).default('full').optional(),
});
export type LdScopeInput = z.infer<typeof ScopeInputSchema>;

export const LdRequestSchema = z.object({
  scope: ScopeInputSchema.default({}),
  dataFilePath: z.string().optional(),
});
export type LdRequest = z.infer<typeof LdRequestSchema>;
export type LdPipelineRequest = LdRequest & { role?: LdRole };

export const LdQnaRequestSchema = z.object({
  reportId: z.string().optional(),
  question: z.string().trim().min(1),
});
export type LdQnaRequest = z.infer<typeof LdQnaRequestSchema>;

export const FinalizeDecisionSchema = z.enum(['approve', 'revise', 'regenerate']);
export const LdFinalizeRequestSchema = z.object({
  decision: FinalizeDecisionSchema,
  note: z.string().optional(),
});
export type LdFinalizeRequest = z.infer<typeof LdFinalizeRequestSchema>;

export const LdReportDraftPatchSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    executiveSummary: z.string().trim().min(1).optional(),
    insights: z.array(z.string().trim().min(1)).max(20).optional(),
    recommendations: z.array(z.string().trim().min(1)).max(20).optional(),
    warnings: z.array(z.string().trim().min(1)).max(20).optional(),
  })
  .strict();
export type LdReportDraftPatch = z.infer<typeof LdReportDraftPatchSchema>;

export interface SourceMetadata {
  source: 'Teams' | 'OneDrive' | 'Forms' | 'KPI' | 'Rules' | 'Template';
  sheetName: string;
  rowCount: number;
  required: boolean;
  present: boolean;
  missingColumns: string[];
  loadedAt: string;
}

export interface Course {
  courseId: string;
  courseName: string;
  topicCategory: string;
  trainerId: string;
  totalSessions: number;
  hoursPerSession: number;
  totalHours: number;
  passThresholdScore: number;
  startDate: string;
  endDate: string;
  status: 'Completed' | 'In Progress' | string;
}

export interface AttendanceRecord {
  courseId: string;
  sessionId: string;
  employeeId: string;
  attendanceStatus: 'Present' | 'Absent' | 'Late' | string;
  trainingHours: number;
}

export interface AssessmentRecord {
  courseId: string;
  employeeId: string;
  score: number | null;
  passStatus: boolean | null;
  generalizedFeedback: string | null;
}

export interface FeedbackRecord {
  courseId: string;
  employeeId: string;
  trainerRating: number | null;
  contentRating: number | null;
  comment: string | null;
}

export interface CostRecord {
  courseId: string;
  costPerSessionScaled: number | null;
  totalSessions: number | null;
  totalCostScaled: number | null;
  traineeCount: number | null;
  completionRate: number | null;
  avgScore: number | null;
  passRate: number | null;
  postTrainingPerfDelta: number | null;
  notes: string | null;
}

export interface NormRule {
  ruleId: string;
  category: string;
  ruleDescription: string;
  threshold: string;
  actionIfTriggered: string;
  priority: 'High' | 'Medium' | 'Low' | string;
}

export interface TemplateSection {
  sectionId: string;
  sectionName: string;
  contentDescription: string;
  dataSource: string;
  required: boolean;
}

export interface TraineeSnapshot {
  courseId: string;
  employeeId: string;
  attendedUnits: number;
  expectedUnits: number;
  attendanceRate: number;
  score: number | null;
  passStatus: boolean | null;
  completed: boolean;
  trainerRating: number | null;
  contentRating: number | null;
  feedbackComment: string | null;
}

export interface NormalizedDataset {
  datasetId: string;
  scope: LdScopeInput;
  importedAt: string;
  sources: SourceMetadata[];
  courses: Course[];
  attendance: AttendanceRecord[];
  assessments: AssessmentRecord[];
  feedback: FeedbackRecord[];
  costs: CostRecord[];
  normRules: NormRule[];
  templateSections: TemplateSection[];
  trainees: TraineeSnapshot[];
}

export interface MissingEvidenceItem {
  type:
    | 'MISSING_SOURCE'
    | 'MISSING_COLUMN'
    | 'MISSING_ATTENDANCE'
    | 'MISSING_ASSESSMENT'
    | 'MISSING_FEEDBACK'
    | 'NO_COURSES_IN_SCOPE'
    | 'IN_PROGRESS_COURSE'
    | 'CONSISTENCY_ERROR'
    | 'INSUFFICIENT_FEEDBACK'
    | 'SCORE_INCONSISTENCY'
    | 'DUPLICATE_ATTENDANCE'
    | 'DUPLICATE_ASSESSMENT'
    | 'DUPLICATE_FEEDBACK'
    | 'MISSING_SCORE'
    | 'INVALID_SCORE_RANGE'
    | 'INVALID_RATING_RANGE'
    | 'INVALID_COST_VALUE'
    | 'INVALID_COURSE_VALUE'
    | 'INVALID_ATTENDANCE_STATUS';
  severity: 'blocker' | 'warning';
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
  ownerRole?: 'LND_MANAGER' | 'DATA_OWNER' | 'TRAINER' | 'HRIS_ADMIN' | 'SYSTEM_ADMIN';
}

export interface EvidenceDecision {
  evidenceId: string;
  datasetId: string;
  status: EvidenceStatus;
  generatedAt: string;
  missingEvidence: MissingEvidenceItem[];
  checklist: Array<{ check: string; status: 'PASS' | 'WARN' | 'FAIL'; detail: string }>;
  canGenerateFinalConclusion: boolean;
}

export interface CourseMetrics {
  courseId: string;
  courseName: string;
  trainerId?: string;
  status: string;
  traineeCount: number;
  attendanceRate: number | null;
  completionRate: number | null;
  passRate: number | null;
  averageScore: number | null;
  feedbackRating: number | null;
  trainerRatingAvg: number | null;
  contentRatingAvg: number | null;
  feedbackResponseRate: number | null;
  trainingHours: number;
  totalCostScaled: number | null;
  costPerCompletedTrainee: number | null;
  postTrainingPerfDelta: number | null;
  roiProxy: number | null;
  effectivenessScore: number | null;
}

export interface MetricsSnapshot {
  metricsId: string;
  datasetId: string;
  generatedAt: string;
  overall: {
    totalCourses: number;
    completedCourses: number;
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
  courses: CourseMetrics[];
}

export interface NormFlag {
  ruleId: string;
  priority: string;
  category: string;
  courseId?: string;
  employeeId?: string;
  message: string;
  action: string;
}

export interface TraineeHighlight {
  courseId: string;
  employeeId: string;
  score: number | null;
  attendanceRate: number;
  reason: string;
}

export interface GovernanceView {
  governanceId: string;
  role: LdRole;
  classification: EffectivenessClass;
  generatedAt: string;
  normFlags: NormFlag[];
  outstandingTrainees: TraineeHighlight[];
  supportNeededTrainees: TraineeHighlight[];
  supportNeededGroups: Array<{ courseId: string; count: number; reason: string }>;
  masked: boolean;
}

export interface ReportJson {
  reportId: string;
  datasetId: string;
  metricsId: string;
  evidenceId: string;
  governanceId: string;
  title: string;
  scope: LdScopeInput;
  status: 'DRAFT' | 'FINAL' | 'REVISION_REQUESTED';
  generatedAt: string;
  lastEditedAt?: string;
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
  evidence: EvidenceDecision;
  metrics: MetricsSnapshot;
  governance: GovernanceView;
  quality?: QualityCheckResult;
  artifacts?: { pptxPath?: string; docxPath?: string };
  llm?: {
    enabled: boolean;
    model?: string;
    usedFor: Array<'report_narrative' | 'qna' | 'pptx_content'>;
    fallbackReason?: string;
    generatedAt?: string;
  };
}

export interface QualityCheckResult {
  qualityId: string;
  status: QualityStatus;
  generatedAt: string;
  issues: string[];
}

export interface QnaAnswer {
  answerId: string;
  reportId?: string;
  answer: string;
  confidence: number;
  limitations: string[];
  citations: string[];
  generatedAt: string;
}
