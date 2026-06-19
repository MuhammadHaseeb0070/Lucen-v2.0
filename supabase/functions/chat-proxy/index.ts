import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as Sentry from 'https://esm.sh/@sentry/deno@10.56.0';
import { getCorsHeaders } from '../_shared/cors.ts';
import { recordUsage, type UsageStatus, type UsageCallKind } from '../_shared/usage.ts';
import { TOOLS } from '../_shared/toolRegistry.ts';
import { createLogger } from '../_shared/logging.ts';
import { circuitAllow, circuitSuccess, circuitFailure } from '../_shared/circuitBreaker.ts';
import { isKillSwitched } from '../_shared/featureFlags.ts';
import { getModelConfig, normalizeModelParams, getDynamicHeaders } from '../_shared/models.ts';

import { handleAuthAndRateLimit } from './auth.ts';
import { deductCredits, computeWebSearchCredits, CREDITS_PER_IMAGE, CREDITS_PER_1K_TOKENS, LC_PER_USD, WEBSEARCH_USD_PER_1K_RESULTS } from './billing.ts';
import { handleStreamRequest } from './streamHandler.ts';
import {
  forceImageDetailLow,
  countImagesInMessages,
  sanitizeWebPlugins,
  detectAttachments,
  hasWebPlugin,
  FREE_TIER_MAX_SEARCHES,
  ABSOLUTE_OUTPUT_CEILING,
  MIN_OUTPUT,
  WEBSEARCH_DEFAULT_MAX_RESULTS,
  WEBSEARCH_DEFAULT_ENGINE
} from './utils.ts';

Sentry.init({
  dsn: Deno.env.get("SENTRY_DSN") || "",
  environment: Deno.env.get("SENTRY_ENV") || "development",
});

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const PATCH_SIDECAR_SYSTEM_PROMPT = `<lucen_system>
<identity>
You are the Lucen Patch Engine. Your ONLY job is to surgically modify existing code artifacts based on user instructions or error messages.
You do not converse, you do not explain, you do not greet the user. You are a strictly machine-to-machine component.
</identity>

<rules>
1. Output ONLY Git conflict marker patches.
2. NEVER wrap your patches in artifact tags (like <lucen_artifact>), markdown code fences (\`\`\`), or any other formatting.
3. NEVER output conversational text (e.g. "Here is the patch:", "Sure, I can fix that."). The UI will discard any explanation text.
4. If the requested change requires modifying more than 30% of the file, or if the file structure is fundamentally changing, output exactly this string:
FULL_REGEN_REQUIRED
5. If the request is too vague to locate a unique SEARCH block, output exactly this string:
AMBIGUOUS_PATCH
6. CRITICAL: The search engine does NOT support regex or fuzzy matching. The SEARCH block MUST be a 100% exact, literal, character-for-character reproduction of the lines you want to replace, including all whitespace and indentation.
7. CRITICAL: NEVER use ellipsis (\`...\` or \`…\`) to abbreviate or skip lines in the SEARCH block. If you truncate the code, the patch WILL FAIL. If the block is too large, use multiple smaller SEARCH/REPLACE blocks.

<patch_format>
Use exactly this format for each block of changes:
<<<<<<< SEARCH
[Exact lines of existing code to locate the change. Must be an EXACT literal string match, no abbreviations or skipped lines.]
=======
[The new lines of code that replace the search block]
>>>>>>> REPLACE
</patch_format>

You may output multiple SEARCH/REPLACE blocks in a single response to modify different parts of the file.
</rules>
</lucen_system>`;

