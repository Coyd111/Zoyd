import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWalletStore } from './walletStore';
import { useAuthStore, type User } from './authStore';

/**
 * La propagation d une mise a jour serveur vers le store d AUTH.
 *
 * Le trou que ce fichier comble
 * ----------------------------
 * Le store d'auth detient la PROGRESSION du joueur (xp, niveau, score de
 * confiance, rang). Depuis la refonte « le serveur est la source de
 * verite », cette progression n est plus calculee dans le client : elle
 * arrive du serveur et doit etre poussee dans le store d'auth par
 * `updateUser`.
 *
 * Personne ne le verifiait. Le TODO de `authStore.test.ts` le signalait
 * (« add integration tests covering the socketStore path ») mais aucun
 * test ne couvrait la chaine :
 *
 *   refreshFromServer(userId)
 *     -> GET /api/wallet/me   (renvoie { wallet, user, withdrawal })
 *       -> hydrateFromServer(wallet)
 *       -> applyWithdrawalPolicy(withdrawal)
 *       -> updateUser(user)   <-- ICI
 *
 * Trois consequences, trois tests :
 *
 *  1. Si la chaine casse, le joueur voit une progression FROSEE : son
 *     niveau, son rang et son score de confiance restent a l ancien
 *     valeurs jusqu au rechargement complet de la page.
 *  2. Si le garde multi-compte casse, la reponse d un compte peut
 *     ecrire la progression d un AUTRE joueur dans le store du compte
 *     courant (logout + reconnexion pendant que la requete est en vol).
 *  3. Si le filtre de cles casse, une charge utile serveur pourrait
 *     s attributer un privilege (`role`) que le serveur n a pas autorise.
 */

vi.mock('../lib/walletApi', () => ({
  fetchWalletSnapshot: vi.fn(),
  depositWalletBalance: vi.fn(),
  withdrawWalletBalance: vi.fn(),
}));

// Importe APRES le mock : le module doit voir la version mockee.
const { fetchWalletSnapshot } = await import('../lib/walletApi');

const mockFetch = fetchWalletSnapshot as unknown as ReturnType<typeof vi.fn>;

const WALLET_VIDE = {
  cashBalance: 0,
  bonusBalance: 0,
  lockedBalance: 0,
  pendingWinnings: 0,
  transactions: [],
  lockedEntries: {},
};

const joueur = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  role: 'player',
  pseudo: 'JoueurUn',
  email: 'un@e2e.test',
  phone: '+22960000001',
  gameId: '111',
  controllerType: 'touch',
  device: 'phone',
  levelCODM: 150,
  rankMJ: 'Master',
  rankBR: 'Legendary',
  country: 'Benin',
  streamerMode: false,
  walletBalance: 0,
  trustScore: 50,
  stats: {
    wins: 1,
    losses: 0,
    draws: 0,
    totalMatches: 1,
    totalEarnings: 0,
    winRate: 100,
    tournamentsWon: 0,
    tournamentsPlayed: 0,
    elo: 1200,
    arbitratedMatches: 0,
  },
  progression: { level: 'COMPETITEUR', xp: 100, nextLevelXp: 7000 },
  arbiterProgression: { level: 'NOVICE', xp: 0, nextLevelXp: 1 },
  achievements: [],
  dateJoined: '2024-01-01',
  isOnline: true,
  ...overrides,
});

describe('Propagation serveur -> store d auth', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    useWalletStore.setState(WALLET_VIDE);
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, expiresAt: null });
  });

  it('la progression poussee par le serveur atterrit dans le store d auth', async () => {
    // C est le TODO de authStore.test.ts : un snapshot qui porte un
    // utilisateur DOIT mettre a jour le store d'auth.
    useAuthStore.getState().hydrateSession(joueur());

    mockFetch.mockResolvedValue({
      ok: true,
      wallet: { ...WALLET_VIDE, cashBalance: 250 },
      user: { id: 'user-1', pseudo: 'JoueurUn', trustScore: 72, progression: { xp: 400, level: 'VETERAN' } },
    });

    await useWalletStore.getState().refreshFromServer('user-1');

    const user = useAuthStore.getState().user;
    expect(user, 'le store d auth doit porter l utilisateur').not.toBeNull();
    expect(user?.trustScore).toBe(72);
    expect(user?.progression).toMatchObject({ xp: 400, level: 'VETERAN' });
    // Le solde de l enveloppe du bandeau suit aussi.
    expect(user?.walletBalance).toBe(250);
  });

  it('un snapshot SANS utilisateur ne touche pas le store d auth', async () => {
    // Le champ `user` est OPTIONNEL dans la reponse (`WalletResponse.user?`).
    // S il manque, le store d'auth ne doit pas etre vide : un joueur
    // connecte verrait son profil disparaitre a chaque rafraichissement.
    useAuthStore.getState().hydrateSession(joueur());

    mockFetch.mockResolvedValue({
      ok: true,
      wallet: { ...WALLET_VIDE, cashBalance: 10 },
    });

    await useWalletStore.getState().refreshFromServer('user-1');

    const user = useAuthStore.getState().user;
    expect(user).not.toBeNull();
    expect(user?.pseudo).toBe('JoueurUn');
    expect(user?.trustScore).toBe(50);
  });

  it('garde multi-compte : la reponse d un compte ne peut pas ecrire dans un autre', async () => {
    // Scenario : le joueur A se deconnecte et le joueur B se connecte
    // PENDANT que la requete du joueur A est en vol. La reponse de A
    // arrive ensuite : elle ne doit toucher ni le portefeuille de B ni
    // sa progression.
    useAuthStore.getState().hydrateSession(joueur({ id: 'user-A', pseudo: 'JoueurA' }));
    mockFetch.mockResolvedValue({
      ok: true,
      wallet: { ...WALLET_VIDE, cashBalance: 999 },
      user: { id: 'user-A', pseudo: 'JoueurA', trustScore: 99 },
    });

    // La session change AVANT que la reponse n arrive.
    useAuthStore.getState().hydrateSession(joueur({ id: 'user-B', pseudo: 'JoueurB' }));
    expect(useAuthStore.getState().user?.id).toBe('user-B');

    await useWalletStore.getState().refreshFromServer('user-A');

    // Le compte B est intact : ni son solde, ni sa progression.
    expect(useAuthStore.getState().user?.id).toBe('user-B');
    expect(useAuthStore.getState().user?.trustScore).toBe(50);
    expect(useWalletStore.getState().cashBalance).toBe(0);
  });

  it('une charge utile serveur ne peut pas s attribuer un privilege', async () => {
    // `updateUser` filtre les cles autorisees. `role` n en fait pas
    // partie : meme si le serveur renvoyait un role, le client ne
    // l appliquerait pas - c est le serveur qui fait autorite.
    useAuthStore.getState().hydrateSession(joueur());

    mockFetch.mockResolvedValue({
      ok: true,
      wallet: WALLET_VIDE,
      user: { id: 'user-1', pseudo: 'JoueurUn', role: 'admin', trustScore: 60 },
    });

    await useWalletStore.getState().refreshFromServer('user-1');

    expect(useAuthStore.getState().user?.role).toBe('player');
    // La progression, elle, passe bien.
    expect(useAuthStore.getState().user?.trustScore).toBe(60);
  });
});
