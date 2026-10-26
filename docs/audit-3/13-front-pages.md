# Partie 13 — Front pages et features (audit-3)

**Relecture :** 2026-10-26, base `main` au `ac79c02`.
**Périmètre :** tout `src/app/**` (routes et `App.tsx`, layouts
`AppLayout`/`RootLayout`, hooks `useLogout`/`useServiceWorker`/…, tous les
composants de `src/app/components/` y compris `ui/` et `admin/`, et les 30
pages de `src/app/pages/` : lourdes `DashboardPage`, `WalletPage`, `ChatPage`,
`ClassementsPage`, `LandingPage`, `AdminDashboardPage`, `EarningsDashboard`,
mj `CreateMatchPage` 615 / `CreateTournamentPage` 693 / `HubMJPage`, auth,
legal (7 fichiers), petites) et les 4 features de `src/features/` : match
(8 fichiers, dont `MatchActions.tsx` 722 et `MatchDetailPage.tsx` 952),
tournament (8, dont `TournamentBracketPage.tsx` 591), league (7, dont
`LeagueSeasonPage.tsx` 596), br (4, dont `BrArbiterPanel.tsx` 564).
**Anti faux-positifs :** ledgers `docs/audit-2/` (dont la note hors périmètre
§ 5), invariants `docs/05-invariants.md`, commentaires
`PIEGE:`/`INVARIANT:` des sources, `docs/08-frontend.md` sections 7.2/7.4/10.
**Croisements serveur :** `state-helpers.mjs` (`sanitizeMatchForBroadcast`
`:175-178`, `sanitizeTournamentForBroadcast` `:288-315`,
`buildMatchActionPayload` `:104-112`), `match-engine.mjs` (lancement
`:958-981`, `CONFIRMATION_WINDOW_MS` `:156`, `ARBITER_FEE_RATE` `:190`,
`waitingFor` `:1212/:1229`), `tournament-engine.mjs` (`buildPayout` `:67-83`,
`getArbitersNeeded` `:61`), `league-engine.mjs` (`leaveLeagueSeasonOnServer`
`:403-427`), `br-engine.mjs` (`leaveBrLobbyOnServer` `:478-506`,
`BR_PRIZED_PLACES` `:122`, `TOO_EARLY` `:564`), `auth.mjs`
(`requestPasswordReset` `:296-337`), `persistence.mjs` (`:2612-2626`),
`wallet.mjs` (`withdrawal` `:117-147`), `routes/match.mjs` (route `room`
`:249-`, `waitingFor` `:351/:366`), `wallet-engine.mjs` (plafonds `:67`),
`competition.ts` `:76`, `styles/theme.css` `:1-37`.

## Verdicts par zone

| Zone | Verdict |
|---|---|
| Navigation (`BottomNav`, `ModeSelectionPage`, `LandingPage`) | **1 MAJEUR (C1)** |
| Flux arbitre (`MatchDetailPage`, `MatchRules`, `state-helpers`) | **1 MAJEUR (C2)** |
| Social / chat (`ChatPage`, `FriendsWidget`, `PublicProfilPage`) | 1 FAIBLE (C3), 1 FAIBLE (C12) |
| `LeaksPage` | 1 FAIBLE (C4) |
| `NotificationSettingsModal` | 1 FAIBLE (C5) |
| `Modal.tsx` + `PROJECT_README.md`, `BrLobbyDetailPage` (docstring) | 1 FAIBLE (C6) |
| `AdminTabShared` | 1 FAIBLE (C7) |
| `RootLayout` | 1 FAIBLE (C8) |
| Pages legal (`ConditionsPage`, `JeuResponsablePage`) | 1 FAIBLE (C9) |
| `WalletPage`, `EarningsCharts`, `EarningsDashboard` (chiffres/couleurs) | 1 FAIBLE (C10) |
| `ClassementsPage` + seuils de confiance UI | 1 FAIBLE (C11) |
| Typos d'affichage (projet entier) | 1 FAIBLE (C13) |
| `ForgotPasswordPage`, duplications alignées, micro-remarques | 3 INFO (C14, C15, C16) |
| Hygiène ASCII | 1 INFO (C17) |
| match feature (8/8), league feature (7/7), br feature (4/4), auth+profil, `ParametresPage`, tournoi feature (8/8), mj, legal (5/7) | Propres — voir « solide » |

