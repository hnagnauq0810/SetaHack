import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { ReportJson } from '../../models.ts';
import {
  buildReportModel,
  type ReportKpi,
  type ReportModel,
  type ReportStatusTone,
} from './report-model.ts';

type PptxSlide = {
  background: { color: string };
  addShape: (shapeName: string, options?: Record<string, unknown>) => PptxSlide;
  addTable: (tableRows: string[][], options?: Record<string, unknown>) => PptxSlide;
  addText: (text: string, options?: Record<string, unknown>) => PptxSlide;
};

type PptxInstance = {
  ShapeType: Record<'line' | 'rect' | 'roundRect', string>;
  addSlide: () => PptxSlide;
  author: string;
  company: string;
  lang?: string;
  layout: string;
  subject: string;
  theme: { headFontFace: string; bodyFontFace: string; lang: string };
  title: string;
  write: (props: { outputType: 'nodebuffer' }) => Promise<string | ArrayBuffer | Blob | Uint8Array>;
};

type PptxConstructor = new () => PptxInstance;

const COLORS = {
  ink: '0F172A',
  muted: '64748B',
  light: 'F8FAFC',
  border: 'CBD5E1',
  navy: '0B1220',
  blue: '2563EB',
  green: '047857',
  greenBg: 'D1FAE5',
  amber: 'B45309',
  amberBg: 'FEF3C7',
  red: 'B91C1C',
  redBg: 'FEE2E2',
  slateBg: 'E2E8F0',
  white: 'FFFFFF',
};

const TONE: Record<ReportStatusTone, { fg: string; bg: string; label: string }> = {
  excellent: { fg: COLORS.green, bg: COLORS.greenBg, label: 'Excellent' },
  good: { fg: COLORS.green, bg: COLORS.greenBg, label: 'Good' },
  monitor: { fg: COLORS.amber, bg: COLORS.amberBg, label: 'Monitor' },
  risk: { fg: COLORS.red, bg: COLORS.redBg, label: 'Risk' },
  neutral: { fg: COLORS.muted, bg: COLORS.slateBg, label: 'Tracked' },
};

const SHAPES = {
  line: 'line',
  rect: 'rect',
  roundRect: 'roundRect',
} as const;

export async function writeReportArtifacts(
  report: ReportJson,
  storageDir: string,
): Promise<{
  pptxPath: string;
  docxPath: string;
}> {
  const artifactDir = join(storageDir, 'artifacts', report.reportId);
  await mkdir(artifactDir, { recursive: true });
  const pptxPath = join(artifactDir, `${safeFileName(report.reportId)}.pptx`);
  const docxPath = join(artifactDir, `${safeFileName(report.reportId)}.docx`);
  const model = buildReportModel(report);
  await Promise.all([writeDocx(model, docxPath), writePptx(model, pptxPath)]);
  return { pptxPath, docxPath };
}

export async function writeReportArtifact(
  report: ReportJson,
  storageDir: string,
  kind: 'pptx' | 'docx',
): Promise<{ path: string; filename: string; mediaType: string }> {
  const suffix = `${safeFileName(report.governance.role.toLowerCase())}-${Date.now()}`;
  const artifactDir = join(storageDir, 'artifacts', report.reportId, 'views', suffix);
  await mkdir(artifactDir, { recursive: true });
  const filename = `${safeFileName(report.reportId)}.${kind}`;
  const path = join(artifactDir, filename);
  const model = buildReportModel(report);
  if (kind === 'pptx') {
    await writePptx(model, path);
    return {
      path,
      filename,
      mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
  }
  await writeDocx(model, path);
  return {
    path,
    filename,
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

async function writeDocx(model: ReportModel, path: string): Promise<void> {
  await ensureArtifactParent(path);
  const doc = new Document({
    creator: 'SETA L&D Reporting Agent',
    title: model.title,
    description: model.executiveHeadline,
    sections: [
      {
        properties: {},
        children: [
          heading(model.title, HeadingLevel.TITLE),
          paragraph(model.scope, { muted: true }),
          paragraph(
            `Audience: ${model.audience} | Evidence: ${model.evidenceStatus} | Status: ${model.status}`,
            {
              muted: true,
            },
          ),
          heading('Executive summary', HeadingLevel.HEADING_1),
          callout(model.executiveHeadline, model.executiveMessage),
          paragraph(model.decisionMessage),
          heading('Performance scorecard', HeadingLevel.HEADING_1),
          kpiTable(model.kpis),
          heading('Key findings', HeadingLevel.HEADING_1),
          ...model.findings.flatMap((finding) => [
            bullet(`${finding.headline} (${TONE[finding.severity].label})`, true),
            paragraph(`Evidence: ${finding.evidence}`),
            paragraph(`Implication: ${finding.implication}`),
          ]),
          heading('Recommendations and owners', HeadingLevel.HEADING_1),
          recommendationTable(model),
          heading('Course performance', HeadingLevel.HEADING_1),
          courseTable(model),
          heading('Readiness and evidence', HeadingLevel.HEADING_1),
          paragraph(`Final conclusion: ${model.evidence.finalConclusion}`),
          paragraph(
            `Missing evidence: ${model.evidence.missingCount}; warnings: ${model.evidence.warningCount}`,
          ),
          evidenceTable(model),
          heading('Governance and access', HeadingLevel.HEADING_1),
          paragraph(`Classification: ${model.classification}`),
          paragraph(
            `Sensitive details: ${model.governance.sensitiveDetails}; raw appendix: ${model.governance.rawAppendix}`,
          ),
          governanceTable(model),
          heading('Appendix', HeadingLevel.HEADING_1),
          ...model.appendix.map((item) => bullet(item)),
          paragraph(model.llmDisclosure, { muted: true }),
        ],
      },
    ],
  });
  await writeFile(path, await Packer.toBuffer(doc));
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({
    heading: level,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, bold: true, color: COLORS.ink })],
  });
}

