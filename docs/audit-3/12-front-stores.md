# Partie 12 — Front stores (Zustand) (audit-3)

**Relecture :** 2026-10-26, base `main` au `6463d73`.
**Périmètre :** les 13 stores sources de `src/app/stores/` (lus
intégralement : `matchStore.ts` 638 lignes, `socketConnectionStore.ts` 420,
`presenceStore.ts` 390, `tournamentStore.ts` 374, `chatStore.ts` 343,
`friendsStore.ts` 324, `walletStore.ts` 287, `leagueStore.ts` 278,
`notificationStore.ts` 259, `authStore.ts` 154, `trustScoreStore.ts` 101,
`toastStore.ts` 96, `socketStore.ts` 4), le barrel `index.ts` (73), et le
consommateur du store socket `hooks/useRealtimeHeartbeat.ts` (128).
**Tests survolés :** les 11 fichiers de tests du dossier (`authStore.test.ts`
255, `presenceStore.test.ts` 284, `matchStore.test.ts` 263,
`tournamentStore.test.ts` 237, `leagueStore.test.ts` 229,
`socketConnectionStore.test.ts` 197, `walletStore.test.ts` 163,
`friendsStore.test.ts` 183, `chatStore.test.ts` 96, `notificationStore.test.ts`
65, `toastStore.test.ts` 52) — verrous relevés : F2 (backoff bootstrap),
F3 (file de signalements), M1, M3 (fusion delta vs replace), garde
multi-compte, clamp 0-100.
**Anti faux-positifs :** ledgers `docs/audit-2/`, invariants
`docs/05-invariants.md`, commentaires `PIEGE:`/`INVARIANT:` des sources,
`docs/08-frontend.md` section 6.
**Croisements serveur :** `persistence.mjs` (isOnline, demandes d'ami,
hydrate), `tournament-engine.mjs` (formule payout), `social.mjs` (route
demande d'ami), partie 9 (push), partie 11 (retry `connect_error`).

## Verdicts par store

| Store | Verdict |
|---|---|
| `friendsStore.ts` | **1 MAJEUR (C1), 2 FAIBLE (C2, C3), 1 INFO (C7)** |
| `trustScoreStore.ts` | 1 FAIBLE (C4) |
| `tournamentStore.ts` | 1 INFO (C5) |
| `socketConnectionStore.ts` | 1 INFO (C6) + C7 |
| `matchStore.ts` | Propre — invariants et pièges appliqués |
| `presenceStore.ts` | Propre (micro C7) |
| `chatStore.ts` / `notificationStore.ts` | Propres (micro C6/C7) |
| `walletStore.ts` | Propre |
| `leagueStore.ts` / `authStore.ts` / `toastStore.ts` / `socketStore.ts` / `index.ts` | Propres |
| `useRealtimeHeartbeat.ts` | Propre |

## Ce qui a été vérifié et jugé solide

- **La règle d'hydratation est respectée partout** : `hydrateFromServer`
  FUSIONNE (delta socket), `replaceFromServer` REMPLACE — identique sur les
  quatre domaines diffusés (matchs, tournois, ligue, notifications), avec le
  même commentaire d'origine (« remplacer effacerait tous les autres »).
- **`payoutDistributed: 'pending'` survit à la normalisation** du matchStore
  (PIEGE appliqué) : un résultat non versé ne passe pas pour distribué.
- **Le payload `isMe`** est systématiquement le repère du joueur courant sur
  les matchs comme les tournois (serveur calcule POUR chaque destinataire) ;
  les stores ne déduisent jamais « mon entrée » d'un `userId` absent.
- **Garde multi-compte** : `wallet:update` contrôle l'userId avant écriture
  (`socketConnectionStore.ts:211-219`), `refreshFromServer` passe l'userId
  attendu (`walletStore` PIEGE `:15-17`) — le solde du compte précédent ne
  s'écrit pas chez le nouveau joueur.
- **Notifications** : déduplication par `metadata.dedupeKey`, hydratation
  FUSIONNANTE (les notifications locales survivent à la resynchronisation),
  `markAsRead`/`markAllAsRead` appellent l'API.
- **Chat** : `receiveServerMessage` idempotent (même id, ou même
  canal/expéditeur/texte à moins de 5 s), plafond 500 messages gardant les
  plus récents, `applyServerRead` ignore les lectures d'un tiers.
- **useRealtimeHeartbeat** : dépend de l'IDENTITÉ (`user?.id`) et non de
  l'objet user (sinon boucle disconnect/connect à chaque hydrate du wallet) ;
  backoff F2 du bootstrap 2 s → 5 s → 10 s → 20 s (`:37`, `:85-94`) ; la
  navigation simple ne retrigger pas le bootstrap ; nettoyages complets au
  démontage.
- **trustScoreStore** : vue pure, clamp 0-100 systématique, seuils de design
  documentés comme tels.
- **toastStore** : `id` explicite REMPLACE (pas d'empilement d'erreurs
  identiques), timers possédés et nettoyés, non-persistence voulue.
- **Barrels** : `socketStore.ts` re-exporte `useSocketConnectionStore` et
  `usePresenceStore`, `index.ts` les exclut exprès (un seul chemin d'import) ;
  barrel pur sans effet de bord.

## Constats

### C1 — MAJEUR : la demande d'ami envoyée plante le tableau de bord pour toute la session

Chaîne complète, prouvée par repro exécuté (test vitest temporaire, lancé puis
SUPPRIMÉ) :

1. `sendFriendRequest` (`persistence.mjs:3741-3761`) renvoie
   `{ id, senderId, targetId, status: 'pending', message, timestamp }` —
   SANS `senderPseudo` (`:3760`).
2. La route transmet l'objet brut : `respondJson(res, 200, { ok: true,
   request })` (`social.mjs:119`).
3. Le store l'insère BRUT dans la liste des demandes :
   `requests: [res.request, ...state.requests]` (`friendsStore.ts:196`).
4. Le type MENT : `socialApi.ts:34` déclare la réponse
   `request: FriendRequest`, où `senderPseudo: string` est requis
   (`friendsStore.ts:61`) — alors que le serveur ne l'envoie pas. Le
   typecheck (0 erreur) ne peut rien voir, et la normalisation défensive qui
   met `senderPseudo || 'Joueur'` n'existe que sur la voie hydrate
   (`friendsStore.ts:179-184`), jamais sur la voie envoi.
5. Deux lectures non gardées de ce champ pendant le rendu :
   `FriendsWidget.tsx:223` (`request.senderPseudo.slice(0, 2)`) et
   `DashboardPage.tsx:446` (`req.senderPseudo.slice(0, 2)`).

**Repro exécuté** (sortie console du test temporaire) :

```
request stockee : {"id":"FR-1","senderId":"U1","targetId":"U2","status":"pending",
                   "message":null,"timestamp":"2026-10-26T00:00:00.000Z"}
