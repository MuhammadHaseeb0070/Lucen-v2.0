// Simple in-memory sliding-window rate limiter for Edge Functions.
// Each Deno isolate has its own memory, so this limits per-instance.
// For production, consider Redis-backed rate limiting via Upstash.

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

/**
 * Check if a request should be rate-limited.
 * @param key — identifier (e.g. userId, IP, or "chat-proxy:userId")
 * @param maxRequests — max requests allowed in the window
 * @param windowMs — window duration in ms (default 60s)
 * @returns { allowed: boolean, retryAfterMs?: number }
 */
export function checkRateLimit(
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