function paragraph(text: string, opts: { muted?: boolean; bold?: boolean } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({ text, color: opts.muted ? COLORS.muted : COLORS.ink, bold: opts.bold }),
    ],
  });
}

function bullet(text: string, bold = false): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, bold, color: COLORS.ink })],
  });
}

function callout(title: string, body: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: COLORS.light },
            borders: cellBorders(COLORS.border),
            children: [paragraph(title, { bold: true }), paragraph(body)],
          }),
        ],
      }),
    ],
  });
}

function kpiTable(kpis: ReportKpi[]): Table {
  const rows: TableRow[] = [
    row(['Metric', 'Value', 'Target', 'Status', 'Meaning'], true),
    ...kpis.map((kpi) =>
      row([kpi.label, kpi.value, kpi.target, TONE[kpi.status].label, kpi.explanation]),
    ),
  ];
  return table(rows);
}

function recommendationTable(model: ReportModel): Table {
  return table([
    row(['Priority', 'Owner', 'Action', 'Expected outcome'], true),
    ...model.recommendations.map((rec) =>
      row([rec.priority, rec.owner, rec.action, rec.expectedOutcome]),
    ),
  ]);
}

function courseTable(model: ReportModel): Table {
  return table([
    row(
      ['Course', 'Learners', 'Attendance', 'Completion', 'Pass rate', 'Score', 'Effectiveness'],
      true,
    ),
    ...model.courseRows.map((course) =>
      row([
        course.course,
        course.learners,
        course.attendance,
        course.completion,
        course.passRate,
        course.score,
        course.effectiveness,
      ]),
    ),
  ]);
}

function evidenceTable(model: ReportModel): Table {
  return table([
    row(['Check', 'Status', 'Detail'], true),
    ...model.evidence.checklist.map((item) => row([item.check, item.status, item.detail])),
  ]);
}

function governanceTable(model: ReportModel): Table {
  return table([
    row(['Rule', 'Priority', 'Message', 'Action'], true),
    ...(model.governance.flags.length
      ? model.governance.flags.map((flag) =>
          row([flag.rule, flag.priority, flag.message, flag.action]),
        )
      : [row(['No NORM flags', 'N/A', 'No governance flags triggered.', 'Continue monitoring.'])]),
  ]);
}

function table(rows: TableRow[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

function row(values: string[], header = false): TableRow {
  return new TableRow({
    tableHeader: header,
    children: values.map(
      (value) =>
        new TableCell({
          shading: header ? { fill: COLORS.navy } : undefined,
          borders: cellBorders(COLORS.border),
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: value,
                  bold: header,
                  color: header ? COLORS.white : COLORS.ink,
                  size: 18,
                }),
              ],
            }),
          ],
        }),
    ),
  });
}

function cellBorders(color: string) {
  return {
    top: { style: BorderStyle.SINGLE, size: 1, color },
    bottom: { style: BorderStyle.SINGLE, size: 1, color },
    left: { style: BorderStyle.SINGLE, size: 1, color },
    right: { style: BorderStyle.SINGLE, size: 1, color },
  };
}

