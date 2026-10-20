/**
 * server/vapid-keys.mjs - Lecture des cles VAPID (Web Push) depuis l'environnement.
 *
 * Expose soit une paire complete `{ publicKey, privateKey }`, soit `null`.
 * Aucun appel reseau ici : la configuration de `web-push` est faite par les
 * modules consommateurs.
 *
 * INVARIANT : `vapidKeys` est soit une paire COMPLETE, soit `null` - jamais
 *   une demi-paire (une cle publique sans cle privee ne peut rien signer).
 * INVARIANT : les deux cles viennent de l'environnement (VAPID_PUBLIC_KEY /
 *   VAPID_PRIVATE_KEY) et ne sont JAMAIS generees a l'execution : une nouvelle
 *   cle invalide toutes les souscriptions deja enregistrees.
 * INVARIANT : l'absence de cles ne leve pas d'exception - le push est
 *   optionnel, l'API doit continuer a fonctionner sans lui.
 * INVARIANT : ce module ne fait rien d'autre que lire l'environnement : il
 *   est importe par la route qui expose la cle publique au navigateur.
 * PIEGE : `vapidKeys` est fige au chargement du module : changer les variables
 *   d'environnement exige un redemarrage.
 * PIEGE : seule la cle PUBLIQUE est exposee au client (route
 *   `/api/realtime/push/public-key`) ; la cle privee ne doit jamais sortir du
 *   serveur.
 * PIEGE : un avertissement est journalise a l'import : un push desactive ne
 *   se voit pas autrement (aucune erreur n'est levee).
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

// VAPID Keys for Web Push Notifications
// Les clés doivent être définies dans les variables d'environnement.
// Générer avec : node -e "console.log(JSON.stringify(require('web-push').generateVAPIDKeys()))"

import { createLogger } from './logger.mjs';

const log = createLogger('vapid');

const ENV_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const ENV_PRIVATE = process.env.VAPID_PRIVATE_KEY;

if (!ENV_PUBLIC || !ENV_PRIVATE) {
  log.warn('VAPID keys not set — push notifications disabled.');
}

export const vapidKeys = ENV_PUBLIC && ENV_PRIVATE
  ? { publicKey: ENV_PUBLIC, privateKey: ENV_PRIVATE }
  : null;
