/**
 * apiClient - client HTTP du front : enveloppe fetch, erreurs typees, purge.
 *
 * Point d'entree de tous les appels /api/*. Ajoute les credentials (cookie
 * httpOnly), un timeout de 30 s, la traduction des codes d'erreur en messages
 * lisibles, et la purge de session sur echec d'authentification.
 *
 * INVARIANT : AUCUNE verification d'expiration ici. Le cookie est httpOnly :
 * le client ne peut pas connaitre sa reelle expiration, et expiresAt n'en
 * est qu'un miroir qui derive. Le serveur est l'autorite.
 * INVARIANT : seul un 401 - ou un 403 explicitement code AUTH_REQUIRED -
 * purge l'etat. Un 403 METIER (2FA, mot de passe actuel, transaction d'un
 * autre compte) ne doit PAS detruire la session.
 * PIEGE : le cycle d'imports. Ce module NE DOIT PAS importer sessionReset
 * (ni socketStore, ni realtimeClient) : le cycle
 * apiClient -> sessionReset -> socketStore -> socketConnectionStore ->
 * realtimeClient -> apiClient se referme. La purge passe par le registre
 * sessionPurge.ts, et les URLs par le module feuille apiUrl.ts.
 * PIEGE : credentials: 'include' est obligatoire (cookie cross-origine
 * Vercel -> Render). L'oublier fait tomber toutes les requetes en 401.
 *
 * Voir aussi : docs/08-frontend.md - section 2 (L'arborescence de src/)
 */
import { useAuthStore } from '../stores/authStore';
import { getBaseUrl, getApiUrl } from './apiUrl';
import { purgeSessionStores } from './sessionPurge';

let logoutQueued = false;

// `getBaseUrl`/`getApiUrl` vivent dans `apiUrl.ts` (module feuille) pour ne
// pas boucler le graphe d'imports. On les reexporte ici : tous les appels
// existants continuent de fonctionner.
export { getBaseUrl, getApiUrl };

export const getAuthHeaders = () => {
  // Cookie-only : le token vit dans le cookie httpOnly `zoyd_auth`,
  // envoye automatiquement (credentials:include ci-dessous).
  //
  // AUCUNE verification d'expiration ici — volontairement retiree.
  //
  // Le client ne peut pas connaitre l'expiration reelle du cookie : il est
  // httpOnly, donc illisible en JavaScript. `expiresAt` n'en est qu'un MIROIR
  // cote store, et ce miroir derive des qu'une session a ete prolongee ailleurs,
  // qu'un onglet a change avant l'autre, ou qu'un deploiement a change les
  // durees de vie.
  //
  // Sur une divergence, le comportement etait le pire des deux : deconnecter
  // un joueur dont le cookie est parfaitement valide. Il perdait sa session —
  // alors meme que le serveur l'aurait accepte — et n'avait aucun moyen de le
  // savoir.
  //
  // Le serveur est l autorite, et le chemin existe deja : `handleAuthError`
  // purge l'etat sur un 401 (et sur un 403 `AUTH_REQUIRED` uniquement, jamais
  // sur un 403 metier comme la 2FA). Un store perime se resout donc par le
  // premier appel qui repond 401 — plus tard, mais juste.
  return {};
};

const handleAuthError = (status: number, code?: string) => {
  // 403 = refus d'autorisation MÉTIER (2FA requise, mot de passe actuel faux,
  // transaction d'un autre compte) : la session est valide, ne la détruit pas.
  // Seul un 401 (ou un 403 explicitement lié à l'authentification) purge l'état.
  const isAuthFailure = status === 401 || (status === 403 && code === 'AUTH_REQUIRED');
  if (isAuthFailure) {
    if (!logoutQueued) {
      logoutQueued = true;
      queueMicrotask(() => {
        logoutQueued = false;
        // Purge aussi les données de session (solde, matchs, chat, amis) :
        // sinon elles restent visibles pour un compte connecté ensuite.
        purgeSessionStores();
        useAuthStore.getState().logout();
      });
    }
  }
};

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'Solde insuffisant. Recharge ton portefeuille.',
  MATCH_CLOSED: 'Ce match est déjà fermé.',
  ALREADY_JOINED: 'Tu es déjà inscrit à ce match.',
  MATCH_NOT_FOUND: 'Match introuvable.',
  TOURNAMENT_NOT_FOUND: 'Tournoi introuvable.',
  LEAGUE_NOT_FOUND: 'Ligue introuvable.',
  PLAYER_NOT_FOUND: 'Joueur introuvable.',
  NOT_ENOUGH_PLAYERS: 'Pas assez de joueurs pour commencer.',
  REGISTRATION_CLOSED: 'Les inscriptions sont fermées.',
  NOT_JOINED: 'Tu n\'es pas inscrit.',
  MATCH_ALREADY_LIVE: 'Ce match est déjà en cours.',
  MATCH_NOT_LIVE: 'Le match doit être lancé avant de valider un score.',
  INVALID_DAY: 'Journée invalide.',
  INVALID_RESULTS: 'Résultat invalide : désigne une équipe gagnante (0 ou 1).',
  DUPLICATE_PSEUDO: 'Ce pseudo est déjà utilisé.',
  DUPLICATE_EMAIL: 'Cet email est déjà utilisé.',
  DUPLICATE_PHONE: 'Ce numéro est déjà utilisé.',
  ARBITER_TAKEN: 'Un arbitre est déjà assigné.',
  ROLE_CONFLICT: 'Conflit de rôle.',
  NO_SLOT_AVAILABLE: 'Aucune place disponible.',
  TRUST_REQUIRED: 'Score de confiance insuffisant.',
  DISPUTE_ALREADY_OPEN: 'Un litige est actif sur ce match : règle-le avant de valider un score.',
  RESULT_NOT_FOUND: 'Résultat introuvable.',
  RESULT_ALREADY_EXISTS: 'Un résultat a déjà été soumis.',
  WITHDRAWAL_MIN: 'Retrait : le montant est en dessous du minimum requis.',
  INVALID_PHONE: 'Numéro de téléphone invalide.',
  INVALID_CREDENTIALS: 'Identifiants invalides. Vérifie ton pseudo/email et ton mot de passe.',
  LEGAL_NOT_ACCEPTED: 'Confirme avoir 18 ans ou plus et accepter les Conditions pour créer un compte.',
  CONFIRM_REQUIRED: 'Confirmation requise pour cette action définitive.',
  '2FA_REQUIRED': 'Vérification 2FA requise : ouvre Paramètres > Sécurité.',
  '2FA_ALREADY_ENABLED': '2FA déjà activée : vérifie un code TOTP pour la ré-enrôler.',
  WEAK_PASSWORD: 'Mot de passe trop faible : 8 caractères min, majuscule, chiffre et caractère spécial.',
  ACCOUNT_NOT_ACTIVATED: 'Compte non activé. Termine ton inscription avec le code reçu.',
  INVALID_OPERATOR: 'Opérateur invalide.',
  INVALID_COUNTRY: 'Retraits bientôt disponibles pour ton pays.',
  INVALID_AMOUNT: 'Montant invalide.',
  TRANSACTION_ALREADY_PROCESSED: 'Cette transaction a déjà été traitée.',
  TRANSACTION_NOT_OWNED: "Cette transaction ne correspond pas à ton compte.",
  SERVER_BUSY: 'Serveur saturé. Réessaie dans un instant.',
  IDEMPOTENCY_KEY_REQUIRED: 'Recharge la page puis réessaie ton retrait.',
  ACTIVE_WAGER: 'Tu as des wagers en cours : termine ou annule tes matchs avant de supprimer ton compte.',
  DELETE_FAILED: 'Suppression impossible pour le moment. Réessaie dans un instant.',
  TRANSACTION_IN_PROGRESS: 'Transaction en cours de traitement. Réessaie dans un instant.',
  PAYOUT_FAILED: 'Le transfert Mobile Money a échoué. Ton solde a été restauré.',
  ACCOUNT_LOCKED: 'Compte verrouillé. Réessaie plus tard.',
  PAYMENT_NOT_CONFIGURED: 'Paiement temporairement indisponible.',
};