async function writePptx(model: ReportModel, path: string): Promise<void> {
  await ensureArtifactParent(path);
  const pptxModule = await import('pptxgenjs');
  const PptxGen = ('default' in pptxModule
    ? pptxModule.default
    : pptxModule) as unknown as PptxConstructor;
  const pptx = new PptxGen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'SETA L&D Reporting Agent';
  pptx.company = 'SETA';
  pptx.subject = model.executiveHeadline;
  pptx.title = model.title;
  pptx.lang = 'en-US';
  pptx.theme = {
    headFontFace: 'Aptos Display',
    bodyFontFace: 'Aptos',
    lang: 'en-US',
  };

  addCoverSlide(pptx, model);
  addExecutiveSnapshotSlide(pptx, model);
  addDecisionReadinessSlide(pptx, model);
  addKpiScorecardSlide(pptx, model);
  addCoursePerformanceSlide(pptx, model);
  addFindingsSlide(pptx, model);
  addEvidenceTraceabilitySlide(pptx, model);
  addGovernanceSlide(pptx, model);
  addRecommendationsSlide(pptx, model);
  addDeliveryRoadmapSlide(pptx, model);
  addAppendixSlide(pptx, model);

  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  await writeFile(path, Buffer.from(buffer as ArrayBuffer));
}

function addCoverSlide(pptx: PptxInstance, model: ReportModel): void {
  const slide = pptx.addSlide();
  addBackground(slide);
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.33,
    h: 7.5,
    fill: { color: COLORS.navy },
    line: { color: COLORS.navy },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.18,
    h: 7.5,
    fill: { color: COLORS.blue },
    line: { color: COLORS.blue },
  });
  slide.addText('Training Effectiveness Agent', {
    x: 0.7,
    y: 0.65,
    w: 6.8,
    h: 0.35,
    color: '93C5FD',
    fontSize: 14,
    bold: true,
  });
  slide.addText(model.title, {
    x: 0.7,
    y: 1.25,
    w: 8.8,
    h: 1.35,
    color: COLORS.white,
    fontSize: 34,
    bold: true,
    margin: 0.02,
    fit: 'shrink',
  });
  slide.addText(model.executiveHeadline, {
    x: 0.72,
    y: 2.85,
    w: 8.5,
    h: 0.65,
    color: 'CBD5E1',
    fontSize: 18,
    margin: 0.02,
    fit: 'shrink',
  });
  addBadge(slide, model.evidenceStatus, 0.72, 4.05, toneForEvidence(model.evidenceStatus));
  addBadge(slide, model.status, 2.25, 4.05, model.status === 'Finalized' ? 'good' : 'neutral');
  addBadge(slide, model.audience, 3.6, 4.05, 'neutral');
  slide.addText(model.scope, { x: 0.72, y: 5.95, w: 6.2, h: 0.3, color: 'CBD5E1', fontSize: 12 });
  slide.addText(model.generatedAt, {
    x: 0.72,
    y: 6.32,
    w: 4.2,
    h: 0.3,
    color: '94A3B8',
    fontSize: 11,
  });
  slide.addText('SETA L&D Reporting', {
    x: 10.3,
    y: 6.72,
    w: 2.2,
    h: 0.25,
    color: '94A3B8',
    fontSize: 10,
    align: 'right',
  });
}

function addExecutiveSnapshotSlide(pptx: PptxInstance, model: ReportModel): void {
  const slide = addTitledSlide(pptx, 'Executive snapshot', model);
  slide.addText(model.executiveHeadline, {
    x: 0.65,
    y: 1.15,
    w: 7.4,
    h: 0.52,
    fontSize: 22,
    bold: true,
    color: COLORS.ink,
    fit: 'shrink',
  });
  slide.addText(model.executiveMessage, {
    x: 0.68,
    y: 1.88,
    w: 7.3,
    h: 1.7,
    fontSize: 13,
    color: COLORS.ink,
    breakLine: false,
    fit: 'shrink',
    valign: 'top',
  });
  addDecisionCard(slide, model, 8.55, 1.1);
  model.kpis.slice(0, 4).forEach((kpi, index) => {
    addKpiCard(slide, kpi, 0.65 + index * 3.05, 4.55, 2.75, 1.25);
  });
}

