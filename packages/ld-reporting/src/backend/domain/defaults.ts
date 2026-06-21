import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function defaultMockWorkbookPath(): string {
  return resolve(__dirname, '../../../mock-data/LnD_07_Training_Effectiveness.xlsx');
}

export function defaultStorageDir(): string {
  return process.env.LD_REPORTING_STORAGE_DIR ?? resolve(process.cwd(), '.data/ld-reporting');
}
