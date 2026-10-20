/**
 * server/dev-runner.mjs - Lanceur de developpement : demarre l'API et le client
 * Vite dans un seul terminal, avec un prefixe colore par flux.
 *
 * Outil de confort local uniquement : le demarrage de production est
 * `node server/realtime-server.mjs` (cf. package.json / render.yaml).
 *
 * INVARIANT : ce fichier ne doit JAMAIS etre importe par le serveur : il
 *   lance deux processus enfants, il n'est pas un module de l'application.
 * INVARIANT : sur SIGINT/SIGTERM les deux enfants sont tues - sinon l'API
 *   garde le port et le demarrage suivant echoue.
 * INVARIANT : la sortie des enfants estcapturee (stdio `pipe`) pour que les
 *   prefixes restent lisibles cote runner.
 * PIEGE : sur Windows, `shell: true` est obligatoire pour que `npm run dev`
 *   demarre reellement.
 * PIEGE : le prefixe est ecrit par CHUNK, pas par ligne : un chunk peut
 *   contenir une ligne a moitie.
 * PIEGE : tuer le runner ne garantit pas que les enfants soient morts : ils
 *   peuvent lui survivre et continuer d'occuper le port.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

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