function addDecisionReadinessSlide(pptx: PptxInstance, model: ReportModel): void {
  const slide = addTitledSlide(pptx, 'Decision readiness', model);
  addDecisionCard(slide, model, 0.65, 1.12);
  slide.addText(model.decisionMessage, {
    x: 5.05,
    y: 1.18,
    w: 7.2,
    h: 0.62,
    fontSize: 16,
    bold: true,
    color: COLORS.ink,
    fit: 'shrink',
  });
  slide.addText('Validated gate checks', {
    x: 5.05,
    y: 2.18,
    w: 3.2,
    h: 0.26,
    fontSize: 14,
    bold: true,
    color: COLORS.ink,
  });
  model.evidence.checklist.slice(0, 5).forEach((item, index) => {
    addStatusRow(
      slide,
      item.check,
      item.status,
      item.detail,
      5.05,
      2.65 + index * 0.75,
      item.status === 'Ready' ? 'good' : item.status === 'Warning' ? 'monitor' : 'risk',
      7.2,
    );
  });
}

function addKpiScorecardSlide(pptx: PptxInstance, model: ReportModel): void {
  const slide = addTitledSlide(pptx, 'Performance scorecard', model);
  model.kpis.forEach((kpi, index) => {
    addKpiCard(
      slide,
      kpi,
      0.65 + (index % 4) * 3.05,
      1.15 + Math.floor(index / 4) * 2.05,
      2.75,
      1.55,
    );
  });
  addFooterNote(
    slide,
    'Completion is attendance-based (>= 70%) and is intentionally separate from pass rate.',
  );
}

function addCoursePerformanceSlide(pptx: PptxInstance, model: ReportModel): void {
  const slide = addTitledSlide(pptx, 'Course performance', model);
  const rows = [
    ['Course', 'Learners', 'Attend.', 'Complete', 'Pass', 'Score', 'Effectiveness'],
    ...model.courseRows
      .slice(0, 6)
      .map((r) => [
        short(r.course, 32),
        r.learners,
        r.attendance,
        r.completion,
        r.passRate,
        r.score,
        r.effectiveness,
      ]),
  ];
  slide.addTable(rows, {
    x: 0.65,
    y: 1.18,
    w: 12.0,
    h: 3.35,
    border: { type: 'solid', color: COLORS.border, pt: 0.5 },
    fontSize: 10,
    color: COLORS.ink,
    fill: { color: COLORS.white },
    margin: 0.06,
    autoFit: false,
    rowH: 0.45,
    valign: 'mid',
    fit: 'shrink',
    bold: false,
    colW: [3.3, 1, 1.25, 1.25, 1.1, 1.1, 1.35],
  });
  slide.addText('What to notice', {
    x: 0.65,
    y: 5.0,
    w: 2.2,
    h: 0.28,
    fontSize: 14,
    bold: true,
    color: COLORS.ink,
  });
  model.findings.slice(0, 3).forEach((finding, index) => {
    addMiniFinding(slide, finding.headline, finding.severity, 0.65 + index * 4.08, 5.42);
  });
}

function addFindingsSlide(pptx: PptxInstance, model: ReportModel): void {
  const slide = addTitledSlide(pptx, 'Key findings and implications', model);
  model.findings.slice(0, 4).forEach((finding, index) => {
    const x = 0.65 + (index % 2) * 6.15;
    const y = 1.18 + Math.floor(index / 2) * 2.35;
    addFindingCard(
      slide,
      finding.headline,
      finding.evidence,
      finding.implication,
      finding.severity,
      x,
      y,
    );
  });
}

function addEvidenceTraceabilitySlide(pptx: PptxInstance, model: ReportModel): void {
  const slide = addTitledSlide(pptx, 'Evidence traceability', model);
  slide.addText('Every narrative claim is backed by validated artifacts before export.', {
    x: 0.65,
    y: 1.14,
    w: 7.5,
    h: 0.34,
    fontSize: 15,
    bold: true,
    color: COLORS.ink,
  });
  model.evidence.checklist.slice(0, 6).forEach((item, index) => {
    const x = 0.65 + (index % 2) * 6.1;
    const y = 1.85 + Math.floor(index / 2) * 1.28;
    addTraceCard(
      slide,
      item.check,
      item.status,
      item.detail,
      x,
      y,
      item.status === 'Ready' ? 'good' : item.status === 'Warning' ? 'monitor' : 'risk',
    );
  });
}

