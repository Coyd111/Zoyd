import { describe, it, expect, beforeEach } from 'vitest';
import { useTournamentStore } from './tournamentStore';
import { useAuthStore } from './authStore';

/**
 * `tournamentStore` etait a 12 % de couverture.
 *
 * Le comportement le plus risque est le FILTRE PAR APPAREIL. Un joueur qui
 * ouvre un tournoi mobile alors que son telephone est en mode portable, ou un
 * joueur PC qui tente un tournoi console : les deux sont des inscriptions
 * impossibles a valider cote serveur. Si le filtre laisse passer, le joueur
 * s inscrit, paie son entree, et decouvre l impossibilite au moment du
 * tournoi — avec une cagnotte engaged.
 */

const tournament = (over: Record<string, unknown> = {}) =>
  ({
    id: 'TO-1',
    title: 'Open #1',
    format: 'solo',
    status: 'open',
    deviceRestriction: 'open',
    controllerRestriction: 'open',
    entries: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as never;

const reset = () => {
  useTournamentStore.setState({
    tournaments: [],
    filters: { format: 'all', status: 'all' },
    callerEntryByTournament: {},
    callerArbiterSlotByTournament: {},
    openArbiterSlotsByTournament: {},
  } as never);
  useAuthStore.setState({ user: null } as never);
};

const setUser = (over: Record<string, unknown> = {}) => {
  useAuthStore.setState({ user: { id: 'U1', device: 'mobile', controllerType: 'touch', ...over } } as never);
};

describe('tournamentStore — fusion des deltas', () => {
  beforeEach(reset);

  it('conserve les tournois absents du delta', () => {
    useTournamentStore.setState({
      tournaments: [
        tournament({ id: 'TO-1', updatedAt: '2026-01-10T00:00:00.000Z' }),
        tournament({ id: 'TO-2', updatedAt: '2026-01-09T00:00:00.000Z' }),
      ],
    } as never);

    useTournamentStore.getState().hydrateFromServer([
      tournament({ id: 'TO-2', title: 'Modifie', updatedAt: '2026-01-11T00:00:00.000Z' }),
    ]);

    expect(useTournamentStore.getState().tournaments.map((t) => t.id).sort()).toEqual(['TO-1', 'TO-2']);
  });

  it('un delta plus ancien ne perime pas l etat local', () => {
    useTournamentStore.setState({
      tournaments: [tournament({ id: 'TO-1', status: 'finished', updatedAt: '2026-05-01T00:00:00.000Z' })],
    } as never);
    useTournamentStore.getState().hydrateFromServer([
      tournament({ id: 'TO-1', status: 'open', updatedAt: '2026-04-01T00:00:00.000Z' }),
    ]);
    expect(useTournamentStore.getState().tournaments[0].status).toBe('finished');
  });

  it('ajoute un tournoi inconnu', () => {
    useTournamentStore.getState().hydrateFromServer([tournament({ id: 'TO-9' })]);
    expect(useTournamentStore.getState().tournaments).toHaveLength(1);
  });

  it('un delta vide ne vide pas la liste', () => {
    useTournamentStore.setState({ tournaments: [tournament({ id: 'TO-1' })] } as never);
    useTournamentStore.getState().hydrateFromServer([]);
    expect(useTournamentStore.getState().tournaments).toHaveLength(1);
  });

  it('trie du plus recent au plus ancien', () => {
    useTournamentStore.getState().replaceFromServer([
      tournament({ id: 'VIEUX', updatedAt: '2026-01-01T00:00:00.000Z' }),
      tournament({ id: 'RECENT', updatedAt: '2026-03-01T00:00:00.000Z' }),
    ]);
    expect(useTournamentStore.getState().tournaments.map((t) => t.id)).toEqual(['RECENT', 'VIEUX']);
  });
});

describe('tournamentStore — remplacement complet', () => {
  beforeEach(reset);

  it('remplace integralement', () => {
    useTournamentStore.setState({ tournaments: [tournament({ id: 'PERDU' })] } as never);
    useTournamentStore.getState().replaceFromServer([tournament({ id: 'GARDE' })]);
    expect(useTournamentStore.getState().tournaments.map((t) => t.id)).toEqual(['GARDE']);
  });

  it('tolere une entree non tableau', () => {
    expect(() => useTournamentStore.getState().replaceFromServer(undefined as never)).not.toThrow();
    expect(useTournamentStore.getState().tournaments).toEqual([]);
  });
});

describe('tournamentStore — filtre par appareil', () => {
  beforeEach(() => {
    reset();
    useTournamentStore.getState().replaceFromServer([
      tournament({ id: 'OUVERT', deviceRestriction: 'open', controllerRestriction: 'open' }),
      tournament({ id: 'MOBILE', deviceRestriction: 'mobile', controllerRestriction: 'open' }),
      tournament({ id: 'CONSOLE', deviceRestriction: 'console', controllerRestriction: 'open' }),
    ]);
  });

  it('sans session, aucune restriction : on voit tout', () => {
    // Inviter avant connexion ne doit pas masquer la moindre competition.
    expect(useTournamentStore.getState().getFilteredTournaments()).toHaveLength(3);
  });

  it('un joueur mobile voit les tournois ouverts et mobiles, pas les consoles', () => {
    setUser({ device: 'mobile' });
    const ids = useTournamentStore.getState().getFilteredTournaments().map((t) => t.id).sort();
    expect(ids).toEqual(['MOBILE', 'OUVERT']);
  });

  it('un joueur console ne voit pas les tournois mobiles', () => {
    setUser({ device: 'console' });
    const ids = useTournamentStore.getState().getFilteredTournaments().map((t) => t.id).sort();
    expect(ids).toEqual(['CONSOLE', 'OUVERT']);
  });

  it('filtre aussi sur le type de manette', () => {
    useTournamentStore.getState().replaceFromServer([
      tournament({ id: 'MANETTE', controllerRestriction: 'gamepad' }),
      tournament({ id: 'TACTILE', controllerRestriction: 'touch' }),
    ]);
    setUser({ device: 'mobile', controllerType: 'gamepad' });

    const ids = useTournamentStore.getState().getFilteredTournaments().map((t) => t.id);
    expect(ids).toEqual(['MANETTE']);
  });

  it('les deux contraintes sappliquent ensemble', () => {
    // Un tournoi console+manette ne doit pas apparaitre pour un mobile tactile,
    // meme si l appareil « passe ».
    useTournamentStore.getState().replaceFromServer([
      tournament({ id: 'CONSOLE_MANETTE', deviceRestriction: 'console', controllerRestriction: 'gamepad' }),
      tournament({ id: 'MOBILE_TACTILE', deviceRestriction: 'mobile', controllerRestriction: 'touch' }),
    ]);
    setUser({ device: 'mobile', controllerType: 'touch' });

    const ids = useTournamentStore.getState().getFilteredTournaments().map((t) => t.id);
    expect(ids).toEqual(['MOBILE_TACTILE']);
  });
});

describe('tournamentStore — filtres de liste', () => {
  beforeEach(() => {
    reset();
    useTournamentStore.getState().replaceFromServer([
      tournament({ id: 'SOLO', format: 'solo', status: 'open' }),
      tournament({ id: 'DUO', format: 'duo', status: 'finished' }),
    ]);
  });

  it('filtre sur le format', () => {
    useTournamentStore.getState().setFilters({ format: 'duo' });
    expect(useTournamentStore.getState().getFilteredTournaments().map((t) => t.id)).toEqual(['DUO']);
  });

  it('filtre sur le statut', () => {
    useTournamentStore.getState().setFilters({ status: 'open' });
    expect(useTournamentStore.getState().getFilteredTournaments().map((t) => t.id)).toEqual(['SOLO']);
  });

  it('cumule les deux filtres', () => {
    useTournamentStore.getState().setFilters({ format: 'duo', status: 'open' });
    expect(useTournamentStore.getState().getFilteredTournaments()).toHaveLength(0);
  });

  it('retrouve un tournoi par identite', () => {
    expect(useTournamentStore.getState().getTournamentById('SOLO')?.title).toBe('Open #1');
  });

  it('renvoie undefined pour un identifiant inconnu', () => {
    expect(useTournamentStore.getState().getTournamentById('NOPE')).toBeUndefined();
  });
});

describe('tournamentStore — contexte du joueur', () => {
  beforeEach(reset);

  it('memorise l inscription et le role d arbitre', () => {
    useTournamentStore.getState().setCallerTournamentContext('TO-1', {
      myEntryId: 'E-9',
      myArbiterSlot: 2,
      openArbiterSlots: 3,
    });

    const state = useTournamentStore.getState();
    expect(state.callerEntryByTournament['TO-1']).toBe('E-9');
    expect(state.callerArbiterSlotByTournament['TO-1']).toBe(2);
    expect(state.openArbiterSlotsByTournament['TO-1']).toBe(3);
  });

  it('desinscrire efface le contexte', () => {
    // Sans cet effacement, le joueur resterait affiche comme inscrit apres
    // avoir quitte le tournoi, et pourrait croire sa place reservee.
    const { setCallerTournamentContext } = useTournamentStore.getState();
    setCallerTournamentContext('TO-1', { myEntryId: 'E-9', myArbiterSlot: 2, openArbiterSlots: 1 });
    setCallerTournamentContext('TO-1', {});

    const state = useTournamentStore.getState();
    expect(state.callerEntryByTournament['TO-1']).toBeUndefined();
    expect(state.callerArbiterSlotByTournament['TO-1']).toBeUndefined();
  });

  it('conserve le nombre de places ouvertes quand il est absent', () => {
    // Le serveur peut renvoyer un contexte partiel : ne pas ecraser un
    // compte deja connu par `undefined`.
    const { setCallerTournamentContext } = useTournamentStore.getState();
    setCallerTournamentContext('TO-1', { openArbiterSlots: 4 });
    setCallerTournamentContext('TO-1', { myEntryId: 'E-1' });

    expect(useTournamentStore.getState().openArbiterSlotsByTournament['TO-1']).toBe(4);
  });

  it('un contexte vide ne cree pas d entree', () => {
    useTournamentStore.getState().setCallerTournamentContext('TO-1', {});
    const state = useTournamentStore.getState();
    expect(Object.keys(state.callerEntryByTournament)).toHaveLength(0);
    expect(Object.keys(state.openArbiterSlotsByTournament)).toHaveLength(0);
  });
});