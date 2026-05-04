// ============================================================
// iframeErrorBridge — capture runtime errors from sandboxed iframes
//
// HTML artifacts render in `<iframe srcdoc sandbox="allow-scripts ...">`,
// which means the parent React tree never sees the iframe's runtime
// errors directly. This module bridges them via postMessage:
//
//   - INJECT_SCRIPT: a tiny <script> blob we splice into the iframe
//     srcDoc. Hooks window.onerror, unhandledrejection, and a thin
//     console.error wrapper. Each captured event is forwarded to the
//     parent via window.parent.postMessage with a tagged envelope.
//
//   - attachErrorListener(onError): the parent-side counterpart. Listens
//     for the tagged envelopes and dispatches them to a callback. Returns
//     a cleanup function for React effects.
//
// Security:
//   - We DO NOT post raw stack traces from cross-origin frames; the
//     iframe's content runs same-origin (`allow-same-origin` is on) so
//     stacks are okay to forward.
//   - The envelope is tagged with __lucen_iframe_error so other
//     postMessage chatter (Vite HMR, third-party widgets) is ignored.
//   - The injected script doesn't trust user code: it copies primitives
//     out of the original error before serialising, so a malicious
//     `Error.prototype.toString` override can't leak parent state.
// ============================================================

export interface IframeErrorEvent {
  /** Best-effort error message (may include "Uncaught"). */
  message: string;
  /** Stack trace if available. */
  stack?: string;
  /** Source URL/file when known (often "about:srcdoc"). */
  source?: string;
  line?: number;
  column?: number;
  /** Where the error came from. */
  origin: 'window.onerror' | 'unhandledrejection' | 'console.error';
  /** Wall-clock when the iframe captured it. */
  capturedAt: number;
}

const ENVELOPE_KEY = '__lucen_iframe_error';

/**
 * IIFE injected into the iframe srcDoc. Crafted so it doesn't pollute
 * the global scope, doesn't break user code, and is robust to
 * `console.error` being shadowed by the user's HTML.
 *
 * Important: keep this string TIGHT — it lives inside `srcdoc=` and
 * gets parsed every render. Avoid template-literal `${...}` here so
 * users embedding their own template literals don't collide.
 */
export const INJECT_SCRIPT = `<script>(function(){try{
  var KEY=${JSON.stringify(ENVELOPE_KEY)};
  function send(payload){try{window.parent && window.parent.postMessage({__type:KEY,payload:payload},"*");}catch(_){/*noop*/}}
  function asString(v){try{if(v==null)return String(v);if(typeof v==="string")return v;if(v instanceof Error){return (v.message||String(v))+(v.stack?"\\n"+v.stack:"");}return JSON.stringify(v);}catch(_){return String(v);}}
  function pickStack(err){try{return err && err.stack ? String(err.stack).slice(0,3000) : undefined;}catch(_){return undefined;}}
  window.addEventListener("error",function(e){
    try{
      send({
        message: e && e.message ? String(e.message) : "Unknown error",
        stack: pickStack(e && e.error),
        source: e && e.filename ? String(e.filename) : undefined,
        line: typeof (e && e.lineno) === "number" ? e.lineno : undefined,
        column: typeof (e && e.colno) === "number" ? e.colno : undefined,
        origin: "window.onerror",
        capturedAt: Date.now()
      });
    }catch(_){/*noop*/}
  },true);
  window.addEventListener("unhandledrejection",function(e){
    try{
      var reason = e && e.reason;
      send({
        message: reason instanceof Error ? String(reason.message||reason) : asString(reason),
        stack: pickStack(reason instanceof Error ? reason : null),
        origin: "unhandledrejection",
        capturedAt: Date.now()
      });
    }catch(_){/*noop*/}
  });
  // Wrap console.error so we surface explicit user logs without breaking it.
  try{
    var origErr = console.error.bind(console);
    console.error = function(){
      try{
        var parts = [];
        for(var i=0;i<arguments.length;i++){ parts.push(asString(arguments[i])); }
        send({
          message: parts.join(" "),
          origin: "console.error",
          capturedAt: Date.now()
        });
      }catch(_){/*noop*/}
      return origErr.apply(console, arguments);
    };
  }catch(_){/*noop*/}
}catch(_){/*noop*/}})();</script>`;

/**
 * Attach a parent-side message listener that fires `onError` for every
 * envelope received from a child iframe matching `iframeWindow`.
 *
 * If `iframeWindow` is null, the listener fires for ANY iframe sending
 * the tagged envelope — useful when the iframe re-creates itself on
 * srcDoc changes (each new srcDoc gets a new contentWindow).
 *
 * Returns a cleanup function suitable for `useEffect` cleanup.
 */
export function attachErrorListener(
  onError: (e: IframeErrorEvent) => void,
  iframeWindow?: Window | null,
): () => void {
  const handler = (msg: MessageEvent) => {
    if (!msg.data || typeof msg.data !== 'object') return;
    if ((msg.data as { __type?: string }).__type !== ENVELOPE_KEY) return;
    if (iframeWindow && msg.source !== iframeWindow) return;
    const payload = (msg.data as { payload?: IframeErrorEvent }).payload;
    if (!payload || typeof payload.message !== 'string') return;
    onError(payload);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

/**
 * Splice INJECT_SCRIPT into the user's HTML srcDoc. Best-effort
 * insertion right after `<head>` (or right before `</body>`, or as a
 * prefix when neither tag is present). The injected script runs FIRST
 * so it captures errors thrown during the rest of the page's parse.
 */
export function injectIntoHtml(srcDoc: string): string {
  if (!srcDoc) return INJECT_SCRIPT;
  // Try the start of <head>...
  const headOpen = srcDoc.match(/<head[^>]*>/i);
  if (headOpen && headOpen.index !== undefined) {
    const insertAt = headOpen.index + headOpen[0].length;
    return srcDoc.slice(0, insertAt) + INJECT_SCRIPT + srcDoc.slice(insertAt);
  }
  // ...or just before </body>...
  const bodyClose = srcDoc.toLowerCase().lastIndexOf('</body>');
  if (bodyClose !== -1) {
    return srcDoc.slice(0, bodyClose) + INJECT_SCRIPT + srcDoc.slice(bodyClose);
  }
  // ...or just before </html>...
  const htmlClose = srcDoc.toLowerCase().lastIndexOf('</html>');
  if (htmlClose !== -1) {
    return srcDoc.slice(0, htmlClose) + INJECT_SCRIPT + srcDoc.slice(htmlClose);
  }
  // Fallback: prepend (will still execute first).
  return INJECT_SCRIPT + srcDoc;
}
