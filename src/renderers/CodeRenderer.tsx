import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

declare global {
  interface Window {
    shiki?: any;
  }
}

const SUPPORTED_LANGS: Record<string, { shikiLang: string; label: string }> = {
  js: { shikiLang: 'javascript', label: 'JavaScript' },
  ts: { shikiLang: 'typescript', label: 'TypeScript' },
  tsx: { shikiLang: 'tsx', label: 'TSX' },
  jsx: { shikiLang: 'jsx', label: 'JSX' },
  python: { shikiLang: 'python', label: 'Python' },
  rust: { shikiLang: 'rust', label: 'Rust' },
  go: { shikiLang: 'go', label: 'Go' },
  java: { shikiLang: 'java', label: 'Java' },
  c: { shikiLang: 'c', label: 'C' },
  cpp: { shikiLang: 'cpp', label: 'C++' },
  css: { shikiLang: 'css', label: 'CSS' },
  html: { shikiLang: 'html', label: 'HTML' },
  json: { shikiLang: 'json', label: 'JSON' },
  yaml: { shikiLang: 'yaml', label: 'YAML' },
  bash: { shikiLang: 'shellscript', label: 'Bash' },
  sql: { shikiLang: 'sql', label: 'SQL' },
  markdown: { shikiLang: 'markdown', label: 'Markdown' },
};

const stylesId = 'lucen-code-renderer-styles';
let stylesInjected = false;

function ensureStylesInjected() {
  if (stylesInjected) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById(stylesId)) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.id = stylesId;
  style.textContent = `
    .code-block-wrapper {
      position: relative;
      border-radius: var(--border-radius-lg, 12px);
      overflow: hidden;
      margin: 0.75rem 0;
      font-size: 13px;
      line-height: 1.6;
      background: rgba(0,0,0,0.22);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .code-copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 11px;
      opacity: 0;
      transition: opacity 0.15s;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.15);
      cursor: pointer;
      color: inherit;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      z-index: 2;
    }
    .code-block-wrapper:hover .code-copy-btn {
      opacity: 1;
    }
    .code-lang-badge {
      position: absolute;
      top: 8px;
      right: 70px;
      font-size: 11px;
      opacity: 0.45;
      font-family: var(--font-mono, monospace);
      z-index: 2;
      user-select: none;
      pointer-events: none;
    }
    .code-render-area {
      overflow-x: auto;
      padding: 14px 0 14px 0;
    }
    .code-render-area pre {
      margin: 0 !important;
      padding: 0 !important;
      background: transparent !important;
      overflow-x: auto !important;
      white-space: pre !important;
      font-family: var(--font-mono, monospace) !important;
      font-size: 13px !important;
      line-height: 1.6 !important;
      color: inherit !important;
    }
    .code-render-area code {
      font-family: var(--font-mono, monospace) !important;
      font-size: 13px !important;
      line-height: 1.6 !important;
      white-space: pre !important;
    }

    /* Line numbers via Shiki's per-line spans */
    .code-render-area {
      counter-reset: lucen-code-line;
    }
    .code-render-area .line {
      counter-increment: lucen-code-line;
      display: block;
      position: relative;
      padding-left: 3.5rem;
      padding-right: 1rem;
      white-space: pre !important;
    }
    .code-render-area .line::before {
      content: counter(lucen-code-line);
      position: absolute;
      left: 0;
      top: 0;
      width: 3rem;
      text-align: right;
      padding-right: 0.75rem;
      color: rgba(255, 255, 255, 0.35);
      user-select: none;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

function usePrefersDark() {
  const get = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  };

  const [prefersDark, setPrefersDark] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mql) return;
    const handler = () => setPrefersDark(mql.matches);
    handler();
    const mqAny = mql as any;
    if (typeof mqAny.addEventListener === 'function') mqAny.addEventListener('change', handler);
    else if (typeof mqAny.addListener === 'function') mqAny.addListener(handler);
    return () => {
      if (typeof mqAny.removeEventListener === 'function') mqAny.removeEventListener('change', handler);
      else if (typeof mqAny.removeListener === 'function') mqAny.removeListener(handler);
    };
  }, []);

  return prefersDark;
}

let shikiModulePromise: Promise<any> | null = null;

async function ensureShiki() {
  if (shikiModulePromise) return shikiModulePromise;
  shikiModulePromise = import('shiki');
  return shikiModulePromise;
}

function normalizeLang(lang: string) {
  const t = (lang || '').trim().toLowerCase();
  return t;
}

export interface CodeRendererProps {
  lang: string;
  content: string;
}

function PlainCode({ content }: { content: string }) {
  return (
    <div className="code-render-area">
      <pre>
        <code>{content}</code>
      </pre>
    </div>
  );
}

const CodeRenderer: React.FC<CodeRendererProps> = React.memo(({ lang, content }) => {
  ensureStylesInjected();

  const prefersDark = usePrefersDark();
  const [copied, setCopied] = useState(false);

  const normalizedLang = useMemo(() => normalizeLang(lang), [lang]);
  const langInfo = SUPPORTED_LANGS[normalizedLang];
  const theme = prefersDark ? 'github-dark' : 'github-light';

  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  // Prevent stale async results for rapid streaming updates.
  const renderIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const currentId = ++renderIdRef.current;
    setHighlightedHtml(null);

    const run = async () => {
      if (!langInfo) {
        // Unsupported / unrecognized language -> plaintext
        return;
      }

      try {
        const shiki = await ensureShiki();
        const codeToHtml = shiki.codeToHtml as (code: string, opts: any) => Promise<string>;
        if (typeof codeToHtml !== 'function') return;

        const html = await codeToHtml(content, {
          lang: langInfo.shikiLang,
          theme,
        });
        if (cancelled) return;
        if (renderIdRef.current !== currentId) return;
        setHighlightedHtml(html);
      } catch {
        if (cancelled) return;
        if (renderIdRef.current !== currentId) return;
        setHighlightedHtml(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [content, langInfo, theme]);

  const langLabel = langInfo?.label || (normalizedLang ? normalizedLang : 'text');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard errors; code will still render.
    }
  };

  return (
    <div className="code-block-wrapper">
      <div className="code-lang-badge">{langLabel}</div>
      <button
        type="button"
        className="code-copy-btn"
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy'}
        aria-label="Copy code"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>

      {highlightedHtml ? (
        <div className="code-render-area" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      ) : (
        <PlainCode content={content} />
      )}
    </div>
  );
});

export default CodeRenderer;

