import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

declare global {
  interface Window {
    katex?: any;
  }
}

const KATEX_CDN_SCRIPT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js';
const KATEX_CDN_CSS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css';

const INLINE_MATH_REGEX =
  /(?<!\w)\$(?!\s)((?:[^$\n]|\\.)+?)(?<!\s)\$/g; // match $...$ only

let katexLoadPromise: Promise<any> | null = null;
let katexCssInjected = false;

function injectCssOnce() {
  if (katexCssInjected) return;
  if (typeof document === 'undefined') return;
  katexCssInjected = true;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = KATEX_CDN_CSS_URL;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

async function ensureKaTeXLoaded() {
  if (typeof window === 'undefined') return null;
  injectCssOnce();

  if (window.katex) return window.katex;
  if (katexLoadPromise) return katexLoadPromise;

  katexLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-lucen-katex="${KATEX_CDN_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.katex));
      existing.addEventListener('error', reject);
      return;
    }

    const script = document.createElement('script');
    script.src = KATEX_CDN_SCRIPT_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.setAttribute('data-lucen-katex', KATEX_CDN_SCRIPT_URL);
    script.onload = () => resolve(window.katex);
    script.onerror = () => reject(new Error('Failed to load KaTeX'));
    document.head.appendChild(script);
  });

  return katexLoadPromise;
}

let mathStylesInjected = false;
function injectMathStylesOnce() {
  if (mathStylesInjected) return;
  if (typeof document === 'undefined') return;
  mathStylesInjected = true;

  const styleId = 'lucen-math-renderer-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .math-block {
      display: flex;
      justify-content: center;
      padding: 1rem 0;
      overflow-x: auto;
    }
    .math-inline {
      display: inline;
    }
  `;
  document.head.appendChild(style);
}

export function MathBlockRenderer({ content }: { content: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [hadError, setHadError] = useState(false);

  useEffect(() => {
    injectMathStylesOnce();
    let cancelled = false;

    (async () => {
      try {
        const katex = await ensureKaTeXLoaded();
        if (!katex) throw new Error('KaTeX unavailable');
        // block math: displayMode=true
        const out = katex.renderToString(content, { displayMode: true });
        if (!cancelled) {
          setHtml(out);
          setHadError(false);
        }
      } catch {
        if (!cancelled) {
          setHtml(null);
          setHadError(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [content]);

  if (hadError || !html) {
    return (
      <div className="math-block">
        <code>{content}</code>
      </div>
    );
  }

  return (
    <div className="math-block" aria-label="Math block">
      <span className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function MarkdownInlineMathRenderer({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const needsInlineMath = useMemo(() => {
    try {
      const matches = content.match(INLINE_MATH_REGEX);
      return Array.isArray(matches) && matches.length > 0;
    } catch {
      return false;
    }
  }, [content]);

  useEffect(() => {
    injectMathStylesOnce();
    if (!needsInlineMath) return;

    let cancelled = false;

    (async () => {
      try {
        const katex = await ensureKaTeXLoaded();
        if (!katex) return;
        if (cancelled) return;

        const root = containerRef.current;
        if (!root) return;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const regex = new RegExp(INLINE_MATH_REGEX.source, 'g');

        const textNodes: Text[] = [];
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          if (!node.nodeValue) continue;
          const parent = node.parentElement;
          if (!parent) continue;
          if (parent.closest('code, pre')) continue;
          textNodes.push(node);
        }

        for (const node of textNodes) {
          if (!node.nodeValue) continue;
          const text = node.nodeValue;
          regex.lastIndex = 0;
          const matches: Array<{ full: string; latex: string; index: number }> = [];

          let m: RegExpExecArray | null = null;
          while ((m = regex.exec(text)) !== null) {
            matches.push({ full: m[0], latex: m[1], index: m.index ?? 0 });
            if (m.index === regex.lastIndex) regex.lastIndex++; // avoid infinite loops
          }
          if (matches.length === 0) continue;

          const frag = document.createDocumentFragment();
          let last = 0;
          for (const match of matches) {
            if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));

            const latexSource = match.latex;
            let mathHtml: string;
            try {
              mathHtml = katex.renderToString(latexSource, { displayMode: false });
            } catch {
              const code = document.createElement('code');
              code.textContent = latexSource;
              frag.appendChild(code);
              last = match.index + match.full.length;
              continue;
            }

            const span = document.createElement('span');
            span.className = 'math-inline';
            span.innerHTML = mathHtml;
            frag.appendChild(span);
            last = match.index + match.full.length;
          }

          if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
          node.replaceWith(frag);
        }
      } catch {
        // Graceful degradation: if inline KaTeX fails, keep raw $...$ text.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [content, needsInlineMath]);

  return (
    <div className="markdown-body" ref={containerRef}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');

            // Inline code spans usually won't have `language-*` classes.
            if (!match) {
              return (
                <code className={className ? `inline-code ${className}` : 'inline-code'} {...props}>
                  {children}
                </code>
              );
            }

            // If code fences slip through detection, fall back to a basic pre/code render.
            return (
              <pre>
                <code {...props}>{children}</code>
              </pre>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export { MarkdownInlineMathRenderer };

