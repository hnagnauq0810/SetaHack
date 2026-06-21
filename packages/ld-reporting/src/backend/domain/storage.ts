import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

  async getReport(reportId: string): Promise<ReportJson | null> {
    return this.readJson<ReportJson>('report_artifacts', reportId);
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
