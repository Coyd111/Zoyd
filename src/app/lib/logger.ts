/**
 * logger - journalisation client structuree, prefixee [ZOYD].
 *
 * Expose logError et logWarning. En production, la sortie est un
 * JSON ; hors production, l'objet reste lisible dans la console.
 *
 * PIEGE : la sortie console EST le comportement attendu de ce module.
 * Ne pas remplacer console.error/warn/log par autre chose sans changer le
 * contrat du fichier.
 * PIEGE : ne jamais passer de secret, de token ni de donnee personnelle dans
 * le `context` : le payload part en console et peut finir dans un rapport
 * d'erreur ou une capture d'ecran.
 *
 * Voir aussi : docs/08-frontend.md - section 11 (Les points de vigilance)
 */
type ErrorLevel = 'error' | 'warn' | 'info';

interface ErrorContext {
  component?: string;
  action?: string;
  userId?: string;
  [key: string]: unknown;
}

interface LogPayload {
  level: ErrorLevel;
  message: string;
  stack?: string;
  context?: ErrorContext;
  timestamp: string;
  url?: string;
  userAgent?: string;
}

const isProd = import.meta.env.PROD;

export function logError(error: unknown, context?: ErrorContext) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  const payload: LogPayload = {
    level: 'error',
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
  const payload: LogPayload = {
    level: 'warn',
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
