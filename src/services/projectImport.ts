import { v4 as uuidv4 } from 'uuid';
import JSZip from 'jszip';
import type { ProjectFile, ReactProject, ReactProjectTemplate, WorkspaceImportResult } from '../types/workspace';

const IGNORED_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'coverage',
  '__macosx',
]);

const BACKEND_SEGMENTS = new Set([
  'api',
  'server',
  'backend',
  'functions',
  'supabase',
  'prisma',
  'migrations',
]);

const TEXT_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'json', 'css', 'scss', 'sass', 'less', 'html', 'htm',
  'md', 'txt', 'yml', 'yaml', 'env', 'svg', 'xml', 'mjs', 'cjs', 'toml',
]);

function normalizePath(rawPath: string): string {
  return rawPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

function getExtension(path: string): string {
  const fileName = path.split('/').pop() || '';
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

function looksTextFile(path: string): boolean {
  const ext = getExtension(path);
  return TEXT_EXTENSIONS.has(ext) || path.endsWith('Dockerfile') || path.endsWith('.gitignore');
}

function shouldIgnorePath(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase();
  const segments = normalized.split('/');
  return segments.some((segment) => IGNORED_SEGMENTS.has(segment));
}

function containsBackendSegments(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase();
  const segments = normalized.split('/');
  return segments.some((segment) => BACKEND_SEGMENTS.has(segment));
}

function getLanguage(path: string): string {
  const normalized = path.toLowerCase();
  if (normalized.endsWith('.tsx') || normalized.endsWith('.ts')) return 'typescript';
  if (normalized.endsWith('.jsx') || normalized.endsWith('.js') || normalized.endsWith('.mjs') || normalized.endsWith('.cjs')) return 'javascript';
  if (normalized.endsWith('.json')) return 'json';
  if (normalized.endsWith('.css') || normalized.endsWith('.scss') || normalized.endsWith('.sass') || normalized.endsWith('.less')) return 'css';
  if (normalized.endsWith('.html') || normalized.endsWith('.htm')) return 'html';
  if (normalized.endsWith('.svg') || normalized.endsWith('.xml')) return 'xml';
  if (normalized.endsWith('.md')) return 'markdown';
  return 'text';
}

function makeProjectFile(path: string, content: string, isBinary: boolean, runtimeSupported: boolean, size: number, omittedReason?: string): ProjectFile {
  const normalizedPath = normalizePath(path);
  const segments = normalizedPath.split('/');
  const name = segments[segments.length - 1];
  const directory = segments.length > 1 ? segments.slice(0, -1).join('/') : '';
  const timestamp = Date.now();

  return {
    path: normalizedPath,
    name,
    directory,
    content,
    encoding: isBinary ? 'base64' : 'utf8',
    language: getLanguage(normalizedPath),
    isBinary,
    runtimeSupported,
    omittedReason,
    size,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function detectTemplate(paths: string[], packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> } | null): ReactProjectTemplate {
  const hasTypeScript = paths.some((path) => path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('tsconfig.json'));
  const hasViteConfig = paths.some((path) => /(^|\/)vite\.config\.(ts|js|mts|mjs)$/.test(path));
  const deps = { ...(packageJson?.dependencies || {}), ...(packageJson?.devDependencies || {}) };
  const usesVite = hasViteConfig || 'vite' in deps || Boolean(packageJson?.scripts?.dev?.includes('vite'));

  if (usesVite) {
    return hasTypeScript ? 'vite-react-ts' : 'vite-react';
  }

  return hasTypeScript ? 'react-ts' : 'react';
}

function scoreRoot(root: string, allPaths: string[], packageJsonContent: string | null): number {
  const prefix = root ? `${root}/` : '';
  let score = 0;
  const scopedPaths = allPaths.filter((path) => path === root || path.startsWith(prefix));

  if (scopedPaths.some((path) => path.startsWith(`${prefix}src/`))) score += 4;
  if (scopedPaths.includes(`${prefix}index.html`) || scopedPaths.includes(`${prefix}public/index.html`)) score += 4;
  if (scopedPaths.some((path) => /(^|\/)vite\.config\.(ts|js|mts|mjs)$/.test(path))) score += 3;
  if (scopedPaths.some((path) => path.startsWith(`${prefix}src/App.`))) score += 3;
  if (scopedPaths.some((path) => path.startsWith(`${prefix}src/main.`) || path.startsWith(`${prefix}src/index.`))) score += 3;

  if (packageJsonContent) {
    try {
      const parsed = JSON.parse(packageJsonContent) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
      if ('react' in deps) score += 8;
      if ('react-dom' in deps) score += 5;
      if ('vite' in deps) score += 3;
    } catch {
      score += 1;
    }
  }

  return score;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function buildStarterPackageJson(template: ReactProjectTemplate) {
  const isTypeScript = template === 'vite-react-ts' || template === 'react-ts';
  const isVite = template === 'vite-react-ts' || template === 'vite-react';
  return {
    name: 'lucen-react-workspace',
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: isVite
      ? { dev: 'vite', build: 'vite build', preview: 'vite preview' }
      : { start: 'react-scripts start', build: 'react-scripts build' },
    dependencies: {
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      'lucide-react': '^0.575.0',
      recharts: '^3.8.0',
      ...(isVite ? {} : { 'react-scripts': '^5.0.1' }),
    },
    devDependencies: isVite
      ? {
          vite: '^7.0.0',
          '@vitejs/plugin-react': '^5.0.0',
          ...(isTypeScript ? { typescript: '^5.0.0', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' } : {}),
        }
      : undefined,
  };
}

export function createStarterReactProject(template: ReactProjectTemplate = 'vite-react-ts'): ReactProject {
  const timestamp = Date.now();
  const files: Record<string, ProjectFile> = {};
  const isTypeScript = template === 'vite-react-ts' || template === 'react-ts';
  const isVite = template === 'vite-react-ts' || template === 'vite-react';

  const starterEntries: Array<[string, string]> = [
    ['package.json', JSON.stringify(buildStarterPackageJson(template), null, 2)],
    ['index.html', [
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '    <title>Lucen React Workspace</title>',
      '  </head>',
      '  <body>',
      '    <div id="root"></div>',
      isVite ? `    <script type="module" src="/src/${isTypeScript ? 'main.tsx' : 'main.jsx'}"></script>` : '',
      '  </body>',
      '</html>',
    ].filter(Boolean).join('\n')],
    [`src/${isTypeScript ? 'main.tsx' : 'main.jsx'}`, [
      'import React from "react";',
      'import { createRoot } from "react-dom/client";',
      'import App from "./App";',
      'import "./index.css";',
      '',
      'createRoot(document.getElementById("root")!).render(',
      '  <React.StrictMode>',
      '    <App />',
      '  </React.StrictMode>',
      ');',
    ].join('\n')],
    [`src/${isTypeScript ? 'App.tsx' : 'App.jsx'}`, [
      'import { Sparkles } from "lucide-react";',
      '',
      'export default function App() {',
      '  return (',
      '    <main className="min-h-screen bg-slate-950 text-white">',
      '      <section className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">',
      '        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-sm text-emerald-200">',
      '          <Sparkles size={16} />',
      '          Lucen React Workspace',
      '        </div>',
      '        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">Edit this project with AI, preview it live, and export it as a zip.</h1>',
      '        <p className="mt-4 max-w-2xl text-base text-slate-300 sm:text-lg">This starter project is running inside the dedicated React workspace. Import a zip or start asking Lucen for targeted file edits.</p>',
      '      </section>',
      '    </main>',
      '  );',
      '}',
    ].join('\n')],
    ['src/index.css', [
      '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");',
      '',
      ':root {',
      '  font-family: "Inter", system-ui, sans-serif;',
      '  color: #e2e8f0;',
      '  background: #020617;',
      '}',
      '',
      'body {',
      '  margin: 0;',
      '  min-width: 320px;',
      '  min-height: 100vh;',
      '  background: #020617;',
      '}',
      '',
      '* {',
      '  box-sizing: border-box;',
      '}',
    ].join('\n')],
  ];

  if (isVite) {
    starterEntries.push([
      isTypeScript ? 'vite.config.ts' : 'vite.config.js',
      [
        'import { defineConfig } from "vite";',
        'import react from "@vitejs/plugin-react";',
        '',
        'export default defineConfig({',
        '  plugins: [react()],',
        '});',
      ].join('\n'),
    ]);
  } else {
    starterEntries.push(['public/index.html', '<!doctype html><html><body><div id="root"></div></body></html>']);
  }

  if (isTypeScript) {
    starterEntries.push(['tsconfig.json', JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        allowJs: false,
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: true,
        forceConsistentCasingInFileNames: true,
        module: 'ESNext',
        moduleResolution: 'Node',
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'react-jsx',
      },
      include: ['src'],
    }, null, 2)]);
  }

  starterEntries.forEach(([path, content]) => {
    const file = makeProjectFile(path, content, false, true, content.length);
    files[file.path] = file;
  });

  return {
    id: uuidv4(),
    name: 'Lucen React Workspace',
    source: 'starter',
    framework: 'react',
    template,
    rootPath: '',
    packageJsonPath: 'package.json',
    entryFilePath: `src/${isTypeScript ? 'App.tsx' : 'App.jsx'}`,
    files,
    warnings: [],
    ignoredPaths: [],
    binaryAssetPaths: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function importReactProjectArchive(file: File): Promise<WorkspaceImportResult> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const allEntries = Object.values(zip.files).filter((entry) => !entry.dir);
  const warnings: string[] = [];
  const ignoredPaths: string[] = [];
  const binaryAssetPaths: string[] = [];

  const packageJsonCandidates = await Promise.all(
    allEntries
      .filter((entry) => normalizePath(entry.name).toLowerCase().endsWith('package.json') && !shouldIgnorePath(entry.name))
      .map(async (entry) => ({
        path: normalizePath(entry.name),
        content: await entry.async('string'),
      })),
  );

  const allPaths = allEntries.map((entry) => normalizePath(entry.name)).filter((path) => !shouldIgnorePath(path));
  const rankedRoots = packageJsonCandidates
    .map((candidate) => {
      const root = candidate.path.split('/').slice(0, -1).join('/');
      return { root, content: candidate.content, score: scoreRoot(root, allPaths, candidate.content) };
    })
    .sort((a, b) => b.score - a.score);

  const selectedRoot = rankedRoots[0]?.root
    ?? (allPaths.some((path) => path.startsWith('src/')) ? '' : allPaths[0]?.split('/').slice(0, -1).join('/') ?? '');

  const rootPrefix = selectedRoot ? `${selectedRoot}/` : '';
  const files: Record<string, ProjectFile> = {};

  for (const entry of allEntries) {
    const originalPath = normalizePath(entry.name);
    if (shouldIgnorePath(originalPath)) {
      ignoredPaths.push(originalPath);
      continue;
    }
    if (selectedRoot && originalPath !== selectedRoot && !originalPath.startsWith(rootPrefix)) {
      continue;
    }

    const relativePath = selectedRoot ? originalPath.slice(rootPrefix.length) : originalPath;
    if (!relativePath) continue;

    if (containsBackendSegments(relativePath)) {
      ignoredPaths.push(relativePath);
      continue;
    }

    if (looksTextFile(relativePath)) {
      const content = await entry.async('string');
      const projectFile = makeProjectFile(relativePath, content, false, true, content.length);
      files[projectFile.path] = projectFile;
      continue;
    }

    const base64 = await entry.async('base64');
    const projectFile = makeProjectFile(relativePath, base64, true, false, base64.length, 'Binary assets are preserved for export but omitted from the live browser runtime.');
    files[projectFile.path] = projectFile;
    binaryAssetPaths.push(projectFile.path);
  }

  if (Object.keys(files).length === 0) {
    throw new Error('No importable frontend files were found in this zip archive.');
  }

  const packageJsonPath = Object.keys(files).find((path) => path.endsWith('package.json')) || null;
  let parsedPackageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> } | null = null;
  if (packageJsonPath) {
    try {
      parsedPackageJson = JSON.parse(files[packageJsonPath].content) as typeof parsedPackageJson;
    } catch {
      warnings.push('package.json could not be parsed cleanly. The runtime will still try to preview the project.');
    }
  } else {
    warnings.push('No package.json was found. A preview may still load for simple projects, but dependency resolution could fail.');
  }

  const template = detectTemplate(Object.keys(files), parsedPackageJson);
  const entryFilePath =
    Object.keys(files).find((path) => path === 'src/App.tsx')
    || Object.keys(files).find((path) => path === 'src/App.jsx')
    || Object.keys(files).find((path) => path === 'src/main.tsx')
    || Object.keys(files).find((path) => path === 'src/main.jsx')
    || Object.keys(files).find((path) => path === 'src/index.tsx')
    || Object.keys(files).find((path) => path === 'src/index.jsx')
    || Object.keys(files).find((path) => path.startsWith('src/'))
    || Object.keys(files)[0];

  if (binaryAssetPaths.length > 0) {
    warnings.push(`${binaryAssetPaths.length} binary asset file(s) were preserved for zip export but are omitted from the live preview runtime.`);
  }

  if (ignoredPaths.some((path) => containsBackendSegments(path))) {
    warnings.push('Backend-leaning folders were skipped so the workspace stays frontend-only.');
  }

  const project: ReactProject = {
    id: uuidv4(),
    name: file.name.replace(/\.zip$/i, '') || 'Imported React Project',
    source: 'zip-import',
    framework: 'react',
    template,
    rootPath: selectedRoot,
    packageJsonPath,
    entryFilePath,
    files,
    warnings,
    ignoredPaths,
    binaryAssetPaths,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return { project, warnings };
}

export function exportProjectToZip(project: ReactProject): Promise<Blob> {
  const zip = new JSZip();

  Object.values(project.files).forEach((file) => {
    if (file.isBinary && file.encoding === 'base64') {
      zip.file(file.path, decodeBase64ToBytes(file.content));
      return;
    }

    zip.file(file.path, file.content);
  });

  return zip.generateAsync({ type: 'blob' });
}
