type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

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
    }
  },
  warn: (...args: unknown[]) => {
    if (shouldLog('warn')) {
      const { correlationId, formattedArgs } = extractCorrelationId(args);
      const prefix = correlationId ? `[Lucen] [corr:${correlationId}]` : '[Lucen]';
      console.warn(prefix, ...formattedArgs);
    }
  },
  error: (...args: unknown[]) => {
    if (shouldLog('error')) {
      const { correlationId, formattedArgs } = extractCorrelationId(args);
      const prefix = correlationId ? `[Lucen] [corr:${correlationId}]` : '[Lucen]';
      console.error(prefix, ...formattedArgs);
    }
  },
  setLevel: (level: LogLevel) => {
    currentLevel = level;
    try { localStorage.setItem('lucen_log_level', level); } catch { /* ignore */ }
  },
  getLevel: () => currentLevel,
};
