# Partie 1 — Noyau serveur (audit-3)

**Relecture :** 2026-10-26, base `main` au `491b9f0`.
**Périmètre :** `server/utils.mjs`, `logger.mjs`, `mutex.mjs`, `supabase.mjs`,
`vapid-keys.mjs`, `single-process-guard.mjs`, `metrics.mjs`, `http-utils.mjs`,
`rate-limiter.mjs`, `code-delivery.mjs` — plus les points de wiring de
`realtime-server.mjs` nécessaires aux vérifications (le reste de ce fichier
est relu en partie 10).
**Anti faux-positifs :** ledgers `docs/audit-2/`, invariants `docs/05-invariants.md`
(V1-V15), commentaires `PIEGE:`/`INVARIANT:` des sources.

## Verdicts par fichier

| Fichier | Verdict |
|---|---|
| `utils.mjs` | Quasi propre (C4, C5) |
| `logger.mjs` | Quasi propre (C2, latent) |
| `mutex.mjs` | Propre pour la sécurité du verrouillage (C3-bis : hygiène BR incohérente, bornée) |
| `supabase.mjs` | Propre — opt-out `ZOYD_DISABLE_SUPABASE`, double nom de clé service, jamais de repli anon |
| `vapid-keys.mjs` | Propre — paire complète ou `null`, fail-closed vérifié |
| `single-process-guard.mjs` | Propre — limites connues et documentées (deux processus hors `WEB_CONCURRENCY`/cluster non détectés, `:75-78`) |
| `metrics.mjs` | Propre — plafonds 5000/5000/500, éviction FIFO documentée (`:19-20`), trim des observations (`:224-228`) |
| `http-utils.mjs` | Un constat FAIBLE (C1) + micro-notes (C7) |
| `rate-limiter.mjs` | Propre — dernier saut XFF (`:226-228`), pair de confiance (`:188-198`), relaxation à 3 conditions (`:77-88`) |
| `code-delivery.mjs` | Quasi propre — allowlist anti-SSRF solide (`:273-287`), micro-notes (C7) |

Wiring vérifié au passage (utile à C1) : `res._req = req` est posé pour TOUTE
requête dans `handleRequest` (`realtime-server.mjs:256`), donc les
`respondJson` appelés sans `req` (429 du rate limiter, 404 final, filet 500 de
`:311-317`) héritent d'une origine CORS correcte et des métriques
(`_metricsStart`/`_metricsPathname` posés en `:254-255`). Ce point est sain.

## Constats

### C1 — FAIBLE : `CLIENT_ABORTED` n'est pas mappé, une coupure client devient un faux 500

- `parseRequestBody` lève `code: 'CLIENT_ABORTED'` quand le client coupe le
  socket en cours de lecture (`http-utils.mjs:231-233`).
- `mapPersistenceError` n'a **aucun** `case 'CLIENT_ABORTED'` : la chute tombe
  dans le `default` → statut 500, message « Une erreur serveur est survenue. »
  (`http-utils.mjs:470-471`).
- `respondMappedError` journalise alors en `error` un faux incident serveur
  (`http-utils.mjs:482-484`), et `respondJson` incrémente
  `zoyd_http_errors_total` pour tout statut ≥ 500 (`http-utils.mjs:178`) :
  les métriques d'erreurs serveur sont polluées par un comportement client
  banal — coupures de réseau mobile surtout fréquentes sur la cible
  (Bénin/Côte d'Ivoire).
- Chemin réel vérifié : les routes attrapent l'erreur de parsing et la passent
  à `respondMappedError` (ex. `routes/chat.mjs:117→148`,
  `routes/match.mjs:86→88`) ; aucune route ne traite `CLIENT_ABORTED`
  spécifiquement (3 occurrences du code dans tout `server/`, dont le commentaire
  et le `throw`).
- Le commentaire in-file (`:32-33`) visait juste à ne pas confondre la coupure
  avec une session invalide ; l'intention est tenue, mais le mapping 500 reste
  un mensonge de diagnostic.

Piste de correctif (à arbitrer) : un `case 'CLIENT_ABORTED'` vers 400 (ou
au moins exclure le `log.error` et le compteur 5xx pour ce code).

### C2 — FAIBLE (latent) : collision sur la clé littérale `data` dans le logger

- `RESERVED_KEYS = { time, level, module, msg }` (`logger.mjs:42`) ne contient
  pas `data`. Pour un `extra` objet, une clé non réservée est copiée telle
  quelle (`:66`) — donc `extra.data` **devient** `entry.data`.
- Deux ordres, deux dégâts (`:61-68`) :
  1. `data` primitive AVANT une clé réservée : `entry.data` est une string,
     puis la clé réservée fait `entry.data[key] = value` (`:63-64`) — en ESM
     (mode strict), assigner une propriété sur une primitive **lève un
     TypeError** : l'appel au logger crashe le chemin appelant (par exemple
     depuis un gestionnaire d'erreur).
  2. `data` APRÈS les clés réservées : `entry.data = value` (`:66`) **écrase**
     le sac `entry.data` où les clés réservées venaient d'être déplacées —
     perte d'information de journal.
- Aucun appelant actuel ne passe de clé `data` (recherche
  `log.(debug|info|warn|error|fatal)(… data:` dans `server/` : zéro match) —
  constat latent, pas d'incident en production aujourd'hui.

Piste de correctif : ajouter `data` à `RESERVED_KEYS`, ou déplacer
systématiquement les clés réservées dans un objet fraîchement créé.

### C3 — FAIBLE : dérive ASCII dans le noyau (127 occurrences, scan du 2026-10-26)

Scanner (régions entières des 10 fichiers) : 127 caractères non-ASCII.
Répartition :

- Commentaires accentués : `mutex.mjs:108-113`, `http-utils.mjs:78-81/:108-109/:299-304/:384`,
  `rate-limiter.mjs:144/:181-212`, `code-delivery.mjs:33-46/:106-110/:146-149/:191-193/:255/:280/:310-311`,
  `supabase.mjs:62-65`, `vapid-keys.mjs:30-31` — files qui ont échappé au
  nettoyage ASCII d'audit-2.
- Tirets cadratins `—` dans les commentaires : `utils.mjs:41`, `logger.mjs:27`,
  `mutex.mjs:80/:112`, `supabase.mjs:33/:71/:84`, `vapid-keys.mjs:41`,
  `single-process-guard.mjs:38/:55/:76-77`, `metrics.mjs:35`,
  `http-utils.mjs:134/:275/:466`, `rate-limiter.mjs:66/:82-83/:181`,
  `code-delivery.mjs:32/:95/:97/:100/:106/:146/:237/:246/:255/:271`.
- Un message d'erreur CLIENT accentué : `http-utils.mjs:241`
  (« Corps de requête JSON invalide. »).
- Contenu e-mails (`code-delivery.mjs:66-100`) : accents volontaires, contenu
  utilisateur — à valider comme choix produit, hors convention commentaires.
- Pas d'impact fonctionnel : aucun mojibake (le test `encoding-integrity`
  passe), les fichiers sont UTF-8 corrects.