senderPseudo    : undefined
lecture .slice  : THROWS: Cannot read properties of undefined (reading 'slice')
hydrate senderPseudo : Joueur
```

Conséquence utilisateur : il cherche un joueur et lui envoie une demande
(flux normal) — l'objet sans `senderPseudo` entre dans la liste ; le badge
« Demandes (1) » (`FriendsWidget.tsx:109-111`) l'invite à ouvrir l'onglet,
et la section « Demandes » du tableau de bord (`DashboardPage.tsx:430`,
affichée dès que `pendingRequests.length > 0` où
`pendingRequests = requests.filter(r => r.status === 'pending')`,
`DashboardPage.tsx:131-134`) jette au rendu : `TypeError: Cannot read
properties of undefined (reading 'slice')`. `RouteErrorBoundary` prend la
page (pas de white-screen nu), mais le tableau de bord et l'onglet
« Demandes » sont morts pour la session : aucune hydratation ne vient réparer
la liste avant le prochain bootstrap complet (une fois par session, ou à la
resynchronisation après coupure) — et cette hydratation est INBOUND only
(`persistence.mjs:3704`), donc la demande envoyée n'y revient pas.

De plus, aucune sortie par l'UI : « Refuser » sa propre demande appelle
`declineFriendRequest` côté serveur qui jette `UNAUTHORIZED` (le demandeur
n'est pas `target_id`, `persistence.mjs:3790`) — le catch de
`declineRequest` (`friendsStore.ts:231-233`) affiche l'échec et laisse
l'objet pourri dans la liste. L'objet route devrait être normalisé à
l'insertion (comme l'hydrate le fait), ou la réponse serveur enrichie de
`senderPseudo`.

### C2 — FAIBLE : le statut « en ligne » des amis est mort de bout en bout

- **Serveur** : `user.isOnline` est écrit `false` UNE SEULE FOIS, à la
  création (`persistence.mjs:1310`), et JAMAIS muté ensuite — grep serveur :
  `:1310`, `:1538` (relit le champ figé pour les profils publics),
  `public.mjs:468` (recherche d'utilisateurs), `channel-presence.mjs:128`
  (hors sujet : présence par canal, `socketIds.size > 0`). Aucun cron ni
  handler ne met `isOnline` à jour à la connexion/déconnexion.
- **Front** : `updateFriendStatus` (`friendsStore.ts:313`) n'a AUCUN
  appelant (grep : la déclaration `:119`, le commentaire `:170`, la définition
  `:313`) ; le commentaire `:169-170` prétend que le socket pousse
  `friend:presence` → `updateFriendStatus` — cet événement n'existe ni côté
  serveur (aucune émission) ni côté front (aucun bind).
- `hydrateFromServer:175` force `status: 'offline'` (légitime en soi : le
  serveur ne fournit pas de statut), donc `getOnlineFriends():323` renvoie
  TOUJOURS `[]`.
- **Consommateurs** : `FriendsWidget.tsx:53/61/186` (badges + section « en
  ligne »), `ChatPage.tsx:133`, `DashboardPage.tsx:130` — tous affichent
  « tous hors ligne » / section vide, en permanence.
- **Non documenté comme choix produit** : les docs ne mentionnent `isOnline`
  qu'en `04-api.md:510` (payload de la recherche) et `01-architecture.md:768`
  (présence par canal) — rien ne dit « les amis apparaissent volontairement
  hors ligne ».

Le joueur voit une fonctionnalité (amis en ligne) qui ment silencieusement.
FAIBLE : c'est de l'affichage trompeur, pas une fonction cassée au sens
strict (aucun flux métier ne dépend de ce statut).

### C3 — FAIBLE : typo « Signalément envoyé »

`friendsStore.ts:305` : titre du toast de succès du signalement
« Signalément envoyé » — voulu « Signalement envoyé ». Visible
utilisateur.

### C4 — FAIBLE : le découpage du score de confiance n'est jamais hydraté

`trustScoreStore.hydrateFromUser` lit `user.trustBreakdown`
(`trustScoreStore.ts:34` garde du type, `:57` lecture). Grep projet entier :
2 occurrences, toutes les deux dans ce store — le champ n'existe NI sur le
type `User` (`authStore.ts`), NI côté serveur. Conséquence : Ponctualité,
Fair-play, Résultats, Litiges, Ancienneté restent TOUJOURS à la valeur par
défaut 50 (`:43-47`) — et `TrustScoreBadge.tsx:109-115` affiche ce découpage
figé comme s'il était réel, à côté d'un `overall` à lui vrai. Le commentaire
d'en-tête (« Detient le score global et son decoupage ») décrit une donnée
que personne ne produit.

### C5 — INFO : la payout des tournois est reconstruite localement à l'hydratation

`normalizePersistedTournament` (`tournamentStore.ts:259`) écrase
`tournament.payout` du serveur par le `buildPayout` LOCAL
(`tournamentStore.ts:207-225`). La formule front est IDENTIQUE à la formule
serveur (`tournament-engine.mjs:67-80` : 50/30/20 % du `playerPool` après
pool arbitre 5 %/10 %) — qui est elle-même recalculée à chaque normalisation
serveur (`:158`), donc les deux parties repartent des mêmes nombres, SAUF
pour `third` : le serveur fait `roundAmount(playerPool - first - second)`
(l'arrondi est absorbé par la troisième place), le front fait
`roundAmount(playerPool * 0.2)`. Divergence maximale constatable :
0,01 ZC affichée sur la troisième place. Le commentaire serveur `PIEGE:30`
(documente que `buildPayout` dépend des entrées et est recalculé) couvre le
cas ; le front devrait refléter la même soustraction plutôt qu'un 0,2 plat,
mais l'écran ne gouverne aucun versement.

### C6 — INFO : `showBrowser: true` court-circuite le garde « onglet en arrière-plan »

`deliverServerNotification` (`socketConnectionStore.ts:99`) pose
`showBrowser: true` sur TOUTE notification serveur livrée, alors que
`notificationStore` documente (PIEGE `:17-18`) et applique (`:112-114`) un
garde « le push navigateur n'exige… ET un onglet en arrière-plan » — le
commentaire de garde est ainsi contourné systématiquement par le chemin
socket : une notification arrive-t-elle pendant que le joueur regarde
l'onglet, la notification navigateur s'affiche quand même par-dessus.
Fonctionnel mais contraire au contrat documenté du store ; à arbitrer
(les chemins REST, eux, passent par le garde).

### C7 — INFO : micro-remarques et révision de P11 C5

- **Révision de P11 C5 (reprise `connect_error`)** : le bullet « le retry
  dépend d'un re-appel EXTERNE » est CORRIGÉ — le socket est créé sans
  désactiver `reconnection` (`realtimeClient.ts:149-155`), donc les défauts
  socket.io s'appliquent (tentatives infinies, délai exponentiel) ; chaque
  tentative de reconnexion réémet `connect_error`, le handler (`:182-192`)
  repart et re-tente la régénération de session. Le commentaire « retry au
  prochain cycle » est satisfait par le cycle socket.io lui-même. Les autres
  micro-points de P11 C5 restent valides (double enregistrement SW,
  `server:hello` jamais écouté, type `team` aspiré, champs identité inertes).
- **`syncFromMatches` pose `isConnected: true` inconditionnellement**
  (`socketConnectionStore.ts:357`), toutes les 15 s via le heartbeat
  (`useRealtimeHeartbeat.ts:100`) — cohérent avec l'INVARIANT `:8-9`
  (« on cherche à être connecté ») et le fait que le heartbeat ne tourne que
  pour un utilisateur authentifié ; rien à changer, noté pour l'historique.
- **Identifiant accentué** `MAX_PRÉSENCE_CHANNELS` (`presenceStore.ts:158`)
  — même famille d'hygiène ASCII, dans du CODE cette fois (identifiant, pas
  commentaire).
- **`activeChannelIds` non plafonné** (`presenceStore`) alors que
  roomPresence et seen sont plafonnés à 50 — un joueur qui naviguerait
  beaucoup de canaux ferait grandir la liste sans borne (théorique : les
  canaux restent peu nombreux).
- **`applyServerRead` s'applique si `userId` est absent** du payload
  (`chatStore.ts:228-229`) — le serveur force toujours `userId` depuis la
  session, donc inoffensif aujourd'hui ; un payload tiers sans `userId`
  lirait tous les canaux comme lus.
- **`addTransaction` plafonne à 100** les transactions locales alors que les
  transactions hydratées du serveur ne sont pas plafonnées — asymétrie
  d'affichage après une longue session, mineure.
- **`NodeJS.Timeout`** comme type de timer dans le module navigateur
  (`toastStore.ts:40`) — compile (types Node en portée), inoffensif.
- **Restrictions device/controller non filtrées sans session**
  (`matchStore.ts:592-599`) — même décision que pour les tournois
  (testée : « sans session, aucune restriction »), l'UI reste consultable
  sans compte.

### C8 — INFO : hygiène ASCII (code)

195 lignes non-ASCII sur les 15 fichiers code du périmètre (commentaires et
textes d'affichage accentués : `matchStore.ts` 70, `walletStore.ts` 27,
`notificationStore.ts` 17…), aucune occurrence CJK (grep vérifié). Même
famille que les parties 8-11 : la convention « commentaires de code ASCII
sans accents » n'est pas appliquée rétroactivement ; un seul identifiant
accentué (`MAX_PRÉSENCE_CHANNELS`, C7). UTF-8 propre (test d'intégrité vert).

## Résumé

Un MAJEUR, trois FAIBLE, quatre INFO. Le MAJEUR : envoyer une demande d'ami
plante le tableau de bord pour toute la session — la réponse serveur sans
`senderPseudo` est insérée brute dans la liste des demandes, le type du
client affirme le champ requis (le typecheck ne peut rien voir), et deux
rendus lisent `.slice` dessus sans garde ; prouvé par repro exécuté. Les
FAIBLE : le statut « en ligne » des amis est mort de bout en bout (jamais
muté serveur, jamais alimenté front, un commentaire qui prétend le
contraire), une typo visible dans le toast de signalement, et un découpage
du score de confiance affiché à 50 en permanence parce que le champ qui
l'alimenterait n'existe nulle part. Les INFO : la payout tournoi
recalculée localement (identique sauf l'arrondi de la troisième place),
`showBrowser` qui contourne le garde documenté, la famille de
micro-remarques avec la révision de P11 C5 (le retry `connect_error` est
couvert par le cycle de reconnexion socket.io), et l'hygiène ASCII. Tout le
reste est solide : la règle d'hydratation fusion/remplace est appliquée sur
les quatre domaines, l'argent affiché vient du serveur, les gardes
multi-compte tiennent, et la couverture de tests verrouille les pièges qui
se sont déjà trompés.
