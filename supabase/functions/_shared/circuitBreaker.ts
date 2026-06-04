// Simple circuit breaker for external API calls (OpenRouter, Tavily).
// Prevents cascading failures when upstream is down.

interface CircuitState {
    failures: number;
    lastFailure: number;
    state: 'closed' | 'open' | 'half-open';
}

const circuits = new Map<string, CircuitState>();

const FAILURE_THRESHOLD = 5;      // open after 5 consecutive failures
const RECOVERY_MS = 30_000;       // try again after 30s
const HALF_OPEN_MAX = 1;          // allow 1 request in half-open state

function getCircuit(name: string): CircuitState {
    let c = circuits.get(name);
    if (!c) {
        c = { failures: 0, lastFailure: 0, state: 'closed' };
        circuits.set(name, c);
    }
    return c;
}

/** Check if a request is allowed through the circuit breaker. */
export function circuitAllow(name: string): boolean {
    const c = getCircuit(name);
    if (c.state === 'closed') return true;
    if (c.state === 'open') {
        if (Date.now() - c.lastFailure > RECOVERY_MS) {
            c.state = 'half-open';
            return true;
        }
        return false;
    }
    // half-open: allow limited requests
    return true;
}

/** Record a successful call — resets the circuit to closed. */
export function circuitSuccess(name: string): void {
    const c = getCircuit(name);
    c.failures = 0;
    c.state = 'closed';
}

/** Record a failure — increments counter, may open the circuit. */
export function circuitFailure(name: string): void {
    const c = getCircuit(name);
    c.failures++;
    c.lastFailure = Date.now();
    if (c.failures >= FAILURE_THRESHOLD) {
        c.state = 'open';
    }
}

/** Get current circuit status for logging/monitoring. */
export function circuitStatus(name: string): { state: string; failures: number } {
    const c = getCircuit(name);
    return { state: c.state, failures: c.failures };
}
