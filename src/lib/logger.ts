import * as Sentry from '@sentry/react';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

function redactPiiForSentry(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    if (val.includes('bearer') || val.includes('Bearer')) return '[REDACTED_BEARER_TOKEN]';
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(redactPiiForSentry);
  }
  if (typeof val === 'object') {
    const res: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('message') ||
        lowerKey.includes('content') ||
        lowerKey.includes('prompt') ||
        lowerKey.includes('text') ||
        lowerKey.includes('email') ||
        lowerKey.includes('password') ||
        lowerKey.includes('auth') ||
        lowerKey.includes('token') ||
        lowerKey.includes('key')
      ) {
        res[key] = '[REDACTED]';
      } else {
        res[key] = redactPiiForSentry(value);
      }
    }
    return res;
  }
  return val;
}

function addSentryBreadcrumb(level: 'info' | 'warning' | 'error', args: unknown[], correlationId?: string) {
  try {
    const redactedArgs = args.map(redactPiiForSentry);
    Sentry.addBreadcrumb({
      category: 'app.logger',
      level: level,
      message: redactedArgs.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '),
      data: {
        correlationId,
        args: redactedArgs,
      },
    });
  } catch {
    // Sentry not initialized or fails
  }
}


const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

function getConfiguredLevel(): LogLevel {
  try {
    const stored = localStorage.getItem('lucen_log_level');
    if (stored && stored in LEVEL_ORDER) return stored as LogLevel;
  } catch { /* SSR or restricted context */ }
  const env = import.meta.env.VITE_LOG_LEVEL;
  if (env && env in LEVEL_ORDER) return env as LogLevel;
  return import.meta.env.DEV ? 'debug' : 'warn';
}

let currentLevel = getConfiguredLevel();

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function extractCorrelationId(args: unknown[]): { correlationId?: string; formattedArgs: unknown[] } {
  let correlationId: string | undefined;
  const formattedArgs = args.map((arg) => {
    if (arg && typeof arg === 'object' && 'correlationId' in arg && typeof (arg as any).correlationId === 'string') {
      correlationId = (arg as any).correlationId;
      const { correlationId: _, ...rest } = arg as any;
      if (Object.keys(rest).length === 0) {
        return null;
      }
      return rest;
    }
    return arg;
  }).filter(arg => arg !== null);
  return { correlationId, formattedArgs };
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (shouldLog('debug')) {
      const { correlationId, formattedArgs } = extractCorrelationId(args);
      const prefix = correlationId ? `[Lucen] [corr:${correlationId}]` : '[Lucen]';
      console.debug(prefix, ...formattedArgs);
    }
  },
  info: (...args: unknown[]) => {
    if (shouldLog('info')) {
      const { correlationId, formattedArgs } = extractCorrelationId(args);
      const prefix = correlationId ? `[Lucen] [corr:${correlationId}]` : '[Lucen]';
      console.info(prefix, ...formattedArgs);
      addSentryBreadcrumb('info', formattedArgs, correlationId);
    }
  },
  warn: (...args: unknown[]) => {
    if (shouldLog('warn')) {
      const { correlationId, formattedArgs } = extractCorrelationId(args);
      const prefix = correlationId ? `[Lucen] [corr:${correlationId}]` : '[Lucen]';
      console.warn(prefix, ...formattedArgs);
      addSentryBreadcrumb('warning', formattedArgs, correlationId);
    }
  },
  error: (...args: unknown[]) => {
    if (shouldLog('error')) {
      const { correlationId, formattedArgs } = extractCorrelationId(args);
      const prefix = correlationId ? `[Lucen] [corr:${correlationId}]` : '[Lucen]';
      console.error(prefix, ...formattedArgs);
      addSentryBreadcrumb('error', formattedArgs, correlationId);
    }
  },
  setLevel: (level: LogLevel) => {
    currentLevel = level;
    try { localStorage.setItem('lucen_log_level', level); } catch { /* ignore */ }
  },
  getLevel: () => currentLevel,
};
