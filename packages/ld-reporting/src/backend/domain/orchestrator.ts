import type {
  LdFinalizeRequest,
  LdPipelineRequest,
  LdRequest,
  LdRole,
  QnaAnswer,
  ReportJson,
} from '../../models.ts';
import { applyReportAccessView, type LdReportAccessContext } from './access-control.ts';
import { writeReportArtifact, writeReportArtifacts } from './artifact-writer.ts';
import { evaluateEvidence } from './evidence-gate.ts';
import { loadAndNormalizeDataset } from './excel-loader.ts';
import { applyGovernanceAndRbac } from './governance-service.ts';
import { answerQuestionWithLlm, enrichReportWithLlm } from './llm-service.ts';
import { calculateMetrics } from './metrics-service.ts';
import { validateReportQuality } from './quality-check.ts';
import { buildReportJson } from './report-builder.ts';
import { LdReportingStore } from './storage.ts';
import { formatNumber, formatPct, id } from './utils.ts';

export interface LdReportingAgentDeps {
  store?: LdReportingStore;
}

export class LdReportingSpecialistAgent {
  private readonly store: LdReportingStore;

  constructor(deps: LdReportingAgentDeps = {}) {
    this.store = deps.store ?? new LdReportingStore();
  }

  async ld_checkReadiness(input: LdRequest): Promise<{
    datasetId: string;
    evidence: ReturnType<typeof evaluateEvidence>;
    sourceReadiness: Array<{
      source: string;
      sheetName: string;
      rowCount: number;
      present: boolean;
      missingColumns: string[];
    }>;
  }> {
    const dataset = await loadAndNormalizeDataset({
      sourcePath: input.dataFilePath,
      scope: input.scope,
    });
    const evidence = evaluateEvidence(dataset);
    await this.store.saveDataset(dataset);
    await this.store.saveEvidence(evidence);
    return {
      datasetId: dataset.datasetId,
      evidence,
      sourceReadiness: dataset.sources.map((s) => ({
        source: s.source,
        sheetName: s.sheetName,
        rowCount: s.rowCount,
        present: s.present,
        missingColumns: s.missingColumns,
      })),
    };
  }

  async ld_generateReport(input: LdPipelineRequest): Promise<ReportJson> {
    const dataset = await loadAndNormalizeDataset({
      sourcePath: input.dataFilePath,
      scope: input.scope,
    });
    const evidence = evaluateEvidence(dataset);
    const metrics = calculateMetrics(dataset);
    const governance = applyGovernanceAndRbac(dataset, metrics, evidence, 'LND_MANAGER');
    const report = await enrichReportWithLlm({
      report: buildReportJson({ dataset, evidence, metrics, governance }),
      dataset,
    });
    report.quality = validateReportQuality(report);

    if (report.quality.status !== 'PASS') {
      // Controlled re-plan once: rebuild with stricter reporting classification if evidence is blocked.
      if (!evidence.canGenerateFinalConclusion) {
        report.governance.classification = 'Not reportable';
        report.quality = validateReportQuality(report);
      }
    }

    const artifacts = await writeReportArtifacts(report, this.store.rootDir);
    report.artifacts = artifacts;

    await this.store.saveDataset(dataset);
    await this.store.saveEvidence(evidence);
    await this.store.saveMetrics(metrics);
    await this.store.saveGovernance(governance);
    await this.store.saveReport(report);
    return report;
  }

  async ld_answerQuestion(input: {
    reportId?: string;
    question: string;
    role?: LdRole;
    trainerId?: string;
  }): Promise<QnaAnswer> {
    if (!input.reportId) {
      return this.saveAnswer({
        reportId: undefined,
        answer:
          'Chưa có report artifact được validate. Vui lòng chạy Generate Report trước rồi mới Q&A từ số liệu đã kiểm chứng.',
        confidence: 0.98,
        limitations: ['No validated artifact available.'],
        citations: [],
      });
    }
    const report = await this.store.getReport(input.reportId);
    if (!report) {
      return this.saveAnswer({
        reportId: input.reportId,
        answer: 'Không tìm thấy report artifact này. Hãy tạo lại report hoặc kiểm tra reportId.',
        confidence: 0.92,
        limitations: ['Report artifact not found in local artifact store.'],
        citations: [],
      });
    }

    const role = input.role ?? report.governance.role;
    const reportView = applyReportAccessView(report, { role, trainerId: input.trainerId });
    const question = input.question.toLowerCase();
    const deterministicAnswer = groundedAnswer(reportView, question, role);
    const answer = await answerQuestionWithLlm({
      report: reportView,
      question: input.question,
      role,
      deterministicAnswer,
    });
    return this.saveAnswer({ reportId: report.reportId, ...answer });
  }

