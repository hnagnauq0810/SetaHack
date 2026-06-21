import { createFileRoute } from '@tanstack/react-router';
import { LdReportingPage } from '@/modules/ld-reporting/page';

export const Route = createFileRoute('/_authed/ld-reporting/')({ component: LdReportingPage });
