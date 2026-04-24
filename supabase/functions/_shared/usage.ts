// ============================================================================
// Shared usage-logging helper for all Edge Functions.
//
// Design rules:
//   1. recordUsage() MUST NEVER throw back to the caller — logging a log
//      should never be able to break a request. All errors are swallowed
//      and surfaced as console.error only.
//   2. A single call = a single row. No batching. No retries (the caller
//      has already completed its main work; a dropped log is better than a
//      hang).
//   3. status and call_kind are strongly typed so typos fail the CHECK
//      constraints loudly instead of silently storing garbage.
//   4. usd_cost is computed from tokens + per-1M rates passed in by the
//      caller. If rates are missing (0), usd_cost is 0. We never fabricate
//      pricing.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type UsageStatus =
    | 'completed'
    | 'truncated'
    | 'aborted'
    | 'upstream_error'
    | 'timeout'
    | 'auth_error'
    | 'insufficient_credits'
    | 'client_error';

export type UsageCallKind =
    | 'chat'
    | 'chat_continuation'
    | 'classify_intent'
    | 'embed'
    | 'retrieve'
    | 'describe_image'
    | 'web_search'
    | 'title_gen';

export interface RecordUsageInput {
    userId: string;

    conversationId?: string | null;
    messageId?: string | null;

    callKind: UsageCallKind;
    status: UsageStatus;
    statusReason?: string | null;
    errorMessage?: string | null;

    requestId?: string | null;
    parentRequestId?: string | null;

    modelId?: string | null;
    provider?: string | null;

    // Token counts (defaults to 0 if missing).
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
    imageTokens?: number;
    fileTokens?: number;

    // LC (Lucen Credits) economics.
    textCredits?: number;
    imageCredits?: number;
    webSearchCredits?: number;
    totalCreditsDeducted?: number;

    // Real provider USD cost inputs. When rates are 0 or missing,
    // usd_cost is computed as 0.
    inputCostPer1M?: number;
    outputCostPer1M?: number;

    /**
     * Explicit USD cost, overrides the tokens-× rates computation. Use this
     * for non-token-based calls whose cost model is per-unit (e.g. Tavily
     * charges $4 per 1,000 searches regardless of token count).
     */
    fixedUsdCost?: number;

    // Web search metadata (optional).
    webSearchEnabled?: boolean;
    webSearchEngine?: string | null;
    webSearchMaxResults?: number | null;
    webSearchResultsBilled?: number | null;

    durationMs?: number;
}

/**
 * Compute real USD cost from tokens + per-1M rates.
 *
 * Reasoning tokens are billed at the output rate (per OpenRouter / Anthropic
 * pricing pages). Image tokens are not charged here because vision passes
 * are routed through describe-image which logs its own row.
 */
function computeUsdCost(input: RecordUsageInput): number {
    // Explicit per-unit cost (e.g. Tavily's $0.004/search) always wins.
    if (typeof input.fixedUsdCost === 'number' && input.fixedUsdCost >= 0) {
        return input.fixedUsdCost;
    }

    const inRate = input.inputCostPer1M ?? 0;
    const outRate = input.outputCostPer1M ?? 0;
    if (!inRate && !outRate) return 0;

    const prompt = input.promptTokens ?? 0;
    const completion = input.completionTokens ?? 0;
    const reasoning = input.reasoningTokens ?? 0;

    return (prompt * inRate + (completion + reasoning) * outRate) / 1_000_000;
}

/**
 * Derive provider slug from a model id (`openai/gpt-4o` -> `openai`).
 * Passing an explicit `provider` overrides this.
 */
function deriveProvider(input: RecordUsageInput): string | null {
    if (input.provider) return input.provider;
    if (!input.modelId) return null;
    const head = input.modelId.split('/')[0];
    return head || null;
}

/**
 * Insert a single usage_logs row. Swallows all errors — the caller's main
 * work must never be broken by logging.
 */
export async function recordUsage(input: RecordUsageInput): Promise<void> {
    try {
        if (!input.userId) {
            console.warn('[usage] recordUsage: missing userId, skipping');
            return;
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!supabaseUrl || !serviceKey) {
            console.warn('[usage] missing SUPABASE_URL/SERVICE_ROLE_KEY, skipping log');
            return;
        }

        const admin = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false },
        });

        const usdCost = computeUsdCost(input);
        const provider = deriveProvider(input);

        const row: Record<string, unknown> = {
            user_id: input.userId,
            conversation_id: input.conversationId ?? null,
            message_id: input.messageId ?? null,

            call_kind: input.callKind,
            status: input.status,
            status_reason: input.statusReason ?? null,
            error_message: input.errorMessage ?? null,

            request_id: input.requestId ?? null,
            parent_request_id: input.parentRequestId ?? null,

            model_id: input.modelId ?? null,
            provider,

            prompt_tokens: input.promptTokens ?? 0,
            completion_tokens: input.completionTokens ?? 0,
            reasoning_tokens: input.reasoningTokens ?? 0,
            image_tokens: input.imageTokens ?? 0,
            file_tokens: input.fileTokens ?? 0,

            text_credits: input.textCredits ?? 0,
            image_credits: input.imageCredits ?? 0,
            web_search_credits: input.webSearchCredits ?? 0,
            total_credits_deducted: input.totalCreditsDeducted ?? 0,

            usd_cost: usdCost,
            duration_ms: input.durationMs ?? null,

            web_search_enabled: input.webSearchEnabled ?? false,
            web_search_engine: input.webSearchEngine ?? null,
            web_search_max_results: input.webSearchMaxResults ?? null,
            web_search_results_billed: input.webSearchResultsBilled ?? null,
        };

        const { error } = await admin.from('usage_logs').insert(row);
        if (error) {
            console.error('[usage] insert failed:', error.message);
        }
    } catch (err) {
        console.error('[usage] recordUsage crashed:', err);
    }
}
