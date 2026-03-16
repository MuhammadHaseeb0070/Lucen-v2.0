import type { ReactProject } from '../types/workspace';
import { exportProjectToZip } from './projectImport';

export async function downloadProjectArchive(project: ReactProject): Promise<void> {
  const blob = await exportProjectToZip(project);
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${project.name.replace(/[^a-z0-9_-]+/gi, '_') || 'react-workspace'}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(anchor.href);
}
