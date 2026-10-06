// server/logger.mjs — Lightweight structured logger (zero external deps)
// Outputs JSON to stdout. In dev, pretty-prints if NODE_ENV !== 'production'.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'] || LEVELS.info;

const isDev = process.env.NODE_ENV !== 'production';

const formatTime = () => new Date().toISOString();

/**
 * Champs de structure du log : jamais ecrasables par `extra`.
 * Un `log.info('x', { level: 'error' })` faisait passer l'entree pour une
 * erreur, et `{ msg: ... }` reecrivait le message.
 */
const RESERVED_KEYS = new Set(['time', 'level', 'module', 'msg']);

const write = (level, msg, extra, module) => {
  if (LEVELS[level] < currentLevel) return;

  const entry = {
    time: formatTime(),
    level,
    module: module || 'server',
    msg,
  };

  if (extra !== undefined && extra !== null) {
    if (extra instanceof Error) {
      entry.err = { message: extra.message, stack: extra.stack, code: extra.code };
    } else if (typeof extra === 'object') {
      // `Object.assign` direct : un `extra` contenant `level`, `msg`, `time`
      // ou `module` ecraseait la structure du log et le rendait
      // illisible (ou forgeable). On protege ces cles reservees.
      for (const [key, value] of Object.entries(extra)) {
        if (RESERVED_KEYS.has(key)) {
          entry.data = entry.data || {};
          entry.data[key] = value;
        } else {
          entry[key] = value;
        }
      }
    } else {
      entry.data = extra;
    }
  }

  if (isDev) {
    const color = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', fatal: '\x1b[35m' }[level] || '';
    const reset = '\x1b[0m';
    const prefix = `${color}[${entry.time}] [${level.toUpperCase()}] [${entry.module}]${reset}`;
    const suffix = entry.err ? `\n  ${entry.err.stack || entry.err.message}` : '';
    const data = { ...entry };
    delete data.time; delete data.level; delete data.module; delete data.msg; delete data.err;
    const extraStr = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
    process.stdout.write(`${prefix} ${msg}${extraStr}${suffix}\n`);
  } else {
    process.stdout.write(JSON.stringify(entry) + '\n');
  }
};

export const createLogger = (module) => ({
  debug: (msg, extra) => write('debug', msg, extra, module),
  info: (msg, extra) => write('info', msg, extra, module),
  warn: (msg, extra) => write('warn', msg, extra, module),
  error: (msg, extra) => write('error', msg, extra, module),
  fatal: (msg, extra) => write('fatal', msg, extra, module),
});

// Default logger for quick use
const log = createLogger('server');
export default log;
