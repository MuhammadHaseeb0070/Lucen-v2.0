// sliding-window rate limiter for Edge Functions.
// For production, uses Redis-backed rate limiting via Upstash REST API.
// Falls back to in-memory tracking if Upstash is not configured or fails.

interface RateLimitEntry {
    timestamps: number[];
}

const buckets = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL = 60_000; // 1 min
let lastCleanup = Date.now();

function cleanup(now: number) {
    if (now - lastCleanup < CLEANUP_INTERVAL) return;
    lastCleanup = now;
    for (const [key, entry] of buckets) {
        entry.timestamps = entry.timestamps.filter(t => now - t < 60_000);
        if (entry.timestamps.length === 0) buckets.delete(key);
    }
}

function checkRateLimitLocal(
    key: string,
    maxRequests: number,
    windowMs = 60_000,
): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    cleanup(now);

    let entry = buckets.get(key);
    if (!entry) {
        entry = { timestamps: [] };
        buckets.set(key, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);

    if (entry.timestamps.length >= maxRequests) {
        const oldest = entry.timestamps[0];
        const retryAfterMs = windowMs - (now - oldest);
        return { allowed: false, retryAfterMs };
    }

    entry.timestamps.push(now);
    return { allowed: true };
}

/**
 * Check if a request should be rate-limited.
 * @param key — identifier (e.g. userId, IP, or "chat-proxy:userId")
 * @param maxRequests — max requests allowed in the window
 * @param windowMs — window duration in ms (default 60s)
 * @returns { Promise<{ allowed: boolean, retryAfterMs?: number }> }
 */
export async function checkRateLimit(
    key: string,
    maxRequests: number,
    windowMs = 60_000,
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
    const url = Deno.env.get('UPSTASH_REDIS_REST_URL');
    const token = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');

    if (url && token) {
        try {
            const now = Date.now();
            const member = crypto.randomUUID();
            const redisKey = `rate:${key}`;

            const luaScript = `
                local key = KEYS[1]
                local now = tonumber(ARGV[1])
                local window = tonumber(ARGV[2])
                local max = tonumber(ARGV[3])
                local member = ARGV[4]

                redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
                local count = redis.call('ZCARD', key)
                if count < max then
                    redis.call('ZADD', key, now, member)
                    redis.call('EXPIRE', key, math.ceil(window / 1000))
                    return {1, 0}
                else
                    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
                    local retry_after = 0
                    if #oldest > 0 then
                        retry_after = window - (now - tonumber(oldest[2]))
                    end
                    return {0, retry_after}
                end
            `;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 500);

            const response = await fetch(`${url}/eval`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    script: luaScript,
                    keys: [redisKey],
                    args: [String(now), String(windowMs), String(maxRequests), member],
                }),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                const result = data.result;
                if (Array.isArray(result)) {
                    const allowed = result[0] === 1;
                    const retryAfterMs = result[1];
                    return { allowed, retryAfterMs: allowed ? undefined : retryAfterMs };
                }
            }
        } catch (err) {
            console.error('[RateLimit] Upstash Redis check failed, falling back to local:', err);
        }
    }

    return checkRateLimitLocal(key, maxRequests, windowMs);
}