## Ce qui a été vérifié et jugé solide

- **Front match (8/8)** : `MatchDetailPage` (952) et `MatchActions` (722)
  appliquent tous les invariants — repère du joueur exclusivement par
  `isMe`/`arbiter.isMe`, actions toutes via `matchApi.ts`, fenêtre de
  confirmation présentée comme « en attente » et non « gagné »,
  `payoutDistributed: 'pending'`/`false` jamais affichés comme gains,
  litige et soumission exclusifs, `getWinnerPayout` toujours présenté comme
  total d'équipe, `canSeeRoom` respecté côté affichage, gardes multi-compte
  et désinscription propres. Les 6 composants (`MatchHeader`,
  `MatchRules`, `MatchResults`, `MatchPlayers`, `MatchChat`,
  `MatchTimeline`) sont des composants de lecture fidèles à la projection
  serveur ; `waitingFor` est toujours présent dans les réponses
  (`match-engine.mjs:1229` renvoie `[]` quand réglé) et l'API le déclare.
- **Front tournoi (8/8)** : `TournoisPage` (filtres couvrant les 4 statuts,
  recherche debouncée, liste du store sans requête locale),
  `TournamentBracketPage` (contexte d'appelant en mémoire de session,
  solde vérifié avec recharge `walletFunding`, 4 statuts couverts,
  rejet `alpha === bravo`, minEntries affiché), `BracketActions` (désactivé
  pendant soumission, pass non remboursable annoncé avant clic, déficit
  via `buildFundingPath`), `BracketSidebar` (contexte purge documenté,
  règles jamais recopiées en dur), `BracketGrid`/`BracketMatchCard`
  (vainqueur par `winnerEntryId`, scores absents affichés `-`, memo avec
  props stables, libellés de round calculés sur `mainRounds`),
  `BracketHeader`, `TournamentCard`.
- **Front league (7/7)** : `LeaguePage` (repli M2 sur badge inconnu,
  `AbortController`, garde admin sur création/qualification, `reloadKey`
  pour le Réessayer), `LeagueSeasonPage` (F5 complet : invite TOTP ouverte
  sur `2FA_REQUIRED`, action mémorisée puis rejouée, confirmations
  destructives distinctes, repli M2 sur statut inconnu, paiement du podium
  affiché sans le présumer), `FinalResultsForm` (aucun appel réseau,
  classement complet exigé AVANT envoi — le commentaire verrouille
  exactement le piège des finalistes non classés dont le pass serait
  consommé —, places dupliquées bloquées, saisie conservée après échec),
  `QualificationPanel`, `StandingsTable` (état vide explicite), `AdminPanel`,
  `leagueSeasonConstants`. Vérifié serveur : le `leave` de ligue rembourse
  bien le pass (`league-engine.mjs:414-416`), la promesse de l'écran
  (`LeagueSeasonPage:355`) est exacte.
- **Front BR (4/4)** : `BrPage` (règle commerciale affichée AVANT
  l'inscription, salon `live` non joinable, roster sans `userId` avec
  comparaison par pseudo documentée, fallback config vide maîtrisé),
  `BrLobbyDetailPage` (projection serveur comme source de vérité des
  montants, M3 corrigé, règle du pass annoncée deux fois, statut
  `settling` jamais traité comme réglé), `BrLobbyCreatePanel`
  (repartition validée en direct : plafond arbitre testé AVANT la somme —
  le message affiche la cause —, défauts alignés sur `BR_DEFAULT_PAYOUT`,
  fenêtre 24-48 h, arbitre non joueur), `BrArbiterPanel` (2FA demandée à
  l'écran sur `2FA_REQUIRED`, `MIN_PRESENT_TO_START = 5` aligné sur
  `BR_PRIZED_PLACES` (`br-engine.mjs:122`), fenêtre 10 min alignée sur
  `TOO_EARLY` (`:564`), écran `settling` qui interdit de re-clôturer).
