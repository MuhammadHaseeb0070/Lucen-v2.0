import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as Sentry from 'https://esm.sh/@sentry/deno@10.56.0';
import { recordUsage } from '../_shared/usage.ts';
import { TOOLS } from '../_shared/toolRegistry.ts';
import { circuitSuccess, circuitFailure } from '../_shared/circuitBreaker.ts';
import { buildResponseFormatContract } from './utils.ts';
import { computeWebSearchCredits, LC_PER_USD, WEBSEARCH_USD_PER_1K_RESULTS, CREDITS_PER_1K_TOKENS } from './billing.ts';

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

export function handleStreamRequest(options: StreamHandlerOptions): Response {
  const {
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

  const responseStream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      let keepaliveTimer: any = null;
      
      let currentMessages = [...messages];
      let rounds = 0;
      const maxRounds = 3;
      
      const toolCallCounts: Record<string, number> = {};
      const MAX_CALLS_PER_TOOL: Record<string, number> = { web_search: 3 };
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

          const allLimitsReached = toolsToPass.length > 0 && toolsToPass.every((tool: any) => {
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
            return false;
          });
          const isLastRound = rounds >= maxRounds - 1;

          if (allLimitsReached || isLastRound) {
            currentMessages.push({
              role: 'system',
              content: 'FINAL RESPONSE REQUIRED: Generate a complete, helpful response now using only the search results and information already retrieved above. Do not output search queries. Do not reference needing more searches. Write a direct, useful answer to the user.'
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

          const requestBody: any = {
            model: effectiveModel,
            messages: filteredMessages,
            stream: true,
            max_tokens: resolvedMaxTokens,
            max_completion_tokens: resolvedMaxTokens,
            include_usage: true,
            ...(response_format ? { response_format } : {}),
            ...(provider ? { provider } : {}),
            ...(is_reasoning ? { reasoning: { enabled: true } } : {}),
          };

          if (toolsToPass.length > 0 && rounds < maxRounds - 1 && !allLimitsReached) {
            requestBody.tools = toolsToPass;
            requestBody.tool_choice = 'auto';
          }

          const openrouterResponse = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${openrouterApiKey}`,
              'HTTP-Referer': supabaseUrl,
              'X-Title': 'Lucen',
            },
            body: JSON.stringify(requestBody),
          });

          if (!openrouterResponse.ok) {
            const errBody = await openrouterResponse.text().catch(() => '');
            circuitFailure('openrouter');
            log.error('OpenRouter stream error', { status: openrouterResponse.status, body: errBody.slice(0, 300) });
            throw new Error(`OpenRouter upstream error ${openrouterResponse.status}: ${errBody}`);
          }
          circuitSuccess('openrouter');

          const reader = openrouterResponse.body!.getReader();
          
          let isToolCall = false;
          const firstChunks: Uint8Array[] = [];
          const flushedChunks: boolean[] = [];
          let accumulatedText = '';
          let chunkCount = 0;

          outerLoop: while (true) {
            if (chunkCount >= 1000) {
              isToolCall = false;
              break;
            }

            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunkCount++;
              firstChunks.push(value);
              flushedChunks.push(false);
              const text = decoder.decode(value, { stream: true });
              accumulatedText += text;

              const lines = text.split('\n');
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) continue;
                const dataStr = trimmed.slice(6);
                if (dataStr === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(dataStr);
                  const choice = parsed.choices?.[0];
                  if (choice) {
                    if (choice.delta?.tool_calls && Array.isArray(choice.delta.tool_calls) && choice.delta.tool_calls.length > 0) {
                      isToolCall = true;
                      break outerLoop;
                    }
                    if (typeof choice.delta?.content === 'string' && choice.delta.content.trim().length > 0) {
                      isToolCall = false;
                      break outerLoop;
                    }
                    const reasoning = choice.delta?.reasoning || choice.delta?.reasoning_content;
                    if (typeof reasoning === 'string' && reasoning.trim().length > 0) {
                      if (!flushedChunks[flushedChunks.length - 1]) {
                        try {
                          controller.enqueue(value);
                        } catch { /* ignore */ }
                        flushedChunks[flushedChunks.length - 1] = true;
                      }
                    }
                    const fr = choice.finish_reason;
                    if (fr !== null && fr !== undefined) {
                      isToolCall = (fr === 'tool_calls');
                      finishReason = String(fr);
                      break outerLoop;
                    }
                  }
                } catch { /* skip */ }
              }
            }
          }

          if (isToolCall) {
            let unflushedText = '';
            for (let i = 0; i < firstChunks.length; i++) {
              if (!flushedChunks[i]) {
                unflushedText += decoder.decode(firstChunks[i], { stream: true });
              }
            }
            const outputText = unflushedText.replace(/data:\s*\[DONE\][\r\n]*/g, '');
            if (outputText) {
              try {
                controller.enqueue(encoder.encode(outputText));
              } catch { /* ignore */ }
            }

            keepaliveTimer = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(": keepalive\n\n"));
              } catch { /* ignore */ }
            }, 5000);

            const toolCallsMap = new Map<number, {
              id?: string;
              name?: string;
              arguments: string;
            }>();

            const parseText = (txt: string) => {
              const lines = txt.split('\n');
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) continue;
                const dataStr = trimmed.slice(6);
                if (dataStr === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(dataStr);
                  if (parsed.usage) {
                    totalPromptTokens += parsed.usage.prompt_tokens || 0;
                    totalCompletionTokens += parsed.usage.completion_tokens || 0;
                    totalReasoningTokens += getReasoningTokens(parsed.usage) || 0;
                  }
                  const delta = parsed.choices?.[0]?.delta;
                  if (delta?.tool_calls) {
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
                  }
                } catch { /* skip */ }
              }
            };

            parseText(accumulatedText);

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                let text = decoder.decode(value, { stream: true });
                parseText(text);
                text = text.replace(/data:\s*\[DONE\][\r\n]*/g, '');
                if (text) {
                  try {
                    controller.enqueue(encoder.encode(text));
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
                  } catch { /* ignore */ }

                  return {
                    tool_call_id: tc.id,
                    role: 'tool',
                    name: tc.name,
                    content: output
                  };
                }

                const ALLOWED_TOOLS = ['analyze_image', 'process_file', 'web_search'];
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
                  let siblingName = tc.name;
                  if (tc.name === 'analyze_image') siblingName = 'describe-image';
                  if (tc.name === 'process_file') siblingName = 'get-file-content';
                  if (tc.name === 'web_search') siblingName = 'web-search';

                  const executionPromise = callSiblingFunction(siblingName, parsedArgs);
                  const timeoutPromise = new Promise<never>((_, reject) => {
                    timerId = setTimeout(() => reject(new Error('timeout')), 12000);
                  });

                  res = await Promise.race([executionPromise, timeoutPromise]);
                  output = res.description ?? res.content ?? res.text ?? JSON.stringify(res);
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
                if (output.length > 12000) {
                  console.warn(`[chat-proxy] Tool result for ${tc.name} truncated from ${output.length} characters.`);
                  finalOutput = output.slice(0, 12000) + '\n\n[Result truncated for length]';
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
            }
            if (keepaliveTimer) {
              clearInterval(keepaliveTimer);
              keepaliveTimer = null;
            }
            rounds++;
            continue;
          } else {
            try {
              controller.enqueue(encoder.encode(
                `event: content_start\ndata: ${JSON.stringify({ 
                  after_tool_calls: rounds > 0, model: effectiveModel 
                })}\n\n`
              ));
            } catch { /* ignore */ }

            for (let i = 0; i < firstChunks.length; i++) {
              if (!flushedChunks[i]) {
                try {
                  controller.enqueue(firstChunks[i]);
                } catch { /* ignore */ }
                flushedChunks[i] = true;
              }
            }

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
                try {
                  controller.enqueue(value);
                } catch { /* ignore */ }

                const text = decoder.decode(value, { stream: true });
                const lines = text.split('\n');
                for (const line of lines) {
                  if (!line.trim().startsWith('data: ')) continue;
                  const dataStr = line.trim().slice(6);
                  if (dataStr === '[DONE]') {
                    finalSawDone = true;
                    continue;
                  }
                  try {
                    const parsed = JSON.parse(dataStr);
                    if (parsed.usage) {
                      totalPromptTokens += parsed.usage.prompt_tokens || 0;
                      totalCompletionTokens += parsed.usage.completion_tokens || 0;
                      totalReasoningTokens += getReasoningTokens(parsed.usage) || 0;
                    }
                    if (parsed.error) {
                      finalStreamError = parsed.error.message ?? 'stream error';
                    }
                    const choice = parsed.choices?.[0];
                    const fr = choice?.finish_reason;
                    if (fr !== null && fr !== undefined) {
                      finishReason = String(fr);
                    }
                  } catch { /* skip */ }
                }
              }
            }

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