function getReasoningTokens(usage: Record<string, unknown> | undefined): number {
  if (!usage || typeof usage !== 'object') return 0;
  const details = usage.completion_tokens_details as Record<string, unknown> | undefined;
  const value = details?.reasoning_tokens;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // Barcode tracing: retrieve X-Correlation-ID header
  const correlationId = req.headers.get('X-Correlation-ID') || req.headers.get('x-correlation-id') || crypto.randomUUID();
  const log = createLogger('chat-proxy', { correlationId });

  // Feature flag kill switch — return 503 if chat is disabled
  if (isKillSwitched('CHAT')) {
    return new Response(JSON.stringify({ error: 'Chat is temporarily unavailable. Please try again later.' }), {
      status: 503,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const accounting = {
    finalized: false,
    status: 'completed' as UsageStatus,
    statusReason: null as string | null,
    errorMessage: null as string | null,
    callKind: 'chat' as UsageCallKind,
    userId: null as string | null,
    requestId: null as string | null,
    parentRequestId: null as string | null,
    conversationId: null as string | null,
    messageId: null as string | null,
    modelId: null as string | null,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    imageTokens: 0,
    textCredits: 0,
    imageCredits: 0,
    webSearchCredits: 0,
    totalCredits: 0,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    webSearchEnabled: false,
    webSearchEngine: null as string | null,
    webSearchMaxResults: null as number | null,
    webSearchResultsBilled: null as number | null,
  };
  const startedAt = Date.now();

  const fail = async (
    status: UsageStatus,
    httpStatus: number,
    message: string,
    statusReason: string | null = null,
  ): Promise<Response> => {
    accounting.finalized = true;
    accounting.status = status;
    accounting.errorMessage = message;
    accounting.statusReason = statusReason;
    await recordUsage({
      userId: accounting.userId ?? 'unknown',
      conversationId: accounting.conversationId,
      messageId: accounting.messageId,
      callKind: accounting.callKind,
      status,
      statusReason,
      errorMessage: message,
      requestId: accounting.requestId,
      parentRequestId: accounting.parentRequestId,
      modelId: accounting.modelId,
      durationMs: Date.now() - startedAt,
      inputCostPer1M: accounting.inputCostPer1M,
      outputCostPer1M: accounting.outputCostPer1M,
    });
    return new Response(JSON.stringify({ error: message }), {
      status: httpStatus,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  };

  try {
    const authResult = await handleAuthAndRateLimit(req, log, cors, fail);
    if (!authResult.success) {
      return authResult.errorResponse!;
    }

    const { userId, expiry, user, supabaseAdmin, token } = authResult;
    accounting.userId = userId;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY')!;
    const authHeader = req.headers.get('Authorization')!;

    // Parse request body
    const body = await req.json();
    const {
      messages,
      model,
      max_tokens,
      max_completion_tokens,
      mode,
      is_reasoning,
      stream,
      plugins,
      response_format,
      provider,
      __bg_description,
      web_search_enabled,
      webSearchEnabled,
      enableWebSearch,
      web_search_used,
      web_search_fallback_requested,
      request_id,
      parent_request_id,
      conversation_id,
      message_id,
      call_kind,
      input_cost_per_1m,
      output_cost_per_1m,
      patch,
    } = body ?? {};

    if (typeof request_id === 'string') accounting.requestId = request_id;
    if (typeof parent_request_id === 'string') accounting.parentRequestId = parent_request_id;
    if (typeof conversation_id === 'string') accounting.conversationId = conversation_id;
    if (typeof message_id === 'string') accounting.messageId = message_id;
    if (typeof call_kind === 'string') {
      accounting.callKind = call_kind as UsageCallKind;
    }
    if (patch) {
      accounting.callKind = 'patch';
    }
    if (typeof input_cost_per_1m === 'number' && Number.isFinite(input_cost_per_1m)) {
      accounting.inputCostPer1M = input_cost_per_1m;
    }
    if (typeof output_cost_per_1m === 'number' && Number.isFinite(output_cost_per_1m)) {
      accounting.outputCostPer1M = output_cost_per_1m;
    }

    if (patch && messages && Array.isArray(messages)) {
      const systemIndex = messages.findIndex((m: any) => m.role === 'system');
      if (systemIndex !== -1) {
        messages[systemIndex].content = PATCH_SIDECAR_SYSTEM_PROMPT;
      } else {
        messages.unshift({ role: 'system', content: PATCH_SIDECAR_SYSTEM_PROMPT });
      }
    }

    if (!messages || !Array.isArray(messages)) {
      return await fail('client_error', 400, 'Invalid request: messages array required');
    }
    if (!model || typeof model !== 'string') {
      return await fail('client_error', 400, 'model is required');
    }

    const isSideChat = model === 'side-chat-model';
    const isMainChat = model === 'main-chat-model';
    const isCodingChat = model === 'coding-chat-model';

    let fallbackModels: string[] = [];
    if (isMainChat) {
      fallbackModels = [
        Deno.env.get('MAIN_CHAT_MODEL_PRIMARY'),
        Deno.env.get('MAIN_CHAT_MODEL_SECONDARY'),
        Deno.env.get('MAIN_CHAT_MODEL_TERTIARY'),
        Deno.env.get('MAIN_CHAT_MODEL')
      ].filter((m): m is string => !!m && m.trim().length > 0);
      if (fallbackModels.length === 0) {
        fallbackModels.push('minimax/minimax-01');
      }
    } else if (isSideChat) {
      fallbackModels = [
        Deno.env.get('SIDE_CHAT_MODEL_PRIMARY'),
        Deno.env.get('SIDE_CHAT_MODEL_SECONDARY'),
        Deno.env.get('SIDE_CHAT_MODEL_TERTIARY'),
        Deno.env.get('SIDE_CHAT_MODEL')
      ].filter((m): m is string => !!m && m.trim().length > 0);
      if (fallbackModels.length === 0) {
        fallbackModels.push('openai/gpt-4o-mini');
      }
    } else if (isCodingChat) {
      fallbackModels = [
        Deno.env.get('CODING_CHAT_MODEL_PRIMARY'),
        Deno.env.get('CODING_CHAT_MODEL_SECONDARY'),
        Deno.env.get('CODING_CHAT_MODEL_TERTIARY'),
        Deno.env.get('CODING_CHAT_MODEL')
      ].filter((m): m is string => !!m && m.trim().length > 0);
      if (fallbackModels.length === 0) {
        fallbackModels.push('qwen/qwen-2.5-coder-32b-instruct');
      }
    } else {
      fallbackModels = [model];
    }
    fallbackModels = Array.from(new Set(fallbackModels));

    let effectiveModel = fallbackModels[0];
    accounting.modelId = effectiveModel;

    let configHeaders = getDynamicHeaders(effectiveModel, model);

    const imageCount = countImagesInMessages(messages);
    accounting.imageTokens = imageCount;

    // Deprecation: log warning when legacy camelCase web search keys are used
    if (webSearchEnabled !== undefined || enableWebSearch !== undefined) {
      log.warn('[DEPRECATED] Legacy web search key detected', {
        keys: [
          webSearchEnabled !== undefined ? 'webSearchEnabled' : null,
          enableWebSearch !== undefined ? 'enableWebSearch' : null,
        ].filter(Boolean),
        recommendation: 'Use web_search_enabled (snake_case) instead',
      });
    }

    const legacyPluginRequested = hasWebPlugin(plugins);
    const webSearchRequested = !!(web_search_enabled || webSearchEnabled || enableWebSearch);
    const webSearchFallback = !!web_search_fallback_requested;
    const webSearchUsed = !!web_search_used;

    if (!webSearchRequested) {
      const systemMsg = {
        role: 'system',
        content: 'You do not have access to the internet or web search in this conversation. Do not attempt to search the web, generate search queries, or reference real-time information. If asked about current events or live data, honestly tell the user you cannot access the web and suggest they enable web search.'
      };
      const reversedIndex = [...messages].reverse().findIndex(m => m.role === 'user');
      if (reversedIndex !== -1) {
        const targetIndex = messages.length - 1 - reversedIndex;
        messages.splice(targetIndex, 0, systemMsg);
      } else {
        messages.push(systemMsg);
      }
    }

    const sanitizedWebPlugins = webSearchFallback && legacyPluginRequested
      ? sanitizeWebPlugins(plugins)
      : undefined;
    const webSearchMaxResults = webSearchRequested
      ? (sanitizedWebPlugins && sanitizedWebPlugins[0] && typeof sanitizedWebPlugins[0].max_results === 'number'
        ? (sanitizedWebPlugins[0].max_results as number)
        : WEBSEARCH_DEFAULT_MAX_RESULTS)
      : 0;
    const webSearchEngine = webSearchRequested
      ? (sanitizedWebPlugins && sanitizedWebPlugins[0] && typeof sanitizedWebPlugins[0].engine === 'string'
        ? (sanitizedWebPlugins[0].engine as string)
        : WEBSEARCH_DEFAULT_ENGINE)
      : '';

    accounting.webSearchEnabled = webSearchRequested;
    accounting.webSearchEngine = webSearchRequested ? webSearchEngine : null;
    accounting.webSearchMaxResults = webSearchRequested ? webSearchMaxResults : null;
    if (legacyPluginRequested && !webSearchFallback) {
      log.warn('ignoring legacy plugins field without explicit web_search_fallback_requested=true');
      if (!accounting.statusReason) {
        accounting.statusReason = 'ignored_legacy_plugins_without_fallback';
      }
    }

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    const { hasImage, hasFile } = detectAttachments(lastUserMessage ? [lastUserMessage] : []);
    const toolsToPass: any[] = [];
    if (hasImage) {
      toolsToPass.push(TOOLS.analyze_image);
    }
    if (hasFile) {
      toolsToPass.push(TOOLS.process_file);
    }

    log.info('attachments check', { hasImage, hasFile, toolsToPassCount: toolsToPass.length });

    if (webSearchFallback) {
      const onlineModel = Deno.env.get('OPENROUTER_ONLINE_MODEL');
      if (onlineModel) {
        effectiveModel = onlineModel;
        accounting.modelId = effectiveModel;
        accounting.statusReason = 'web_search_fallback_online_model';
        log.warn('web_search_fallback_requested — switching model', { onlineModel });
      } else {
        log.warn('fallback requested but OPENROUTER_ONLINE_MODEL is not set; using main model');
      }
    }

    await supabaseAdmin!.rpc('ensure_user_credits', {
      p_user_id: user.id,
      p_initial_credits: 100,
    });

    const { data: creditsRow, error: creditsErr } = await supabaseAdmin!
      .from('user_credits')
      .select('remaining_credits, subscription_status, free_searches_used')
      .eq('user_id', user.id)
      .single();

    if (creditsErr || !creditsRow) {
      return await fail('upstream_error', 500, 'Failed to load user credits');
    }

    const subscriptionStatus = (creditsRow.subscription_status || 'free') as string;
    const remainingCredits = typeof creditsRow.remaining_credits === 'number' ? creditsRow.remaining_credits : 0;
    const freeSearchesUsed = typeof (creditsRow as Record<string, unknown>).free_searches_used === 'number'
      ? ((creditsRow as Record<string, unknown>).free_searches_used as number)
      : 0;

    if (remainingCredits <= 0 && !__bg_description) {
      return await fail('insufficient_credits', 402, 'Insufficient credits');
    }

    if (webSearchRequested && remainingCredits > 0) {
      toolsToPass.push(TOOLS.web_search);
    }

    const effectivePlugins: unknown = webSearchFallback ? sanitizedWebPlugins : undefined;
    if (subscriptionStatus === 'free') {
      forceImageDetailLow(messages);
      if (webSearchRequested && freeSearchesUsed >= FREE_TIER_MAX_SEARCHES) {
        return await fail(
          'insufficient_credits',
          402,
          'Free tier web search limit reached. Upgrade to Regular or Pro for unlimited web search.',
          'FREE_SEARCH_LIMIT_REACHED',
        );
      }
    }

    const resolvedMaxTokens = __bg_description
      ? 200
      : Math.min(
        Math.max(MIN_OUTPUT, Number(max_completion_tokens ?? max_tokens) || 4096),
        ABSOLUTE_OUTPUT_CEILING,
      );

    const shouldStream = patch ? false : (stream !== false);

    if (!await circuitAllow('openrouter')) {
      log.warn('Circuit breaker OPEN — OpenRouter unavailable');
      return await fail('upstream_error', 503, 'AI service is temporarily unavailable. Please try again in a moment.');
    }

    if (!shouldStream) {
      let openrouterResponse: Response | null = null;
      let successfulModel = '';
      let lastError: any = null;

      for (const currentModel of fallbackModels) {
        try {
          log.info(`Attempting non-streaming call with model: ${currentModel}`);
          const basePayload = {
            model: currentModel,
            messages,
            stream: false,
            max_tokens: resolvedMaxTokens,
            max_completion_tokens: resolvedMaxTokens,
            include_usage: true,
            ...(response_format ? { response_format } : {}),
            ...(provider ? { provider } : {}),
            ...(webSearchFallback && effectivePlugins ? { plugins: effectivePlugins } : {}),
            ...(is_reasoning ? { is_reasoning: true } : {}),
          };
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
            openrouterResponse = res;
            successfulModel = currentModel;
            effectiveModel = currentModel;
            accounting.modelId = currentModel;
            break;
          } else {
            const errBody = await res.text().catch(() => '');
            lastError = new Error(`OpenRouter API Error ${res.status}: ${errBody}`);
            log.warn(`Model ${currentModel} failed: ${lastError.message}`);
            Sentry.captureMessage(`Model fallback triggered from ${currentModel}. Error: ${lastError.message}`, 'warning');
          }
        } catch (err: any) {
          lastError = err;
          log.warn(`Model ${currentModel} failed with exception: ${err.message}`);
          Sentry.captureMessage(`Model fallback triggered from ${currentModel} due to exception: ${err.message}`, 'warning');
        }
      }

      if (!openrouterResponse || !openrouterResponse.ok) {
        await circuitFailure('openrouter');
        const errMsg = lastError?.message || 'All models in fallback chain failed';
        return await fail(
          'upstream_error',
          502,
          `OpenRouter API Error: ${errMsg}`,
          errMsg
        );
      } else {
        await circuitSuccess('openrouter');
      }

      // Regenerate dynamic headers using the successful model's metadata
      configHeaders = getDynamicHeaders(successfulModel, model);

      const json = await openrouterResponse.json();
      const finishReason = json?.choices?.[0]?.finish_reason
        ? String(json.choices[0].finish_reason)
        : null;
      const usage = json?.usage || {};
      const promptTokens = usage?.prompt_tokens || 0;
      const completionTokens = usage?.completion_tokens || 0;
      const reasoningTokens = getReasoningTokens(usage);
      const totalTokens = usage?.total_tokens ?? (promptTokens + completionTokens);
      const totalTokensNum = typeof totalTokens === 'number' && Number.isFinite(totalTokens)
        ? totalTokens
        : (promptTokens + completionTokens);

      const textCost = (totalTokensNum / 1000) * CREDITS_PER_1K_TOKENS;
      const imageCost = imageCount * CREDITS_PER_IMAGE;
      const actualWebSearchHappened = webSearchUsed || webSearchFallback;
      const searchCost = actualWebSearchHappened ? computeWebSearchCredits(webSearchMaxResults) : 0;
      const totalCost = textCost + imageCost + searchCost;

      try {
        await deductCredits(
          supabaseAdmin!,
          user.id,
          totalCost,
          subscriptionStatus,
          actualWebSearchHappened,
          freeSearchesUsed
        );
      } catch (dbErr) {
        log.error('Failed to deduct credits:', dbErr);
      }

      accounting.finalized = true;
      accounting.status = finishReason === 'length' ? 'truncated' : 'completed';
      accounting.statusReason = finishReason ? `finish_reason=${finishReason}` : null;
      accounting.promptTokens = promptTokens;
      accounting.completionTokens = completionTokens;
      accounting.reasoningTokens = reasoningTokens;
      accounting.textCredits = textCost;
      accounting.imageCredits = imageCost;
      accounting.webSearchCredits = searchCost;
      accounting.totalCredits = totalCost;
      accounting.webSearchResultsBilled = actualWebSearchHappened ? webSearchMaxResults : null;

      await recordUsage({
        userId: user.id,
        conversationId: accounting.conversationId,
        messageId: accounting.messageId,
        callKind: accounting.callKind,
        status: accounting.status,
        statusReason: accounting.statusReason,
        requestId: accounting.requestId,
        parentRequestId: accounting.parentRequestId,
        modelId: accounting.modelId,
        durationMs: Date.now() - startedAt,
        promptTokens,
        completionTokens,
        reasoningTokens,
        imageTokens: imageCount,
        textCredits: textCost,
        imageCredits: imageCost,
        webSearchCredits: searchCost,
        totalCreditsDeducted: totalCost,
        inputCostPer1M: accounting.inputCostPer1M,
        outputCostPer1M: accounting.outputCostPer1M,
        webSearchEnabled: webSearchRequested,
        webSearchEngine: accounting.webSearchEngine,
        webSearchMaxResults: accounting.webSearchMaxResults,
        webSearchResultsBilled: accounting.webSearchResultsBilled,
      });

      return new Response(JSON.stringify(json), {
        headers: { ...cors, ...configHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Streaming mode delegated to streamHandler.ts
    return await handleStreamRequest({
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
      fallbackModels,
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
    });

  } catch (err) {
    log.error('chat-proxy general error:', err);
    if (!accounting.finalized) {
      accounting.finalized = true;
      accounting.status = 'upstream_error';
      accounting.errorMessage = err instanceof Error ? err.message : 'Internal server error';
      await recordUsage({
        userId: accounting.userId ?? 'unknown',
        conversationId: accounting.conversationId,
        messageId: accounting.messageId,
        callKind: accounting.callKind,
        status: accounting.status,
        statusReason: accounting.statusReason,
        errorMessage: accounting.errorMessage,
        requestId: accounting.requestId,
        parentRequestId: accounting.parentRequestId,
        modelId: accounting.modelId,
        durationMs: Date.now() - startedAt,
        inputCostPer1M: accounting.inputCostPer1M,
        outputCostPer1M: accounting.outputCostPer1M,
      });
    }
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
