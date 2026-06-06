import { spawn } from 'node:child_process';

const cwd = process.cwd();
const shell = process.platform === 'win32';

const run = (label, command, args) => {
  const child = spawn(command, args, {
    cwd,
    stdio: 'pipe',
    shell,
  });

  const write = (stream, color) => {
    stream.on('data', (chunk) => {
      process.stdout.write(`${color}[${label}] ${chunk}\x1b[0m`);
    });
  };

  write(child.stdout, label === 'client' ? '\x1b[36m' : '\x1b[33m');
  write(child.stderr, '\x1b[31m');

  return child;
};

const processes = [
  run('server', 'node', ['server/realtime-server.mjs']),
  run('client', 'npm', ['run', 'dev']),
];

const shutdown = () => {
  for (const child of processes) {
    child.kill();
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
