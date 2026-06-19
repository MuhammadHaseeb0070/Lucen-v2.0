import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as Sentry from 'https://esm.sh/@sentry/deno@10.56.0';
import { recordUsage } from '../_shared/usage.ts';
import { TOOLS } from '../_shared/toolRegistry.ts';
import { circuitSuccess, circuitFailure } from '../_shared/circuitBreaker.ts';
import { buildResponseFormatContract, WEBSEARCH_DEFAULT_MAX_RESULTS } from './utils.ts';
import { computeWebSearchCredits, LC_PER_USD, WEBSEARCH_USD_PER_1K_RESULTS, CREDITS_PER_1K_TOKENS } from './billing.ts';
import { getModelConfig, normalizeModelParams, getDynamicHeaders } from '../_shared/models.ts';

const OPENROUTER_URL_ARTIFACT = 'https://openrouter.ai/api/v1/chat/completions';

const CODING_MODEL_SYSTEM_PROMPT = `You are the Lucen Artifact Engine — a world-class frontend developer and designer.
Your ONLY job is to generate a COMPLETE, fully functional, visually stunning artifact.

OUTPUT FORMAT:
Output ONLY a <lucen_artifact> tag with the complete code inside. No explanations, no markdown, no commentary.
Format: <lucen_artifact type="[type]" title="[Title]">[complete code]</lucen_artifact>

DESIGN PHILOSOPHY:
Every artifact you create is a creative decision, not a template instantiation.
Someone should look at your output and think "a designer made this" — not "an AI picked a layout."

COLOR: Forget safe palettes. No pure #000/#FFF backgrounds, no blue-to-purple gradients, no neon-on-dark, no glassmorphism.
Consider desaturated strange backgrounds (#2C1810, #0D1F0F), one loud color on an otherwise silent palette,
wrong-feeling combinations that are actually right (dusty rose + military green), monochrome with temperature shifts.
Pick 3-5 colors. Name them. Use them consistently.

TYPOGRAPHY: Two faces maximum from Google Fonts. The pairing must create tension — not harmony.
Good options: Syne, Space Grotesk, Bebas Neue, DM Serif Display, Darker Grotesque, Instrument Serif, Urbanist, Fraunces.
Set a real type scale using ratio 1.25 or 1.333. Every size must come from this scale.

LAYOUT: No section-by-section autonomous blocks. Every section must refer to something above or below it.
One intentional grid break per design. Mobile-first. Breakpoints: 640px, 900px, 1200px.

MOTION: One animation type per artifact. Either reveal (opacity+translateY, 280ms), interaction (specific properties, 140ms),
or ambient (one element, loops). Always wrap in @media(prefers-reduced-motion: no-preference).

SANDBOX RULES:
- HTML artifacts run in a SANDBOXED iframe. No Node.js, no filesystem, no require, no npm.
- CDN scripts are OK. Inline ALL CSS and JS.
- All page transitions MUST use DOM manipulation (show/hide). NEVER use window.location.
- Always include viewport meta tag.
- For Excel: use openpyxl/pandas. For Word: use python-docx. For PDF: use fpdf2.
- Excel/Word/PDF run in Pyodide (no internet, no GUI, 60s timeout).

QUALITY GATE:
Before outputting, verify: (a) every import works in sandbox, (b) HTML renders without errors,
(c) code is complete and self-contained, (d) all tags properly closed, (e) the design is NOT generic.
A working small artifact beats a broken ambitious one.`;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function getReasoningTokens(usage: Record<string, unknown> | undefined): number {
  if (!usage || typeof usage !== 'object') return 0;
  const details = usage.completion_tokens_details as Record<string, unknown> | undefined;
  const value = details?.reasoning_tokens;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export interface StreamHandlerOptions {
  req: Request;
  supabaseUrl: string;
  supabaseServiceKey: string;
  openrouterApiKey: string;
  userId: string;
  expiry: number;
  user: any;
  subscriptionStatus: string;
  remainingCredits: number;
  freeSearchesUsed: number;
  body: any;
  effectiveModel: string;
  fallbackModels?: string[];
  resolvedMaxTokens: number;
  cors: Record<string, string>;
  configHeaders: Record<string, string>;
  webSearchRequested: boolean;
  webSearchFallback: boolean;
  webSearchUsed: boolean;
  webSearchMaxResults: number;
  toolsToPass: any[];
  accounting: any;
  startedAt: number;
  log: any;
  authHeader: string;
}

export async function handleStreamRequest(options: StreamHandlerOptions): Promise<Response> {
  let {
    req,
    supabaseUrl,
    supabaseServiceKey,
    openrouterApiKey,
    userId,
    expiry,
    user,
    subscriptionStatus,
    remainingCredits,
    freeSearchesUsed,
    body,
    effectiveModel,
    fallbackModels = [effectiveModel],
    resolvedMaxTokens,
    cors,
    configHeaders,
    webSearchRequested,
    webSearchFallback,
    webSearchUsed,
    webSearchMaxResults,
    toolsToPass,
    accounting,
    startedAt,
    log,
    authHeader,
  } = options;

  const {
    messages,
    response_format,
    provider,
    is_reasoning,
  } = body || {};

  // Build the filtered messages and format contract for the initial round (Round 0)
  const formatContract = buildResponseFormatContract(false, webSearchRequested);
  const initialFilteredMessages = [...messages].filter(
    m => !(m.role === 'system' && m.content?.includes('## Response Format — MANDATORY'))
  );
  const lastUserIdx = [...initialFilteredMessages].map(m => m.role).lastIndexOf('user');
  if (lastUserIdx !== -1) {
    initialFilteredMessages.splice(lastUserIdx, 0, {
      role: 'system',
      content: formatContract
    });
  } else {
    initialFilteredMessages.push({ role: 'system', content: formatContract });
  }

  // Fallback engine: Try fallback models sequentially for Round 0 connection
  let initialOpenRouterResponse: Response | null = null;
  let activeModel = effectiveModel;
  let lastError: any = null;

  for (const currentModel of fallbackModels) {
    try {
      log.info(`[streamHandler] Attempting initial connection with model: ${currentModel}`);
      const basePayload = {
        model: currentModel,
        messages: initialFilteredMessages,
        stream: true,
        max_tokens: resolvedMaxTokens,
        max_completion_tokens: resolvedMaxTokens,
        include_usage: true,
        ...(response_format ? { response_format } : {}),
        ...(provider ? { provider } : {}),
        ...(is_reasoning ? { is_reasoning: true } : {}),
      };

      if (toolsToPass.length > 0) {
        basePayload.tools = toolsToPass;
        basePayload.tool_choice = 'auto';
      }

      const normalizedPayload = normalizeModelParams(currentModel, basePayload);

      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openrouterApiKey}`,
          'HTTP-Referer': supabaseUrl,
          'X-Title': 'Lucen',
        },
        body: JSON.stringify(normalizedPayload),
      });

      if (res.ok) {
        initialOpenRouterResponse = res;
        activeModel = currentModel;
        effectiveModel = currentModel;
        accounting.modelId = currentModel;
        break;
      } else {
        const errBody = await res.text().catch(() => '');
        lastError = new Error(`OpenRouter API Error ${res.status}: ${errBody}`);
        log.warn(`[streamHandler] Model ${currentModel} failed: ${lastError.message}`);
        Sentry.captureMessage(`Stream model fallback triggered from ${currentModel}. Error: ${lastError.message}`, 'warning');
      }
    } catch (err: any) {
      lastError = err;
      log.warn(`[streamHandler] Model ${currentModel} failed with exception: ${err.message}`);
      Sentry.captureMessage(`Stream model fallback triggered from ${currentModel} due to exception: ${err.message}`, 'warning');
    }
  }

  if (!initialOpenRouterResponse) {
    const errMsg = lastError?.message || 'All models in fallback chain failed';
    await circuitFailure('openrouter');
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
  await circuitSuccess('openrouter');

  // Dynamically update configHeaders to match the successful model
  configHeaders = {
    ...configHeaders,
    ...getDynamicHeaders(activeModel, body?.model ?? 'main-chat-model'),
  };

  const responseStream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      let keepaliveTimer: any = null;

      const flushStream = () => {
        try {
          // Write a 2KB comment padding to force proxies like Cloudflare to flush the buffer
          controller.enqueue(encoder.encode(`:${' '.repeat(2048)}\n`));
        } catch { /* ignore */ }
      };
      
      let currentMessages = [...messages];
      let rounds = 0;
      
      const toolCallCounts: Record<string, number> = {};
      const MAX_CALLS_PER_TOOL: Record<string, number> = { web_search: 4, generate_artifact: 1 };
      const analyzedImageIds = new Set<string>();
      const processedFileIds = new Set<string>();
      const searchedQueries = new Set<string>();

      const uploadedImageIds = new Set<string>();
      const uploadedFileIds = new Set<string>();
      for (const msg of messages) {
        if (msg && typeof msg === 'object') {
          const content = msg.content;
          const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
          
          const imgRegex = /\[Attached Image:\s*([a-zA-Z0-9-]+)\]/g;
          let imgMatch;
          while ((imgMatch = imgRegex.exec(contentStr)) !== null) {
            uploadedImageIds.add(imgMatch[1]);
          }
          
          const fileRegex = /\[Attached File:\s*([a-zA-Z0-9-]+)\]/g;
          let fileMatch;
          while ((fileMatch = fileRegex.exec(contentStr)) !== null) {
            uploadedFileIds.add(fileMatch[1]);
          }
        }
      }
      
      const hasAttachments = uploadedImageIds.size > 0 || uploadedFileIds.size > 0;
      const maxRounds = hasAttachments && webSearchRequested ? 5 : webSearchRequested ? 4 : 3;

      // ── Tool budget awareness: tell the brain model what's available ──
      const toolBudgetParts: string[] = [];
      if (toolsToPass.some((t: any) => t.function?.name === 'web_search')) {
        toolBudgetParts.push('web_search (max 3 calls)');
      }
      if (toolsToPass.some((t: any) => t.function?.name === 'analyze_image')) {
        toolBudgetParts.push(`analyze_image (${uploadedImageIds.size} image(s) available)`);
      }
      if (toolsToPass.some((t: any) => t.function?.name === 'process_file')) {
        toolBudgetParts.push(`process_file (${uploadedFileIds.size} file(s) available)`);
      }
      if (toolsToPass.some((t: any) => t.function?.name === 'generate_artifact')) {
        toolBudgetParts.push('generate_artifact (max 1 call, use for complex builds >50 lines)');
      }
      if (toolBudgetParts.length > 0) {
        const budgetMsg = {
          role: 'system',
          content: `[Tool Budget] Available tools this turn: ${toolBudgetParts.join(', ')}. Plan your tool usage BEFORE calling — call independent tools in parallel, chain dependent tools sequentially. Do NOT call tools you don't need.`
        };
        currentMessages.push(budgetMsg);
      }
      
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let totalReasoningTokens = 0;
      let totalSearchCost = 0;
      let finalStatus: any = 'completed';
      let finalStatusReason: string | null = null;
      let finalStreamError: string | null = null;
      let finalSawDone = false;
      let finishReason: string | null = null;
      let jwtVerifiedMidStream = false;
      
      const toolsExecuted: Array<{
        id: string;
        name: string;
        arguments: string;
        status: 'completed' | 'failed';
        durationMs: number;
      }> = [];

      const callSiblingFunction = async (name: string, payload: any) => {
        const endpoint = `${supabaseUrl}/functions/v1/${name}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader,
            'apikey': supabaseServiceKey,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Status ${res.status}: ${errText}`);
        }
        return await res.json();
      };

      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      try {
        while (rounds < maxRounds) {
          const { data: loopCreditsRow, error: loopCreditsErr } = await supabaseAdmin
            .from('user_credits')
            .select('remaining_credits')
            .eq('user_id', user.id)
            .single();
          
          const loopRemainingCredits = typeof loopCreditsRow?.remaining_credits === 'number'
            ? loopCreditsRow.remaining_credits
            : 0;

          if (loopCreditsErr || loopRemainingCredits <= 0) {
            try {
              controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'Insufficient credits to continue.' })}\n\n`));
            } catch { /* ignore */ }
            finishReason = 'insufficient_credits';
            break;
          }

          if (rounds > 0) {
            currentMessages = currentMessages.map((msg) => {
              if (msg && typeof msg === 'object' && msg.role === 'tool' && typeof msg.content === 'string') {
                const limit = msg.name === 'web_search' ? 6000
                        : msg.name === 'process_file' ? 4000
                        : 2000;
                if (msg.content.length > limit) {
                  console.warn(`[chat-proxy] Tool result for ${msg.name} truncated to ${limit} chars`);
                  return { ...msg, content: msg.content.slice(0, limit) + '\n[Truncated for efficiency]' };
                }
              }
              return msg;
            });
          }

          // ── Strip exhausted tools from subsequent rounds to prevent spiraling ──
          if (rounds > 0) {
            const activeTools = toolsToPass.filter((tool: any) => {
              const name = tool.function?.name;
              if (name === 'web_search' && (toolCallCounts['web_search'] || 0) >= 3) return false;
              if (name === 'analyze_image' && uploadedImageIds.size > 0 && Array.from(uploadedImageIds).every(id => analyzedImageIds.has(id))) return false;
              if (name === 'process_file' && uploadedFileIds.size > 0 && Array.from(uploadedFileIds).every(id => processedFileIds.has(id))) return false;
              if (name === 'generate_artifact' && (toolCallCounts['generate_artifact'] || 0) >= 1) return false;
              return true;
            });
            // Replace toolsToPass contents for this round
            toolsToPass.length = 0;
            toolsToPass.push(...activeTools);
          }

          const allLimitsReached = toolsToPass.length === 0 || toolsToPass.every((tool: any) => {
            const name = tool.function?.name;
            if (name === 'web_search') {
              return (toolCallCounts['web_search'] || 0) >= 3;
            }
            if (name === 'analyze_image') {
              return uploadedImageIds.size === 0 || Array.from(uploadedImageIds).every(id => analyzedImageIds.has(id));
            }
            if (name === 'process_file') {
              return uploadedFileIds.size === 0 || Array.from(uploadedFileIds).every(id => processedFileIds.has(id));
            }
            if (name === 'generate_artifact') {
              return (toolCallCounts['generate_artifact'] || 0) >= 1;
            }
            return false;
          });
          const isLastRound = rounds >= maxRounds - 1;

          if (allLimitsReached || isLastRound) {
            currentMessages.push({
              role: 'system',
              content: 'FINAL RESPONSE REQUIRED: All tool calls are complete. You MUST now write your final response directly to the user. Synthesize ALL tool results into a complete, helpful answer. If an artifact was generated, introduce it naturally. Do NOT attempt any more tool calls or output XML tool tags. Your response MUST contain substantive content — do not just output a one-line acknowledgment.'
            });
          }

          const filteredMessages = currentMessages.filter(
            m => !(m.role === 'system' && m.content?.includes('## Response Format — MANDATORY'))
          );
          
          const hasToolResults = rounds > 0;
          const formatContract = buildResponseFormatContract(hasToolResults, webSearchRequested);
          
          const lastUserIdx = [...filteredMessages].map(m => m.role).lastIndexOf('user');
          if (lastUserIdx !== -1) {
            filteredMessages.splice(lastUserIdx, 0, {
              role: 'system',
              content: formatContract
            });
          } else {
            filteredMessages.push({ role: 'system', content: formatContract });
          }

          let openrouterResponse: Response;

          if (rounds === 0) {
            openrouterResponse = initialOpenRouterResponse!;
          } else {
            const basePayload = {
              model: activeModel,
              messages: filteredMessages,
              stream: true,
              max_tokens: resolvedMaxTokens,
              max_completion_tokens: resolvedMaxTokens,
              include_usage: true,
              ...(response_format ? { response_format } : {}),
              ...(provider ? { provider } : {}),
              ...(is_reasoning ? { is_reasoning: true } : {}),
            };

            if (toolsToPass.length > 0 && rounds < maxRounds - 1 && !allLimitsReached) {
              basePayload.tools = toolsToPass;
              basePayload.tool_choice = 'auto';
            }

            const normalizedPayload = normalizeModelParams(activeModel, basePayload);

            const res = await fetch(OPENROUTER_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openrouterApiKey}`,
                'HTTP-Referer': supabaseUrl,
                'X-Title': 'Lucen',
              },
              body: JSON.stringify(normalizedPayload),
            });

            if (!res.ok) {
              const errBody = await res.text().catch(() => '');
              await circuitFailure('openrouter');
              log.error('OpenRouter stream error', { status: res.status, body: errBody.slice(0, 300) });
              throw new Error(`OpenRouter upstream error ${res.status}: ${errBody}`);
            }
            await circuitSuccess('openrouter');
            openrouterResponse = res;
          }

          const reader = openrouterResponse.body!.getReader();
          const toolCallsMap = new Map<number, {
            id?: string;
            name?: string;
            arguments: string;
          }>();
          let hasContentStartSent = false;

          while (true) {
            const currentSecs = Math.floor(Date.now() / 1000);
            if (expiry && currentSecs >= expiry && !jwtVerifiedMidStream) {
              jwtVerifiedMidStream = true;
              const { data: midUser, error: midErr } = await supabaseAdmin.auth.admin.getUserById(userId);
              if (midErr || !midUser?.user) {
                try {
                  controller.enqueue(encoder.encode(
                    `event: error\ndata: ${JSON.stringify({ error: "Session expired. Please sign in again.", code: 401 })}\n\n`
                  ));
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                } catch { /* ignore */ }
                throw new Error('JWT expired mid-stream and refresh validation failed');
              }
            }

            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              const text = decoder.decode(value, { stream: true });
              const lines = text.split('\n');
              let filteredText = '';
              let hasContent = false;

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) {
                  if (trimmed) filteredText += line + '\n';
                  continue;
                }
                const dataStr = trimmed.slice(6);
                if (dataStr === '[DONE]') {
                  finalSawDone = true;
                  filteredText += line + '\n';
                  continue;
                }
                try {
                  const parsed = JSON.parse(dataStr);
                  if (parsed.usage) {
                    totalPromptTokens += parsed.usage.prompt_tokens || 0;
                    totalCompletionTokens += parsed.usage.completion_tokens || 0;
                    totalReasoningTokens += getReasoningTokens(parsed.usage) || 0;
                  }
                  const choice = parsed.choices?.[0];
                  if (choice) {
                    const fr = choice.finish_reason;
                    if (fr !== null && fr !== undefined) {
                      finishReason = String(fr);
                    }
                    const delta = choice.delta;
                    if (delta) {
                      if (delta.tool_calls && Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
                        for (const tc of delta.tool_calls) {
                          const index = tc.index;
                          if (!toolCallsMap.has(index)) {
                            toolCallsMap.set(index, { id: tc.id, name: tc.function?.name, arguments: '' });
                          }
                          const existing = toolCallsMap.get(index)!;
                          if (tc.id) existing.id = tc.id;
                          if (tc.function?.name) existing.name = tc.function?.name;
                          if (tc.function?.arguments) existing.arguments += tc.function?.arguments;
                        }
                        continue; // Skip enqueuing this tool_call line to the client
                      }
                      if (delta.content || delta.reasoning || delta.reasoning_content) {
                        hasContent = true;
                      }
                      if (parsed.error) {
                        finalStreamError = parsed.error.message ?? 'stream error';
                      }
                    }
                  }
                } catch { /* skip */ }

                filteredText += line + '\n';
              }

              if (hasContent && !hasContentStartSent) {
                hasContentStartSent = true;
                try {
                  controller.enqueue(encoder.encode(
                    `event: content_start\ndata: ${JSON.stringify({ 
                      after_tool_calls: rounds > 0, model: effectiveModel 
                    })}\n\n`
                  ));
                } catch { /* ignore */ }
              }

              if (filteredText.trim().length > 0) {
                try {
                  controller.enqueue(encoder.encode(filteredText));
                } catch { /* ignore */ }
              }
            }
          }

          let toolCalls = Array.from(toolCallsMap.values());
          toolCalls = toolCalls.filter((tc) => {
            if (!tc.name) {
              console.warn('[chat-proxy] Skipping tool call: missing function name', tc);
              return false;
            }
            if (!tc.id || tc.id.trim() === '') {
              tc.id = crypto.randomUUID();
            }
            return true;
          });

          if (toolCalls.length > 0) {
            for (const tc of toolCalls) {
              let parsedArgs: any = {};
              let argsParsedSuccessfully = true;
              try { 
                parsedArgs = JSON.parse(tc.arguments); 
              } catch { 
                argsParsedSuccessfully = false; 
              }

              let label = '';
              if (argsParsedSuccessfully && parsedArgs && typeof parsedArgs === 'object') {
                if (tc.name === 'analyze_image') {
                  label = parsedArgs.analysis_title || 'Analyzing image';
                } else if (tc.name === 'process_file') {
                  label = parsedArgs.extraction_title || 'Reading file';
                } else if (tc.name === 'web_search') {
                  label = parsedArgs.search_title || 'Searching the web';
                } else {
                  const def = TOOLS[tc.name ?? ''];
                  label = def?.userFacingLabel ?? `Running ${tc.name}`;
                }
              } else {
                label = `Running ${tc.name}`;
                parsedArgs = {};
              }

              const eventPayload = {
                id: tc.id,
                tool: tc.name,
                status: 'running',
                label,
                args: parsedArgs
              };
              try {
                controller.enqueue(encoder.encode(`event: tool_activity\ndata: ${JSON.stringify(eventPayload)}\n\n`));
                flushStream();
              } catch { /* ignore */ }
            }

            const parallelCalls = toolCalls.filter(tc => TOOLS[tc.name ?? '']?.parallelizable);
            const sequentialCalls = toolCalls.filter(tc => !TOOLS[tc.name ?? '']?.parallelizable);

            const toolResults: any[] = [];

            const runTool = async (tc: any) => {
              const start = Date.now();
              let output = '';
              let success = true;
              let parsedArgs: any = {};
              let argsParsedSuccessfully = true;
              try { 
                parsedArgs = JSON.parse(tc.arguments); 
              } catch { 
                argsParsedSuccessfully = false; 
              }

              let durationMs = 0;

              if (!argsParsedSuccessfully) {
                success = false;
                output = 'Tool execution failed: could not parse tool arguments.';
                durationMs = Date.now() - start;

                toolsExecuted.push({
                  id: tc.id!,
                  name: tc.name!,
                  arguments: tc.arguments,
                  status: 'failed',
                  durationMs
                });

                const eventPayload = {
                  id: tc.id,
                  tool: tc.name,
                  status: 'failed',
                  label: `Running ${tc.name}`,
                  args: {},
                  durationMs,
                  output: output.slice(0, 400)
                };
                try {
                  controller.enqueue(encoder.encode(`event: tool_activity\ndata: ${JSON.stringify(eventPayload)}\n\n`));
                  flushStream();
                } catch { /* ignore */ }

                return {
                  tool_call_id: tc.id,
                  role: 'tool',
                  name: tc.name,
                  content: output
                };
              }

              if (!parsedArgs || typeof parsedArgs !== 'object') {
                success = false;
                output = 'Tool execution failed: arguments were null or invalid.';
                durationMs = Date.now() - start;

                toolsExecuted.push({
                  id: tc.id!,
                  name: tc.name!,
                  arguments: tc.arguments,
                  status: 'failed',
                  durationMs
                });

                const eventPayload = {
                  id: tc.id,
                  tool: tc.name,
                  status: 'failed',
                  label: `Running ${tc.name}`,
                  args: {},
                  durationMs,
                  output: output.slice(0, 400)
                };
                try {
                  controller.enqueue(encoder.encode(`event: tool_activity\ndata: ${JSON.stringify(eventPayload)}\n\n`));
                  flushStream();
                } catch { /* ignore */ }

                return {
                  tool_call_id: tc.id,
                  role: 'tool',
                  name: tc.name,
                  content: output
                };
              }

              const ALLOWED_TOOLS = ['analyze_image', 'process_file', 'web_search', 'generate_artifact'];
              if (!ALLOWED_TOOLS.includes(tc.name)) {
                success = false;
                output = 'Tool execution failed: unknown tool name.';
                durationMs = Date.now() - start;

                toolsExecuted.push({
                  id: tc.id!,
                  name: tc.name!,
                  arguments: tc.arguments,
                  status: 'failed',
                  durationMs
                });

                const eventPayload = {
                  id: tc.id,
                  tool: tc.name,
                  status: 'failed',
                  label: `Running ${tc.name}`,
                  args: parsedArgs,
                  durationMs,
                  output: output.slice(0, 400)
                };
                try {
                  controller.enqueue(encoder.encode(`event: tool_activity\ndata: ${JSON.stringify(eventPayload)}\n\n`));
                  flushStream();
                } catch { /* ignore */ }

                return {
                  tool_call_id: tc.id,
                  role: 'tool',
                  name: tc.name,
                  content: output
                };
              }

              const toolName = tc.name;
              let isLimitReached = false;
              let limitMsg = '';

              if (toolName === 'web_search') {
                const query = (parsedArgs?.query || '').trim().toLowerCase();
                const currentCount = toolCallCounts['web_search'] || 0;
                const maxForWebSearch = MAX_CALLS_PER_TOOL['web_search'] ?? 3;

                if (currentCount >= maxForWebSearch) {
                  isLimitReached = true;
                  limitMsg = 'Search limit reached for this message. Use results already retrieved.';
                } else if (query && searchedQueries.has(query)) {
                  isLimitReached = true;
                  limitMsg = 'Query already searched. Use results already retrieved.';
                }
                
                if (!isLimitReached) {
                  toolCallCounts['web_search'] = currentCount + 1;
                  if (query) {
                    searchedQueries.add(query);
                  }
                }
              } else if (toolName === 'analyze_image') {
                const imageIds = parsedArgs?.image_ids || [];
                if (Array.isArray(imageIds) && imageIds.length > 0) {
                  const allAlreadyAnalyzed = imageIds.every((id: string) => analyzedImageIds.has(id));
                  if (allAlreadyAnalyzed) {
                    isLimitReached = true;
                    limitMsg = 'Image already analyzed. Use results already retrieved.';
                  } else {
                    imageIds.forEach((id: string) => analyzedImageIds.add(id));
                  }
                }
              } else if (toolName === 'process_file') {
                const fileId = parsedArgs?.file_id;
                if (fileId && typeof fileId === 'string') {
                  if (processedFileIds.has(fileId)) {
                    isLimitReached = true;
                    limitMsg = 'File already processed. Use results already retrieved.';
                  } else {
                    processedFileIds.add(fileId);
                  }
                }
              } else {
                const currentCount = toolCallCounts[toolName] || 0;
                if (currentCount >= 1) {
                  isLimitReached = true;
                  limitMsg = 'Execution limit reached for this tool.';
                } else {
                  toolCallCounts[toolName] = currentCount + 1;
                }
              }

              if (isLimitReached) {
                success = false;
                output = limitMsg;
                durationMs = Date.now() - start;

                toolsExecuted.push({
                  id: tc.id!,
                  name: tc.name!,
                  arguments: tc.arguments,
                  status: 'failed',
                  durationMs
                });

                const eventPayload = {
                  id: tc.id,
                  tool: tc.name,
                  status: 'failed',
                  label: `Running ${tc.name}`,
                  args: parsedArgs,
                  durationMs,
                  output: output.slice(0, 400)
                };
                try {
                  controller.enqueue(encoder.encode(`event: tool_activity\ndata: ${JSON.stringify(eventPayload)}\n\n`));
                  flushStream();
                } catch { /* ignore */ }

                return {
                  tool_call_id: tc.id,
                  role: 'tool',
                  name: tc.name,
                  content: output
                };
              }

              let timerId: any;
              let res: any = null;
              try {
                if (tc.name === 'generate_artifact') {
                  // ── Artifact generation via coding model ──
                  const codingModels = [
                    Deno.env.get('CODING_CHAT_MODEL_PRIMARY'),
                    Deno.env.get('CODING_CHAT_MODEL_SECONDARY'),
                    Deno.env.get('CODING_CHAT_MODEL_TERTIARY'),
                    Deno.env.get('CODING_CHAT_MODEL'),
                  ].filter((m): m is string => !!m && m.trim().length > 0);
                  if (codingModels.length === 0) codingModels.push('qwen/qwen-2.5-coder-32b-instruct');

                  const artifactType = parsedArgs.artifact_type || 'html';
                  const artifactTitle = parsedArgs.title || 'Artifact';
                  const masterPrompt = parsedArgs.master_prompt || '';

                  let codingResponse: Response | null = null;
                  for (const codingModel of codingModels) {
                    try {
                      const codingPayload = {
                        model: codingModel,
                        messages: [
                          { role: 'system', content: CODING_MODEL_SYSTEM_PROMPT },
                          { role: 'user', content: masterPrompt }
                        ],
                        max_tokens: 16000,
                        stream: false,
                      };
                      const codingRes = await fetch(OPENROUTER_URL_ARTIFACT, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${Deno.env.get('OPENROUTER_API_KEY')}`,
                          'HTTP-Referer': supabaseUrl,
                          'X-Title': 'Lucen Artifact Engine',
                        },
                        body: JSON.stringify(codingPayload),
                      });
                      if (codingRes.ok) {
                        codingResponse = codingRes;
                        break;
                      }
                    } catch { /* try next model */ }
                  }

                  if (!codingResponse) {
                    throw new Error('All coding models failed');
                  }

                  const codingData = await codingResponse.json();
                  let artifactContent = codingData.choices?.[0]?.message?.content || '';

                  // Unwrap markdown fences if present
                  const fenceMatch = artifactContent.match(/```[a-z]*\s*([\s\S]*?)\s*```/i);
                  if (fenceMatch && artifactContent.includes('<lucen_artifact')) {
                    artifactContent = fenceMatch[1];
                  } else if (!artifactContent.includes('<lucen_artifact')) {
                    // Synthesize tag if model didn't include one
                    const rawCode = fenceMatch ? fenceMatch[1] : artifactContent;
                    artifactContent = `<lucen_artifact type="${artifactType}" title="${artifactTitle.replace(/"/g, '&quot;')}">
${rawCode.trim()}
</lucen_artifact>`;
                  }

                  output = artifactContent;
                  res = { content: artifactContent };

                  // Inline artifact streaming: write the generated artifact directly to the client's text stream
                  try {
                    const contentPayload = {
                      choices: [{
                        delta: {
                          content: `\n\n${artifactContent}\n\n`
                        }
                      }]
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentPayload)}\n\n`));
                    flushStream();
                  } catch (streamErr) {
                    console.error('[chat-proxy] Failed to stream inline artifact content to client:', streamErr);
                  }

                  // Track coding model token usage if available
                  if (codingData.usage) {
                    totalPromptTokens += codingData.usage.prompt_tokens || 0;
                    totalCompletionTokens += codingData.usage.completion_tokens || 0;
                  }
                } else {
                  // ── Standard tool execution (web_search, analyze_image, process_file) ──
                  let siblingName = tc.name;
                  if (tc.name === 'analyze_image') siblingName = 'describe-image';
                  if (tc.name === 'process_file') siblingName = 'get-file-content';
                  if (tc.name === 'web_search') siblingName = 'web-search';

                  const toolTimeout = 12000;
                  const executionPromise = callSiblingFunction(siblingName, parsedArgs);
                  const timeoutPromise = new Promise<never>((_, reject) => {
                    timerId = setTimeout(() => reject(new Error('timeout')), toolTimeout);
                  });

                  res = await Promise.race([executionPromise, timeoutPromise]);
                  output = res.description ?? res.content ?? res.text ?? JSON.stringify(res);
                }
              } catch (err: any) {
                success = false;
                if (err.message === 'timeout') {
                  output = 'Tool execution timed out. Please try again.';
                } else {
                  output = 'The requested information could not be retrieved. Please continue without it.';
                }
              } finally {
                if (timerId) clearTimeout(timerId);
              }

              durationMs = Date.now() - start;
              toolsExecuted.push({
                id: tc.id!,
                name: tc.name!,
                arguments: tc.arguments,
                status: success ? 'completed' : 'failed',
                durationMs
              });

              if (tc.name === 'web_search') {
                const maxResults = Number(parsedArgs.max_results ?? WEBSEARCH_DEFAULT_MAX_RESULTS);
                totalSearchCost += computeWebSearchCredits(maxResults);
              }

              let label = '';
              if (tc.name === 'analyze_image') {
                label = parsedArgs.analysis_title || 'Analyzing image';
              } else if (tc.name === 'process_file') {
                label = parsedArgs.extraction_title || 'Reading file';
              } else if (tc.name === 'web_search') {
                label = parsedArgs.search_title || 'Searching the web';
              } else if (tc.name === 'generate_artifact') {
                label = parsedArgs.generation_title || 'Creating artifact';
              } else {
                const def = TOOLS[tc.name ?? ''];
                label = def?.userFacingLabel ?? `Running ${tc.name}`;
              }

              const eventPayload = {
                id: tc.id,
                tool: tc.name,
                status: success ? 'completed' : 'failed',
                label,
                args: parsedArgs,
                durationMs,
                output: output.slice(0, 400)
              };
              try {
                controller.enqueue(encoder.encode(`event: tool_activity\ndata: ${JSON.stringify(eventPayload)}\n\n`));
                flushStream();
              } catch { /* ignore */ }

              if (success && tc.name === 'web_search' && res && res.organic && Array.isArray(res.organic) && res.organic.length > 0) {
                const urls = res.organic.map((r: any) => ({
                  title: r.title,
                  url: r.link,
                  snippet: r.snippet
                }));
                const resultsPayload = {
                  urls,
                  query: parsedArgs.query
                };
                try {
                  controller.enqueue(encoder.encode(`event: web_search_results\ndata: ${JSON.stringify(resultsPayload)}\n\n`));
                } catch { /* ignore */ }
              }

              let finalOutput = output;
              // Don't truncate artifact content — it IS the deliverable
              const truncLimit = tc.name === 'generate_artifact' ? 80000 : 12000;
              if (output.length > truncLimit) {
                console.warn(`[chat-proxy] Tool result for ${tc.name} truncated from ${output.length} characters.`);
                finalOutput = output.slice(0, truncLimit) + '\n\n[Result truncated for length]';
              }

              return {
                tool_call_id: tc.id,
                role: 'tool',
                name: tc.name,
                content: finalOutput
              };
            };

            const parallelResults = await Promise.all(parallelCalls.map(runTool));
            toolResults.push(...parallelResults);

            for (const tc of sequentialCalls) {
              const res = await runTool(tc);
              toolResults.push(res);
            }

            currentMessages.push({
              role: 'assistant',
              content: '',
              tool_calls: toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.name,
                  arguments: tc.arguments
                }
              }))
            });
            currentMessages.push(...toolResults);

            rounds++;
            continue;
          } else {
            if (!finalSawDone) {
              try {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              } catch { /* ignore */ }
            }
            break;
          }
        }

        const originalFinishReasonIsNull = finishReason === null;
        if (!finishReason) {
          if (finalStreamError) {
            finishReason = 'error';
          } else if (!finalSawDone) {
            finishReason = 'abort';
          } else {
            finishReason = 'stop';
          }
        }

        if (finalStreamError) {
          finalStatus = 'upstream_error';
          finalStatusReason = finalStreamError.slice(0, 500);
        } else if (finishReason === 'length') {
          finalStatus = 'truncated';
          finalStatusReason = 'finish_reason=length';
        } else if (finishReason === 'stop' && finalSawDone) {
          finalStatus = 'completed';
        } else if (finishReason) {
          finalStatus = 'completed';
          finalStatusReason = `finish_reason=${finishReason}`;
        } else if (!finalSawDone) {
          finalStatus = 'aborted';
          finalStatusReason = 'eof_without_done';
        } else {
          finalStatus = 'completed';
        }

        const totalTokensNum = totalPromptTokens + totalCompletionTokens;
        const textCost = (totalTokensNum / 1000) * CREDITS_PER_1K_TOKENS;
        const actualWebSearchHappened = totalSearchCost > 0;
        const shouldCharge =
          finalStatus === 'completed' || finalStatus === 'truncated' || totalTokensNum > 0;
        const totalCost = shouldCharge ? (textCost + totalSearchCost) : 0;

        if (originalFinishReasonIsNull) {
          Sentry.addBreadcrumb({
            category: 'billing',
            message: `Billing calculated with null finishReason for user ${user.id}, status: ${finalStatus}`,
            level: 'warning',
          });
        }

        try {
          if (shouldCharge && totalCost > 0) {
            await supabaseAdmin.rpc('deduct_user_credits', {
              p_user_id: user.id,
              p_amount: totalCost,
            });
          }

          if (shouldCharge && subscriptionStatus === 'free' && actualWebSearchHappened) {
            await supabaseAdmin
              .from('user_credits')
              .update({ free_searches_used: freeSearchesUsed + 1 })
              .eq('user_id', user.id);
          }
        } catch (dbErr) {
          console.error('[chat-proxy] CRITICAL: Failed to deduct stream credits:', dbErr);
          try {
            controller.enqueue(encoder.encode(
              `event: error\ndata: ${JSON.stringify({ error: 'Credit deduction failed. Your balance may be inaccurate.', code: 'BILLING_ERROR' })}\n\n`
            ));
          } catch { /* stream already closed */ }
        }

        const receiptPayload = {
          tools_used: toolsExecuted,
          prompt_tokens: totalPromptTokens,
          completion_tokens: totalCompletionTokens,
          reasoning_tokens: totalReasoningTokens,
          total_credits: totalCost,
          search_credits: totalSearchCost
        };
        controller.enqueue(encoder.encode(`event: usage_receipt\ndata: ${JSON.stringify(receiptPayload)}\n\n`));

        accounting.finalized = true;
        accounting.status = finalStatus;
        accounting.statusReason = finalStatusReason;
        accounting.errorMessage = finalStreamError;
        accounting.promptTokens = totalPromptTokens;
        accounting.completionTokens = totalCompletionTokens;
        accounting.reasoningTokens = totalReasoningTokens;
        accounting.textCredits = textCost;
        accounting.imageCredits = 0;
        accounting.webSearchCredits = totalSearchCost;
        accounting.totalCredits = totalCost;
        accounting.webSearchResultsBilled = actualWebSearchHappened ? (totalSearchCost / (LC_PER_USD * (WEBSEARCH_USD_PER_1K_RESULTS / 1000))) : null;

        await recordUsage({
          userId: user.id,
          conversationId: accounting.conversationId,
          messageId: accounting.messageId,
          callKind: accounting.callKind,
          status: finalStatus,
          statusReason: finalStatusReason,
          errorMessage: finalStreamError,
          requestId: accounting.requestId,
          parentRequestId: accounting.parentRequestId,
          modelId: accounting.modelId,
          durationMs: Date.now() - startedAt,
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          reasoningTokens: totalReasoningTokens,
          imageTokens: 0,
          textCredits: textCost,
          imageCredits: 0,
          webSearchCredits: totalSearchCost,
          totalCreditsDeducted: totalCost,
          inputCostPer1M: accounting.inputCostPer1M,
          outputCostPer1M: accounting.outputCostPer1M,
          webSearchEnabled: webSearchRequested,
          webSearchEngine: accounting.webSearchEngine,
          webSearchMaxResults: accounting.webSearchMaxResults,
          webSearchResultsBilled: accounting.webSearchResultsBilled,
        });

      } catch (e: any) {
        console.error('[chat-proxy] Stream internal execution error:', e);
        if (!finishReason) {
          finishReason = 'error';
        }
        try {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`));
          // Always emit [DONE] after error so the client's processStream
          // exits cleanly instead of triggering infinite continuation retries.
          // BUG-06 Fix: guarantee [DONE] is written
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch { /* skip */ }
      } finally {
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
        }
        try {
          // BUG-06 Fix: guarantee [DONE] is sent before closing if not already saw done or if it ended with error
          if (!finalSawDone && finishReason === 'error') {
            try {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            } catch { /* ignore */ }
          }
          controller.close();
        } catch { /* ignore */ }
      }
    }
  });

  return new Response(responseStream, {
    headers: {
      ...cors,
      ...configHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
