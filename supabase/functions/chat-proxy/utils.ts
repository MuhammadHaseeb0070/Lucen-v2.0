export const WEB_PLUGIN_ID = 'web';
export const FREE_TIER_MAX_SEARCHES = 3;

export const WEBSEARCH_DEFAULT_ENGINE = 'exa';
export const WEBSEARCH_DEFAULT_MAX_RESULTS = 5;
export const WEBSEARCH_MAX_RESULTS_CAP = 5;

export const ABSOLUTE_OUTPUT_CEILING = Number(
  Deno.env.get('ABSOLUTE_OUTPUT_CEILING') ?? '32768',
);
export const MIN_OUTPUT = 512;

export interface ValidationResult {
  valid: boolean;
  type: 'plain' | 'final' | 'artifact' | 'raw';
  content: string;
  rawContent: string;
}

export function validateModelOutput(raw: string): ValidationResult {
  if (!raw || typeof raw !== 'string') {
    return { valid: false, type: 'raw', content: '', rawContent: raw || '' };
  }

  const responseMatch = raw.match(
    /<lucen_response\s+type="(plain|final)">([\s\S]*?)<\/lucen_response>/i
  );
  if (responseMatch) {
    const content = responseMatch[2].trim();
    if (content.length >= 15) {
      return { 
        valid: true, 
        type: responseMatch[1] as 'plain' | 'final',
        content,
        rawContent: raw
      };
    }
  }

  if (/<lucen_artifact[\s\S]*?<\/lucen_artifact>/i.test(raw)) {
    return { valid: true, type: 'artifact', content: raw, rawContent: raw };
  }

  const hasLeakedXml = /<invoke\s|<tool_call|<minimax:|<query>|<parameter/i.test(raw);
  const cleaned = raw.replace(/<[a-zA-Z_:][^>]*>[\s\S]*?<\/[a-zA-Z_:][^>]*>/g, '')
                     .replace(/<[a-zA-Z_:][^>]*/g, '').trim();
  
  if (!hasLeakedXml && cleaned.length >= 30) {
    return { valid: true, type: 'raw', content: cleaned, rawContent: raw };
  }

  return { valid: false, type: 'raw', content: '', rawContent: raw };
}

export function buildResponseFormatContract(hasToolResults: boolean, webSearchEnabled: boolean): string {
  return `## Response Format — MANDATORY

You MUST wrap every response in the correct tag:

**For direct answers** (no tools used this turn):
<lucen_response type="plain">
your response in markdown here
</lucen_response>

**For answers using tool results** (after web search, image analysis, file reading):
<lucen_response type="final">
your response using the gathered information
</lucen_response>

**For code, apps, HTML, Python, SVG, diagrams**:
<lucen_artifact type="[html|python|svg|mermaid|text]" title="[descriptive title]">
code here
</lucen_artifact>

**STRICT RULES**:
- ALWAYS use the correct wrapper tag — no exceptions
- NEVER output <invoke>, <tool_call>, <parameter>, or any XML tool tags
- NEVER show search queries or tool names to the user  
- NEVER say "I was unable to generate a response"
- For artifacts with explanation, output both tags sequentially
${!webSearchEnabled ? '- Web search is DISABLED. If asked about real-time info, say so and suggest enabling web search.' : ''}
${hasToolResults ? '- You have tool results available. Use them to write a complete, helpful answer.\n- If you analyzed multiple images, describe each one individually and reference them by their order (Image 1, Image 2, etc.)' : ''}`;
}

export function countImagesInMessages(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  let count = 0;
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const content = (msg as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      if (p.type === 'image_url' && p.image_url && typeof p.image_url === 'object') {
        const img = p.image_url as Record<string, unknown>;
        if (typeof img.url === 'string' && img.url) count += 1;
      }
    }
  }
  return count;
}

export function forceImageDetailLow(messages: unknown): void {
  if (!Array.isArray(messages)) return;
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const content = (msg as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      if (p.type === 'image_url' && p.image_url && typeof p.image_url === 'object') {
        const img = p.image_url as Record<string, unknown>;
        img.detail = 'low';
      }
    }
  }
}

export function hasWebPlugin(plugins: unknown): boolean {
  if (!Array.isArray(plugins)) return false;
  return plugins.some((p) => p && typeof p === 'object' && (p as Record<string, unknown>).id === WEB_PLUGIN_ID);
}

export function sanitizeDomainList(value: unknown, maxItems: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out.length > 0 ? out : undefined;
}

export function sanitizeWebPlugins(plugins: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(plugins)) return undefined;
  const raw = plugins.find((p) => p && typeof p === 'object' && (p as Record<string, unknown>).id === WEB_PLUGIN_ID) as Record<string, unknown> | undefined;
  if (!raw) return undefined;

  const maxResultsRaw = raw.max_results;
  const maxResultsNum = typeof maxResultsRaw === 'number' && Number.isFinite(maxResultsRaw)
    ? Math.floor(maxResultsRaw)
    : WEBSEARCH_DEFAULT_MAX_RESULTS;
  const max_results = Math.min(Math.max(1, maxResultsNum), WEBSEARCH_MAX_RESULTS_CAP);

  const engine = WEBSEARCH_DEFAULT_ENGINE;

  const include_domains = sanitizeDomainList(raw.include_domains, 10);
  const exclude_domains = sanitizeDomainList(raw.exclude_domains, 10);

  const plugin: Record<string, unknown> = { id: WEB_PLUGIN_ID, engine, max_results };
  if (include_domains) plugin.include_domains = include_domains;
  if (exclude_domains) plugin.exclude_domains = exclude_domains;

  return [plugin];
}

export function detectAttachments(messages: any[]): { hasImage: boolean; hasFile: boolean } {
  let hasImage = false;
  let hasFile = false;
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const content = msg.content;
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
    if (
      contentStr.includes('[Attached Image:') || 
      contentStr.includes('image: ') || 
      contentStr.includes('type: "image_url"') || 
      contentStr.includes('image_url')
    ) {
      hasImage = true;
    }
    if (contentStr.includes('[Attached File:') || contentStr.includes('file: ')) {
      hasFile = true;
    }
  }
  return { hasImage, hasFile };
}
