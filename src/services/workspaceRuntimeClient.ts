import type { SandpackFiles, SandpackOptions, SandpackSetup } from '@codesandbox/sandpack-react';
import { v4 as uuidv4 } from 'uuid';
import type { ReactProject, WorkspaceRuntimeLog } from '../types/workspace';

export interface WorkspaceRuntimeConfig {
  template: Exclude<ReactProject['template'], 'custom'>;
  files: SandpackFiles;
  customSetup: SandpackSetup;
  options: SandpackOptions;
  activeFile: string;
  visibleFiles: string[];
  warnings: string[];
}

function normalizeRuntimeTemplate(template: ReactProject['template']): Exclude<ReactProject['template'], 'custom'> {
  return template === 'custom' ? 'vite-react-ts' : template;
}

function toSandpackPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function parsePackageJson(project: ReactProject): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  const packageJsonPath = project.packageJsonPath;
  if (!packageJsonPath) {
    return {
      dependencies: {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        'lucide-react': '^0.575.0',
        recharts: '^3.8.0',
      },
      devDependencies: {},
    };
  }

  try {
    const parsed = JSON.parse(project.files[packageJsonPath]?.content || '{}') as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    return {
      dependencies: {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        'lucide-react': '^0.575.0',
        recharts: '^3.8.0',
        ...(parsed.dependencies || {}),
      },
      devDependencies: {
        ...(parsed.devDependencies || {}),
      },
    };
  } catch {
    return {
      dependencies: {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        'lucide-react': '^0.575.0',
        recharts: '^3.8.0',
      },
      devDependencies: {},
    };
  }
}

function buildVisibleFiles(project: ReactProject): string[] {
  return Object.values(project.files)
    .filter((file) => file.runtimeSupported && !file.isBinary)
    .filter((file) => !file.path.endsWith('package.json'))
    .filter((file) => !file.path.endsWith('tsconfig.json'))
    .map((file) => toSandpackPath(file.path))
    .filter((path) => path.includes('/src/') || path.endsWith('/vite.config.ts') || path.endsWith('/vite.config.js'))
    .slice(0, 40);
}

function detectRuntimeEntry(project: ReactProject): string | undefined {
  const candidates = [
    'src/main.tsx',
    'src/main.jsx',
    'src/index.tsx',
    'src/index.jsx',
    'index.tsx',
    'index.jsx',
    'index.ts',
    'index.js',
  ];

  const match = candidates.find((candidate) => Boolean(project.files[candidate]));
  return match ? toSandpackPath(match) : undefined;
}

export function buildWorkspaceRuntimeConfig(project: ReactProject, activeFilePath: string | null): WorkspaceRuntimeConfig {
  const warnings = [...project.warnings];
  const { dependencies, devDependencies } = parsePackageJson(project);
  const runtimeFiles = Object.values(project.files).filter((file) => file.runtimeSupported);
  const files: SandpackFiles = {};

  runtimeFiles.forEach((file) => {
    files[toSandpackPath(file.path)] = {
      code: file.content,
      hidden: false,
      readOnly: false,
    };
  });

  if (!project.packageJsonPath) {
    files['/package.json'] = {
      code: JSON.stringify({
        name: 'lucen-react-workspace',
        private: true,
        version: '0.0.0',
        dependencies,
      }, null, 2),
      hidden: true,
    };
  }

  const visibleFiles = buildVisibleFiles(project);
  const activeFile = activeFilePath ? toSandpackPath(activeFilePath) : (visibleFiles[0] || '/src/App.tsx');

  if (project.binaryAssetPaths.length > 0) {
    warnings.push('Binary assets are preserved for export, but files like PNG and JPG are excluded from the live preview runtime.');
  }

  return {
    template: normalizeRuntimeTemplate(project.template),
    files,
    customSetup: {
      entry: detectRuntimeEntry(project),
      dependencies,
      devDependencies,
    },
    options: {
      activeFile,
      visibleFiles: visibleFiles.length > 0 ? visibleFiles : undefined,
      autorun: true,
      autoReload: true,
      showTabs: false,
      showLineNumbers: true,
      showInlineErrors: true,
      showNavigator: false,
      showRefreshButton: false,
      showConsole: false,
      showConsoleButton: false,
      recompileMode: 'delayed',
      recompileDelay: 200,
      initMode: 'immediate',
      externalResources: ['https://cdn.tailwindcss.com'],
    },
    activeFile,
    visibleFiles,
    warnings,
  };
}

export function createWorkspaceRuntimeLog(level: WorkspaceRuntimeLog['level'], message: string, source = 'runtime'): WorkspaceRuntimeLog {
  return {
    id: uuidv4(),
    level,
    message,
    source,
    timestamp: Date.now(),
  };
}
