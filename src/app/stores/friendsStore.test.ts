import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFriendsStore } from './friendsStore';

const { reportServerUser } = vi.hoisted(() => ({
  reportServerUser: vi.fn(),
}));

vi.mock('../lib/socialApi', () => ({
  sendServerFriendRequest: vi.fn(),
  acceptServerFriendRequest: vi.fn(),
  declineServerFriendRequest: vi.fn(),
  removeServerFriend: vi.fn(),
  blockServerUser: vi.fn(),
  unblockServerUser: vi.fn(),
  reportServerUser,
}));

/**
 * Ce store avait 0 test alors qu'il porte la file de moderation cote client.
 *
 * Les deux comportements testes ici sont ceux qui se sont deja trompes :
 *
 *  - l'adaptateur d'hydratation convertit une forme serveur vers la forme
 *    consommee par `communityInsights`. Une valeur de `reason` inconnue ne
 *    doit pas DISPARAITRE : elle deviendrait un trou muet dans la file.
 *  - `reportUser` fabrique un identifiant `RP-<Date.now()>` alors que le
 *    serveur produit un autre format. Sans alignement sur la reponse serveur,
 *    l'hydratation afficherait la meme ligne deux fois.
 */

const reset = () => {
  useFriendsStore.setState({
    friends: [],
    requests: [],
    blockedIds: [],
    reports: [],
    pendingId: null,
  } as never);
};

const stored = (over: Record<string, unknown> = {}) => ({
  id: 'RP-SRV',
  reporterId: 'U1',
  reporterPseudo: 'Alice',
  targetId: 'U2',
  reason: 'harassment',
  description: 'Insistances',
  status: 'pending',
  severity: 'grave',
  createdAt: '2026-03-01T10:00:00.000Z',
  ...over,
});

describe('friendsStore — hydrateReportsFromServer', () => {
  beforeEach(() => {
    reset();
    reportServerUser.mockReset();
  });

  it('convertit la forme serveur vers la forme consommee', () => {
    useFriendsStore.getState().hydrateReportsFromServer([stored()] as never);

    const [r] = useFriendsStore.getState().reports;
    // `createdAt` (serveur) devient `timestamp` (client).
    expect(r.timestamp).toBe('2026-03-01T10:00:00.000Z');
    expect(r.targetId).toBe('U2');
    expect(r.reason).toBe('harassment');
    expect(r.status).toBe('pending');
    expect(r.severity).toBe('grave');
    expect(r.reporterPseudo).toBe('Alice');
  });

  it('conserve une gravite inconnue plutot que de perdre le signalement', () => {
    // Le serveur peut ajouter une gravite que le client ne connait pas encore.
    // Un `?? 'a_qualifier'` qui ECRASE la valeur ferait disparaitre le tri.
    useFriendsStore.getState().hydrateReportsFromServer([
      stored({ severity: 'catastrophique' }),
    ] as never);

    const [r] = useFriendsStore.getState().reports;
    expect(r).toBeTruthy();
    expect(r.severity).toBe('catastrophique');
  });

  it('replie un motif hors union sur other, sans perdre la ligne', () => {
    useFriendsStore.getState().hydrateReportsFromServer([
      stored({ reason: 'raison_inconnue' }),
    ] as never);

    const reports = useFriendsStore.getState().reports;
    expect(reports).toHaveLength(1);
    expect(reports[0].reason).toBe('other');
  });

  it('replie un statut inconnu sur pending', () => {
    useFriendsStore.getState().hydrateReportsFromServer([
      stored({ status: 'statut_bidon' }),
    ] as never);
    expect(useFriendsStore.getState().reports[0].status).toBe('pending');
  });

  it('remplace integralement : un signalement absent disparait', () => {
    // Un hydrate est un remplacement d etat de vue, pas un ajout : sinon les
    // signalements traites dans un autre onglet réapparaitraient.
    useFriendsStore.getState().hydrateReportsFromServer([stored({ id: 'A' })] as never);
    useFriendsStore.getState().hydrateReportsFromServer([stored({ id: 'B' })] as never);

    const ids = useFriendsStore.getState().reports.map((r) => r.id);
    expect(ids).toEqual(['B']);
  });

  it('tolere une reponse vide', () => {
    useFriendsStore.getState().hydrateReportsFromServer([] as never);
    expect(useFriendsStore.getState().reports).toEqual([]);
  });

  it('ne leve pas sur une entree absente', () => {
    expect(() =>
      useFriendsStore.getState().hydrateReportsFromServer(undefined as never)
    ).not.toThrow();
    expect(useFriendsStore.getState().reports).toEqual([]);
  });

  it('donne un timestamp quand le serveur n en fournit pas', () => {
    useFriendsStore.getState().hydrateReportsFromServer([
      stored({ createdAt: null }),
    ] as never);
    expect(useFriendsStore.getState().reports[0].timestamp).toBeTruthy();
  });
});

describe('friendsStore — reportUser utilise l identifiant du serveur', () => {
  beforeEach(() => {
    reset();
    reportServerUser.mockReset();
  });

  it('reprend l identifiant renvoye par le serveur', async () => {
    // Avant, le store fabriquait `RP-${Date.now()}` alors que le serveur
    // produit `RP-<base36>`. Apres hydratation, la meme ligne serait
    // apparue deux fois, dont une que personne n avait jamais lue.
    reportServerUser.mockResolvedValue({
      ok: true,
      report: {
        id: 'RP-MKQ7XYZ',
        targetId: 'U9',
        createdAt: '2026-04-01T12:00:00.000Z',
      },
    });

    await useFriendsStore.getState().reportUser('U9', 'cheating', 'triche');

    const [r] = useFriendsStore.getState().reports;
    expect(r.id).toBe('RP-MKQ7XYZ');
    expect(r.targetId).toBe('U9');
    expect(r.timestamp).toBe('2026-04-01T12:00:00.000Z');
  });

  it('replie sur un identifiant local si la reponse est incomplete', async () => {
    reportServerUser.mockResolvedValue({ ok: true });
    await useFriendsStore.getState().reportUser('U8', 'no_show', 'absent');
    const [r] = useFriendsStore.getState().reports;
    expect(r.id).toMatch(/^RP-/);
    expect(r.targetId).toBe('U8');
  });

  it('n ajoute RIEN quand l ecriture echoue', async () => {
    // Le serveur repond 503 si la table manque. Ajouter une entree locale
    // quand meme afficherait « signale » alors que rien n a ete ecrit.
    reportServerUser.mockRejectedValue(new Error('SERVER_BUSY'));
    await useFriendsStore.getState().reportUser('U7', 'harassment', 'x');
    expect(useFriendsStore.getState().reports).toEqual([]);
    expect(useFriendsStore.getState().pendingId).toBeNull();
  });

  it('liberer le verrou de traitement meme en cas d echec', async () => {
    // Sans cela, un second signalement resterait bloque derriere un
    // `pendingId` a jamais remis a zero.
    reportServerUser.mockRejectedValue(new Error('reseau'));
    await useFriendsStore.getState().reportUser('U6', 'harassment', 'x');
    expect(useFriendsStore.getState().pendingId).toBeNull();
  });
});