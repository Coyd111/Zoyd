/**
 * buildVersion.test.ts
 *
 * Cle de retry des chunks perimes (routes.tsx / `lazyWithRetry`).
 *
 * Le contrat est simple : la cle doit dependre du CHUNK, pas d'un prefixe
 * de message. Avant, la cle etait `message.slice(0, 80)` : le prefixe de
 * Vite (« Failed to fetch dynamically imported module: ») consomme 44
 * caracteres, il ne restait que ~36 caracteres d'URL — donc 4 caracteres
 * utiles du nom de fichier. Deux chunks d'une meme famille
 * (`CreateMatchPage` / `CreateTournamentPage`) produisaient la MEME cle : le
 * second ne beneficiait pas du rechargement et tombait sur l'ecran fige
 * « UNE MISE A JOUR EST ARRIVEE ».
 *
 * L'environnement de test est node (pas de DOM) : on ne teste que la
 * fonction pure, pas le reload.
 */
import { describe, it, expect } from 'vitest';
import { chunkRetryKey, isStaleChunkError } from './buildVersion';

/** Prefixe exact du message de Vite pour un import dynamique rate. */
const VITE_PREFIX = 'Failed to fetch dynamically imported module: ';

const staleChunkError = (file: string) =>
  new Error(`${VITE_PREFIX}https://zoyd.vercel.app/assets/${file}`);

describe('buildVersion — cle de retry par chunk', () => {
  it('distingue CreateMatchPage de CreateTournamentPage', () => {
    const match = chunkRetryKey(staleChunkError('CreateMatchPage-abc12345.js'));
    const tournament = chunkRetryKey(staleChunkError('CreateTournamentPage-abc12345.js'));
    expect(match).not.toBe(tournament);
  });

  it('distingue TournoisPage de TournamentBracketPage', () => {
    const tournois = chunkRetryKey(staleChunkError('TournoisPage-abc12345.js'));
    const bracket = chunkRetryKey(staleChunkError('TournamentBracketPage-abc12345.js'));
    expect(tournois).not.toBe(bracket);
  });

  it('donne la MEME cle pour le MEME chunk', () => {
    expect(chunkRetryKey(staleChunkError('WalletPage-abc12345.js'))).toBe(
      chunkRetryKey(staleChunkError('WalletPage-abc12345.js'))
    );
  });

  it('distingue deux hashes de contenu du meme fichier', () => {
    expect(chunkRetryKey(staleChunkError('WalletPage-aaa11111.js'))).not.toBe(
      chunkRetryKey(staleChunkError('WalletPage-bbb22222.js'))
    );
  });

  it('produit une cle utilisable en sessionStorage', () => {
    const key = chunkRetryKey(staleChunkError('WalletPage-abc12345.js'));
    expect(key).toMatch(/^zoyd_chunk_retry_/);
    // Une cle de sessionStorage ne doit contenir ni espace ni controle.
    // Une cle de sessionStorage ne doit contenir ni espace ni caractere de
    // controle : il ne doit rester QUE des caracteres surs.
    expect(/[^A-Za-z0-9_.:-]/.test(key)).toBe(false);
  });

  it('reste deterministe meme sans URL dans le message', () => {
    const a = chunkRetryKey(new Error('Failed to fetch'));
    const b = chunkRetryKey(new Error('Failed to fetch'));
    expect(a).toBe(b);
    expect(a).toMatch(/^zoyd_chunk_retry_/);
  });

  it('detecte toujours un chunk perime', () => {
    expect(isStaleChunkError(staleChunkError('WalletPage-abc12345.js'))).toBe(true);
    expect(isStaleChunkError(new Error('boom'))).toBe(false);
  });
});