- **Auth et profil** : `Login`/`Forgot`/`Activate`, `RegisterPage`
  (validations complètes), `ProfilPage`/`PublicProfilPage` (résolution
  `isMe`/`pseudo` appliquée, canonique et `noindex` corrects),
  `ProfileView`, `ParametresPage` (sauvegarde via API puis resynchronisation
  des stores, 2FA admin irréprochable), `useServiceWorker` (INVARIANT
  appliqué : rechargement uniquement quand `controllerchange` remplace un
  contrôleur actif ; push souscrit via `subscribeToRealtimePush` Bearer).
- **mj** : `CreateMatchPage` (création via API puis
  `applyServerAccountState`, `returnTo` en liste blanche de préfixes,
  redirection funding sanitisée, partition affichée = celle du serveur),
  `CreateTournamentPage` (date passée refusée, projections verrouillées
  comme approximations documentées), `HubMJPage` (PIEGES appliqués).
- **Legal (7/7)** : `LegalLayout` (ASSISTANCE partagée, SEO `path` toujours
  passé), `ConditionsPage`, `ConfidentialitePage`, `MentionsPage`
  (hébergeurs réels front Vercel / API Render, FedaPay nommé),
  `JeuResponsablePage`, `LitigesPage`, `AntiFraudePage` (sanctions
  graduées cohérentes avec `sanctions.mjs` : `warning`/`temporary_ban`/
  `permanent_ban`). Chiffres croisés : 1 ZC = 10 FCFA, min/max retrait et
  fenêtre de contestation 30 min — tout aligné sauf C9 et C10.
- **Chrome de navigation** : `Navbar`, `NotificationDropdown`
  (déduplication lue par le serveur), `Modal` (focus trap), `Sidebar` et
  `BottomNav` pour le reste, `RouteErrorBoundary`.
- **Dashboard/Landing** : `DashboardPage` (badge demandes, actions),
  `LandingPage` (promessesMJ + BR au niveau des écrans, chiffres modérés),
  `ModeSelectionPage` pour le reste.

## Constats

### C1 — MAJEUR : `/br` est inaccessible depuis toute la navigation standard

Le salon Battle Royale existe (`/br`, 4 écrans front + routes serveur
`/api/br/**`), mais aucun chemin de navigation utilisateur n'y mène :

- `BottomNav.tsx` (mobile) n'a aucun lien `/br` — l'INVARIANT `:7-9` du
  fichier liste pourtant les modes à exposer ; les onglets présents sont
  MJ/Tournois/Ligue/Social/Profil.
- `ModeSelectionPage` (écran de choix de mode après connexion) : le seul
  bouton BR (`handleBRClick`, `:32-34`) navigue vers `/br-league`, pas
  `/br` — l'en-tête du fichier (`:4-5`) documente trois modes (MJ, BR, BR
  League) mais la page n'expose que deux boutons.
- `LandingPage:499` annonce « MJ + BR » et renvoie vers `/mode`, qui mène
  à son tour à `/br-league`.
- Seuls la `Sidebar` desktop (menu social/BR, visible uniquement en
  desktop connecté) et les retours internes BR (`Retour aux salons`)
  permettent d'y accéder.

Conséquence : un joueur mobile connecté — le public cible (CODM Mobile
Money) — n'a AUCUN chemin vers les salons BR : la fonction entière (créer
un salon, s'inscrire, être arbitré) est morte depuis l'UI mobile. Écart
net avec `docs/08-frontend.md` (section navigation) qui liste `/br` dans
l'inventaire des routes accessibles.

**Piste de correctif** : ajouter `/br` dans `BottomNav` (ou dans les 5
onglets existants) et un bouton « Battle Royale » dans `ModeSelectionPage`
vers `/br` (distinct de `/br-league`), en cohérence avec l'INVARIANT
`BottomNav.tsx:7-9`.

### C2 — MAJEUR : la salle CODM n'est jamais livrée au front — le lancement des matchs arbitrés est inerte depuis l'UI

