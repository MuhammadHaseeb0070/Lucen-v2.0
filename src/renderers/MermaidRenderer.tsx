import React, { useEffect, useMemo, useRef, useState } from 'react';

declare global {
  interface Window {
    mermaid?: any;
  }
}

const MERMAID_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.6.1/mermaid.min.js';

let mermaidLoadPromise: Promise<any> | null = null;
let mermaidInitialized = false;

function cleanupMermaidElements() {
  try {
    document.querySelectorAll('[id^="dmermaid-"], [id^="mermaid-"], .mermaid-error').forEach((el) => el.remove());
  } catch {
    // ignore
  }
}

function injectMermaidScriptOnce() {
  if (typeof document === 'undefined') return;
  const existing = document.querySelector<HTMLScriptElement>(`script[data-lucen-mermaid="${MERMAID_CDN_URL}"]`);
  if (existing) return;

  const script = document.createElement('script');
  script.src = MERMAID_CDN_URL;
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.setAttribute('data-lucen-mermaid', MERMAID_CDN_URL);
  document.head.appendChild(script);
}

async function ensureMermaidLoaded() {
  if (typeof window === 'undefined') return null;
  if (window.mermaid) return window.mermaid;
  if (mermaidLoadPromise) return mermaidLoadPromise;

  injectMermaidScriptOnce();

  mermaidLoadPromise = new Promise((resolve, reject) => {
    const script = document.querySelector<HTMLScriptElement>(`script[data-lucen-mermaid="${MERMAID_CDN_URL}"]`);
    if (!script) {
      reject(new Error('Mermaid script missing'));
      return;
    }
    script.addEventListener('load', () => resolve(window.mermaid));
    script.addEventListener('error', () => reject(new Error('Failed to load mermaid')));
  });

  return mermaidLoadPromise;
}

const stylesId = 'lucen-mermaid-renderer-styles';
let stylesInjected = false;

function ensureStylesInjected() {
  if (stylesInjected) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById(stylesId)) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.id = stylesId;
  style.textContent = `
    .lucen-mermaid-wrapper {
      margin: 0.75rem 0;
      border-radius: var(--border-radius-lg, 12px);
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(0,0,0,0.22);
      padding: 14px;
    }
    .lucen-mermaid-svg {
      width: 100%;
      overflow-x: auto;
      display: block;
    }
    .lucen-mermaid-fallback pre {
      margin: 0;
      white-space: pre-wrap;
    }
  `;
  document.head.appendChild(style);
}

export interface MermaidRendererProps {
  content: string;
}

const MermaidRenderer: React.FC<MermaidRendererProps> = React.memo(({ content }) => {
  ensureStylesInjected();

  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renderIdRef = useRef(0);

  const cleaned = useMemo(() => content.trim(), [content]);

  useEffect(() => {
    let cancelled = false;
    if (!cleaned) {
      setSvg(null);
      setError(null);
      return;
    }

    const run = async () => {
      try {
        const mermaid = await ensureMermaidLoaded();
        if (!mermaid) throw new Error('Mermaid unavailable');

        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: 'base',
            themeVariables: {
              darkMode: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
              fontSize: '14px',
            },
          });
          mermaidInitialized = true;
        }

        cleanupMermaidElements();
        const currentId = ++renderIdRef.current;
        const renderId = `lucen-mermaid-${Date.now()}-${currentId}`;
        const rendered = await mermaid.render(renderId, cleaned);
        if (cancelled) return;
        setSvg(rendered?.svg ?? '');
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setSvg(null);
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        cleanupMermaidElements();
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [cleaned]);

  if (error || !svg) {
    return (
      <div className="lucen-mermaid-wrapper lucen-mermaid-fallback">
        {error ? <div style={{ marginBottom: 8, opacity: 0.8, fontSize: 12 }}>Mermaid render failed</div> : null}
        <pre>
          <code>{cleaned}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="lucen-mermaid-wrapper">
      <div
        className="lucen-mermaid-svg"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
});

export default MermaidRenderer;