function addGovernanceSlide(pptx: PptxInstance, model: ReportModel): void {
  const slide = addTitledSlide(pptx, 'Governance and access', model);
  addInfoBlock(
    slide,
    'Classification',
    model.classification,
    0.65,
    1.15,
    toneForClassification(model.classification),
  );
  addInfoBlock(
    slide,
    'Sensitive details',
    model.governance.sensitiveDetails,
    3.7,
    1.15,
    model.governance.sensitiveDetails === 'Visible' ? 'good' : 'monitor',
  );
  addInfoBlock(
    slide,
    'Raw appendix',
    model.governance.rawAppendix,
    6.75,
    1.15,
    model.governance.rawAppendix === 'Allowed' ? 'good' : 'monitor',
  );
  addInfoBlock(
    slide,
    'High-priority flags',
    String(model.governance.highPriorityCount),
    9.8,
    1.15,
    model.governance.highPriorityCount > 0 ? 'risk' : 'good',
  );
  const flags = model.governance.flags.slice(0, 4);
  (flags.length
    ? flags
    : [
        {
          rule: 'No NORM flags',
          priority: 'N/A',
          message: 'No governance flags triggered.',
          action: 'Continue monitoring.',
        },
      ]
  ).forEach((flag, index) => {
    addStatusRow(
      slide,
      `${flag.rule} | ${flag.priority}`,
      flag.priority,
      flag.message,
      0.65,
      3.05 + index * 0.82,
      flag.priority === 'High' ? 'risk' : flag.priority === 'Medium' ? 'monitor' : 'good',
    );
  });
}

function addRecommendationsSlide(pptx: PptxInstance, model: ReportModel): void {
  const slide = addTitledSlide(pptx, 'Recommended action plan', model);
  model.recommendations.slice(0, 5).forEach((rec, index) => {
    const y = 1.05 + index * 1.08;
    addRecommendationRow(
      slide,
      index + 1,
      rec.priority,
      rec.owner,
      rec.action,
      rec.expectedOutcome,
      y,
    );
  });
}

function addDeliveryRoadmapSlide(pptx: PptxInstance, model: ReportModel): void {
  const slide = addTitledSlide(pptx, 'Delivery roadmap', model);
  const steps = model.recommendations.slice(0, 4);
  steps.forEach((rec, index) => {
    const x = 0.72 + index * 3.05;
    const tone = rec.priority === 'High' ? 'risk' : rec.priority === 'Medium' ? 'monitor' : 'good';
    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y: 1.35,
      w: 2.55,
      h: 4.65,
      rectRadius: 0.08,
      fill: { color: COLORS.white },
      line: { color: COLORS.border, pt: 1 },
    });
    slide.addText(`Step ${index + 1}`, {
      x: x + 0.2,
      y: 1.65,
      w: 1.1,
      h: 0.22,
      fontSize: 10,
      bold: true,
      color: COLORS.muted,
    });
    addBadge(slide, rec.priority, x + 1.35, 1.62, tone, 0.85);
    slide.addText(rec.owner, {
      x: x + 0.2,
      y: 2.12,
      w: 2.05,
      h: 0.24,
      fontSize: 11,
      bold: true,
      color: COLORS.ink,
      fit: 'shrink',
    });
    slide.addText(rec.action, {
      x: x + 0.2,
      y: 2.62,
      w: 2.05,
      h: 1.1,
      fontSize: 10.5,
      color: COLORS.ink,
      fit: 'shrink',
      valign: 'top',
    });
    slide.addText('Expected outcome', {
      x: x + 0.2,
      y: 4.18,
      w: 1.8,
      h: 0.18,
      fontSize: 8,
      bold: true,
      color: COLORS.muted,
    });
    slide.addText(rec.expectedOutcome, {
      x: x + 0.2,
      y: 4.48,
      w: 2.05,
      h: 0.65,
      fontSize: 9.2,
      color: COLORS.muted,
      fit: 'shrink',
    });
  });
}

