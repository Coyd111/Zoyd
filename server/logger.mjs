// server/logger.mjs — Lightweight structured logger (zero external deps)
// Outputs JSON to stdout. In dev, pretty-prints if NODE_ENV !== 'production'.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'] || LEVELS.info;

const isDev = process.env.NODE_ENV !== 'production';

const formatTime = () => new Date().toISOString();

const serialize = (obj) => {
  if (obj instanceof Error) {
    return { message: obj.message, stack: obj.stack, code: obj.code };
  }
  if (obj && typeof obj === 'object') {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return String(obj);
    }
  }
  return obj;
};

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
      Object.assign(entry, extra);
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