  async ld_finalizeReport(input: {
    reportId: string;
    body: LdFinalizeRequest;
    actorUserId?: string;
  }): Promise<ReportJson> {
    const report = await this.store.getReport(input.reportId);
    if (!report) throw new Error(`Report not found: ${input.reportId}`);
    const approval = {
      decision: input.body.decision,
      note: input.body.note,
      actorUserId: input.actorUserId,
      at: new Date().toISOString(),
    };
    if (input.body.decision === 'approve') {
      report.status = 'FINAL';
      report.finalizedAt = approval.at;
    } else if (input.body.decision === 'revise') {
      report.status = 'REVISION_REQUESTED';
    } else {
      report.status = 'DRAFT';
    }
    report.approval = approval;
    await this.store.saveReport(report);
    return report;
  }

  async getReport(reportId: string): Promise<ReportJson | null> {
    return this.store.getReport(reportId);
  }

  viewReport(report: ReportJson, access: LdReportAccessContext): ReportJson {
    return applyReportAccessView(report, access);
  }

  async writeArtifactForView(
    report: ReportJson,
    kind: 'pptx' | 'docx',
  ): Promise<{ path: string; filename: string; mediaType: string }> {
    return writeReportArtifact(report, this.store.rootDir, kind);
  }

  private async saveAnswer(input: Omit<QnaAnswer, 'answerId' | 'generatedAt'>): Promise<QnaAnswer> {
    const answer: QnaAnswer = {
      answerId: id('qa'),
      generatedAt: new Date().toISOString(),
      ...input,
    };
    await this.store.saveQna(answer);
    return answer;
  }
}