function addAppendixSlide(pptx: PptxInstance, model: ReportModel): void {
  const slide = addTitledSlide(pptx, 'Appendix and methodology', model);
  slide.addText('Source traceability', {
    x: 0.65,
    y: 1.15,
    w: 3.2,
    h: 0.3,
    fontSize: 16,
    bold: true,
    color: COLORS.ink,
  });
  model.appendix.forEach((item, index) => {
    slide.addText(item, {
      x: 0.8,
      y: 1.62 + index * 0.34,
      w: 5.6,
      h: 0.24,
      fontSize: 10.5,
      color: COLORS.ink,
      fit: 'shrink',
    });
  });
  slide.addText('LLM disclosure', {
    x: 7.1,
    y: 1.15,
    w: 3.2,
    h: 0.3,
    fontSize: 16,
    bold: true,
    color: COLORS.ink,
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 7.1,
    y: 1.6,
    w: 5.45,
    h: 1.5,
    rectRadius: 0.08,
    fill: { color: COLORS.light },
    line: { color: COLORS.border, pt: 1 },
  });
  slide.addText(model.llmDisclosure, {
    x: 7.35,
    y: 1.86,
    w: 4.9,
    h: 0.85,
    fontSize: 11.5,
    color: COLORS.ink,
    fit: 'shrink',
  });
  slide.addText('Business rule', {
    x: 7.1,
    y: 3.55,
    w: 3.2,
    h: 0.3,
    fontSize: 16,
    bold: true,
    color: COLORS.ink,
  });
  slide.addText(
    'Completion rate is calculated from learner attendance >= 70%. Pass rate is calculated independently from assessment pass status.',
    {
      x: 7.1,
      y: 4.02,
      w: 5.35,
      h: 0.75,
      fontSize: 12,
      color: COLORS.ink,
      fit: 'shrink',
    },
  );
}

function addTitledSlide(pptx: PptxInstance, title: string, model: ReportModel): PptxSlide {
  const slide = pptx.addSlide();
  addBackground(slide);
  slide.addText(title, {
    x: 0.58,
    y: 0.35,
    w: 7.5,
    h: 0.4,
    fontSize: 22,
    bold: true,
    color: COLORS.ink,
    margin: 0.02,
  });
  slide.addText(model.scope, {
    x: 8.5,
    y: 0.42,
    w: 3.95,
    h: 0.25,
    fontSize: 9.5,
    color: COLORS.muted,
    align: 'right',
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.6,
    y: 0.92,
    w: 12.15,
    h: 0,
    line: { color: COLORS.border, pt: 1 },
  });
  addFooter(slide, model);
  return slide;
}

function addBackground(slide: PptxSlide): void {
  slide.background = { color: COLORS.light };
}

function addFooter(slide: PptxSlide, model: ReportModel): void {
  slide.addText(`Evidence: ${model.evidenceStatus} | ${model.status} | ${model.audience}`, {
    x: 0.62,
    y: 7.08,
    w: 7.6,
    h: 0.22,
    fontSize: 8.5,
    color: COLORS.muted,
  });
  slide.addText('SETA L&D Reporting', {
    x: 10.35,
    y: 7.08,
    w: 2.25,
    h: 0.22,
    fontSize: 8.5,
    color: COLORS.muted,
    align: 'right',
  });
}

function addFooterNote(slide: PptxSlide, text: string): void {
  slide.addText(text, { x: 0.65, y: 6.55, w: 10.8, h: 0.25, fontSize: 9.5, color: COLORS.muted });
}

function addKpiCard(
  slide: PptxSlide,
  kpi: ReportKpi,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const tone = TONE[kpi.status];
  slide.addShape(SHAPES.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: { color: COLORS.white },
    line: { color: COLORS.border, pt: 1 },
  });
  slide.addText(kpi.label.toUpperCase(), {
    x: x + 0.18,
    y: y + 0.16,
    w: w - 0.35,
    h: 0.18,
    fontSize: 8.5,
    bold: true,
    color: COLORS.muted,
    fit: 'shrink',
  });
  slide.addText(kpi.value, {
    x: x + 0.18,
    y: y + 0.42,
    w: w - 0.35,
    h: 0.36,
    fontSize: 21,
    bold: true,
    color: COLORS.ink,
    fit: 'shrink',
  });
  slide.addText(kpi.target, {
    x: x + 0.18,
    y: y + 0.86,
    w: w - 1.15,
    h: 0.18,
    fontSize: 8.5,
    color: COLORS.muted,
    fit: 'shrink',
  });
  addBadge(slide, tone.label, x + w - 1.03, y + h - 0.39, kpi.status, 0.85);
}

