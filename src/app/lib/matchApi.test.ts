import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authorizedGet } = vi.hoisted(() => ({
  authorizedGet: vi.fn(),
}));

vi.mock('./apiClient', () => ({
  authorizedGet,
}));

import { fetchAllMatchesFromDb } from './matchApi';

/**
 * Audit-4 C4 : le contrat de ce fetch porte le store matchs. Il avalait
 * TOUT en resolvant [] : les .catch de RootLayout (bootstrap, rattrapage de
 * coupure, polling 30 s) etaient du code mort, et chaque echec devenait
 * replaceFromServer([]) — EFFACEMENT du store matchs pendant
 * l'indisponibilite serveur (le hub affichait « aucun match » au lieu de
 * dire que la lecture a echoue). Le contrat verrouille ici : le fetch
 * REJETTE sur un echec, l'appelant catche, le store reste intact.
 */
describe('matchApi — fetchAllMatchesFromDb (audit-4 C4)', () => {
  beforeEach(() => {
    authorizedGet.mockReset();
  });

  it('renvoie la liste serveur telle quelle', async () => {
    authorizedGet.mockResolvedValue({ matches: [{ id: 'M-1' }, { id: 'M-2' }] });

    await expect(fetchAllMatchesFromDb()).resolves.toHaveLength(2);
  });

  it('resume a [] une reponse 200 sans matches (base vide authentique)', async () => {
    authorizedGet.mockResolvedValue({});

    await expect(fetchAllMatchesFromDb()).resolves.toEqual([]);
  });

  it('REJETTE sur un echec HTTP (aucun aval, le store n est jamais ecrase)', async () => {
    authorizedGet.mockRejectedValue(new Error('TIMEOUT'));

    await expect(fetchAllMatchesFromDb()).rejects.toThrow('TIMEOUT');
  });
});
