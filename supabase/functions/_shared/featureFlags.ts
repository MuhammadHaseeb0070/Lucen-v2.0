// Environment-variable based feature flags / kill switches.
// Toggle features in production without code deploys by setting
// Supabase function secrets.

/**
 * Check if a feature flag is enabled.
 * Flags are env vars like FEATURE_WEB_SEARCH=true, FEATURE_ARTIFACTS=false.
 * Defaults to true (enabled) unless explicitly set to 'false' or '0'.
 */
export function isFeatureEnabled(flag: string): boolean {
    const value = Deno.env.get(`FEATURE_${flag}`);
    if (value === undefined || value === null) return true; // default ON
    const normalized = value.trim().toLowerCase();
    return normalized !== 'false' && normalized !== '0' && normalized !== 'off';
}

/**
 * Kill switch — returns true if the feature should be BLOCKED.
 * Use: if (isKillSwitched('WEB_SEARCH')) return error response.
 */
export function isKillSwitched(feature: string): boolean {
    return !isFeatureEnabled(feature);
}