Chaîne complète, croisée serveur (déjà relevée côté serveur dans
`docs/audit-2/02-autorisation.md:947-955`, note « hors périmètre » restée
sans correctif, reprise ici côté front car elle rend la fonction morte
depuis l'UI) :

1. `sanitizeMatchForBroadcast` (`state-helpers.mjs:178`) retire
   `roomName`/`roomPassword` de TOUTES les sorties, sans exception ni
   dérogation pour les participants ou l'arbitre.
2. Les réponses REST d'action passent par le même sanitizer :
   `buildMatchActionPayload` (`:104-112`) appelle
   `sanitizeMatchForBroadcast(match, userId)` (`:108`) — y compris la
   réponse du POST `/api/matches/:id/room` où l'arbitre vient de saisir la
   salle. Les diffusions socket passent par le même chemin.
3. Côté front : `canLaunch` (`MatchDetailPage.tsx:231`) exige
   `!!match.roomName && !!match.roomPassword` — champ TOUJOURS absent
   des payloads reçus — donc `canLaunch` vaut TOUJOURS `false` et le
   bouton « DÉMARRER LE MATCH » reste inerte, même quand tout le reste est
   prêt (check-in, présence de l'arbitre).
4. Le pré-remplissage (`:202`, `setRoomName(match.roomName || '')`) est
   donc toujours vide, et `MatchRules:57` affiche invariablement « La salle
   sera partagée peu avant le lancement », même après publication par
   l'arbitre.
5. Le serveur exige LUI AUSSI la salle au lancement
   (`match-engine.mjs:967-976`, `MATCH_NOT_READY`) — la condition serveur
   est saine, mais comme le front ne peut jamais VÉRIFIER l'état salle,
   l'écran ne peut jamais activer le bouton.

Périmètre exact de la casse : le flux « match arbitré » (arbitre réservé,
commission 2 % de la cagnotte, lancement par `launchMatchOnServer`
exclusivement réservé à l'arbitre `:963-964`). Les matchs MJ sans arbitre
ne passent pas par `launchMatch` (réglement par soumission + confirmation
des deux joueurs) et restent fonctionnels. Tout match 1v1 arbitré crée
depuis l'UI ne peut donc jamais démarrer (et donc jamais être réglé ni
payer la commission d'arbitre promise).

**Piste de correctif** : rendre la salle à l'arbitre et aux participants
dans `buildMatchActionPayload`/diffusions quand `viewerId` est participant
ou arbitre (comme `isMe` est calculé par destinataire), ou ajouter un
champ dédié `{ room: { name, password } | null }` dans la réponse d'action
`room`. Côté front, `canLaunch` et `MatchRules` lisent alors la valeur
réelle. Le garde « ne jamais la mettre dans un état partagé » du store
(`MatchDetailPage` PIEGE `:17-19`) reste applicable : seule la projection
par destinataire change.

### C3 — FAIBLE : le chat privé joueur-à-joueur est inutilisable de bout en bout

- `ChatPage.tsx:186-190` : création de canal
  `chatApi.ensurePrivateChannel(participants)` — le canal construit est
  mono-participant (l'appelant seul) et aucun écran ne permet d'inviter
  l'autre joueur ; les messages partent donc dans un salon sans
  interlocuteur (vérifié : aucun endpoint d'invitation côté serveur pour
  ajouter un membre à un canal privé).
- `FriendsWidget.tsx:196-198` : bouton « Message » rendu sur chaque ami —
  SANS `onClick` : le clic ne fait rien.
- `PublicProfilPage:165` : « Inviter en match » navigue vers
  `/mj/creer?invite=<id>` ; grep projet entier : AUCUN lecteur de
  `?invite=` (`CreateMatchPage` ne lit aucun paramètre d'URL) — le paramètre
  est ignoré, l'invitation pré-remplie n'existe pas.

La fonctionnalité « parler à un joueur en privé » est annoncée par la
Sidebar (lien `/chat`) et par le widget amis, mais aucun flux ne l'accomplit.
FAIBLE : pas d'argent en jeu, mais une fonction annoncée morte de bout en
bout (famille C2 audit-2 « Message » mort).

### C4 — FAIBLE : `LeaksPage` — course du chargement du catalogue

`LeaksPage.tsx:244-263` : le fetch du catalogue tourne dans un
`useEffect` à dépendances `[]` sans `AbortController` ni garde
`cancelled` : un démontage rapide (ou deux montages successifs) laisse la
promesse résoudre après coup et écrire dans un état démonté (avertissement
React), et deux montages concurrents peuvent laisser le résultat périmé
écraser le plus récent. Bruit de réseau local, pas de dommage métier.
Même famille que le motif corrigé ailleurs (`AbortController` appliqué dans
`LeaguePage`/`LeagueSeasonPage` — la convention locale existe, cette page
n'y est pas passée).

### C5 — FAIBLE : `NotificationSettingsModal` — réglages décoratifs

- Les toggles (push navigateur, résumé hebdo, sons) ne modifient AUCUN
  réglage persisté : « Sauvegarder » se contente de fermer la fenêtre
  (`onClose`), rien n'est envoyé à l'API, et l'état est perdu au
  démontage.
- Le bouton « Ajouter au calendrier » génère un fichier `.ics` factice
  (contenu statique sans évènement réel).

L'écran donne l'illusion d'une préférence enregistrée. FAIBLE : pas de
donnée détruite, mais tromperie douce sur l'état (famille C5 audit-2).
À arbitrer : soit câbler aux réglages réels existants (notificationStore
+ push), soit cacher les toggles non câblés.

### C6 — FAIBLE : docs fantômes — classe CSS inexistante et docstring BR fausse

- `Modal.tsx:105` applique `bg-zoyd-black-80` — token ABSENT de
  `theme.css:25-33` (sept tokens `zoyd-*` définis, aucun `-80`) : la classe
  ne génère rien, le fond de la modale ne reçoit donc pas l'opacité
  prévue ; `PROJECT_README.md:137-139` documente le token comme s'il
  existait (doc fausse).
- `BrLobbyDetailPage.tsx:4` (docstring) : « Affiche le roster, le
  check-in, la salle CODM, … » — la page n'affiche AUCUNE salle et le
  payload BR ne porte aucun `roomName` (grep front + serveur : aucune
  occurrence) ; la mention est un résidu d'un autre écran.

Famille « doc fausse » (FAIBLE) : rien ne casse le rendu, mais
l'inventaire des tokens (README) et le descriptif de l'écran mentent.

### C7 — FAIBLE : `AdminTabShared` ne connaît pas `awaiting_arbiter`

`AdminTabShared.tsx:22-46` : `statusToneMap` et `statusLabelFR` couvrent
recruiting/full/check_in/ready/in_progress/completed/cancelled/disputed,
mais PAS `awaiting_arbiter` — statut pourtant vivant et réel
(`match-engine.mjs`, match vivant bloqué faute d'arbitre, PIEGE
`MatchDetailPage:14-16`). Un match en attente d'arbitre s'affiche dans
l'admin avec le libellé brut du statut et sans couleur de garde. FAIBLE :
l'admin voit un libellé brut (bruit), la file d'arbitres reste visible
ailleurs.

### C8 — FAIBLE : `RootLayout` — polling et réactions sur `isConnected`

`RootLayout.tsx:37/:58/:82` : les effets de resynchronisation (bootstrap
données, purge à la déconnexion, polling de complément) se déclenchent sur
`isConnected` du store socket, c'est-à-dire sur des transitions de
transport, pas sur l'identité. Une coupure réseau re-déclenche le
polling/bootstrap complet à la reconnexion — fonctionnel mais
contre-productif (double fetch à chaque retour réseau, pics à la
reconnexion mobile) ; l'identité (`user?.id`) est déjà le critère utilisé
par `useRealtimeHeartbeat` (partie 12), ce layout ne l'applique pas.
FAIBLE : charge réseau et états transitoires, aucune perte de données
vérifiée.

### C9 — FAIBLE : pages legal en écart avec le code (plafond quotidien omis, « plafond de dépôt » sans mécanisme)

- `ConditionsPage:94` annonce les plafonds de retrait mais omet le
  plafond QUOTIDIEN de 50 000 ZC / 24 h (`wallet-engine.mjs:67`,
  publié au joueur dans `wallet.mjs:138` `dailyLimit`) — un joueur lisant
  les Conditions découvrira le refus en agissant (le max par retrait
  100 000 ZC, lui, est conforme à `wallet.mjs:197`).
- `JeuResponsablePage:49-51` propose « Plafond de dépôt » comme outil du
  joueur ; aucun mécanisme serveur ne l'implémente (grep
  `depositLimit|plafond|selfExclude` : rien côté joueur — la seule
  régulation existe pour la ligue `maxPlayers`, hors sujet). La « Pause
  temporaire », elle, est bien couverte par les sanctions admin réelles
  (`warning`/`temporary_ban`) — tranché anti faux-positif.

C'est la famille PIEGE de ces pages mêmes (« toute evolution metier …
doit etre refletee ici en meme temps que dans le code »). FAIBLE : une
promesse contractuelle sans mécanisme et un plafond réel non documenté.

### C10 — FAIBLE : chiffres et couleurs codés en dur dans les écrans wallet/earnings

- `WalletPage:514/:518` : la carte « En un coup d'oeil » code en dur
  « frais 2 % » et « recharge min 150 ZC » alors que l'INVARIANT
  `:10-11` exige la lecture de `withdrawal` publié par le serveur
  (`wallet.mjs:134-140` livre `feeRate`/`minAmount`/`dailyLimit`) —
  diverge à la première politique différente.
- `EarningsCharts.tsx:54/:66` et `EarningsDashboard.tsx:112-113` :
  couleurs `#FFCC00` et `#009EE2` en dur, alors que le PIEGE de
  `EarningsCharts:8-9` exige les tokens et que les tokens valent
  `#FFFF00` (`zoyd-yellow`) et `#0070FF` (`zoyd-blue`,
  `theme.css:3-6`) — les graphiques utilisent deux couleurs
  légèrement différentes du reste de l'UI.

FAIBLE : tout est correct aujourd'hui (2 %, 150 ZC existants), mais chaque
point diverge silencieusement à la première édition du côté « source ».

### C11 — FAIBLE : trois jeux de seuils de confiance coexistent dans l'UI, et la vue mobile du classement omet l'ELO

- Le store (`trustScoreStore`, source de vérité documentée) définit
  80/50/30 ; `EarningsDashboard.tsx:76-82` redéfinit « Solide » à ≥75 ;
  `ClassementsPage.tsx:404-409/:435` redéfinit à ≥70. Le même joueur peut
  être « Solide » sur un écran et « Fiable » sur l'autre.
- `ClassementsPage.tsx:419-440` : la variante mobile de la liste de
  classement n'affiche ni ELO ni victoires ni taux de victoire —
  l'utilisateur mobile voit des rangs sans la métrique qui les définit
  (desktop ok).

FAIBLE : incohérence d'affichage, aucune action monétaire derrière (les
badges sont informatifs).

### C12 — FAIBLE : `PublicProfilPage` — succès affiché avant l'issue réelle, double toast

`PublicProfilPage:190-192` : après clic sur « Signaler », un toast
« Signalement enregistré » est affiché INCONDITIONNELLEMENT, avant le
retour de l'API — le store `friendsStore.reportUser` (`:285-311`) gère
déjà ses propres toasts d'issue (succès « Signalément envoyé » — voir C13 —
et échec). Résultat : double toast, et message de succès affiché même si
l'API échoue (réseau, quota). Même famille que C1 P12 (issue annonce
l'issue du serveur avant de la connaître). FAIBLE : pas de perte de
donnée, tromperie d'issue.

### C13 — FAIBLE : collection de fautes d'affichage (fr)

Visible utilisateur, aucun impact fonctionnel (tout est échappé par React).
Occurrence la plus longue du projet — extraits par fichier :

- `CreateMatchPage:544` « Verrouillér » ; `CreateTournamentPage:644`
  « gardès », `:661` « Publiér » ; `MatchDetailPage:378` « à bien été »
  (voulu « a bien été ») ; `MatchActions:699` « Scréénshots » ;
  `TournamentBracketPage:249/:265` « Ajouté les coéquipiers » /
  « Ajouté des ZC » (voulu « Ajoute »), `:361` « Scores invalidés »
  (voulu « invalidés » reste valable mais le sens voulu était
  « invalidé » — lire « scores invalides ») ; `BracketActions:142`
  « confirmé l'inscription » (voulu « confirmer ») ;
  `EarningsDashboard:227` « rembourséments » (voulu
  « remboursements ») ; `friendsStore:305` « Signalément » (déjà C3 P12) ;
  `PublicProfilPage:190-192` « Signalément » ×2 ;
  `LeagueSeasonPage:170` « remboursément » ;
  `BrArbiterPanel:142` « ils seront.classes derniers » (point en plein
  milieu), `:329` « (laisser vide si mort/mort) » (libellé incohérent) ;
  `BrLobbyCreatePanel:384` « tu sera le seul » (voulu « tu seras ») ;
  `BrPage:120` « la regle quisurvit » (collé) ;
  `AdminPanel:168` « La reassignment n est possible » (apostrophe manquante
  et anglicisme).

### C14 — INFO : `ForgotPasswordPage` — branche morte (choix produit assumé côté serveur) et commentaires contradictoires

- `ForgotPasswordPage:44-47` : la branche « Aucun compte associé à cet
  identifiant » est du CODE MORT : le serveur force `found: true` et une
  réponse identique que le compte existe ou non (`auth.mjs:311-337`,
  « Conserve pour compatibilite, mais toujours a true » ;
  `persistence.mjs:2612-2626`). Tranché anti faux-positif : ce n'est PAS
  un oracle d'énumération actif. La branche front ne peut jamais être
  prise — à supprimer ou à garder comme filet avec un commentaire
  « morte par choix serveur ».
- Commentaires serveur contradictoires : `auth.mjs:303-305` décrit le
  choix produit INVERSÉ (« le front a besoin de savoir si le compte
  existe ») alors que `:311-332` (le code) dit le contraire — le premier
  bloc est obsolète et induit en erreur le prochain lecteur.
- Même famille front : `BrPage:5` et `BrLobbyCreatePanel:8-9`
  (docstrings « réservé au role admin ») contredisent A7 appliqué dans
  les mêmes fichiers (`:90-92`, `:146-148`, `:275-276`) : la création de
  salon est ouverte à tout utilisateur connecté. Les docstrings
  d'en-tête sont obsolètes.

### C15 — INFO : duplications front/serveur alignées (à surveiller, rien à corriger)

- `ARBITER_FEE_RATE = 0.02` : `match-engine.mjs:190` (versement réel) et
  `CreateMatchPage:40` (aperçu de cagnotte) — identiques aujourd'hui.
- `BracketGrid:141-142` : re-divise `arbiterPool / arbitersNeeded` et
  encode « 2% au cash-out » en dur — alignés, même famille.
- `TrustScoreBadge` (variante compacte) re-déclare les seuils du store —
  identiques (partie 12).
- `CreateTournamentPage` : la part 3e place en aperçu (`0.2` plat) vs
  résiduel serveur — DÉJÀ constaté en P12 C5 (payout tournoi recalculée
  localement), pas un constat nouveau.

### C16 — INFO : micro-remarques

- `ChatPage:279-290` : mute/unmute du canal n'examine pas
  `response.ok` ni ne toast l'échec — le toggle peut revenir à l'écran
  sans effet (les voies d'envoi de message, elles, traitent l'échec).
- `DashboardPage:399` : `to={n.actionUrl || '#'}` — un `#` est un lien
  mort silencieux quand l'action n'a pas d'URL ; `safeNavigate` (appliqué
  ailleurs pour les destinations sanitizées) n'est pas utilisé ici.
- `DashboardPage:585` : `elo || 1000` — un ELO réellement à 0 s'affiche
  1000 (improbable mais non gardé).
- `EarningsDashboard:342` : `transaction.type` brut affiché tel quel —
  libellés techniques (`payout`, `deposit`…) sans table FR.
- `RegisterPage` (pseudo max 20) vs `ParametresPage` (30) — plafonds
  d'édition divergents.
- `ActivatePage` : voie héritée (code d'activation) maintenue en parallèle
  du flux actuel — fonctionnelle, redondante.
- `ClassementsPage:409` (`|| player.isMe`) force l'inclusion du joueur
  courant sans activité, en tension avec son PIEGE `:13-14` (un joueur
  sans activité ne doit pas être classé) — l'écran l'affiche quand même
  pour l'ancrage, choix d'UX non documenté.
- `BracketSidebar:142-147` : le mot de passe de duel de tournoi est rendu
  sans garde `canSeeRoom` — INOPÉRANT : le champ n'arrive jamais au front
  (le sanitizer des tournois passe aussi par `sanitizeMatchForBroadcast`,
  `state-helpers.mjs:288-291`), donc l'affichage est vide. Garder la garde
  au cas où le champ devient livré.
- `AdminPanel:151` : le pot projeté utilise le `entryFee` LOCAL non
  encore sauvegardé — affiche le potentiel après sauvegarde (ambigu, pas
  faux) ; `:72-74` : le chargement des paiements n'a ni abort ni garde
  `cancelled` (même famille C4, impact moindre).
- `LeaguePage:455` : « Démarrer les qualifications » sur `activeSeason?.
  id || ''` — si aucune saison active, la soumission part avec un id vide
  et reçoit l'erreur serveur (le bouton est masqué sans admin, donc
  théorique).
- Page 404 : bouton « CONNEXION » présent — en tension avec son propre
  PIEGE `:11-12` (« un 404 qui propose de se connecter masque l'erreur »).
- Micro-précédents déjà listés dans la lecture : double-fetch au montage
  (bootstrap + socket push), double purge à la déconnexion
  (RootLayout + useLogout), `Sidebar.socialItems` pointe `/chat` (canal
  mort, C3), compteur `WALLET` dupliqué dans la Sidebar, bootstrap sans
  `retry` applicatif (couvert par F2 côté heartbeat), `navigator.
  serviceWorker.ready` sans timeout (un SW en erreur bloque la demande de
  permission — théorique).

### C17 — INFO : hygiène ASCII (code)

Le scan (`zoyd-ascii-scan.mjs`, les 160 fichiers code de
`src/app/**` et `src/features/**`) relève 2427 occurrences non-ASCII sur
1369 lignes distinctes : accents des textes d'affichage FR et des
commentaires. Aucune occurrence CJK (grep `[\x{4e00}-\x{9fff}]` vérifié
sur le périmètre). Même famille que les
parties 8-12 : la convention « commentaires de code ASCII sans accents »
n'est pas appliquée rétroactivement — voir 00-SYNTHESE. UTF-8 propre
(test d'intégrité vert).

## Résumé

Deux MAJEUR, onze FAIBLE, quatre INFO. Le premier MAJEUR : `/br` est
inaccessible depuis la navigation mobile et l'écran de choix de mode
(les deux boutons BR mènent à `/br-league`) — la fonction BR est morte
depuis l'UI mobile, le public cible. Le second MAJEUR (déjà noté
« hors périmètre » en audit-2, resté sans correctif) : le sanitizer
retire la salle CODM de toutes les sorties, y compris les réponses
d'action, donc `canLaunch` est toujours faux et le bouton « DÉMARRER LE
MATCH » des matchs arbitrés est inerte — le flux arbitré 1v1 ne peut ni
démarrer ni payer la commission d'arbitre. Les FAIBLE dominants : le chat
privé joueur-à-joueur est inutilisable de bout en bout (canal
mono-participant, bouton « Message » sans clic, `?invite=` ignoré), les
pages legal promettent un outil inexistant et omettent le plafond
quotidien de retrait, trois jeux de seuils de confiance coexistent, et
une longue collection de fautes d'affichage FR. Les INFO : la branche
morte de `ForgotPasswordPage` (choix serveur assumé), les duplications
de littéraux alignées (0.02, seuils), une famille de micro-remarques et
l'hygiène ASCII. Tout le reste est solide : les quatre features
(match/tournoi/ligue/BR) appliquent leurs invariants de bout en bout,
l'argent affiché vient du serveur, les gardes 2FA (F5) et les replis
(M2/M3) sont en place, et les pages legal nomment les prestataires réels.
