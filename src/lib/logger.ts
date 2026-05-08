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

export const logger = {
  debug: (...args: unknown[]) => {
    if (shouldLog('debug')) console.debug('[Lucen]', ...args);
  },
  info: (...args: unknown[]) => {
    if (shouldLog('info')) console.info('[Lucen]', ...args);
  },
  warn: (...args: unknown[]) => {
    if (shouldLog('warn')) console.warn('[Lucen]', ...args);
  },
  error: (...args: unknown[]) => {
    if (shouldLog('error')) console.error('[Lucen]', ...args);
  },
  setLevel: (level: LogLevel) => {
    currentLevel = level;
    try { localStorage.setItem('lucen_log_level', level); } catch { /* ignore */ }
  },
  getLevel: () => currentLevel,
};
