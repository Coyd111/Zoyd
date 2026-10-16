import { describe, it, expect, beforeEach } from 'vitest';
import { useLeagueStore } from './leagueStore';
import { useAuthStore } from './authStore';

/**
 * `leagueStore` etait a 9 % de couverture — le store le moins couvert du
 * projet — et aucun test ne l'atteignait.
 *
 * Le meme motif que le defaut de reconnexion de l'etape 4 : les fonctions de
 * fusion par fraicheur sont complexes, silencieuses, et c'est exactement le
 * genre de code qu'on ne relit pas. Une erreur n'y produit aucune erreur
 * visible : une saison disparait du tableau de bord, ou une inscription est
 * remplacee par une version perimee.
 */

const season = (over: Record<string, unknown> = {}) =>
  ({
    id: 'LS-1',
    name: 'Saison 1',
    status: 'registering',
    registeredPlayers: [],
    days: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as never;

const reset = () => {
  useLeagueStore.setState({ seasons: [], filters: { status: 'all' } } as never);
};

const setUser = (id?: string) => {
  useAuthStore.setState({ user: id ? { id } : null } as never);
};

describe('leagueStore — hydrateFromServer (fusion de deltas)', () => {
  beforeEach(() => {
    reset();
    setUser(undefined);
  });

  it('conserve les saisons absentes du delta', () => {
    // Le socket n emet que des deltas : appeler replaceFromServer a la place
    // effacerait toute la liste. C est le piege deja paye sur matchStore.
    useLeagueStore.setState({
      seasons: [
        season({ id: 'LS-1', updatedAt: '2026-01-10T00:00:00.000Z' }),
        season({ id: 'LS-2', updatedAt: '2026-01-09T00:00:00.000Z' }),
        season({ id: 'LS-3', updatedAt: '2026-01-08T00:00:00.000Z' }),
      ],
    } as never);

    useLeagueStore.getState().hydrateFromServer([
      season({ id: 'LS-2', name: 'Saison 2 modifiee', updatedAt: '2026-01-11T00:00:00.000Z' }),
    ]);

    expect(useLeagueStore.getState().seasons.map((s) => s.id).sort()).toEqual(['LS-1', 'LS-2', 'LS-3']);
  });

  it('applique le changement venu du delta', () => {
    useLeagueStore.setState({ seasons: [season({ id: 'LS-1', name: 'Avant' })] } as never);
    useLeagueStore.getState().hydrateFromServer([
      season({ id: 'LS-1', name: 'Apres', updatedAt: '2026-02-01T00:00:00.000Z' }),
    ]);
    expect(useLeagueStore.getState().seasons[0].name).toBe('Apres');
  });

  it('un delta plus ancien ne perime pas l etat local', () => {
    useLeagueStore.setState({
      seasons: [season({ id: 'LS-1', status: 'finished', updatedAt: '2026-05-01T00:00:00.000Z' })],
    } as never);

    useLeagueStore.getState().hydrateFromServer([
      season({ id: 'LS-1', status: 'registering', updatedAt: '2026-04-01T00:00:00.000Z' }),
    ]);

    expect(useLeagueStore.getState().seasons[0].status).toBe('finished');
  });

  it('ajoute une saison inconnue sans supprimer les autres', () => {
    useLeagueStore.setState({ seasons: [season({ id: 'LS-1' })] } as never);
    useLeagueStore.getState().hydrateFromServer([season({ id: 'LS-9' })]);
    expect(useLeagueStore.getState().seasons).toHaveLength(2);
  });

  it('trie du plus recent au plus ancien', () => {
    useLeagueStore.getState().hydrateFromServer([
      season({ id: 'VIEUX', updatedAt: '2026-01-01T00:00:00.000Z' }),
      season({ id: 'RECENT', updatedAt: '2026-03-01T00:00:00.000Z' }),
      season({ id: 'MOYEN', updatedAt: '2026-02-01T00:00:00.000Z' }),
    ]);
    expect(useLeagueStore.getState().seasons.map((s) => s.id)).toEqual(['RECENT', 'MOYEN', 'VIEUX']);
  });

  it('un delta vide ne vide pas la liste', () => {
    useLeagueStore.setState({ seasons: [season({ id: 'LS-1' }), season({ id: 'LS-2' })] } as never);
    useLeagueStore.getState().hydrateFromServer([]);
    expect(useLeagueStore.getState().seasons).toHaveLength(2);
  });
});

describe('leagueStore — replaceFromServer (liste complete)', () => {
  beforeEach(reset);

  it('remplace integralement', () => {
    useLeagueStore.setState({ seasons: [season({ id: 'PERDU' })] } as never);
    useLeagueStore.getState().replaceFromServer([season({ id: 'GARDE' })]);
    expect(useLeagueStore.getState().seasons.map((s) => s.id)).toEqual(['GARDE']);
  });

  it('trie aussi la liste complete', () => {
    useLeagueStore.getState().replaceFromServer([
      season({ id: 'A', updatedAt: '2026-01-01T00:00:00.000Z' }),
      season({ id: 'B', updatedAt: '2026-06-01T00:00:00.000Z' }),
    ]);
    expect(useLeagueStore.getState().seasons.map((s) => s.id)).toEqual(['B', 'A']);
  });

  it('ne leve pas sur une entree non tableau', () => {
    expect(() => useLeagueStore.getState().replaceFromServer(undefined as never)).not.toThrow();
    expect(useLeagueStore.getState().seasons).toEqual([]);
  });
});

describe('leagueStore — filtres', () => {
  beforeEach(() => {
    reset();
    useLeagueStore.getState().replaceFromServer([
      season({ id: 'LS-1', status: 'registering' }),
      season({ id: 'LS-2', status: 'qualifying' }),
      season({ id: 'LS-3', status: 'completed' }),
    ]);
  });

  it('filtre sur un statut precis', () => {
    useLeagueStore.getState().setFilters({ status: 'qualifying' });
    expect(useLeagueStore.getState().getFilteredSeasons().map((s) => s.id)).toEqual(['LS-2']);
  });

  it('"all" ne filtre rien', () => {
    useLeagueStore.getState().setFilters({ status: 'all' });
    expect(useLeagueStore.getState().getFilteredSeasons()).toHaveLength(3);
  });

  it('un filtre remplace le precedent sans ecraser les autres cles', () => {
    // `setFilters` fusionne : passer `{ status }` ne doit pas perdre une autre
    // cle de filtre introduite plus tard.
    useLeagueStore.getState().setFilters({ status: 'qualifying' });
    useLeagueStore.getState().setFilters({ status: 'completed' });
    expect(useLeagueStore.getState().filters.status).toBe('completed');
  });
});

describe('leagueStore — acces par identite', () => {
  beforeEach(() => {
    reset();
    setUser(undefined);
    useLeagueStore.getState().replaceFromServer([
      season({ id: 'LS-1', status: 'registering' }),
      season({ id: 'LS-2', status: 'qualifying' }),
      season({ id: 'LS-3', status: 'completed' }),
    ]);
  });

  it('retrouve une saison par son id', () => {
    expect(useLeagueStore.getState().getSeasonById('LS-2')?.id).toBe('LS-2');
  });

  it('renvoie undefined pour un id inconnu, sans lever', () => {
    expect(useLeagueStore.getState().getSeasonById('NOPE')).toBeUndefined();
  });

  it('getActiveSeason prend une saison encore jouable', () => {
    // Une saison terminee n est pas « active » : la montrer encourage le
    // joueur a s inscrire pour une competition finie.
    expect(useLeagueStore.getState().getActiveSeason()?.id).toBe('LS-1');
  });

  it('renvoie undefined quand aucune saison n est jouable', () => {
    useLeagueStore.getState().replaceFromServer([season({ id: 'LS-FINIE', status: 'completed' })]);
    expect(useLeagueStore.getState().getActiveSeason()).toBeUndefined();
  });
});

describe('leagueStore — isPlayerRegistered', () => {
  beforeEach(() => {
    reset();
    useLeagueStore.getState().replaceFromServer([
      season({
        id: 'LS-1',
        registeredPlayers: [{ userId: 'U1', pseudo: 'Alice' }],
      }),
    ]);
  });

  it('reconnait un joueur inscrit', () => {
    setUser('U1');
    expect(useLeagueStore.getState().isPlayerRegistered('LS-1')).toBe(true);
  });

  it('refuse un joueur non inscrit', () => {
    setUser('U99');
    expect(useLeagueStore.getState().isPlayerRegistered('LS-1')).toBe(false);
  });

  it('accepte un userId explicite, sans dependre de la session', () => {
    setUser(undefined);
    expect(useLeagueStore.getState().isPlayerRegistered('LS-1', 'U1')).toBe(true);
  });

  it('refuse quand aucun joueur n est connecte', () => {
    // Sans session, `registeredPlayers.some` sur un userId undefined pourrait
    // designer un joueur fictif inscrit partout.
    setUser(undefined);
    expect(useLeagueStore.getState().isPlayerRegistered('LS-1')).toBe(false);
  });

  it('refuse pour une saison inconnue', () => {
    setUser('U1');
    expect(useLeagueStore.getState().isPlayerRegistered('LS-ABSENTE')).toBe(false);
  });

  it('ne leve pas sur une saison dont la liste d inscrits est absente', () => {
    useLeagueStore.getState().replaceFromServer([season({ id: 'LS-VIDE', registeredPlayers: undefined })]);
    setUser('U1');
    expect(() => useLeagueStore.getState().isPlayerRegistered('LS-VIDE')).not.toThrow();
    expect(useLeagueStore.getState().isPlayerRegistered('LS-VIDE')).toBe(false);
  });
});