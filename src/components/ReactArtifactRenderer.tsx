import React, { useCallback, useMemo } from 'react';
import {
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
  useSandpackPreviewProgress,
} from '@codesandbox/sandpack-react';
import { AlertTriangle, Loader2, Wand2 } from 'lucide-react';
import { useComposerStore } from '../store/composerStore';

interface ReactArtifactRendererProps {
  content: string;
  title?: string;
}

const APP_FILE_PATH = '/App.tsx';
const ENTRY_FILE_PATH = '/index.tsx';
const REACT_SANDBOX_OPTIONS = {
  activeFile: APP_FILE_PATH,
  visibleFiles: [APP_FILE_PATH],
  autorun: true,
  autoReload: true,
  initMode: 'immediate' as const,
  recompileMode: 'delayed' as const,
  recompileDelay: 250,
  showNavigator: false,
  showRefreshButton: false,
  showOpenInCodeSandbox: false,
  showOpenNewtab: false,
  externalResources: ['https://cdn.tailwindcss.com'],
};

const REACT_SANDBOX_SETUP = {
  entry: ENTRY_FILE_PATH,
  dependencies: {
    'lucide-react': 'latest',
    'recharts': 'latest',
  },
};

function normalizeReactArtifactSource(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:tsx|jsx|typescript|javascript|react)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

function formatReactError(error: { title?: string; message: string; path?: string; line?: number; column?: number } | null): string {
  if (!error) return '';

  const parts = [error.title, error.message]
    .map((part) => part?.trim())
    .filter(Boolean);

  if (error.path) {
    const location = [error.line, error.column].filter((value) => typeof value === 'number').join(':');
    parts.push(location ? `${error.path}:${location}` : error.path);
  }

  return parts.join('\n').trim();
}

function buildPassToAiPrompt(title: string | undefined, source: string, errorText: string): string {
  return [
    `The React artifact "${title || 'Untitled React Artifact'}" failed in the Lucen Workspace preview.`,
    '',
    'Please fix the artifact and regenerate the full `<lucen_artifact type="react">...</lucen_artifact>` block.',
    '',
    'Error:',
    errorText,
    '',
    'Current artifact source:',
    '"""',
    source,
    '"""',
  ].join('\n');
}

const ReactArtifactPreview: React.FC<ReactArtifactRendererProps & { source: string }> = ({ title, source }) => {
  const { sandpack } = useSandpack();
  const previewProgress = useSandpackPreviewProgress({ timeout: 20000 });
  const setPendingMainComposerPrefill = useComposerStore((state) => state.setPendingMainComposerPrefill);

  const formattedError = useMemo(() => formatReactError(sandpack.error), [sandpack.error]);
  const timeoutMessage = sandpack.status === 'timeout'
    ? 'The React preview took too long to start. Try asking Lucen to simplify the component or fix any heavy runtime logic.'
    : '';

  const visibleError = formattedError || timeoutMessage;
  const isLoading = !visibleError && sandpack.status !== 'idle' && sandpack.status !== 'done';
  const loadingLabel = previewProgress || (sandpack.status === 'running' ? 'Compiling React preview...' : 'Preparing React runtime...');

  const handlePassErrorToAi = useCallback(() => {
    if (!visibleError) return;
    setPendingMainComposerPrefill(buildPassToAiPrompt(title, source, visibleError));
  }, [setPendingMainComposerPrefill, source, title, visibleError]);

  return (
    <div className="artifact-react-shell">
      <SandpackLayout className="artifact-react-layout">
        <SandpackPreview
          className="artifact-react-preview"
          showSandpackErrorOverlay={false}
          showNavigator={false}
          showRefreshButton={false}
          showOpenInCodeSandbox={false}
          showOpenNewtab={false}
        />
      </SandpackLayout>

      {isLoading && (
        <div className="artifact-react-overlay artifact-react-overlay--loading" aria-live="polite">
          <div className="artifact-react-loading-card">
            <div className="artifact-react-loading-skeleton" />
            <div className="artifact-react-loading-copy">
              <Loader2 size={18} className="artifact-react-loading-icon" />
              <div>
                <div className="artifact-react-loading-title">Compiling React artifact</div>
                <div className="artifact-react-loading-text">{loadingLabel}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {visibleError && (
        <div className="artifact-react-overlay artifact-react-overlay--error" role="alert">
          <div className="artifact-react-error-card">
            <div className="artifact-react-error-header">
              <AlertTriangle size={18} />
              <div>
                <div className="artifact-react-error-title">React preview failed</div>
                <div className="artifact-react-error-subtitle">The code view is still available if you want to inspect the raw JSX.</div>
              </div>
            </div>
            <pre className="artifact-react-error-message">{visibleError}</pre>
            <div className="artifact-react-error-actions">
              <button className="artifact-react-ai-btn" onClick={handlePassErrorToAi}>
                <Wand2 size={15} />
                <span>Pass error to AI</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ReactArtifactRenderer: React.FC<ReactArtifactRendererProps> = ({ content, title }) => {
  const source = useMemo(() => normalizeReactArtifactSource(content), [content]);

  const files = useMemo(() => ({
    [APP_FILE_PATH]: {
      code: source,
      active: true,
      readOnly: true,
    },
    [ENTRY_FILE_PATH]: {
      code: [
        'import React from "react";',
        'import { createRoot } from "react-dom/client";',
        'import App from "./App";',
        '',
        'const rootElement = document.getElementById("root");',
        '',
        'if (!rootElement) {',
        '  throw new Error("Missing root element for React artifact preview.");',
        '}',
        '',
        'createRoot(rootElement).render(<App />);',
      ].join('\n'),
      hidden: true,
      readOnly: true,
    },
    '/styles.css': {
      code: '',
      hidden: true,
      readOnly: true,
    },
  }), [source]);

  return (
    <SandpackProvider
      key={source}
      template="react-ts"
      files={files}
      customSetup={REACT_SANDBOX_SETUP}
      options={REACT_SANDBOX_OPTIONS}
    >
      <ReactArtifactPreview content={content} title={title} source={source} />
    </SandpackProvider>
  );
};

export default ReactArtifactRenderer;
