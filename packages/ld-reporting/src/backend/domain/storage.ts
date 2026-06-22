import { mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  EvidenceDecision,
  GovernanceView,
  MetricsSnapshot,
  NormalizedDataset,
  QnaAnswer,
  ReportJson,
} from '../../models.ts';
import { defaultStorageDir } from './defaults.ts';

export class LdReportingStore {
  readonly rootDir: string;

  constructor(rootDir = defaultStorageDir()) {
    this.rootDir = rootDir;
  }

  async saveDataset(dataset: NormalizedDataset): Promise<void> {
    await this.writeJson('datasets', dataset.datasetId, dataset);
  }

  async saveEvidence(evidence: EvidenceDecision): Promise<void> {
    await this.writeJson('evidence_decisions', evidence.evidenceId, evidence);
  }

  async saveMetrics(metrics: MetricsSnapshot): Promise<void> {
    await this.writeJson('metrics_snapshots', metrics.metricsId, metrics);
  }

  async saveGovernance(governance: GovernanceView): Promise<void> {
    await this.writeJson('governance_views', governance.governanceId, governance);
  }

  async saveReport(report: ReportJson): Promise<void> {
    await this.writeJson('report_artifacts', report.reportId, report);
  }

  async deleteReport(reportId: string): Promise<boolean> {
    const reportPath = join(this.rootDir, 'report_artifacts', `${reportId}.json`);
    const artifactDir = join(this.rootDir, 'artifacts', reportId);
    let deleted = false;
    try {
      await unlink(reportPath);
      deleted = true;
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err;
    }
    try {
      await rm(artifactDir, { recursive: true, force: true });
    } catch {
      // Ignore directory deletion error
    }
    return deleted;
  }

  async getReport(reportId: string): Promise<ReportJson | null> {
    return this.readJson<ReportJson>('report_artifacts', reportId);
  }

  async listReports(): Promise<ReportJson[]> {
    const dir = join(this.rootDir, 'report_artifacts');
    let files: string[];
    try {
      files = await readdir(dir);
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return [];
      throw err;
    }
    const reports = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map((file) => this.readJson<ReportJson>('report_artifacts', file.slice(0, -5))),
    );
    return reports
      .filter((report): report is ReportJson => report !== null && report.saved !== false)
      .sort((a, b) => reportTimestamp(b).localeCompare(reportTimestamp(a)));
  }

  async saveQna(answer: QnaAnswer): Promise<void> {
    await this.writeJson('qna_logs', answer.answerId, answer);
  }

  private async writeJson<T>(bucket: string, key: string, value: T): Promise<void> {
    const dir = join(this.rootDir, bucket);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${key}.json`), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  private async readJson<T>(bucket: string, key: string): Promise<T | null> {
    try {
      const text = await readFile(join(this.rootDir, bucket, `${key}.json`), 'utf8');
      return JSON.parse(text) as T;
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return null;
      throw err;
    }
  }
}

function reportTimestamp(report: ReportJson): string {
  return report.finalizedAt ?? report.lastEditedAt ?? report.approval?.at ?? report.generatedAt;
}