function addDecisionCard(slide: PptxSlide, model: ReportModel, x: number, y: number): void {
  const tone = model.evidence.finalConclusion === 'Allowed' ? 'good' : 'risk';
  slide.addShape(SHAPES.roundRect, {
    x,
    y,
    w: 3.95,
    h: 2.4,
    rectRadius: 0.08,
    fill: { color: COLORS.white },
    line: { color: COLORS.border, pt: 1 },
  });
  slide.addText('Decision readiness', {
    x: x + 0.25,
    y: y + 0.25,
    w: 2.8,
    h: 0.25,
    fontSize: 13,
    bold: true,
    color: COLORS.ink,
  });
  addBadge(slide, model.evidence.finalConclusion, x + 0.25, y + 0.7, tone, 1.25);
  slide.addText(`Missing evidence: ${model.evidence.missingCount}`, {
    x: x + 0.25,
    y: y + 1.22,
    w: 2.5,
    h: 0.25,
    fontSize: 11,
    color: COLORS.ink,
  });
  slide.addText(`Warnings: ${model.evidence.warningCount}`, {
    x: x + 0.25,
    y: y + 1.55,
    w: 2.5,
    h: 0.25,
    fontSize: 11,
    color: COLORS.ink,
  });
  slide.addText(model.decisionMessage, {
    x: x + 0.25,
    y: y + 1.9,
    w: 3.35,
    h: 0.32,
    fontSize: 9.5,
    color: COLORS.muted,
    fit: 'shrink',
  });
}

function addInfoBlock(
  slide: PptxSlide,
  label: string,
  value: string,
  x: number,
  y: number,
  tone: ReportStatusTone,
): void {
  slide.addShape(SHAPES.roundRect, {
    x,
    y,
    w: 2.75,
    h: 1.18,
    rectRadius: 0.08,
    fill: { color: COLORS.white },
    line: { color: COLORS.border, pt: 1 },
  });
  slide.addText(label.toUpperCase(), {
    x: x + 0.16,
    y: y + 0.14,
    w: 2.35,
    h: 0.16,
    fontSize: 8,
    bold: true,
    color: COLORS.muted,
  });
  slide.addText(value, {
    x: x + 0.16,
    y: y + 0.48,
    w: 2.35,
    h: 0.34,
    fontSize: 15,
    bold: true,
    color: TONE[tone].fg,
    fit: 'shrink',
  });
}

function addStatusRow(
  slide: PptxSlide,
  title: string,
  status: string,
  detail: string,
  x: number,
  y: number,
  tone: ReportStatusTone,
  w = 7.45,
): void {
  slide.addShape(SHAPES.roundRect, {
    x,
    y,
    w,
    h: 0.62,
    rectRadius: 0.06,
    fill: { color: COLORS.white },
    line: { color: COLORS.border, pt: 0.8 },
  });
  addBadge(slide, status, x + 0.14, y + 0.17, tone, 0.85);
  slide.addText(title, {
    x: x + 1.1,
    y: y + 0.12,
    w: 2.35,
    h: 0.16,
    fontSize: 9.3,
    bold: true,
    color: COLORS.ink,
    fit: 'shrink',
  });
  slide.addText(detail, {
    x: x + 3.55,
    y: y + 0.1,
    w: Math.max(2.8, w - 3.85),
    h: 0.24,
    fontSize: 8.6,
    color: COLORS.muted,
    fit: 'shrink',
  });
}

function addTraceCard(
  slide: PptxSlide,
  title: string,
  status: string,
  detail: string,
  x: number,
  y: number,
  tone: ReportStatusTone,
): void {
  slide.addShape(SHAPES.roundRect, {
    x,
    y,
    w: 5.65,
    h: 0.95,
    rectRadius: 0.08,
    fill: { color: COLORS.white },
    line: { color: COLORS.border, pt: 1 },
  });
  addBadge(slide, status, x + 0.18, y + 0.18, tone, 0.92);
  slide.addText(title, {
    x: x + 1.25,
    y: y + 0.16,
    w: 3.95,
    h: 0.2,
    fontSize: 10,
    bold: true,
    color: COLORS.ink,
    fit: 'shrink',
  });
  slide.addText(detail, {
    x: x + 1.25,
    y: y + 0.5,
    w: 3.95,
    h: 0.22,
    fontSize: 8.5,
    color: COLORS.muted,
    fit: 'shrink',
  });
}

