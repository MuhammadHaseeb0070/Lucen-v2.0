import { v4 as uuidv4 } from 'uuid';
import type { WorkspaceDiagnostic, WorkspaceRuntimeLog } from '../types/workspace';

export type WorkspaceConsoleData = Array<{
  data: Array<string | Record<string, string>> | undefined;
  id: string;
  method: string;
}>;

export function createWorkspaceDiagnostic(input: Omit<WorkspaceDiagnostic, 'id'>): WorkspaceDiagnostic {
  return { id: uuidv4(), ...input };
}

export function diagnosticFromSandpackError(error: { title?: string; message: string; path?: string; line?: number; column?: number } | null): WorkspaceDiagnostic[] {
  if (!error) return [];

  return [
    createWorkspaceDiagnostic({
      source: 'runtime',
      severity: 'error',
      title: error.title || 'Preview runtime error',
      message: error.message,
      path: error.path?.replace(/^\//, ''),
      line: error.line,
      column: error.column,
      raw: [error.title, error.message].filter(Boolean).join('\n'),
    }),
  ];
}

export function diagnosticsFromRuntimeLogs(logs: WorkspaceRuntimeLog[]): WorkspaceDiagnostic[] {
  return logs
    .filter((log) => log.level === 'error' || log.level === 'warning')
    .slice(-25)
    .map((log) => createWorkspaceDiagnostic({
      source: 'runtime',
      severity: log.level === 'warning' ? 'warning' : 'error',
      title: log.level === 'warning' ? 'Runtime warning' : 'Runtime error',
      message: log.message,
      raw: log.message,
    }));
}

export function runtimeLogsFromConsole(consoleData: WorkspaceConsoleData | undefined): WorkspaceRuntimeLog[] {
  if (!consoleData) return [];

  return consoleData
    .filter((entry) => entry.method !== 'clear')
    .map((entry) => ({
      id: entry.id,
      level: entry.method === 'warn' ? 'warning' : entry.method === 'error' || entry.method === 'assert' ? 'error' : 'info',
      message: (entry.data || [])
        .map((part) => typeof part === 'string' ? part : JSON.stringify(part))
        .join(' '),
      source: 'console',
      timestamp: Date.now(),
    }));
}