### C4 — INFO : `cleanupIdleMutexes` omet les verrous BR — croissance bornée, hygiène incohérente

- Le cleanup périodique (5 min) purge wallet, user et channel
  (`mutex.mjs:172-201`) mais pas `brLobbyMutex`/`brLobbyMutexTimestamps`.
- PAS de fuite non plus : `withBrLobbyMutex` appelle
  `evictOldestMutex(brLobbyMutex, brLobbyMutexTimestamps)` à chaque acquire
  (`:120`), plafond `MUTEX_MAX_SIZE = 10000` (`:42`), verrous actifs épargnés
  (`:91`). Les mutex BR inactifs ne sont donc purgés qu'à saturation —
  incohérence d'hygiène, pas un risque.
- Ajuste la note provisoire : la croissance est bornée.

### C5 — INFO : `makeError` — `details` s'applique APRÈS `{ code }`

- `Object.assign(new Error(message), { code }, details || {})`
  (`utils.mjs:51`) : un `details` portant une clé `code` écraserait
  silencieusement le code métier → mapping HTTP faux (500 générique).
- Aucun appelant ne passe de `code` dans `details` (recherche dans `server/`) :
  théorique. Une inversion (`{ ...details, code }`) rendrait l'invariant
  structurel.

### C6 — INFO : `nextLevelXp` vaut `Infinity` pour PRO — sérialisé `null`

- `LEVEL_THRESHOLDS.PRO = Infinity` (`utils.mjs:69`) recopié dans
  `next.nextLevelXp` (`:83`) : `JSON.stringify` le sérialise `null` dans les
  réponses/persistance des joueurs PRO.
- Auto-correctif : au prochain appel, `addXpToProgression` recalcule la valeur
  (`:76` puis `:83`). Visible seulement comme `nextLevelXp: null` côté client
  pour un joueur PRO — à confirmer côté front (partie 13).

### C7 — INFO : micro-remarques sans impact

- `http-utils.mjs` — quand l'origine n'est pas whitelistée, le commentaire
  (`:26-27`) dit que la réponse part **sans** `Access-Control-Allow-Origin`,
  mais `writeHead` reçoit la valeur `''` (`:150`) : Node émet l'en-tête vide.
  Comportement navigateur équivalent (pas d'autorisation), nuance de doc.
- `code-delivery.mjs` — chemin d'échec du webhook : `clearTimeout` (`:301`)
  n'est pas appelé si `fetch` rejette (il l'est dans le `finally` des canaux
  Resend/Brevo, `:140-142/:184-186`) : minuterie de 5 s survit, abort sur un
  fetch déjà réglé = no-op. Cosmétique.
- `code-delivery.mjs:289` — `maskDestination(webhook)` masque une URL comme
  un e-mail (`ht***ok`) : le log perd l'information de diagnostic sur l'hôte
  bloqué.

## Résumé

Rien de CRITIQUE ni de MAJEUR dans le noyau. Les invariants d'argent du
portefeuille (verrou global avant par entité, exclusion mutuelle, éviction
épargnant les verrous actifs), le fail-closed des cles de debug
(`ALLOW_DEBUG_CODES`), la résolution d'IP (dernier saut XFF derrière proxy de
confiance) et l'anti-SSRF du webhook sont solides et correctement documentés.
Trois FAIBLE (faux 500 sur coupures client, collision `data` latente du
logger, dérive ASCII) et quatre INFO.
