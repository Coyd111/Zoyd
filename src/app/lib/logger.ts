type ErrorLevel = 'error' | 'warn' | 'info';

interface ErrorContext {
  component?: string;
  action?: string;
  userId?: string;
  [key: string]: unknown;
}

const isProd = import.meta.env.PROD;

export function logError(error: unknown, context?: ErrorContext) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  const payload = {
    level: 'error' as const,
    message,
    stack,
    context,
    timestamp: new Date().toISOString(),
    url: typeof window !== 'undefined' ? window.location.href : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };

  if (isProd) {
    // Production: structured log (could be sent to Sentry/DataDog later)
    console.error('[ZOYD]', JSON.stringify(payload));
  } else {
    console.error('[ZOYD]', payload);
  }
}

export function logWarning(message: string, context?: ErrorContext) {
  const payload = {
    level: 'warn' as const,
    message,
    context,
    timestamp: new Date().toISOString(),
  };

  if (isProd) {
    console.warn('[ZOYD]', JSON.stringify(payload));
  } else {
    console.warn('[ZOYD]', payload);
  }
}

export function logInfo(message: string, context?: ErrorContext) {
  if (!isProd) {
    console.log('[ZOYD]', { level: 'info', message, context, timestamp: new Date().toISOString() });
  }
}
