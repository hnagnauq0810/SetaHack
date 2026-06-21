import type {
  GovernanceView,
  LdRole,
  MissingEvidenceItem,
  NormFlag,
  ReportJson,
  TraineeHighlight,
} from '../../models.ts';
import { maskEmployeeId } from './utils.ts';

export interface LdReportAccessContext {
  role: LdRole;
}

export function applyReportAccessView(
  report: ReportJson,
  access: LdReportAccessContext,
): ReportJson {
  const view = cloneReport(report);
  const masked = access.role !== 'LND_MANAGER';
  const idMap = collectEmployeeIdMaskMap(view);
  view.governance = maskGovernance(view.governance, access.role, masked, idMap);
  view.evidence = {
    ...view.evidence,
    missingEvidence: view.evidence.missingEvidence.map((item) =>
      maskMissingEvidence(item, masked, idMap),
    ),
  };
  if (masked) {
    view.executiveSummary = maskKnownIds(view.executiveSummary, idMap);
    view.insights = view.insights.map((item) => maskKnownIds(item, idMap));
    view.recommendations = view.recommendations.map((item) => maskKnownIds(item, idMap));
    view.warnings = view.warnings.map((item) => maskKnownIds(item, idMap));
  }

  // File-system paths are internal implementation detail. Downloads are rendered
  // dynamically from this access view so the caller never receives raw artifact paths.
  delete view.artifacts;
  return view;
}

function cloneReport(report: ReportJson): ReportJson {
  return JSON.parse(JSON.stringify(report)) as ReportJson;
}

function maskGovernance(
  governance: GovernanceView,
  role: LdRole,
  masked: boolean,
  idMap: ReadonlyMap<string, string>,
): GovernanceView {
  return {
    ...governance,
    role,
    masked,
    normFlags: governance.normFlags.map((flag) => maskFlag(flag, masked, idMap)),
    outstandingTrainees: governance.outstandingTrainees.map((item) =>
      maskHighlight(item, masked, idMap),
    ),
    supportNeededTrainees: governance.supportNeededTrainees.map((item) =>
      maskHighlight(item, masked, idMap),
    ),
  };
}

function maskHighlight(
  item: TraineeHighlight,
  masked: boolean,
  idMap: ReadonlyMap<string, string>,
): TraineeHighlight {
  if (!masked) return item;
  return {
    ...item,
    employeeId: idMap.get(item.employeeId) ?? maskEmployeeId(item.employeeId),
    reason: maskKnownIds(item.reason, idMap),
  };
}

function maskFlag(flag: NormFlag, masked: boolean, idMap: ReadonlyMap<string, string>): NormFlag {
  if (!masked) return flag;
  const employeeId = flag.employeeId
    ? (idMap.get(flag.employeeId) ?? maskEmployeeId(flag.employeeId))
    : undefined;
  return {
    ...flag,
    ...(employeeId ? { employeeId } : {}),
    message: maskKnownIds(flag.message, idMap),
    action: maskKnownIds(flag.action, idMap),
  };
}

function maskMissingEvidence(
  item: MissingEvidenceItem,
  masked: boolean,
  idMap: ReadonlyMap<string, string>,
): MissingEvidenceItem {
  if (!masked) return item;
  const employeeId = item.employeeId
    ? (idMap.get(item.employeeId) ?? maskEmployeeId(item.employeeId))
    : undefined;
  return {
    ...item,
    ...(employeeId ? { employeeId } : {}),
    message: maskKnownIds(item.message, idMap),
    actual: typeof item.actual === 'string' ? maskKnownIds(item.actual, idMap) : item.actual,
  };
}

function collectEmployeeIdMaskMap(report: ReportJson): Map<string, string> {
  const ids = new Set<string>();
  for (const flag of report.governance.normFlags) if (flag.employeeId) ids.add(flag.employeeId);
  for (const item of report.governance.outstandingTrainees) ids.add(item.employeeId);
  for (const item of report.governance.supportNeededTrainees) ids.add(item.employeeId);
  for (const item of report.evidence.missingEvidence) if (item.employeeId) ids.add(item.employeeId);
  return new Map([...ids].map((employeeId) => [employeeId, maskEmployeeId(employeeId)]));
}

function maskKnownIds(value: string, idMap: ReadonlyMap<string, string>): string {
  let out = value;
  for (const [raw, masked] of idMap) {
    out = out.split(raw).join(masked);
  }
  return out;
}