function addFindingCard(
  slide: PptxSlide,
  headline: string,
  evidence: string,
  implication: string,
  tone: ReportStatusTone,
  x: number,
  y: number,
): void {
  slide.addShape(SHAPES.roundRect, {
    x,
    y,
    w: 5.75,
    h: 1.95,
    rectRadius: 0.08,
    fill: { color: COLORS.white },
    line: { color: COLORS.border, pt: 1 },
  });
  addBadge(slide, TONE[tone].label, x + 0.2, y + 0.2, tone, 0.95);
  slide.addText(headline, {
    x: x + 0.22,
    y: y + 0.58,
    w: 5.25,
    h: 0.34,
    fontSize: 13,
    bold: true,
    color: COLORS.ink,
    fit: 'shrink',
  });
  slide.addText(`Evidence: ${evidence}`, {
    x: x + 0.22,
    y: y + 1.0,
    w: 5.25,
    h: 0.32,
    fontSize: 8.5,
    color: COLORS.muted,
    fit: 'shrink',
  });
  slide.addText(`Implication: ${implication}`, {
    x: x + 0.22,
    y: y + 1.42,
    w: 5.25,
    h: 0.32,
    fontSize: 8.5,
    color: COLORS.muted,
    fit: 'shrink',
  });
}

function addMiniFinding(
  slide: PptxSlide,
  text: string,
  tone: ReportStatusTone,
  x: number,
  y: number,
): void {
  slide.addShape(SHAPES.roundRect, {
    x,
    y,
    w: 3.75,
    h: 0.95,
    rectRadius: 0.08,
    fill: { color: TONE[tone].bg },
    line: { color: TONE[tone].bg, pt: 1 },
  });
  slide.addText(text, {
    x: x + 0.18,
    y: y + 0.18,
    w: 3.35,
    h: 0.45,
    fontSize: 10,
    bold: true,
    color: COLORS.ink,
    fit: 'shrink',
  });
}

function addRecommendationRow(
  slide: PptxSlide,
  index: number,
  priority: string,
  owner: string,
  action: string,
  outcome: string,
  y: number,
): void {
  const tone = priority === 'High' ? 'risk' : priority === 'Medium' ? 'monitor' : 'good';
  slide.addShape(SHAPES.roundRect, {
    x: 0.65,
    y,
    w: 12.0,
    h: 0.82,
    rectRadius: 0.06,
    fill: { color: COLORS.white },
    line: { color: COLORS.border, pt: 0.8 },
  });
  slide.addText(String(index), {
    x: 0.84,
    y: y + 0.24,
    w: 0.25,
    h: 0.18,
    fontSize: 12,
    bold: true,
    color: COLORS.ink,
    align: 'center',
  });
  addBadge(slide, priority, 1.28, y + 0.22, tone, 0.9);
  slide.addText(owner, {
    x: 2.32,
    y: y + 0.18,
    w: 1.65,
    h: 0.22,
    fontSize: 9,
    bold: true,
    color: COLORS.ink,
    fit: 'shrink',
  });
  slide.addText(action, {
    x: 4.15,
    y: y + 0.12,
    w: 4.2,
    h: 0.28,
    fontSize: 9.3,
    color: COLORS.ink,
    fit: 'shrink',
  });
  slide.addText(outcome, {
    x: 8.6,
    y: y + 0.12,
    w: 3.6,
    h: 0.28,
    fontSize: 8.5,
    color: COLORS.muted,
    fit: 'shrink',
  });
}

function addBadge(
  slide: PptxSlide,
  text: string,
  x: number,
  y: number,
  tone: ReportStatusTone,
  w = 1.25,
): void {
  slide.addShape(SHAPES.roundRect, {
    x,
    y,
    w,
    h: 0.28,
    rectRadius: 0.08,
    fill: { color: TONE[tone].bg },
    line: { color: TONE[tone].bg, pt: 1 },
  });
  slide.addText(text, {
    x: x + 0.04,
    y: y + 0.055,
    w: w - 0.08,
    h: 0.1,
    fontSize: 7.4,
    bold: true,
    color: TONE[tone].fg,
    align: 'center',
    fit: 'shrink',
  });
}

function toneForEvidence(value: string): ReportStatusTone {
  if (value === 'Passed') return 'good';
  if (value === 'Passed with warnings') return 'monitor';
  if (value === 'Blocked') return 'risk';
  return 'neutral';
}

function toneForClassification(value: string): ReportStatusTone {
  const normalized = value.toLowerCase();
  if (normalized.includes('effective')) return 'good';
  if (normalized.includes('improvement')) return 'monitor';
  if (normalized.includes('risk') || normalized.includes('not reportable')) return 'risk';
  return 'neutral';
}

function short(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}

export async function ensureArtifactParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}
