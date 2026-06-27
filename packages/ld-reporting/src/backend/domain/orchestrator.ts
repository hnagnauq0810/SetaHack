import type {
  LdFinalizeRequest,
  LdPipelineRequest,
  LdReportDraftPatch,
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
import { assertSingleCourseMatch, assertUnambiguousReportScope } from './scope-validation.ts';
import { LdReportingStore } from './storage.ts';
import { formatNumber, formatPct, id } from './utils.ts';

export interface LdReportingAgentDeps {
  store?: LdReportingStore;
}

export class LdReportingDomainError extends Error {
  constructor(
    readonly code: 'FINALIZE_BLOCKED_BY_EVIDENCE' | 'FINALIZE_BLOCKED_BY_QUALITY',
    message: string,
  ) {
    super(message);
    this.name = 'LdReportingDomainError';
  }
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
    assertUnambiguousReportScope(input.scope);
    const dataset = await loadAndNormalizeDataset({
      sourcePath: input.dataFilePath,
      scope: input.scope,
    });
    assertSingleCourseMatch(input.scope, dataset.courses);
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
    assertUnambiguousReportScope(input.scope);
    const dataset = await loadAndNormalizeDataset({
      sourcePath: input.dataFilePath,
      scope: input.scope,
    });
    assertSingleCourseMatch(input.scope, dataset.courses);
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

    report.saved = input.saveToWorkspace !== false;

    await this.store.saveDataset(dataset);
    await this.store.saveEvidence(evidence);
    await this.store.saveMetrics(metrics);
    await this.store.saveGovernance(governance);
    await this.store.saveReport(report);
    return report;
  }

  async ld_saveReport(reportId: string): Promise<ReportJson> {
    const report = await this.store.getReport(reportId);
    if (!report) throw new Error(`Report not found: ${reportId}`);
    report.saved = true;
    await this.store.saveReport(report);
    return report;
  }

  async ld_answerQuestion(input: {
    reportId?: string;
    question: string;
    role?: LdRole;
  }): Promise<QnaAnswer> {
    const requestedRole = input.role ?? 'BOD';
    if (!input.reportId) {
      const finalizedReports = (await this.store.listReports()).filter(
        (report) => report.status === 'FINAL',
      );
      if (finalizedReports.length === 0) {
        return this.saveAnswer({
          reportId: undefined,
          answer:
            'Chua co finalized report nao duoc publish cho BOD. Q&A cho BOD chi dung du lieu da duoc L&D Manager finalize, khong dung draft.',
          confidence: 0.98,
          limitations: ['No finalized report artifact is available. Draft reports are excluded.'],
          citations: [],
        });
      }
      if (isPortfolioQuestion(input.question) || finalizedReports.length > 1) {
        return this.saveAnswer({
          reportId: undefined,
          ...groundedPortfolioAnswer(
            finalizedReports.map((report) => this.viewReport(report, { role: requestedRole })),
            requestedRole,
          ),
        });
      }
      const report = finalizedReports[0];
      if (!report) {
        return this.saveAnswer({
          reportId: undefined,
          answer: 'No finalized report artifact is available.',
          confidence: 0.98,
          limitations: ['No finalized report artifact is available.'],
          citations: [],
        });
      }
      const reportView = this.viewReport(report, { role: requestedRole });
      const deterministicAnswer = groundedAnswer(
        reportView,
        input.question.toLowerCase(),
        requestedRole,
      );
      const answer = await answerQuestionWithLlm({
        report: reportView,
        question: input.question,
        role: requestedRole,
        deterministicAnswer,
      });
      return this.saveAnswer({ reportId: report.reportId, ...answer });
    }
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
    if (!canUseReportForRole(report, role)) {
      return this.saveAnswer({
        reportId: input.reportId,
        answer:
          'Report nay chua duoc finalized nen khong kha dung cho BOD Q&A. BOD chi duoc hoi tren finalized reports da duoc L&D Manager approve.',
        confidence: 0.97,
        limitations: ['Draft and revision-requested reports are excluded for BOD access.'],
        citations: ['report.status'],
      });
    }
    const reportView = applyReportAccessView(report, { role });
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
    if (input.body.decision === 'approve') {
      if (report.evidence.status === 'BLOCKED' || !report.evidence.canGenerateFinalConclusion) {
        throw new LdReportingDomainError(
          'FINALIZE_BLOCKED_BY_EVIDENCE',
          'Finalization is blocked because the evidence gate does not allow a final conclusion.',
        );
      }
      if (report.quality?.status !== 'PASS') {
        throw new LdReportingDomainError(
          'FINALIZE_BLOCKED_BY_QUALITY',
          'Finalization is blocked until report quality passes validation.',
        );
      }
    }
    const approval = {
      decision: input.body.decision,
      note: input.body.note,
      actorUserId: input.actorUserId,
      at: new Date().toISOString(),
    };
    if (input.body.decision === 'approve') {
      report.status = 'FINAL';
      report.finalizedAt = approval.at;
      report.saved = true;
    } else if (input.body.decision === 'revise') {
      report.status = 'REVISION_REQUESTED';
      report.finalizedAt = undefined;
    } else {
      report.status = 'DRAFT';
      report.finalizedAt = undefined;
    }
    report.approval = approval;
    await this.store.saveReport(report);
    return report;
  }

  async ld_deleteReport(reportId: string): Promise<boolean> {
    return this.store.deleteReport(reportId);
  }

  async updateDraftReport(input: {
    reportId: string;
    patch: LdReportDraftPatch;
    actorUserId?: string;
  }): Promise<ReportJson> {
    const report = await this.store.getReport(input.reportId);
    if (!report) throw new Error(`Report not found: ${input.reportId}`);
    if (report.status === 'FINAL') {
      throw Object.assign(new Error('Finalized reports cannot be edited.'), {
        code: 'REPORT_FINALIZED',
      });
    }
    if (input.patch.title !== undefined) report.title = input.patch.title;
    if (input.patch.executiveSummary !== undefined) {
      report.executiveSummary = input.patch.executiveSummary;
    }
    if (input.patch.insights !== undefined) report.insights = input.patch.insights;
    if (input.patch.recommendations !== undefined) {
      report.recommendations = input.patch.recommendations;
    }
    if (input.patch.warnings !== undefined) report.warnings = input.patch.warnings;
    report.lastEditedAt = new Date().toISOString();
    await this.store.saveReport(report);
    return report;
  }

  async getReport(reportId: string): Promise<ReportJson | null> {
    return this.store.getReport(reportId);
  }

  async listReports(access?: LdReportAccessContext): Promise<ReportJson[]> {
    const reports = await this.store.listReports();
    if (!access) return reports;
    return reports
      .filter((report) => canUseReportForRole(report, access.role))
      .map((report) => this.viewReport(report, access));
  }

  viewReport(report: ReportJson, access: LdReportAccessContext): ReportJson {
    return applyReportAccessView(report, access);
  }

  async writeArtifactForRole(
    reportId: string,
    kind: 'pptx' | 'docx',
    access: LdReportAccessContext,
  ): Promise<{ path: string; filename: string; mediaType: string } | null> {
    const report = await this.store.getReport(reportId);
    if (!report || !canUseReportForRole(report, access.role)) return null;
    return writeReportArtifact(this.viewReport(report, access), this.store.rootDir, kind);
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

function canUseReportForRole(report: ReportJson, role: LdRole): boolean {
  return role === 'LND_MANAGER' || report.status === 'FINAL';
}

function isPortfolioQuestion(question: string): boolean {
  const normalized = question.toLowerCase();
  return [
    'all report',
    'all reports',
    'previous',
    'history',
    'portfolio',
    'overall',
    'tong quat',
    'tổng quát',
    'truoc do',
    'trước đó',
  ].some((token) => normalized.includes(token));
}

function groundedPortfolioAnswer(
  reports: ReportJson[],
  role: LdRole,
): Omit<QnaAnswer, 'answerId' | 'generatedAt' | 'reportId'> {
  const totalReports = reports.length;
  const latest = reports[0];
  const averageEffectiveness = averageNumber(
    reports.map((report) => report.metrics.overall.effectivenessScore),
  );
  const averageCompletion = averageNumber(
    reports.map((report) => report.metrics.overall.completionRate),
  );
  const averagePassRate = averageNumber(reports.map((report) => report.metrics.overall.passRate));
  const riskCount = reports.filter((report) => report.governance.classification === 'Risk').length;
  const effectiveCount = reports.filter(
    (report) => report.governance.classification === 'Effective',
  ).length;
  const latestLabel = latest ? `${latest.title} (${latest.reportId})` : 'N/A';
  return {
    answer:
      `Across ${totalReports} finalized L&D report(s), latest report is ${latestLabel}. ` +
      `Average effectiveness score is ${formatNumber(averageEffectiveness, 2)}, ` +
      `completion is ${formatPct(averageCompletion)}, and pass rate is ${formatPct(averagePassRate)}. ` +
      `${effectiveCount} report(s) are Effective and ${riskCount} report(s) are Risk. ` +
      'Draft reports and revision-requested reports are excluded from this BOD knowledge base.',
    confidence: 0.9,
    limitations: [
      role === 'BOD'
        ? 'BOD view uses masked finalized reports only.'
        : 'Portfolio answer uses finalized reports only unless a specific draft reportId is provided.',
    ],
    citations: reports.map((report) => report.reportId),
  };
}

function averageNumber(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => typeof value === 'number');
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
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

  const requestedNormRuleIds = extractNormRuleIds(question);
  const asksForCoaching = /\bcoach(?:ing)?\b|1\s*:\s*1|one[ -]on[ -]one/i.test(question);
  if (requestedNormRuleIds.length > 0 || asksForCoaching) {
    const matchingFlags = report.governance.normFlags.filter((flag) => {
      if (requestedNormRuleIds.length > 0) return requestedNormRuleIds.includes(flag.ruleId);
      return /coach|1\s*:\s*1|buddy|practice resource/i.test(`${flag.message} ${flag.action}`);
    });
    if (matchingFlags.length > 0) {
      return groundedNormCoachingAnswer(report, matchingFlags, role, limitations);
    }
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
    const overallScore = report.metrics.overall.averageScore;
    const comparedCourse =
      findCourseInQuestion(report, question) ?? lowestCourseMetric(report, 'averageScore');
    const scoreDelta =
      typeof overallScore === 'number' && comparedCourse
        ? Number(comparedCourse.averageScore) - overallScore
        : null;
    const relativeGap =
      scoreDelta !== null && typeof overallScore === 'number' && overallScore !== 0
        ? (Math.abs(scoreDelta) / overallScore) * 100
        : null;
    const direction =
      scoreDelta === null || scoreDelta === 0 ? 'bằng' : scoreDelta < 0 ? 'thấp hơn' : 'cao hơn';
    const comparison = comparedCourse
      ? `${comparedCourse.courseName} đạt ${formatNumber(Number(comparedCourse.averageScore), 2)}/10, ${direction} ${formatNumber(Math.abs(scoreDelta ?? 0), 2)} điểm (${formatNumber(relativeGap, 1)}%) so với mức trung bình ${formatNumber(overallScore, 2)}/10.`
      : `Điểm trung bình của báo cáo là ${formatNumber(overallScore, 2)}/10; không có dữ liệu theo khóa để so sánh.`;
    const interpretation =
      scoreDelta === null || scoreDelta === 0
        ? 'Kết quả đang ngang với mặt bằng điểm của phạm vi báo cáo'
        : `Kết quả ${direction} mặt bằng điểm của phạm vi báo cáo`;
    return {
      answer:
        `${comparison} ` +
        `Ý nghĩa: ${interpretation}, nhưng chỉ riêng điểm trung bình chưa đủ để kết luận nguyên nhân. ` +
        'Khuyến nghị: Đối chiếu thêm attendance, completion, pass rate và feedback đã validate trước khi điều chỉnh nội dung hoặc phương pháp đào tạo.',
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

function extractNormRuleIds(question: string): string[] {
  return Array.from(question.matchAll(/\bnorm[\s_-]?(\d{1,2})\b/gi), (match) => {
    return `NORM-${String(Number(match[1])).padStart(2, '0')}`;
  });
}

function groundedNormCoachingAnswer(
  report: ReportJson,
  flags: ReportJson['governance']['normFlags'],
  role: LdRole,
  limitations: string[],
): Omit<QnaAnswer, 'answerId' | 'generatedAt' | 'reportId'> {
  if (role !== 'LND_MANAGER') {
    const affectedLearners = new Set(flags.map((flag) => flag.employeeId).filter(Boolean)).size;
    const flagSummary = flags
      .map(
        (flag) => `${flag.ruleId} (${flag.priority}) for ${flag.courseId ?? 'the selected scope'}`,
      )
      .join('; ');
    return {
      answer: `${flagSummary} affects ${affectedLearners} learner${affectedLearners === 1 ? '' : 's'}. Individual identities and scores are hidden for the ${role} role. Recommended action: ${Array.from(new Set(flags.map((flag) => flag.action))).join('; ')}.`,
      confidence: 0.96,
      limitations,
      citations: ['governance.normFlags', 'governance.supportNeededGroups'],
    };
  }

  const details = flags.map((flag) => {
    const trainee = report.governance.supportNeededTrainees.find(
      (item) => item.employeeId === flag.employeeId && item.courseId === flag.courseId,
    );
    const metrics = trainee
      ? ` Score ${formatNumber(trainee.score, 1)}/10; attendance ${formatPct(trainee.attendanceRate)}.`
      : '';
    return `${flag.ruleId} (${flag.priority}) identifies ${flag.employeeId ?? 'the affected learner'} in ${flag.courseId ?? 'the selected scope'}: ${flag.message}${metrics} Action: ${flag.action}.`;
  });
  return {
    answer: details.join(' '),
    confidence: 0.96,
    limitations,
    citations: ['governance.normFlags', 'governance.supportNeededTrainees'],
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

function lowestCourseMetric(
  report: ReportJson,
  key: keyof ReportJson['metrics']['courses'][number],
): ReportJson['metrics']['courses'][number] | undefined {
  const courses = report.metrics.courses.filter((course) => typeof course[key] === 'number');
  return courses.reduce<ReportJson['metrics']['courses'][number] | undefined>(
    (best, current) => (!best || Number(current[key]) < Number(best[key]) ? current : best),
    undefined,
  );
}

function findCourseInQuestion(
  report: ReportJson,
  question: string,
): ReportJson['metrics']['courses'][number] | undefined {
  const normalizedQuestion = question.toLowerCase();
  return report.metrics.courses.find(
    (course) =>
      normalizedQuestion.includes(course.courseId.toLowerCase()) ||
      normalizedQuestion.includes(course.courseName.toLowerCase()),
  );
}
