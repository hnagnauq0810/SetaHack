import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContributionRegistry } from '@seta/core';
import { ldReportingAgentTools } from './backend/agent-tools/index.ts';
import * as schema from './backend/db/schema.ts';
import { buildLdReportingRoutes } from './backend/http/index.ts';
import { ldReportingRbac } from './rbac.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export function registerLdReportingContributions(reg: ContributionRegistry): void {
  reg.module({
    name: 'ld-reporting',
    schema,
    migrationsDir: resolve(__dirname, '../drizzle'),
    rbac: ldReportingRbac,
    agentTools: ldReportingAgentTools,
    agentSpecs: [
      {
        id: 'ld-reporting-specialist',
        defaultTier: 'fast',
        instructions:
          'You are the L&D Reporting Specialist Agent. Use rule-first intent detection. Only generate conclusions from validated metrics and evidence decisions. If evidence is BLOCKED, produce readiness/preliminary output and ask for missing evidence instead of claiming final effectiveness. Apply RBAC for BOD, L&D Manager, and Team Manager views.',
        tools: ['ld_checkReadiness', 'ld_generateReport', 'ld_answerQuestion', 'ld_finalizeReport'],
        rbac: [
          'ld-reporting.readiness.run',
          'ld-reporting.report.generate',
          'ld-reporting.qna.ask',
          'ld-reporting.report.finalize',
        ],
      },
    ],
    routes: { mountAt: '/', build: buildLdReportingRoutes },
    subscriberBuilders: [],
  });
}
