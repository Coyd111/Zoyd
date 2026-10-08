import { describe, it, expect, vi } from 'vitest';

// Reproduit fidelement le contrat du client Supabase installe : les query
// builders sont des THENABLES, avec `.then` mais SANS `.catch` ni `.finally`
// (verifie sur @supabase/postgrest-js 2.112.4).
const thenableWithoutCatch = (label, sink) => ({
  then(onOk) { sink.push(`${label}:then`); return Promise.resolve(onOk?.({ data: [], error: null })); },
});

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ range: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
      delete: vi.fn(() => ({ lt: vi.fn(() => thenableWithoutCatch('delete.lt', [])) })),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  },
}));

import { sbFire } from './persistence.mjs';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('sbFire : resistance aux thenables sans catch', () => {
  it('n\'echoue pas sur un query builder PostgREST', async () => {
    // C'est exactement ce qui tuait le service : `fn().catch is not a function`
    // leve dans un setInterval, et le gestionnaire uncaughtException appelle
    // process.exit(1). Un arret toutes les 5 minutes, en boucle.
    expect(() => sbFire('purge', () => thenableWithoutCatch('x', []))).not.toThrow();
    await settle();
  });

  it('n\'echoue pas si la fonction leve de façon synchrone', async () => {
    expect(() => sbFire('boom', () => { throw new Error('synchrone'); })).not.toThrow();
    await settle();
  });

  it('absorbe un rejet asynchrone', async () => {
    expect(() => sbFire('rejet', async () => { throw new Error('asynchrone'); })).not.toThrow();
    await settle();
  });

  it('absorbe une valeur de retour non-promesse', async () => {
    expect(() => sbFire('sync', () => 42)).not.toThrow();
    await settle();
  });
});