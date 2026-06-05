/**
 * Maps technical JavaScript or API errors to clean, friendly, user-facing error messages.
 */
export function getUserFriendlyError(error: Error | string | null | undefined): string {
    if (!error) {
        return "Something went wrong. Please try again.";
    }

    const errorStr = typeof error === 'string' ? error : (error.message || String(error));

    // 1. TypeError, null, undefined, replace, Cannot read
    if (
        /replace|undefined|null|TypeError|Cannot read/i.test(errorStr)
    ) {
        return "Something went wrong. Please try again.";
    }

    // 2. 500 / Internal Server / upstream
    if (
        /500|Internal Server|upstream/i.test(errorStr)
    ) {
        return "Our servers hit a snag. Please try again in a moment.";
    }

    // 3. 401 / unauthorized / JWT
    if (
        /401|unauthorized|JWT/i.test(errorStr)
    ) {
        return "Your session expired. Please refresh the page.";
    }

    // 4. 402 / credits / insufficient
    if (
        /402|credits|insufficient/i.test(errorStr)
    ) {
        return "You've run out of credits. Please upgrade to continue.";
    }

    // 5. timeout / timed out / AbortError
    if (
        /timeout|timed out|AbortError/i.test(errorStr)
    ) {
        return "The request took too long. Please try again.";
    }

    // 6. network / fetch / NetworkError
    if (
        /network|fetch|NetworkError/i.test(errorStr)
    ) {
        return "Network error. Please check your connection and try again.";
    }

    // 7. 429 / rate limit / too many requests
    if (
        /429|rate.?limit|too many requests/i.test(errorStr)
    ) {
        return "Too many requests. Please wait a moment and try again.";
    }

    // 8. 503 / service unavailable / overloaded
    if (
        /503|service.?unavailable|overloaded|circuit.?breaker/i.test(errorStr)
    ) {
        return "Service temporarily unavailable. Please try again in a moment.";
    }

    // Default fallback
    return "Something went wrong. Please try again.";
}
