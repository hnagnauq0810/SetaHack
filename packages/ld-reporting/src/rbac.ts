import { type Statement, toManifest } from '@seta/shared-rbac';

export const ldReportingStatement = {
  'ld-reporting': ['read'],
  'ld-reporting.readiness': ['read', 'run'],
  'ld-reporting.report': ['read', 'generate', 'finalize'],
  'ld-reporting.qna': ['ask'],
  'ld-reporting.sensitive': ['read'],
} as const satisfies Statement;

const roleStatements = {
  'ld-reporting.bod': {
    'ld-reporting': ['read'],
    'ld-reporting.readiness': ['read'],
    'ld-reporting.report': ['read'],
    'ld-reporting.qna': ['ask'],
  },
  'ld-reporting.manager': {
    'ld-reporting': ['read'],
    'ld-reporting.readiness': ['read', 'run'],
    'ld-reporting.report': ['read', 'generate', 'finalize'],
    'ld-reporting.qna': ['ask'],
    'ld-reporting.sensitive': ['read'],
  },
  'ld-reporting.team_manager': {
    'ld-reporting': ['read'],
    'ld-reporting.readiness': ['read'],
    'ld-reporting.report': ['read'],
    'ld-reporting.qna': ['ask'],
  },
  'ld-reporting.trainer': {
    'ld-reporting': ['read'],
    'ld-reporting.readiness': ['read'],
    'ld-reporting.report': ['read'],
    'ld-reporting.qna': ['ask'],
  },
  'ld-reporting.trainee': {},
} as const satisfies Record<string, Statement>;

export const ldReportingRbac = toManifest('ld-reporting', ldReportingStatement, roleStatements, {
  'ld-reporting.bod': 'Read executive-level L&D summaries with sensitive learner data masked',
  'ld-reporting.manager':
    'Run, review, and finalize L&D reporting workflows with learner-level access',
  'ld-reporting.team_manager': 'Read team/aggregate L&D views with learner-level masking',
  'ld-reporting.trainer': 'Read masked L&D report views scoped to courses taught by the trainer',
  'ld-reporting.trainee': 'No access to L&D reporting dashboards or report artifacts',
});

export type LdReportingPermission = (typeof ldReportingRbac.permissions)[number]['key'];

export const LD_REPORTING_PERMISSIONS = ldReportingRbac.permissions.map((p) => p.key);

export const LD_REPORTING_ROLE_SLUGS = ldReportingRbac.roles.map((r) => r.slug) as Array<
  | 'ld-reporting.bod'
  | 'ld-reporting.manager'
  | 'ld-reporting.team_manager'
  | 'ld-reporting.trainer'
  | 'ld-reporting.trainee'
>;
export type LdReportingRoleSlug = (typeof LD_REPORTING_ROLE_SLUGS)[number];

export const LD_REPORTING_ROLE_PERMISSIONS = Object.fromEntries(
  ldReportingRbac.roles.map((r) => [r.slug, r.permissions]),
) as Record<LdReportingRoleSlug, string[]>;