/**
 * Raccourcit un message de refus pour l'affichage.
 *
 * Le serveur compose le message : partie rassurante (« solde restauré »)
 * puis la raison du prestataire et l'étape. On tronque seulement si c'est
 * anormalement long — la raison est précisément ce qu'on veut montrer.
 */
export const resumerMessagePayout = (message: string, max = 300): string => {
  if (!message) return '';
  const ligne = message.split('\n')[0].trim();
  return ligne.length > max ? `${ligne.slice(0, max - 1)}…` : ligne;
};

export const readJson = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload.code || 'UNKNOWN_ERROR';
    handleAuthError(response.status, code);

    const serverMessage = payload.error || 'Une erreur réseau est survenue.';
    let friendlyMessage = ERROR_MESSAGES[code] || serverMessage;

// Le serveur compose déjà un message qui porte la raison du prestataire et
    // l'étape (« création » / « envoi »). On ne le tronque que s'il est
    // anormalement long, et on ne masque plus ce qui explique l'échec.
    if (code === 'PAYOUT_FAILED' && serverMessage) {
      const raison = resumerMessagePayout(serverMessage);
      friendlyMessage = `${friendlyMessage} ${raison}`;
    }

    // 401/403 : préserve le vrai code serveur au lieu de tout écraser.
    // Avant, un mauvais mot de passe affichait "Session expiree" (trompeur).
    if (response.status === 401) {
      throw new ApiError(
        code === 'UNKNOWN_ERROR' ? 'Session expiree. Veuillez te reconnecter.' : friendlyMessage,
        code === 'UNKNOWN_ERROR' ? 'SESSION_EXPIRED' : code,
        401
      );
    }
    if (response.status === 403) {
      throw new ApiError(
        code === 'UNKNOWN_ERROR' ? 'Accès refuse. Tu n\'as pas les permissions necessaires.' : friendlyMessage,
        code === 'UNKNOWN_ERROR' ? 'FORBIDDEN' : code,
        403
      );
    }

    throw new ApiError(friendlyMessage, code, response.status);
  }

  return payload as T;
};

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const FETCH_TIMEOUT_MS = 30_000;

const authorizedRequest = async <T>(method: HttpMethod, path: string, body?: unknown) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await readJson<T>(
      await fetch(getApiUrl(path), {
        method,
        // Cookie httpOnly cross-origin (Vercel -> Render) : indispensable.
        credentials: 'include',
        headers: {
          ...getAuthHeaders(),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    );
  } catch (err) {
    // Timeout 30s → ApiError explicite au lieu d'une DOMException brute
    // Note: le backend gratuit (Render) dort après inactivité : le 1er appel
    // le réveille (30-60s) et timeout, le 2e passe. Message adapté en ce sens.
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('Délai dépassé — le serveur se réveille (offre gratuite). Attends quelques secondes puis réessaie.', 'TIMEOUT', 408);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const authorizedGet = <T>(path: string) => authorizedRequest<T>('GET', path);
export const authorizedPost = <T>(path: string, body?: unknown) => authorizedRequest<T>('POST', path, body);
export const authorizedPatch = <T>(path: string, body?: unknown) => authorizedRequest<T>('PATCH', path, body);
export const authorizedDelete = <T>(path: string, body?: unknown) => authorizedRequest<T>('DELETE', path, body);
