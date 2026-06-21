import { type NavManifest, noNavExtensions } from '@seta/module-sdk';
import { BarChart3 } from 'lucide-react';

export const ldReportingNavManifest: NavManifest = {
  id: 'ld-reporting',
  label: 'L&D Reporting',
  icon: BarChart3,
  requiredPermissions: ['ld-reporting.read'],
  useNavExtensions: noNavExtensions,
  nav: [
    {
      label: 'Training Effectiveness',
      items: [
        {
          id: 'ld-reporting.dashboard',
          icon: BarChart3,
          label: 'Reporting Agent',
          to: '/ld-reporting',
        },
      ],
    },
  ],
};
