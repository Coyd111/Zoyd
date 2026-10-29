import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFriendsStore } from './friendsStore';
import { sendServerFriendRequest, acceptServerFriendRequest } from '../lib/socialApi';

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

/**
 * P12 C1 (audit-3) : la demande d'ami envoyee plantait le tableau de bord
 * pour toute la session.
 *
 * Le serveur renvoie la demande SANS `senderPseudo`. L'hydrate normalisait
 * (`senderPseudo || 'Joueur'`), la voie envoi insérait l'objet BRUT : le
 * premier rendu de la section 'Demandes' (`FriendsWidget`, `DashboardPage`,
 * `.slice` sur undefined) jetait — `RouteErrorBoundary` prenait la page, le
 * tableau de bord et l'onglet 'Demandes' morts pour la session (aucune
 * hydratation inbound ne reparait la liste : la demande envoyee n'y revient
 * pas).
 *
 * Le repro ci-dessous est celui execute par l'audit (test temporaire
 * supprime depuis) : maintenant PERMANENT.
 */
describe('friendsStore — demande envoyee normalisee a l insertion (P12 C1)', () => {
  beforeEach(() => {
    reset();
    vi.mocked(sendServerFriendRequest).mockReset();
  });

  it('repro audit-3 : une demande sans senderPseudo entre normalisee (voie envoi)', async () => {
    vi.mocked(sendServerFriendRequest).mockResolvedValue({
      ok: true,
      request: {
        id: 'FR-1',
        senderId: 'U1',
        targetId: 'U2',
        status: 'pending',
        message: null,
        timestamp: '2026-10-26T00:00:00.000Z',
      } as never,
    });

    await useFriendsStore.getState().sendRequest('U2', 'Bob');

    const [r] = useFriendsStore.getState().requests;
    expect(r.id).toBe('FR-1');
    expect(r.senderPseudo).toBe('Joueur');
    expect(r.status).toBe('pending');
    expect(r.timestamp).toBe('2026-10-26T00:00:00.000Z');
    // Les deux voies (envoi et hydrate) produisent le MEME objet.
    useFriendsStore.getState().hydrateFromServer([], [{
      id: 'FR-1',
      senderId: 'U1',
      targetId: 'U2',
      status: 'pending',
      message: null,
      timestamp: '2026-10-26T00:00:00.000Z',
    }] as never, []);
    const [hydrated] = useFriendsStore.getState().requests;
    expect(hydrated.senderPseudo).toBe('Joueur');
    expect(hydrated).toEqual(r);
  });

  it('le pseudo fourni par le serveur est conserve (pas ecrase par le fallback)', async () => {
    vi.mocked(sendServerFriendRequest).mockResolvedValue({
      ok: true,
      request: {
        id: 'FR-2',
        senderId: 'U1',
        senderPseudo: 'Alice',
        targetId: 'U2',
        status: 'pending',
        timestamp: '2026-10-26T00:00:00.000Z',
      } as never,
    });

    await useFriendsStore.getState().sendRequest('U2', 'Bob');

    expect(useFriendsStore.getState().requests[0].senderPseudo).toBe('Alice');
  });

  it('un timestamp absent est rempli (voie envoi aussi)', async () => {
    vi.mocked(sendServerFriendRequest).mockResolvedValue({
      ok: true,
      request: {
        id: 'FR-3',
        senderId: 'U1',
        targetId: 'U2',
        status: 'pending',
      } as never,
    });

    await useFriendsStore.getState().sendRequest('U2', 'Bob');

    expect(useFriendsStore.getState().requests[0].timestamp).toBeTruthy();
  });
});

/**
 * Audit-4 C1 : l'acceptation d'une demande insere d'office dans `friends`.
 * Le serveur livre un profil PUBLIC (sans `status`/`isStreamer`, avec
 * `streamerMode`) : sans normalisation, un objet brut arrachait ces champs
 * derives (le type de l'API pretendait le contraire). La normalisation
 * doit etre UNIQUE : l'ami accepte et l'ami hydrate produisent le MEME
 * objet (mirroir du bloc P12 C1 ci-dessus).
 */
describe('friendsStore — ami accepte normalise a l insertion (audit-4 C1)', () => {
  beforeEach(() => {
    reset();
    vi.mocked(acceptServerFriendRequest).mockReset();
  });

  it('repro audit-4 : le profil livre entre avec isStreamer/status derives', async () => {
    vi.mocked(acceptServerFriendRequest).mockResolvedValue({
      ok: true,
      friend: {
        id: 'U1',
        pseudo: 'Alice',
        country: 'CI',
        trustScore: 100,
        controllerType: 'Mobile',
        streamerMode: true,
      } as never,
    });

    await useFriendsStore.getState().acceptRequest('FR-1');

    const [friend] = useFriendsStore.getState().friends;
    expect(friend.id).toBe('U1');
    expect(friend.isStreamer).toBe(true);
    expect(friend.status).toBe('offline');
    expect(useFriendsStore.getState().requests).toHaveLength(0);

    // Les deux voies (accept et hydrate) produisent le MEME objet.
    useFriendsStore.getState().hydrateFromServer([{
      id: 'U1',
      pseudo: 'Alice',
      country: 'CI',
      trustScore: 100,
      controllerType: 'Mobile',
      streamerMode: true,
    } as never], [], []);
    expect(useFriendsStore.getState().friends[0]).toEqual(friend);
  });

  it('streamerMode absent (serveur) donne un isStreamer false, jamais undefined', async () => {
    vi.mocked(acceptServerFriendRequest).mockResolvedValue({
      ok: true,
      friend: {
        id: 'U2',
        pseudo: 'Bob',
        country: 'SN',
        trustScore: 90,
        controllerType: 'Mobile',
      } as never,
    });

    await useFriendsStore.getState().acceptRequest('FR-2');

    const [friend] = useFriendsStore.getState().friends;
    expect(friend.isStreamer).toBe(false);
    expect(friend.status).toBe('offline');
  });
});