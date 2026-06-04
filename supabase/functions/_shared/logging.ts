// Shared structured logging for Edge Functions.
// Provides correlation IDs, log levels, and consistent JSON output
// for aggregation by any log ingestion service.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
    requestId?: string;
    userId?: string;
    functionName?: string;
    [key: string]: unknown;
}

function emit(level: LogLevel, message: string, ctx: LogContext = {}, extra?: Record<string, unknown>) {
    const entry = {
        ts: new Date().toISOString(),
        level,
        msg: message,
        ...ctx,
        ...extra,
    };
    const line = JSON.stringify(entry);
    switch (level) {
        case 'error': console.error(line); break;
        case 'warn':  console.warn(line); break;
        case 'debug': console.debug(line); break;
        default:      console.log(line);
    }
}

export function createLogger(functionName: string, baseCtx: LogContext = {}) {
    const ctx: LogContext = { functionName, ...baseCtx };
    return {
        debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', msg, ctx, extra),
        info:  (msg: string, extra?: Record<string, unknown>) => emit('info',  msg, ctx, extra),
        warn:  (msg: string, extra?: Record<string, unknown>) => emit('warn',  msg, ctx, extra),
        error: (msg: string, extra?: Record<string, unknown>) => emit('error', msg, ctx, extra),
        child: (extra: LogContext) => createLogger(functionName, { ...ctx, ...extra }),
    };
}
