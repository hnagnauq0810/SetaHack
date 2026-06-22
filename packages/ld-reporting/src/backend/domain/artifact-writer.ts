import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
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
  type ReportChart,
  type ReportCourseRow,
  type ReportKpi,
  type ReportModel,
  type ReportStatusTone,
} from './report-model.ts';

type PptxSlide = {
  background: { color: string };
  addChart: (
    chartType: string,
    data: Array<{ name: string; labels: string[]; values: number[] }>,
    options?: Record<string, unknown>,
  ) => PptxSlide;
  addImage: (options?: Record<string, unknown>) => PptxSlide;
  addNotes: (notes: string) => PptxSlide;
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
  ellipse: 'ellipse',
  line: 'line',
  rect: 'rect',
  roundRect: 'roundRect',
} as const;

export const DOCX_REPORT_STYLE = {
  font: 'Arial',
  bodySizeHalfPoints: 23,
  tableSizeHalfPoints: 20,
  titleSizeHalfPoints: 54,
  heading1SizeHalfPoints: 32,
  lineTwips: 276,
  paragraphAfterTwips: 160,
  bulletAfterTwips: 120,
  tableCellVerticalMarginTwips: 80,
  tableCellHorizontalMarginTwips: 100,
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
    styles: {
      default: {
        document: {
          run: {
            font: DOCX_REPORT_STYLE.font,
            size: DOCX_REPORT_STYLE.bodySizeHalfPoints,
            color: COLORS.ink,
          },
          paragraph: {
            spacing: { line: DOCX_REPORT_STYLE.lineTwips },
          },
        },
        title: {
          run: {
            font: DOCX_REPORT_STYLE.font,
            size: DOCX_REPORT_STYLE.titleSizeHalfPoints,
            bold: true,
            color: COLORS.ink,
          },
          paragraph: { keepNext: true, spacing: { before: 0, after: 180 } },
        },
        heading1: {
          run: {
            font: DOCX_REPORT_STYLE.font,
            size: DOCX_REPORT_STYLE.heading1SizeHalfPoints,
            bold: true,
            color: COLORS.ink,
          },
          paragraph: { keepNext: true, spacing: { before: 320, after: 140 } },
        },
        listParagraph: {
          run: {
            font: DOCX_REPORT_STYLE.font,
            size: DOCX_REPORT_STYLE.bodySizeHalfPoints,
            color: COLORS.ink,
          },
          paragraph: {
            spacing: {
              line: DOCX_REPORT_STYLE.lineTwips,
              after: DOCX_REPORT_STYLE.bulletAfterTwips,
            },
          },
        },
      },
    },
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
          ...docxChartSection(model),
          ...(model.charts.length > 0 ? [pageBreak()] : []),
          heading('Key findings', HeadingLevel.HEADING_1),
          ...model.findings.flatMap((finding) => [
            bullet(`${finding.headline} (${TONE[finding.severity].label})`, true),
            paragraph(`Evidence: ${finding.evidence}`, { indentLeft: 360, muted: true }),
            paragraph(`Implication: ${finding.implication}`, { indentLeft: 360 }),
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
  const title = level === HeadingLevel.TITLE;
  return new Paragraph({
    heading: level,
    keepNext: true,
    keepLines: true,
    spacing: title ? { before: 0, after: 180 } : { before: 320, after: 140 },
    children: [
      new TextRun({
        text,
        bold: true,
        color: COLORS.ink,
        font: DOCX_REPORT_STYLE.font,
        size: title
          ? DOCX_REPORT_STYLE.titleSizeHalfPoints
          : DOCX_REPORT_STYLE.heading1SizeHalfPoints,
      }),
    ],
  });
}

function paragraph(
  text: string,
  opts: { muted?: boolean; bold?: boolean; keepNext?: boolean; indentLeft?: number } = {},
): Paragraph {
  return new Paragraph({
    keepNext: opts.keepNext,
    keepLines: true,
    widowControl: true,
    indent: opts.indentLeft ? { left: opts.indentLeft } : undefined,
    spacing: {
      line: DOCX_REPORT_STYLE.lineTwips,
      after: DOCX_REPORT_STYLE.paragraphAfterTwips,
    },
    children: [
      new TextRun({
        text,
        color: opts.muted ? COLORS.muted : COLORS.ink,
        bold: opts.bold,
        font: DOCX_REPORT_STYLE.font,
        size: DOCX_REPORT_STYLE.bodySizeHalfPoints,
      }),
    ],
  });
}

function bullet(text: string, bold = false): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    keepLines: true,
    widowControl: true,
    indent: { left: 360, hanging: 180 },
    spacing: {
      line: DOCX_REPORT_STYLE.lineTwips,
      after: DOCX_REPORT_STYLE.bulletAfterTwips,
    },
    children: [
      new TextRun({
        text,
        bold,
        color: COLORS.ink,
        font: DOCX_REPORT_STYLE.font,
        size: DOCX_REPORT_STYLE.bodySizeHalfPoints,
      }),
    ],
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
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
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

function docxChartSection(model: ReportModel): Array<Paragraph | Table> {
  if (model.charts.length === 0) return [];
  return [
    pageBreak(),
    heading('Visual analytics', HeadingLevel.HEADING_1),
    ...model.charts.map((chart) => chartImage(chart)),
  ];
}

function chartImage(chart: ReportChart): Paragraph {
  const width = 720;
  const height = chartHeight(chart, 320);
  const svg = renderChartSvg(chart, width, height);
  const png = new Resvg(svg, {
    background: '#FFFFFF',
    fitTo: { mode: 'zoom', value: 2 },
    font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
    shapeRendering: 2,
    textRendering: 1,
  })
    .render()
    .asPng();
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    keepLines: true,
    spacing: { before: 80, after: 220 },
    children: [
      new ImageRun({
        type: 'png',
        data: png,
        transformation: { width: 620, height: Math.round(height * (620 / width)) },
        altText: {
          title: chart.title,
          description: chart.subtitle,
          name: chart.id,
        },
      }),
    ],
  });
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] });
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
    cantSplit: true,
    children: values.map(
      (value) =>
        new TableCell({
          shading: header ? { fill: COLORS.navy } : undefined,
          borders: cellBorders(COLORS.border),
          margins: {
            top: DOCX_REPORT_STYLE.tableCellVerticalMarginTwips,
            bottom: DOCX_REPORT_STYLE.tableCellVerticalMarginTwips,
            left: DOCX_REPORT_STYLE.tableCellHorizontalMarginTwips,
            right: DOCX_REPORT_STYLE.tableCellHorizontalMarginTwips,
          },
          children: [
            new Paragraph({
              keepLines: true,
              widowControl: true,
              spacing: { line: 252, after: 0 },
              children: [
                new TextRun({
                  text: value,
                  bold: header,
                  color: header ? COLORS.white : COLORS.ink,
                  font: DOCX_REPORT_STYLE.font,
                  size: DOCX_REPORT_STYLE.tableSizeHalfPoints,
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
  addVisualAnalyticsSlide(pptx, model);
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
  addCoverInfographic(slide, model);
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

function addCoverInfographic(slide: PptxSlide, model: ReportModel): void {
  const effectiveness = model.charts
    .find((chart) => chart.id === 'overall-kpis')
    ?.points.find((point) => point.label === 'Effectiveness');
  const score = effectiveness?.valueLabel ?? model.classification;
  const tone = toneForClassification(model.classification);
  slide.addText('VALIDATED PERFORMANCE', {
    x: 9.55,
    y: 1.05,
    w: 2.8,
    h: 0.22,
    fontSize: 9,
    bold: true,
    color: '93C5FD',
    align: 'center',
    margin: 0,
  });
  slide.addShape(SHAPES.ellipse, {
    x: 9.72,
    y: 1.45,
    w: 2.45,
    h: 2.45,
    fill: { color: TONE[tone].fg, transparency: 5 },
    line: { color: '60A5FA', pt: 1.5, transparency: 20 },
  });
  slide.addShape(SHAPES.ellipse, {
    x: 10.15,
    y: 1.88,
    w: 1.59,
    h: 1.59,
    fill: { color: COLORS.navy },
    line: { color: COLORS.navy, transparency: 100 },
  });
  slide.addText(score, {
    x: 10.24,
    y: 2.35,
    w: 1.42,
    h: 0.38,
    fontSize: 22,
    bold: true,
    color: COLORS.white,
    align: 'center',
    valign: 'mid',
    fit: 'shrink',
    margin: 0,
  });
  slide.addText(model.classification, {
    x: 9.68,
    y: 4.1,
    w: 2.55,
    h: 0.28,
    fontSize: 11,
    bold: true,
    color: COLORS.white,
    align: 'center',
    fit: 'shrink',
    margin: 0,
  });
  model.kpis.slice(0, 3).forEach((kpi, index) => {
    const value = numericValue(kpi.value);
    const rowY = 4.72 + index * 0.5;
    slide.addText(kpi.label, {
      x: 9.48,
      y: rowY,
      w: 0.95,
      h: 0.16,
      fontSize: 7.5,
      color: 'CBD5E1',
      margin: 0,
    });
    slide.addShape(SHAPES.rect, {
      x: 10.45,
      y: rowY + 0.02,
      w: 1.2,
      h: 0.1,
      fill: { color: '334155' },
      line: { color: '334155', transparency: 100 },
    });
    slide.addShape(SHAPES.rect, {
      x: 10.45,
      y: rowY + 0.02,
      w: 1.2 * clamp(value / 100, 0, 1),
      h: 0.1,
      fill: { color: TONE[kpi.status].fg },
      line: { color: TONE[kpi.status].fg, transparency: 100 },
    });
    slide.addText(kpi.value, {
      x: 11.72,
      y: rowY - 0.01,
      w: 0.62,
      h: 0.18,
      fontSize: 7.5,
      bold: true,
      color: COLORS.white,
      align: 'right',
      fit: 'shrink',
      margin: 0,
    });
  });
}

function addVisualBullet(
  slide: PptxSlide,
  text: string,
  index: number,
  x: number,
  y: number,
  w: number,
): void {
  slide.addShape(SHAPES.ellipse, {
    x,
    y: y + 0.05,
    w: 0.34,
    h: 0.34,
    fill: { color: 'DBEAFE' },
    line: { color: '93C5FD', pt: 0.8 },
  });
  slide.addText(String(index), {
    x,
    y: y + 0.05,
    w: 0.34,
    h: 0.34,
    fontSize: 8.5,
    bold: true,
    color: COLORS.blue,
    align: 'center',
    valign: 'mid',
    margin: 0,
  });
  slide.addText(text, {
    x: x + 0.52,
    y,
    w: w - 0.52,
    h: 0.48,
    fontSize: 11.2,
    color: COLORS.ink,
    fit: 'shrink',
    margin: 0.02,
    valign: 'mid',
  });
}

function addExecutiveSnapshotSlide(pptx: PptxInstance, model: ReportModel): void {
  const slide = addTitledSlide(pptx, 'Executive snapshot', model);
  slide.addNotes(`Full executive summary\n\n${model.executiveMessage}`);
  slide.addText(model.executiveHeadline, {
    x: 0.65,
    y: 1.15,
    w: 7.4,
    h: 0.62,
    fontSize: 21,
    bold: true,
    color: COLORS.ink,
    fit: 'shrink',
  });
  summaryBullets(model.executiveMessage).forEach((item, index) => {
    addVisualBullet(slide, item, index + 1, 0.68, 1.95 + index * 0.72, 7.25);
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

function addVisualAnalyticsSlide(pptx: PptxInstance, model: ReportModel): void {
  if (model.charts.length === 0) return;
  const slide = addTitledSlide(pptx, 'Visual analytics', model);
  const [primary, secondary, tertiary, quaternary] = model.charts;
  if (primary) addPptxChart(slide, primary, 0.65, 1.15, 5.95, 5.35);
  if (secondary) addPptxChart(slide, secondary, 6.9, 1.15, 5.75, 5.35);

  if (tertiary || quaternary) {
    const secondSlide = addTitledSlide(pptx, 'Distribution and risk signals', model);
    if (tertiary) addPptxChart(secondSlide, tertiary, 0.65, 1.15, 5.95, 5.35);
    if (quaternary) addPptxChart(secondSlide, quaternary, 6.9, 1.15, 5.75, 5.35);
  }
}

function addCoursePerformanceSlide(pptx: PptxInstance, model: ReportModel): void {
  const slide = addTitledSlide(pptx, 'Course performance', model);
  if (model.courseRows.length === 1 && model.courseRows[0]) {
    addSingleCourseProfile(slide, model.courseRows[0], model);
    return;
  }
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

function addSingleCourseProfile(
  slide: PptxSlide,
  course: ReportCourseRow,
  model: ReportModel,
): void {
  slide.addNotes(
    `Course performance profile\n\n${course.course}\nLearners: ${course.learners}\nAttendance: ${course.attendance}\nCompletion: ${course.completion}\nPass rate: ${course.passRate}\nAverage score: ${course.score}\nEffectiveness: ${course.effectiveness}`,
  );
  slide.addText('Course performance profile', {
    x: 0.68,
    y: 1.12,
    w: 3.2,
    h: 0.2,
    fontSize: 9,
    bold: true,
    color: COLORS.blue,
    margin: 0,
  });
  slide.addText(course.course, {
    x: 0.68,
    y: 1.42,
    w: 7.25,
    h: 0.55,
    fontSize: 21,
    bold: true,
    color: COLORS.ink,
    fit: 'shrink',
    margin: 0,
  });

  const rateMetrics = [
    { label: 'Attendance', value: course.attendance, target: 85 },
    { label: 'Completion', value: course.completion, target: 90 },
    { label: 'Pass rate', value: course.passRate, target: 80 },
  ];
  rateMetrics.forEach((metric, index) => {
    addCourseMetricBar(
      slide,
      metric.label,
      metric.value,
      metric.target,
      0.72,
      2.28 + index * 0.86,
      7.0,
    );
  });

  const effectiveness = numericValue(course.effectiveness);
  const effectivenessTone = effectiveness >= 85 ? 'good' : effectiveness >= 70 ? 'monitor' : 'risk';
  slide.addShape(SHAPES.roundRect, {
    x: 8.35,
    y: 1.28,
    w: 4.2,
    h: 3.95,
    rectRadius: 0.08,
    fill: { color: COLORS.white },
    line: { color: COLORS.border, pt: 1 },
  });
  slide.addText('EFFECTIVENESS', {
    x: 8.68,
    y: 1.62,
    w: 3.55,
    h: 0.2,
    fontSize: 9,
    bold: true,
    color: COLORS.muted,
    align: 'center',
    margin: 0,
  });
  slide.addShape(SHAPES.ellipse, {
    x: 9.35,
    y: 2.0,
    w: 2.2,
    h: 2.2,
    fill: { color: TONE[effectivenessTone].fg },
    line: { color: TONE[effectivenessTone].fg, transparency: 100 },
  });
  slide.addShape(SHAPES.ellipse, {
    x: 9.73,
    y: 2.38,
    w: 1.44,
    h: 1.44,
    fill: { color: COLORS.white },
    line: { color: COLORS.white, transparency: 100 },
  });
  slide.addText(course.effectiveness, {
    x: 9.73,
    y: 2.74,
    w: 1.44,
    h: 0.42,
    fontSize: 22,
    bold: true,
    color: TONE[effectivenessTone].fg,
    align: 'center',
    valign: 'mid',
    fit: 'shrink',
    margin: 0,
  });
  slide.addText('/ 100', {
    x: 9.87,
    y: 3.17,
    w: 1.15,
    h: 0.18,
    fontSize: 8,
    color: COLORS.muted,
    align: 'center',
    margin: 0,
  });
  addCompactStat(slide, 'Learners', course.learners, 8.72, 4.48, 1.55);
  addCompactStat(slide, 'Avg score', course.score, 10.52, 4.48, 1.55);

  slide.addText('What leaders should notice', {
    x: 0.68,
    y: 5.38,
    w: 3.4,
    h: 0.25,
    fontSize: 13,
    bold: true,
    color: COLORS.ink,
    margin: 0,
  });
  model.findings.slice(0, 3).forEach((finding, index) => {
    addMiniFinding(
      slide,
      short(finding.headline, 105),
      finding.severity,
      0.68 + index * 4.08,
      5.78,
    );
  });
}

function addCourseMetricBar(
  slide: PptxSlide,
  label: string,
  valueLabel: string,
  target: number,
  x: number,
  y: number,
  w: number,
): void {
  const value = numericValue(valueLabel);
  const tone = value >= target ? 'good' : value >= target - 10 ? 'monitor' : 'risk';
  const labelW = 1.22;
  const valueW = 0.72;
  const barX = x + labelW;
  const barW = w - labelW - valueW;
  slide.addText(label, {
    x,
    y,
    w: labelW - 0.12,
    h: 0.22,
    fontSize: 10,
    bold: true,
    color: COLORS.ink,
    margin: 0,
    valign: 'mid',
  });
  slide.addShape(SHAPES.roundRect, {
    x: barX,
    y: y + 0.03,
    w: barW,
    h: 0.18,
    rectRadius: 0.04,
    fill: { color: COLORS.slateBg },
    line: { color: COLORS.slateBg, transparency: 100 },
  });
  slide.addShape(SHAPES.roundRect, {
    x: barX,
    y: y + 0.03,
    w: Math.max(0.04, barW * clamp(value / 100, 0, 1)),
    h: 0.18,
    rectRadius: 0.04,
    fill: { color: TONE[tone].fg },
    line: { color: TONE[tone].fg, transparency: 100 },
  });
  const targetX = barX + barW * clamp(target / 100, 0, 1);
  slide.addShape(SHAPES.line, {
    x: targetX,
    y: y - 0.01,
    w: 0,
    h: 0.28,
    line: { color: COLORS.navy, pt: 0.8, transparency: 15 },
  });
  slide.addText(valueLabel, {
    x: barX + barW + 0.1,
    y,
    w: valueW - 0.1,
    h: 0.22,
    fontSize: 9,
    bold: true,
    color: TONE[tone].fg,
    align: 'right',
    margin: 0,
    valign: 'mid',
  });
  slide.addText(`Target ${target}%`, {
    x: barX,
    y: y + 0.32,
    w: barW,
    h: 0.15,
    fontSize: 7,
    color: COLORS.muted,
    align: 'right',
    margin: 0,
  });
}

function addCompactStat(
  slide: PptxSlide,
  label: string,
  value: string,
  x: number,
  y: number,
  w: number,
): void {
  slide.addText(label.toUpperCase(), {
    x,
    y,
    w,
    h: 0.14,
    fontSize: 7.5,
    bold: true,
    color: COLORS.muted,
    align: 'center',
    margin: 0,
  });
  slide.addText(value, {
    x,
    y: y + 0.2,
    w,
    h: 0.28,
    fontSize: 15,
    bold: true,
    color: COLORS.ink,
    align: 'center',
    fit: 'shrink',
    margin: 0,
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
      7.45,
    );
  });
  const primaryFlag = flags[0];
  const responseTone = primaryFlag?.priority === 'High' ? 'risk' : primaryFlag ? 'monitor' : 'good';
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.42,
    y: 3.05,
    w: 4.12,
    h: 2.15,
    rectRadius: 0.08,
    fill: { color: TONE[responseTone].bg },
    line: { color: TONE[responseTone].fg, pt: 1, transparency: 35 },
  });
  slide.addText('GOVERNANCE RESPONSE', {
    x: 8.7,
    y: 3.34,
    w: 3.5,
    h: 0.2,
    fontSize: 8.5,
    bold: true,
    color: TONE[responseTone].fg,
    margin: 0,
  });
  slide.addText(
    primaryFlag?.action ?? 'Continue standard monitoring and preserve the validated audit trail.',
    {
      x: 8.7,
      y: 3.82,
      w: 3.52,
      h: 0.72,
      fontSize: 12,
      bold: true,
      color: COLORS.ink,
      fit: 'shrink',
      margin: 0,
      valign: 'mid',
    },
  );
  slide.addText(
    primaryFlag ? `Triggered by ${primaryFlag.rule}` : 'No active NORM rule requires escalation.',
    {
      x: 8.7,
      y: 4.68,
      w: 3.52,
      h: 0.25,
      fontSize: 8.5,
      color: COLORS.muted,
      margin: 0,
    },
  );
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
  if (steps.length === 0) return;
  slide.addNotes(
    `Recommended delivery sequence\n\n${steps
      .map(
        (rec, index) =>
          `${index + 1}. ${rec.action}\nOwner: ${rec.owner}\nOutcome: ${rec.expectedOutcome}`,
      )
      .join('\n\n')}`,
  );
  const gap = 0.32;
  const cardW = (11.85 - gap * (steps.length - 1)) / steps.length;
  const lineStart = 0.75 + cardW / 2;
  const lineEnd = 0.75 + (steps.length - 1) * (cardW + gap) + cardW / 2;
  slide.addShape(pptx.ShapeType.line, {
    x: lineStart,
    y: 1.63,
    w: Math.max(0, lineEnd - lineStart),
    h: 0,
    line: { color: '93C5FD', pt: 2 },
  });
  steps.forEach((rec, index) => {
    const x = 0.75 + index * (cardW + gap);
    const centerX = x + cardW / 2;
    const tone = rec.priority === 'High' ? 'risk' : rec.priority === 'Medium' ? 'monitor' : 'good';
    slide.addShape(SHAPES.ellipse, {
      x: centerX - 0.28,
      y: 1.35,
      w: 0.56,
      h: 0.56,
      fill: { color: TONE[tone].fg },
      line: { color: COLORS.white, pt: 2 },
    });
    slide.addText(String(index + 1), {
      x: centerX - 0.28,
      y: 1.35,
      w: 0.56,
      h: 0.56,
      fontSize: 11,
      bold: true,
      color: COLORS.white,
      align: 'center',
      valign: 'mid',
      margin: 0,
    });
    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y: 2.12,
      w: cardW,
      h: 3.68,
      rectRadius: 0.08,
      fill: { color: COLORS.white },
      line: { color: COLORS.border, pt: 1 },
    });
    slide.addText(`ACTION ${index + 1}`, {
      x: x + 0.2,
      y: 2.42,
      w: cardW - 1.25,
      h: 0.18,
      fontSize: 8,
      bold: true,
      color: COLORS.muted,
      margin: 0,
    });
    addBadge(slide, rec.priority, x + cardW - 1.05, 2.35, tone, 0.82);
    slide.addText(rec.owner, {
      x: x + 0.2,
      y: 2.88,
      w: cardW - 0.4,
      h: 0.24,
      fontSize: 11,
      bold: true,
      color: COLORS.ink,
      fit: 'shrink',
      margin: 0,
    });
    slide.addText(rec.action, {
      x: x + 0.2,
      y: 3.32,
      w: cardW - 0.4,
      h: 1.02,
      fontSize: 10.5,
      color: COLORS.ink,
      fit: 'shrink',
      valign: 'top',
      margin: 0,
    });
    slide.addText('Expected outcome', {
      x: x + 0.2,
      y: 4.58,
      w: cardW - 0.4,
      h: 0.18,
      fontSize: 8,
      bold: true,
      color: COLORS.muted,
      margin: 0,
    });
    slide.addText(rec.expectedOutcome, {
      x: x + 0.2,
      y: 4.86,
      w: cardW - 0.4,
      h: 0.82,
      fontSize: 9.2,
      color: COLORS.muted,
      fit: 'shrink',
      margin: 0,
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

function addPptxChart(
  slide: PptxSlide,
  chart: ReportChart,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  slide.addShape(SHAPES.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: { color: COLORS.white },
    line: { color: COLORS.border, pt: 1 },
  });
  slide.addText(chart.title, {
    x: x + 0.22,
    y: y + 0.2,
    w: w - 0.44,
    h: 0.24,
    fontSize: 12.5,
    bold: true,
    color: COLORS.ink,
    fit: 'shrink',
  });
  slide.addText(chart.subtitle, {
    x: x + 0.22,
    y: y + 0.52,
    w: w - 0.44,
    h: 0.22,
    fontSize: 7.8,
    color: COLORS.muted,
    fit: 'shrink',
  });

  if (chart.kind === 'donut') {
    addPptxDonutChart(slide, chart, x + 0.25, y + 0.9, w - 0.5, h - 1.15);
    return;
  }
  if (chart.kind === 'groupedBar') {
    addPptxGroupedBarChart(slide, chart, x + 0.25, y + 0.95, w - 0.5, h - 1.2);
    return;
  }
  addPptxHorizontalBarChart(slide, chart, x + 0.22, y + 0.95, w - 0.44, h - 1.2);
}

function addPptxHorizontalBarChart(
  slide: PptxSlide,
  chart: ReportChart,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const points = chart.points.slice(0, 7);
  const rowH = Math.max(0.26, h / Math.max(points.length, 1));
  const labelW = Math.min(1.75, w * 0.34);
  const barX = x + labelW;
  const valueW = 0.82;
  const barW = w - labelW - valueW - 0.1;
  const max = Math.max(chart.maxValue, ...points.map((point) => point.value), 1);

  points.forEach((point, index) => {
    const rowY = y + index * rowH;
    const barY = rowY + Math.min(0.16, rowH * 0.2);
    const barH = Math.max(0.08, Math.min(0.22, rowH * 0.34));
    const pct = clamp(point.value / max, 0, 1);
    slide.addText(short(point.label, 24), {
      x,
      y: rowY,
      w: labelW - 0.1,
      h: 0.18,
      fontSize: 7.8,
      color: COLORS.ink,
      fit: 'shrink',
    });
    slide.addShape(SHAPES.rect, {
      x: barX,
      y: barY,
      w: barW,
      h: barH,
      fill: { color: COLORS.slateBg },
      line: { color: COLORS.slateBg, transparency: 100 },
    });
    slide.addShape(SHAPES.rect, {
      x: barX,
      y: barY,
      w: Math.max(0.03, barW * pct),
      h: barH,
      fill: { color: TONE[point.tone].fg },
      line: { color: TONE[point.tone].fg, transparency: 100 },
    });
    if (point.target !== undefined) {
      const targetX = barX + barW * clamp(point.target / max, 0, 1);
      slide.addShape(SHAPES.line, {
        x: targetX,
        y: barY - 0.05,
        w: 0,
        h: barH + 0.1,
        line: { color: COLORS.navy, pt: 0.8, transparency: 20 },
      });
    }
    slide.addText(point.valueLabel, {
      x: barX + barW + 0.08,
      y: rowY - 0.01,
      w: valueW,
      h: 0.2,
      fontSize: 7,
      bold: true,
      color: COLORS.ink,
      fit: 'shrink',
      margin: 0,
      valign: 'mid',
    });
  });
}

function addPptxGroupedBarChart(
  slide: PptxSlide,
  chart: ReportChart,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const points = chart.points.filter((point) => point.series?.length).slice(0, 5);
  const seriesLabels = points[0]?.series?.map((series) => series.label) ?? [];
  const legendY = y;
  seriesLabels.forEach((label, index) => {
    const tone = points[0]?.series?.[index]?.tone ?? 'neutral';
    slide.addShape(SHAPES.rect, {
      x: x + index * 1.26,
      y: legendY,
      w: 0.1,
      h: 0.1,
      fill: { color: TONE[tone].fg },
      line: { color: TONE[tone].fg, transparency: 100 },
    });
    slide.addText(label, {
      x: x + 0.15 + index * 1.26,
      y: legendY - 0.02,
      w: 1.04,
      h: 0.13,
      fontSize: 6.8,
      color: COLORS.muted,
      fit: 'shrink',
    });
  });

  const plotX = x + 0.22;
  const plotY = y + 0.38;
  const plotW = w - 0.44;
  const plotH = h - 0.78;
  const max = Math.max(100, chart.maxValue);
  const groupW = plotW / Math.max(points.length, 1);
  const baseline = plotY + plotH;

  [0, 0.5, 1].forEach((tick) => {
    const gridY = baseline - plotH * tick;
    slide.addShape(SHAPES.line, {
      x: plotX,
      y: gridY,
      w: plotW,
      h: 0,
      line: { color: COLORS.slateBg, pt: 0.5, transparency: 25 },
    });
  });

  points.forEach((point, pointIndex) => {
    const series = point.series ?? [];
    const barW = Math.min(0.13, (groupW * 0.56) / Math.max(series.length, 1));
    const startX =
      plotX +
      pointIndex * groupW +
      groupW / 2 -
      (barW * series.length + 0.04 * (series.length - 1)) / 2;
    series.forEach((item, seriesIndex) => {
      const valueH = plotH * clamp(item.value / max, 0, 1);
      const barX = startX + seriesIndex * (barW + 0.04);
      slide.addShape(SHAPES.rect, {
        x: barX,
        y: baseline - valueH,
        w: barW,
        h: Math.max(0.03, valueH),
        fill: { color: TONE[item.tone].fg },
        line: { color: TONE[item.tone].fg, transparency: 100 },
      });
    });
    slide.addText(short(point.label, 14), {
      x: plotX + pointIndex * groupW + 0.02,
      y: baseline + 0.1,
      w: groupW - 0.04,
      h: 0.2,
      fontSize: 6.5,
      color: COLORS.ink,
      align: 'center',
      fit: 'shrink',
    });
  });
}

function addPptxDonutChart(
  slide: PptxSlide,
  chart: ReportChart,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const points = chart.points.filter((point) => point.value > 0).slice(0, 6);
  if (points.length === 0) return;
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const chartW = w * 0.58;
  slide.addChart(
    'doughnut',
    [{ name: chart.title, labels: points.map((p) => p.label), values: points.map((p) => p.value) }],
    {
      x,
      y: y + 0.05,
      w: chartW,
      h: h - 0.1,
      holeSize: 68,
      showLegend: false,
      showTitle: false,
      showValue: false,
      showPercent: false,
      showCategoryName: false,
      showBorder: false,
      chartColors: points.map((point) => TONE[point.tone].fg),
    },
  );
  slide.addText(String(total), {
    x: x + chartW * 0.29,
    y: y + h * 0.39,
    w: chartW * 0.42,
    h: 0.38,
    fontSize: 22,
    bold: true,
    color: COLORS.ink,
    align: 'center',
    valign: 'mid',
    margin: 0,
  });
  slide.addText('total flags', {
    x: x + chartW * 0.25,
    y: y + h * 0.52,
    w: chartW * 0.5,
    h: 0.2,
    fontSize: 8,
    color: COLORS.muted,
    align: 'center',
    margin: 0,
  });
  points.forEach((point, index) => {
    const rowY = y + 0.42 + index * 0.54;
    const percentage = total > 0 ? Math.round((point.value / total) * 100) : 0;
    slide.addShape(SHAPES.rect, {
      x: x + chartW + 0.18,
      y: rowY + 0.03,
      w: 0.12,
      h: 0.12,
      fill: { color: TONE[point.tone].fg },
      line: { color: TONE[point.tone].fg, transparency: 100 },
    });
    slide.addText(point.label, {
      x: x + chartW + 0.38,
      y: rowY,
      w: w - chartW - 1.12,
      h: 0.2,
      fontSize: 9,
      bold: true,
      color: COLORS.ink,
      margin: 0,
      valign: 'mid',
    });
    slide.addText(`${point.valueLabel} (${percentage}%)`, {
      x: x + w - 0.76,
      y: rowY,
      w: 0.72,
      h: 0.2,
      fontSize: 8,
      color: COLORS.muted,
      align: 'right',
      margin: 0,
      valign: 'mid',
    });
  });
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
    h: 0.94,
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
    y: y + 0.13,
    w: 4.2,
    h: 0.56,
    fontSize: 9.3,
    color: COLORS.ink,
    fit: 'shrink',
  });
  slide.addText(outcome, {
    x: 8.6,
    y: y + 0.13,
    w: 3.6,
    h: 0.56,
    fontSize: 9,
    color: COLORS.muted,
    fit: 'shrink',
    valign: 'mid',
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
    y,
    w: w - 0.08,
    h: 0.28,
    fontSize: 7.4,
    bold: true,
    color: TONE[tone].fg,
    align: 'center',
    fit: 'shrink',
    margin: 0.01,
    valign: 'mid',
  });
}

function renderChartSvg(chart: ReportChart, width: number, height: number): string {
  if (chart.kind === 'donut') return renderDonutChartSvg(chart, width, height);
  if (chart.kind === 'groupedBar') return renderGroupedBarChartSvg(chart, width, height);
  return renderHorizontalBarChartSvg(chart, width, height);
}

function renderHorizontalBarChartSvg(chart: ReportChart, width: number, height: number): string {
  const points = chart.points.slice(0, 8);
  const max = Math.max(chart.maxValue, ...points.map((point) => point.value), 1);
  const margin = { top: 72, right: 90, bottom: 34, left: 205 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const rowH = plotH / Math.max(points.length, 1);
  const barH = Math.min(24, Math.max(12, rowH * 0.38));
  const axisY = height - margin.bottom + 4;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((tick) => {
      const x = margin.left + plotW * tick;
      const label =
        chart.unit === 'count'
          ? String(Math.round(max * tick))
          : chart.unit === 'score100'
            ? `${Math.round(max * tick)}`
            : `${Math.round(max * tick)}%`;
      return `<line x1="${x}" y1="${margin.top - 8}" x2="${x}" y2="${axisY - 12}" stroke="#E2E8F0" stroke-width="1"/><text x="${x}" y="${axisY}" text-anchor="middle" font-size="12" fill="#64748B">${label}</text>`;
    })
    .join('');

  const bars = points
    .map((point, index) => {
      const y = margin.top + index * rowH + rowH / 2 - barH / 2;
      const pct = clamp(point.value / max, 0, 1);
      const barW = Math.max(3, plotW * pct);
      const target =
        point.target === undefined
          ? ''
          : `<line x1="${margin.left + plotW * clamp(point.target / max, 0, 1)}" y1="${y - 6}" x2="${margin.left + plotW * clamp(point.target / max, 0, 1)}" y2="${y + barH + 6}" stroke="#0B1220" stroke-width="2" stroke-dasharray="4 3"><title>Target ${xmlEscape(point.targetLabel ?? '')}</title></line>`;
      return `<text x="${margin.left - 14}" y="${y + barH * 0.68}" text-anchor="end" font-size="13" font-weight="600" fill="#0F172A">${xmlEscape(short(point.label, 34))}</text><rect x="${margin.left}" y="${y}" width="${plotW}" height="${barH}" rx="7" fill="#E2E8F0"/><rect x="${margin.left}" y="${y}" width="${barW}" height="${barH}" rx="7" fill="#${TONE[point.tone].fg}"/><text x="${margin.left + plotW + 14}" y="${y + barH * 0.68}" font-size="13" font-weight="700" fill="#0F172A">${xmlEscape(point.valueLabel)}</text>${target}`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xmlEscape(chart.title)}"><rect width="${width}" height="${height}" rx="18" fill="#FFFFFF"/><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="18" fill="none" stroke="#CBD5E1"/><text x="28" y="34" font-family="Aptos, Arial, sans-serif" font-size="21" font-weight="700" fill="#0F172A">${xmlEscape(chart.title)}</text><text x="28" y="58" font-family="Aptos, Arial, sans-serif" font-size="13" fill="#64748B">${xmlEscape(chart.subtitle)}</text><g font-family="Aptos, Arial, sans-serif">${grid}${bars}</g></svg>`;
}

function renderGroupedBarChartSvg(chart: ReportChart, width: number, height: number): string {
  const points = chart.points.filter((point) => point.series?.length).slice(0, 6);
  const seriesLabels = points[0]?.series?.map((series) => series.label) ?? [];
  const max = Math.max(
    100,
    chart.maxValue,
    ...points.flatMap((point) => point.series ?? []).map((series) => series.value),
  );
  const margin = { top: 92, right: 34, bottom: 72, left: 56 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const baseline = margin.top + plotH;
  const groupW = plotW / Math.max(points.length, 1);
  const legend = seriesLabels
    .map((label, index) => {
      const tone = points[0]?.series?.[index]?.tone ?? 'neutral';
      const x = margin.left + index * 150;
      return `<rect x="${x}" y="68" width="13" height="13" rx="3" fill="#${TONE[tone].fg}"/><text x="${x + 20}" y="79" font-size="12" fill="#64748B">${xmlEscape(label)}</text>`;
    })
    .join('');
  const grid = [0, 0.5, 1]
    .map((tick) => {
      const y = baseline - plotH * tick;
      const label = `${Math.round(max * tick)}%`;
      return `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#E2E8F0" stroke-width="1"/><text x="${margin.left - 12}" y="${y + 4}" text-anchor="end" font-size="11" fill="#64748B">${label}</text>`;
    })
    .join('');
  const bars = points
    .map((point, pointIndex) => {
      const series = point.series ?? [];
      const barW = Math.min(18, (groupW * 0.58) / Math.max(series.length, 1));
      const startX =
        margin.left +
        pointIndex * groupW +
        groupW / 2 -
        (barW * series.length + 6 * (series.length - 1)) / 2;
      const seriesBars = series
        .map((item, seriesIndex) => {
          const valueH = plotH * clamp(item.value / max, 0, 1);
          const x = startX + seriesIndex * (barW + 6);
          const y = baseline - valueH;
          return `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(2, valueH)}" rx="5" fill="#${TONE[item.tone].fg}"><title>${xmlEscape(item.label)} ${xmlEscape(item.valueLabel)}</title></rect>`;
        })
        .join('');
      return `${seriesBars}<text x="${margin.left + pointIndex * groupW + groupW / 2}" y="${baseline + 24}" text-anchor="middle" font-size="11" font-weight="600" fill="#0F172A">${xmlEscape(short(point.label, 18))}</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xmlEscape(chart.title)}"><rect width="${width}" height="${height}" rx="18" fill="#FFFFFF"/><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="18" fill="none" stroke="#CBD5E1"/><text x="28" y="34" font-family="Aptos, Arial, sans-serif" font-size="21" font-weight="700" fill="#0F172A">${xmlEscape(chart.title)}</text><text x="28" y="58" font-family="Aptos, Arial, sans-serif" font-size="13" fill="#64748B">${xmlEscape(chart.subtitle)}</text><g font-family="Aptos, Arial, sans-serif">${legend}${grid}${bars}</g></svg>`;
}

function renderDonutChartSvg(chart: ReportChart, width: number, height: number): string {
  const points = chart.points.filter((point) => point.value > 0).slice(0, 6);
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const cx = Math.round(width * 0.36);
  const cy = Math.round(height * 0.56);
  const radius = Math.min(width, height) * 0.28;
  const stroke = radius * 0.34;
  let offset = 0;
  const circumference = 2 * Math.PI * radius;
  const arcs = points
    .map((point) => {
      const length = total > 0 ? (point.value / total) * circumference : 0;
      const dash = `${length} ${circumference - length}`;
      const circle = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#${TONE[point.tone].fg}" stroke-width="${stroke}" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"><title>${xmlEscape(point.label)} ${xmlEscape(point.valueLabel)}</title></circle>`;
      offset += length;
      return circle;
    })
    .join('');
  const legend = points
    .map((point, index) => {
      const y = Math.round(height * 0.33) + index * 34;
      const pct = total > 0 ? Math.round((point.value / total) * 100) : 0;
      return `<rect x="${Math.round(width * 0.66)}" y="${y - 12}" width="14" height="14" rx="3" fill="#${TONE[point.tone].fg}"/><text x="${Math.round(width * 0.66) + 24}" y="${y}" font-size="13" font-weight="600" fill="#0F172A">${xmlEscape(point.label)}</text><text x="${width - 36}" y="${y}" text-anchor="end" font-size="13" fill="#64748B">${xmlEscape(point.valueLabel)} (${pct}%)</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xmlEscape(chart.title)}"><rect width="${width}" height="${height}" rx="18" fill="#FFFFFF"/><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="18" fill="none" stroke="#CBD5E1"/><text x="28" y="34" font-family="Aptos, Arial, sans-serif" font-size="21" font-weight="700" fill="#0F172A">${xmlEscape(chart.title)}</text><text x="28" y="58" font-family="Aptos, Arial, sans-serif" font-size="13" fill="#64748B">${xmlEscape(chart.subtitle)}</text><g font-family="Aptos, Arial, sans-serif"><circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#E2E8F0" stroke-width="${stroke}"/>${arcs}<circle cx="${cx}" cy="${cy}" r="${radius - stroke / 2 - 4}" fill="#FFFFFF"/><text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="28" font-weight="700" fill="#0F172A">${total}</text><text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="12" fill="#64748B">total flags</text>${legend}</g></svg>`;
}

function chartHeight(chart: ReportChart, minHeight: number): number {
  if (chart.kind === 'donut') return 360;
  if (chart.kind === 'groupedBar') return Math.max(340, 150 + chart.points.length * 34);
  return Math.max(minHeight, 128 + chart.points.length * 42);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function numericValue(value: string): number {
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function summaryBullets(value: string): string[] {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return ['No executive narrative was available for this report.'];
  const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  const candidates = sentences.length > 1 ? sentences : chunkText(normalized, 145);
  return candidates.slice(0, 3).map((item) => short(item, 180));
}

function chunkText(value: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const word of value.split(' ')) {
    if (current && current.length + word.length + 1 > maxLength) {
      chunks.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