function groundedAnswer(
  report: ReportJson,
  question: string,
  role: LdRole,
): Omit<QnaAnswer, 'answerId' | 'generatedAt' | 'reportId'> {
  const limitations: string[] = [];
  if (report.evidence.status !== 'PASS') {
    limitations.push(
      `Evidence status is ${report.evidence.status}; final conclusions are limited.`,
    );
  }
  if (role !== 'LND_MANAGER') {
    limitations.push('RBAC masking applied: individual trainee details are hidden or aggregated.');
  }

  if (
    question.includes('attendance') ||
    question.includes('tham gia') ||
    question.includes('đi học')
  ) {
    return {
      answer: `Attendance rate của scope này là ${formatPct(report.metrics.overall.attendanceRate)}. Course thấp nhất về attendance là ${lowestCourse(report, 'attendanceRate')}.`,
      confidence: 0.93,
      limitations,
      citations: ['metrics.overall.attendanceRate', 'metrics.courses.attendanceRate'],
    };
  }
  if (question.includes('completion') || question.includes('hoàn thành')) {
    return {
      answer: `Completion rate tổng là ${formatPct(report.metrics.overall.completionRate)}. Theo NORM-13, completion được tính khi học viên tham gia >= 70% sessions; pass rate được tính riêng theo điểm đạt chuẩn.`,
      confidence: 0.92,
      limitations,
      citations: ['metrics.overall.completionRate', 'NORM-13'],
    };
  }
  if (question.includes('pass') || question.includes('đạt')) {
    return {
      answer: `Pass rate tổng là ${formatPct(report.metrics.overall.passRate)}. Course có pass rate thấp nhất là ${lowestCourse(report, 'passRate')}.`,
      confidence: 0.94,
      limitations,
      citations: ['metrics.overall.passRate', 'metrics.courses.passRate'],
    };
  }
  if (question.includes('score') || question.includes('điểm')) {
    const sensitive = /emp-|employee|học viên|cá nhân|ai/.test(question);
    if (sensitive && role !== 'LND_MANAGER') {
      return {
        answer: `Bạn không có quyền xem điểm cá nhân trong role ${role}. Có thể xem aggregate: average score tổng là ${formatNumber(report.metrics.overall.averageScore, 2)}/10.`,
        confidence: 0.96,
        limitations,
        citations: ['governance.role', 'metrics.overall.averageScore'],
      };
    }
    return {
      answer: `Average score tổng là ${formatNumber(report.metrics.overall.averageScore, 2)}/10. Course thấp nhất theo điểm trung bình là ${lowestCourse(report, 'averageScore')}.`,
      confidence: 0.94,
      limitations,
      citations: ['metrics.overall.averageScore', 'metrics.courses.averageScore'],
    };
  }
  if (question.includes('roi') || question.includes('cost') || question.includes('chi phí')) {
    return {
      answer: `Scaled cost tổng là ${formatNumber(report.metrics.overall.totalCostScaled, 2)}. ROI proxy tổng là ${formatNumber(report.metrics.overall.roiProxy, 4)}; chỉ số này dùng post-training performance delta chia theo chi phí scaled nên chỉ nên dùng cho so sánh tương đối trong POC.`,
      confidence: 0.88,
      limitations: [
        ...limitations,
        'ROI is a proxy from mock KPI data, not audited financial ROI.',
      ],
      citations: ['metrics.overall.totalCostScaled', 'metrics.overall.roiProxy'],
    };
  }
  if (
    question.includes('risk') ||
    question.includes('rủi ro') ||
    question.includes('norm') ||
    question.includes('flag')
  ) {
    const high = report.governance.normFlags.filter((f) => f.priority === 'High').length;
    return {
      answer: `Classification hiện tại là ${report.governance.classification}. Có ${report.governance.normFlags.length} NORM flag(s), trong đó ${high} high-priority flag(s).`,
      confidence: 0.92,
      limitations,
      citations: ['governance.classification', 'governance.normFlags'],
    };
  }
  if (
    question.includes('outstanding') ||
    question.includes('nổi bật') ||
    question.includes('star')
  ) {
    const count = report.governance.outstandingTrainees.length;
    return {
      answer:
        role === 'LND_MANAGER'
          ? `Có ${count} outstanding trainee(s). Danh sách đầu tiên: ${
              report.governance.outstandingTrainees
                .slice(0, 5)
                .map((t) => `${t.employeeId} (${t.courseId}, score ${formatNumber(t.score, 1)})`)
                .join('; ') || 'không có'
            }.`
          : `Có ${count} outstanding trainee(s). Danh tính cá nhân đã được ẩn theo RBAC role ${role}.`,
      confidence: 0.91,
      limitations,
      citations: ['governance.outstandingTrainees'],
    };
  }
  if (question.includes('support') || question.includes('hỗ trợ') || question.includes('at-risk')) {
    return {
      answer: `Có ${report.governance.supportNeededGroups.length} course group(s) cần hỗ trợ. Chi tiết theo nhóm: ${report.governance.supportNeededGroups.map((g) => `${g.courseId}: ${g.count}`).join('; ') || 'không có'}.`,
      confidence: 0.91,
      limitations,
      citations: ['governance.supportNeededGroups'],
    };
  }
  if (question.includes('block') || question.includes('evidence') || question.includes('thiếu')) {
    return {
      answer: `Evidence status là ${report.evidence.status}. Có ${report.evidence.missingEvidence.length} missing/warning item(s). ${report.evidence.canGenerateFinalConclusion ? 'Có thể kết luận final.' : 'Không được kết luận final cho đến khi xử lý blocker.'}`,
      confidence: 0.95,
      limitations,
      citations: [
        'evidence.status',
        'evidence.missingEvidence',
        'evidence.canGenerateFinalConclusion',
      ],
    };
  }

  return {
    answer: `Theo report đã validate: ${report.executiveSummary}`,
    confidence: 0.82,
    limitations: [
      ...limitations,
      'Question did not match a specialized Q&A template; answered from executive summary only.',
    ],
    citations: ['report.executiveSummary'],
  };
}

function lowestCourse(
  report: ReportJson,
  key: keyof ReportJson['metrics']['courses'][number],
): string {
  const courses = report.metrics.courses.filter((c) => typeof c[key] === 'number');
  if (courses.length === 0) return 'N/A';
  const lowest = courses.reduce((best, current) =>
    Number(current[key]) < Number(best[key]) ? current : best,
  );
  const value = lowest[key];
  const rendered = key.toLowerCase().includes('rate')
    ? formatPct(value as number)
    : formatNumber(value as number, 2);
  return `${lowest.courseName} (${rendered})`;
}
