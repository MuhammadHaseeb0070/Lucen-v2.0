// Circuit breaker for external API calls (OpenRouter, Tavily).
// Prevents cascading failures when upstream is down.
// In production, uses Upstash Redis for shared state across Deno instances.
// Falls back to local in-memory tracking if Upstash is not configured or fails.

interface CircuitState {
    failures: number;
    lastFailure: number;
    state: 'closed' | 'open' | 'half-open';
}

// Local fallback map — used when Upstash is unavailable.
const circuits = new Map<string, CircuitState>();

const FAILURE_THRESHOLD = 5;      // open after 5 consecutive failures
const RECOVERY_MS = 30_000;       // try again after 30s
const UPSTASH_TIMEOUT_MS = 500;   // max wait for Redis response

// ─── Upstash Redis Helpers ────────────────────────────────────────────────────

function getUpstashCreds(): { url: string; token: string } | null {
    const url = Deno.env.get('UPSTASH_REDIS_REST_URL');
    const token = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');
    if (!url || !token) return null;
    return { url, token };
}

async function redisGet(url: string, token: string, key: string): Promise<string | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTASH_TIMEOUT_MS);
    try {
        const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!res.ok) return null;
        const data = await res.json();
        return data.result ?? null;
    } catch {
        clearTimeout(timeoutId);
        return null;
    }
}

async function redisSet(
    url: string,
    token: string,
    key: string,
    value: string,
    exSeconds?: number,
): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTASH_TIMEOUT_MS);
    try {
        const args = exSeconds ? [key, value, 'EX', String(exSeconds)] : [key, value];
        await fetch(`${url}/set/${args.map(encodeURIComponent).join('/')}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
        });
    } catch {
        // silent — best-effort write
    } finally {
        clearTimeout(timeoutId);
    }
}

async function redisDel(url: string, token: string, key: string): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTASH_TIMEOUT_MS);
    try {
        await fetch(`${url}/del/${encodeURIComponent(key)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
        });
    } catch {
        // silent
    } finally {
        clearTimeout(timeoutId);
    }
}

// ─── Local Fallback Helpers ───────────────────────────────────────────────────

function getLocalCircuit(name: string): CircuitState {
    let c = circuits.get(name);
    if (!c) {
        c = { failures: 0, lastFailure: 0, state: 'closed' };
        circuits.set(name, c);
    }
    return c;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check if a request is allowed through the circuit breaker.
 * Returns true if the circuit is closed (or half-open for a probe request).
 */
export async function circuitAllow(name: string): Promise<boolean> {
    const creds = getUpstashCreds();

    if (creds) {
        try {
            // Key: circuit:<name>:state — set to "open" with a 30s TTL when open.
            // When the key expires, the circuit naturally transitions to half-open.
            const stateKey = `circuit:${name}:state`;
            const stateVal = await redisGet(creds.url, creds.token, stateKey);
            if (stateVal === 'open') return false; // circuit open, block
            return true; // closed or key expired (half-open probe allowed)
        } catch {
            // Fall through to local
        }
    }

    // Local fallback
    const c = getLocalCircuit(name);
    if (c.state === 'closed') return true;
    if (c.state === 'open') {
        if (Date.now() - c.lastFailure > RECOVERY_MS) {
            c.state = 'half-open';
            return true;
        }
        return false;
    }
    return true; // half-open: allow probe
}

/** Record a successful call — resets the circuit to closed. */
export async function circuitSuccess(name: string): Promise<void> {
    const creds = getUpstashCreds();
    if (creds) {
        try {
            await redisDel(creds.url, creds.token, `circuit:${name}:state`);
            await redisDel(creds.url, creds.token, `circuit:${name}:failures`);
            return;
        } catch {
            // Fall through to local
        }
    }

    const c = getLocalCircuit(name);
    c.failures = 0;
    c.state = 'closed';
}

/** Record a failure — increments counter, may open the circuit. */
export async function circuitFailure(name: string): Promise<void> {
    const creds = getUpstashCreds();
    if (creds) {
        try {
            const failKey = `circuit:${name}:failures`;
            const stateKey = `circuit:${name}:state`;

            // Increment failure counter with a 60s TTL (auto-resets if no new failures)
            const incrRes = await fetch(`${creds.url}/incr/${encodeURIComponent(failKey)}`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${creds.token}` },
            });
            if (incrRes.ok) {
                const incrData = await incrRes.json();
                const newCount = Number(incrData.result) || 0;

                // Set TTL on failure counter key
                await redisSet(creds.url, creds.token, failKey, String(newCount), 60);

                if (newCount >= FAILURE_THRESHOLD) {
                    // Open the circuit with a 30s TTL (auto half-open on expiry)
                    await redisSet(creds.url, creds.token, stateKey, 'open', Math.ceil(RECOVERY_MS / 1000));
                }
                return;
            }
        } catch {
            // Fall through to local
        }
    }

    // Local fallback
    const c = getLocalCircuit(name);
    c.failures++;
    c.lastFailure = Date.now();
    if (c.failures >= FAILURE_THRESHOLD) {
        c.state = 'open';
    }
}

/** Get current circuit status for logging/monitoring. */
export async function circuitStatus(name: string): Promise<{ state: string; failures: number }> {
    const creds = getUpstashCreds();
    if (creds) {
        try {
            const [stateVal, failVal] = await Promise.all([
                redisGet(creds.url, creds.token, `circuit:${name}:state`),
                redisGet(creds.url, creds.token, `circuit:${name}:failures`),
            ]);
            return {
                state: stateVal === 'open' ? 'open' : 'closed',
                failures: Number(failVal) || 0,
            };
        } catch {
            // Fall through to local
        }
    }

    const c = getLocalCircuit(name);
    return { state: c.state, failures: c.failures };
}
