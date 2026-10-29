/**
 * server/logger.test.mjs - Tests du logger (cle reservee `data`).
 *
 * P1 C2 (audit-3) : `data` n'etait pas dans `RESERVED_KEYS` — deux degats
 * selon l'ordre d'insertion dans l'`extra` objet :
 *   1. `data` primitive AVANT une cle reservee : `entry.data` est une
 *      string, puis la cle reservee fait `entry.data[key] = value` — en ESM
 *      (mode strict) assigner une propriete d'une primitive leve un
 *      TypeError : l'appel au logger crashe le chemin appelant ;
 *   2. `data` APRES : `entry.data = value` ecrasait le sac ou les cles
 *      reservees venaient d'etre deplacees (perte de journal).
 *
 * Le logger ecrit via `process.stdout.write` : on espionne pour capturer
 * l'entree reelle. En mode dev (NODE_ENV=test) la sortie est
 * `[time] [LEVEL] [module] msg {json du sac}`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger } from './logger.mjs';

const capture = () => {
  const writes = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });
  return writes;
};

// Extrait le JSON du sac en fin de ligne (format dev).
const parseSac = (line) => {
  const match = line.match(/(\{.*\})/);
  return match ? JSON.parse(match[1]) : {};
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logger - cle reservee `data` (audit-3 P1 C2)', () => {
  it("`data` avant la cle reservee : pas de TypeError, sac coherent", () => {
    const log = createLogger('test');
    const writes = capture();
    expect(() => log.info('ordre-1', { data: 'payload', level: 'error' })).not.toThrow();
    expect(parseSac(writes[0])).toEqual({ data: { data: 'payload', level: 'error' } });
  });

  it("`data` apres la cle reservee : le sac n'est pas ecrase", () => {
    const log = createLogger('test');
    const writes = capture();
    expect(() => log.info('ordre-2', { level: 'error', data: 'payload' })).not.toThrow();
    expect(parseSac(writes[0])).toEqual({ data: { level: 'error', data: 'payload' } });
  });

  it('un extra primitif reste pose tel quel sur `entry.data`', () => {
    const log = createLogger('test');
    const writes = capture();
    log.warn('primitif', 'simple-string');
    expect(parseSac(writes[0])).toEqual({ data: 'simple-string' });
  });

  it("un extra { level: 'error' } ne forge pas le niveau de l'entree", () => {
    const log = createLogger('test');
    const writes = capture();
    log.info('forgeron', { level: 'error' });
    expect(writes[0]).toContain('[INFO]');
    expect(parseSac(writes[0])).toEqual({ data: { level: 'error' } });
  });
});
