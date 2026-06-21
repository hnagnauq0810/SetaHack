import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_authed/ld-reporting')({ component: LdReportingShell });

function LdReportingShell() {
  return <Outlet />;
}
