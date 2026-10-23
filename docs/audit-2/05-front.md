# Audit 2 — Étape 5 : relecture critique du FRONT

**Périmètre relu intégralement** : `src/app/routes.tsx`, `src/app/layouts/` (3),
`src/app/stores/` (14 + leurs tests), `src/app/lib/` (apiClient, realtimeClient,
sessionPurge, sessionReset, serverSync, chatApi, matchApi, authApi, walletApi,
leagueApi, tournamentApi, brApi, socialApi, notificationApi, usersApi, apiUrl,
logger, toast), `src/app/hooks/` (7), `src/app/components/` (dont `ui/` — 60
fichiers), `src/app/pages/` (dont `legal/`, `auth/`, `mj/`), `src/features/`
(match, tournament, league, br), `src/lib/` (competition, matchPayout,
profileMetrics, communityInsights, walletFunding, payoutOperators, utils),
`src/styles/` (4).

**Croisé avec** : `server/http-utils.mjs` (correspondance exhaustive des codes
d'erreur), `server/routes/*.mjs` (formes de réponse réelles), `server/persistence.mjs`,
`server/match-engine.mjs`, `server/tournament-engine.mjs`, `server/league-engine.mjs`,
`server/br-engine.mjs`, `server/state-helpers.mjs`, `.eslintrc.json`,
`e2e/ui/accessibility.spec.ts`.

**Aucun fichier applicatif n'a été modifié.** Seul ce document a été créé.

**Méthode** : lecture intégrale du périmètre, puis recoupement ligne à ligne
avec le contrat serveur réel. Chaque affirmation a été relue dans son contexte
avant d'être écrite ; ce qui n'a pas pu être confirmé est marqué
**NON VÉRIFIÉ** (§ 6).

---

## 1. Synthèse

| Sévérité | Nombre | IDs |
|---|---|---|
| Critique | 1 | F1 |
| Haute | 4 | F2, F3, F4, F5 |
| Moyenne | 7 | F6, F7, F8, F9, F10, F11, F12 |
| Faible | 8 | F13, F14, F15, F16, F17, F18, F19, F20 |
| **Total** | **20** | |

**Les 5 plus graves** :

1. **F1** — Hooks conditionnels : `/profil/:id` **plante au chargement direct**
   (`PublicProfilPage.tsx:165`). Erreur React « Rendered more hooks than during
   the previous render » → l'`ErrorBoundary` racine s'affiche et **toute
   l'application tombe**.
2. **F2** — `bootstrapReady` n'est jamais remis à `true` en cas d'échec : **cinq
   écrans restent sur un squelette pour toujours** (portefeuille, match,
   hub, classements, profil public). Le joueur ne voit jamais son solde.
3. **F3** — La déconnexion (`useLogout`) **ne purge pas le contexte d'appelant de
   tournoi** ni la file de signalements : le compte suivant hérite de l'entrée
   du précédent (le bracket affiche « ta position » sur un tournoi où il n'a
   jamais joue).
4. **F4** — Le tableau de bord admin affiche **« 0 ZC » de revenu ZOYD** quand
   la lecture échoue (2FA absente, 500, réseau) : le commentaire du code dit
   « on garde 0 plutôt que de mentir », le code fait exactement le contraire.
5. **F5** — Les actions admin sous 2FA (`award`, `cancel`, `refund` ligue) n'ont
   **aucune invite TOTP** : elles échouent systématiquement en `403
   2FA_REQUIRED` et obligent l'admin à sortir de l'écran.

**Ce qui est solide** (§ 5) : le pattern de purge de session
(`sessionPurge` + `sessionReset`), la règle « un 403 métier ne détruit jamais la
session », les garde multi-compte du wallet et du socket, le composant `Modal`
(piège de focus complet), le retry avec backoff du portefeuille, la
correspondance des codes d'erreur, l'anneau `focus-visible` global, la cible
tactile 44 px, et le `2FA_REQUIRED` traité dans `BrArbiterPanel` (à recopier).

---

## 2. Constats

### F1 — CRITIQUE — Hooks conditionnels : le profil public `/profil/:id` plante et fait tomber l'application

**Fichiers** : `src/app/pages/PublicProfilPage.tsx:93`, `:95`, `:110`, `:165-166`
(même famille : `src/app/pages/ProfilPage.tsx:42` et `:55`).

**Preuve.** Dans `PublicProfilPage`, les deux `useState` de la confirmation de
blocage/signalement sont déclarés **après** trois retours précoces :

```tsx
// PublicProfilPage.tsx
 93:   if (!id) return null;
 95:   if (!bootstrapReady) { return ( <Skeleton .../> ); }
110:   if (!publicProfile || !summary) { return ( ... ); }
...
165:   const [confirmAction, setConfirmAction] = useState<string | null>(null);
166:   const [confirmReport, setConfirmReport] = useState(false);
```

Or `bootstrapReady` vaut **`false` au premier rendu** : l'initialisation du
store `socketConnectionStore` le déclare à `false` (`socketConnectionStore.ts:129`)
et le bootstrap temps réel est asynchrone (`useRealtimeHeartbeat.ts:57-66`).

**Scénario concret.**
1. Un joueur ouvre (ou recharge) `https://…/profil/<uuid>` — lien partagé,
   notification push, rafraîchissement de page.
2. Premier rendu : `bootstrapReady === false` → retour ligne 95 → le composant
   rend **14 hooks**.
3. Le bootstrap temps réel aboutit → le store passe `bootstrapReady: true` →
   re-rendu → le composant va jusqu'à la ligne 165 et appelle **2 hooks de
   plus**.
4. React lève `Rendered more hooks than during the previous render.`
   (invariant de `react-dom`, vérifié dans les versions 18.x).
5. L'`ErrorBoundary` racine (`src/app/components/ErrorBoundary.tsx:31-67`)
   attrape l'erreur → **l'écran « Une erreur est survenue / Recharger »
   remplace toute l'application**, pas seulement la page.

Le même motif existe dans `ProfilPage.tsx` : `useMemo` est appelé ligne 55,
**après** le `if (!user) return` ligne 42. Ce cas est latent (la page n'est
montée que pour un utilisateur connecté, et la déconnexion démonte la page dans
le même lot de rendu), mais il exploserait si l'ordre change.

**Pourquoi personne ne l'a vu** : `eslint-plugin-react-hooks` n'est **pas
installé** (voir F17) et aucun test e2e ne charge `/profil/:id` (voir F18).

**Correction.** Déplacer les deux `useState` **au-dessus** des retours
précoces dans `PublicProfilPage` (et le `useMemo` au-dessus du retour dans
`ProfilPage`). Un hook ne doit jamais être conditionnel, même si la condition
semble stable. Ajouter `eslint-plugin-react-hooks` (F17) pour interdire le
retour.

---

### F2 — HAUTE — `bootstrapReady` reste `false` après un échec : cinq écrans sont bloqués sur un squelette à jamais

**Fichiers** : `src/app/stores/socketConnectionStore.ts:377-405` (le `catch`
ligne 399-404) ; `src/app/hooks/useRealtimeHeartbeat.ts:57-66` ;
consommateurs : `src/app/pages/WalletPage.tsx:414`, `src/features/match/pages/MatchDetailPage.tsx:616`,
`src/app/pages/mj/HubMJPage.tsx:198`, `src/app/pages/ClassementsPage.tsx:343`,
`src/app/pages/PublicProfilPage.tsx:95`.

**Preuve.** `bootstrapServerState` ne pose `bootstrapReady: true` qu'en cas de
succès ; en cas d'échec, le `catch` ne remet que `serverConnected` et
`connectionLabel` :

```ts
// socketConnectionStore.ts:399-404
} catch {
  set((state) => ({
    serverConnected: false,
    connectionLabel: state.isConnected ? 'syncing' : 'offline',
  }));
}
```

`bootstrapReady` reste donc à `false`. Or c'est **la** condition d'affichage
de cinq écrans. Le hook de retry ne rattrape rien : `useRealtimeHeartbeat.ts:61-65`
remet `didBootstrapRef.current = false`, mais l'effet a pour dépendances
`[enabled, isAuthenticated, userId]` — **il ne se rejoue pas**. Le seul
redémarrage est un remontage de `AppLayout`.

**Scénario concret.** Le serveur Render est en veille (offre gratuite) ou la
session temps réel a expiré : `POST /api/realtime/auth/session` ou
`GET /api/realtime/state/bootstrap` échoue. Le joueur ouvre son portefeuille :
il voit **quatre cartes squelette et rien d'autre, définitivement**. Même
chose sur le détail d'un match, le hub, les classements et le profil public.
Le portefeuille ne montre même pas les soldes : le joueur conclut que son
argent a disparu.

**Correction.** Sur l'échec, poser un état explicite (`bootstrapFailed: true`)
et **ne plus utiliser `bootstrapReady` comme condition d'affichage** ;
remplacer le retry par le même backoff que le portefeuille
(`useWalletSessionBootstrap.ts:23`, délais 2 s → 5 s → 10 s → 20 s), qui est
déjà écrit et testé. Un écran doit toujours rendre un état « je n'ai pas pu
charger » avec un bouton « Réessayer », jamais un squelette infini.

**Correctif (23/10/2026)** — les deux parties sont appliquées, cap du backoff
inclus :

- état explicite : `socketConnectionStore` porte désormais `bootstrapFailed`,
  posé dans le `catch` du bootstrap, effacé ensuite par une réussite et par la
  déconnexion volontaire (un échec ne doit pas trainer dans la session
  suivante) ; trois tests ajoutés à `socketConnectionStore.test.ts` ;
- retry : `useRealtimeHeartbeat` retente le bootstrap avec le même backoff
  que le portefeuille (2 s → 5 s → 10 s → 20 s : l'offre gratuite de Render
  s'endort, le reveil demande de la patience). Subtilité : `bootstrapServerState`
  avale ses propres erreurs (le `catch` du store ne rejette pas), donc la
  réussite se lit dans `bootstrapReady` après l'attente — un `.catch` du
  hook n'aurait jamais tiré. Le cleanup de l'effet tue le timer d'arrière-plan
  et interdit les tentatives en vol (logout, changement de compte) sans
  remettre `didBootstrapRef`, pour qu'une simple navigation (remontage)
  ne déclenche pas un bootstrap de plus ;
- écrans : un composant partagé `BootstrapFailedPanel` (« chargement
  impossible » + « Réessayer ») est rendu par les **cinq** écrans branchés
  sur `bootstrapReady` (wallet, détail de match, hub MJ, classements, profil
  public). Le squelette reste affiché tant que le backoff retente ;
  le panneau n'apparaît qu'après le dernier essai — et son bouton « Réessayer »
  relance `bootstrapServerState` à la main.

---

### F3 — HAUTE — La déconnexion ne purge pas le contexte d'appelant de tournoi ni la file de signalements : fuite entre comptes

**Fichiers** : `src/app/hooks/useLogout.ts:47-59` (et `:54`) ;
référence : `src/app/lib/sessionReset.ts:56-77`.

**Preuve.** `useLogout` **duplique** la purge à la main au lieu d'appeler
`resetAllSessionStores()`. La copie est incomplète :

```ts
// useLogout.ts
51:   useTournamentStore.setState({ tournaments: [] });      // ← pas les maps d'appelant
54:   useFriendsStore.setState({ friends: [], requests: [], blockedIds: [] });  // ← pas reports/pendingId
```

alors que la fonction de référence fait :

```ts
// sessionReset.ts:59-67
useTournamentStore.setState({
  tournaments: [],
  // Maps par-utilisateur : sans ce reset, le nouveau compte héritait de
  // l'ENTRÉE du précédent ...
  callerEntryByTournament: {},
  callerArbiterSlotByTournament: {},
  openArbiterSlotsByTournament: {},
});
```

Et l'invariant est écrit noir sur blanc dans l'en-tête du store
(`tournamentStore.ts:13-15`) : « Il doit être purgé à la déconnexion, sinon le
nouveau compte hérite de l'entrée du précédent (fuite de données +
inscription bloquée à tort). »

**Scénario concret.**
1. Le joueur A s'inscrit à un tournoi (`TournamentBracketPage.tsx:271`) →
   `setCallerTournamentContext` remplit `callerEntryByTournament["T-1"]`.
2. A se déconnecte depuis la Sidebar (`useLogout`). `tournaments` est vidé,
   **la map ne l'est pas**.
3. Le joueur B se connecte dans le même onglet et ouvre `/mj/tournois/T-1` :
   `myEntry` est retrouvé par `callerEntryId` (`TournamentBracketPage.tsx:104`) →
   le bracket affiche **« ta position »** pour un tournoi où B n'a jamais
   joué, et **bloque son inscription** (`canRegister = !myEntry`).
4. Même mécanisme pour `callerArbiterSlotByTournament` : B peut se voir
   arbitre d'un tournoi sans l'être.

Second effet, plus discret : `friendsStore.reports` (la file de modération
lue par `AdminDashboardPage.tsx:63` et `ClassementsPage.tsx:94`) survit à la
déconnexion.

**Correction.** Supprimer la purge manuelle de `useLogout` et appeler
`resetAllSessionStores()` (qui est déjà le point d'entrée unique, testable, et
qui isole chaque étape dans son `try/catch`). Ne jamais dupliquer une purge :
il y a déjà eu une régression de ce type (les maps de tournoi ont été ajoutées
à `sessionReset` sans que `useLogout` soit mis à jour).

**Correctif (23/10/2026)** — appliqué tel quel : `useLogout` ne duplique plus
**rien**. Le hook garde son orchestration (backend, push service-worker,
`logout()` de l'auth, timers de toasts), et délègue la purge intégrale à
`resetAllSessionStores()` : wallet, matchs, tournois **avec les trois maps
d'appelant**, ligue, chat, amis **avec la file de signalements et
`pendingId`**, notifications, toasts, trust, presence, socket. La moitié
restée à la main est exactement celle qui exige des timers explicites
(`cleanupToastTimers`, `idCounter`, absents de `sessionReset`) ; tout le reste
est délégué, et le commentaire du hook verrouille l'invariant « jamais de
copie locale de la purge ». Un test ajouté à `sessionPurge.test.ts` verrouille
précisément les deux champs que la copie oubliait (maps d'appelant + `reports`).

---

### F4 — HAUTE — Le tableau de bord admin affiche « 0 ZC » de revenu quand la lecture échoue

**Fichiers** : `src/app/pages/AdminDashboardPage.tsx:107-113` et `:341-352`.

**Preuve.** Le commentaire du `catch` et le code se contredisent :

```ts
// AdminDashboardPage.tsx:109-111
fetchAdminCommissions()
  .then((data) => { setCommissions(data); })
  .catch(() => { /* 2FA absente ou reseau : on garde 0 plutot que de mentir */ });
```

Le commentaire dit « plutôt que de mentir » ; le code fait précisément le
contraire : `commissions` reste à son état initial `{ revenue: 0, … }`, et la
carte l'affiche tel quel :

```tsx
// AdminDashboardPage.tsx:341-346
<StatCard … label="REVENUS ZOYD (2 % RETRAITS)"
  value={formatZC(commissions.revenue)}   // → "0 ZC"
  hint={`${commissions.withdrawalCount} retrait(s) honoré(s)`} />
```

**Scénario concret.** L'admin n'a pas vérifié sa 2FA depuis plus de 5 minutes :
`GET /api/admin/commissions` est sous `requireAdmin2fa` → `403 2FA_REQUIRED`
→ le `catch` avale tout → le tableau de bord affiche **« REVENUS ZOYD : 0 ZC »
et « SORTIES ARBITRES : 0 ZC »**. L'admin en conclut que ZOYD n'a encaissé
rien et qu'aucun arbitre n'a été payé. C'est un **faux statement financier**
présenté comme une donnée.

**Correction.** Distinguer « zéro » de « inconnu » : ajouter un état
`commissionsUnavailable` sur le modèle de `reportsUnavailable` qui existe
déjà dans le même fichier (`AdminDashboardPage.tsx:83`, `:405-412`) et
afficher « indisponible » plutôt que « 0 ZC ». Le même écran sait déjà faire
ce que l'écran ne fait pas.

**Correctif (23/10/2026)** — appliqué : `commissionsUnavailable` est posé dans
le `catch` de la lecture (le commentaire mensonger « on garde 0 plutôt que de
mentir » est remplacé), effacé à chaque succès, et les deux cartes financières
affichent `indisponible` en valeur, avec un motif en sous-titre (« 2FA expirée
ou réseau »), tant que la lecture n'a pas abouti. Un zéro n'est affiché que
quand le serveur a effectivement répondu zéro.

---

### F5 — HAUTE — Les actions admin sous 2FA n'ont aucune invite TOTP : le tableau de bord admin et le panneau ligue sont bloqués

**Fichiers** : `src/app/pages/AdminDashboardPage.tsx:258-306`
(`award`, `resolve-dispute`, `cancel`) ; `src/features/league/pages/LeagueSeasonPage.tsx:152-221`
(`refund`) ; `src/app/lib/leagueApi.ts:114-119` ; `src/app/lib/walletApi.ts:162-165`.

**Preuve.** Côté serveur, ces routes sont sous `requireAdmin2fa` :
`POST /api/admin/matches/:id/award` (`server/routes/admin.mjs:586`),
`/resolve-dispute` (`:641`), `/cancel` (`:669`), `POST /api/leagues/:id/refund/:userId`
(`server/routes/league.mjs:396`), `GET /api/leagues/:id/payments` (`:416`),
`GET /api/admin/commissions` (`admin.mjs:176`),
`GET /api/admin/matches/export` (`admin.mjs:389`).

Côté front, aucun de ces écrans ne demande de code TOTP. Le seul ecran qui le
fait est `BrArbiterPanel.tsx:206-241` (invite TOTP sur `2FA_REQUIRED`) — c'est
le bon pattern, il n'est simplement pas réutilisé.

**Scénario concret.** L'admin clique « Résoudre le vainqueur » sur un litige :
la requête part, le serveur répond `403 { code: '2FA_REQUIRED' }`, le client
affiche « Vérification 2FA requise : ouvre Paramètres > Sécurité » (message
correct, `apiClient.ts:119`). L'admin doit **quitter l'écran**, aller dans
Paramètres > Sécurité, saisir le code, revenir, **recliquer**. Sur le panneau
de ligue, le remboursement n'a **aucun** chemin : le bouton est simplement mort.
L'admin renonce, la file de moderation reste bloquée.

**Correction.** Extraire le pattern de `BrArbiterPanel` (champ TOTP + verify +
rejeu de l'action) dans un composant réutilisable (`<TwoFactorPrompt>`) et
l'utiliser dans `AdminDashboardPage` et `LeagueSeasonPage`. Au minimum :
pré-detecter le `2FA_REQUIRED` et ouvrir l'invite au lieu d'afficher un toast.

**Correctif (23/10/2026)** — le composant réutilisable est extrait
(`src/app/components/admin/TwoFactorPrompt.tsx` : dialog modal, champ
numérique à 6 chiffres, focus automatique et champ remis à zéro à chaque
ouverture — un code résiduel d'une tentative précédente serait refusé par la
fenêtre TOTP) et branché sur les deux écrans :

- `AdminDashboardPage` : `award`, `resolve-dispute`, `cancel` **et** l'export
  CSV/JSON (lui aussi sous `requireAdmin2fa`, `admin.mjs:389`) attrapent
  `ApiError.code === '2FA_REQUIRED'` ; l'action en attente est mémorisée dans
  un ref (la closure du handler), l'invite s'ouvre à la place du toast, et
  après `verifyAdmin2fa` réussi l'action est rejouée telle quelle. Les erreurs
  du rejeu passent par les toasts habituels de chaque handler ; l'invite, elle,
  ne remonte que les échecs de *vérification* du code.
- `LeagueSeasonPage` : `executeAdminAction` mémorise `{ action, payload }`
  (le rejeu des résultats de finale transporte donc les mêmes résultats) et
  rejoue après vérification. Le remboursement de ligue a enfin un chemin ;
  avant, le bouton était mort.

`BrArbiterPanel` garde son implémentation en place — c'était le modèle, le
composant en est l'extraction, changer le fonctionnel qui fonctionnait
d'abord aurait élargi le risque pour zéro gain.

---

### F6 — MOYENNE — Le bouton « couper les notifications » du chat appelle une route qui n'existe pas, et le retour arrière ne se déclenche jamais

**Fichiers** : `src/app/pages/ChatPage.tsx:268-291` ;
serveur : `server/routes/chat.mjs:64`, `:80`, `:108`, `:154`, `:204`.

**Preuve.** Le serveur n'expose que cinq routes chat :
`GET /api/chat/bootstrap`, `GET /api/chat/channels/:id`,
`POST /api/chat/channels`, `POST /api/chat/channels/:id/messages`,
`POST /api/chat/channels/:id/read`. **Il n'y a ni `/mute` ni `/unmute`.**

Le front appelle ces routes par un `fetch` nu :

```tsx
// ChatPage.tsx:279-291
fetch(getApiUrl(`/api/chat/channels/${channelId}/${newMuted ? 'mute' : 'unmute'}`), {
  method: 'POST', headers: {…}, credentials: 'include',
}).catch(() => {
  // Rollback on failure
  …
});
```

Un 404 **résout** la promesse `fetch` : `.catch()` n'est jamais appelé, le
rollback ne part jamais, et `response.ok` n'est jamais vérifié.

**Scénario concret.** Le joueur clique la cloche : l'icône passe en « coupé »
et le compteur de non-lus disparaît. Le serveur n'a rien enregistré. Au
rechargement de la page, le canal est de nouveau « actif » et les notifications
sont de nouveau comptées. Le joueur **croit** avoir coupé ses notifications
pendant ce temps.

**Correction.** Soit implémenter la route serveur, soit retirer le bouton.
Dans les deux cas : vérifier `response.ok` avant de valider la mise à jour
optimiste, et passer par `apiClient` (qui translate déjà les codes d'erreur)
plutôt que par un `fetch` nu.

---

### F7 — MOYENNE — Échec de lecture → liste vide sans message d'erreur : ligues, tournois et matchs

**Fichiers** : `src/app/lib/leagueApi.ts:34-40`, `src/app/lib/tournamentApi.ts:52-58`,
`src/app/lib/matchApi.ts:97-104` ; consommateurs :
`src/features/league/pages/LeaguePage.tsx:197-222` et `:414-422`,
`src/features/tournament/pages/TournoisPage.tsx:48-73`,
`src/app/layouts/RootLayout.tsx:39-52`.

**Preuve.** Les trois fonctions avalent l'erreur et renvoient une collection
vide :

```ts
// leagueApi.ts:34-40
export const fetchServerLeagues = async (): Promise<LeagueListResponse> => {
  try { return await authorizedGet<LeagueListResponse>('/api/leagues'); }
  catch { return { ok: false, seasons: [] }; }
};
```

Le `catch` des pages est donc **du code mort** : `loadError` n'est jamais
posé, le bouton « Réessayer » n'apparaît jamais.

**Scénario concret.**
- `/api/leagues` renvoie un 500 ou un 401 : la page affiche « Aucune saison de
  ligue pour le moment. » **sans aucun message d'erreur** et sans
  « Réessayer ». L'admin conclut qu'aucune ligue n'existe.
- `/api/matches` échoue transitoirement : `RootLayout.tsx:42-46` appelle
  `replaceFromServer([])` → **la liste des matchs du hub est effacée** et le
  joueur voit « L'arène est calme. » sur une arène pleine.

**Correction.** Ne pas avaler l'erreur dans la couche API : la propager
(`throw`) et laisser l'appelant décider entre « liste vide » et « échec de
lecture », comme le fait déjà `AdminDashboardPage` avec `reportsUnavailable`
(`.ts:83`, `:130`, `:405-412`). Le motif est déjà écrit, il n'est juste pas
appliqué.

---

### F8 — MOYENNE — La « cagnotte » affichée est la cagnotte théorique, pas celle qui sera versée

**Fichiers** : `src/features/match/components/MatchPlayers.tsx:98`,
`src/app/components/MatchCard.tsx:139`, `src/app/pages/mj/HubMJPage.tsx:71`,
`src/app/pages/mj/HubMJPage.tsx:214` ;
contre `src/features/match/pages/MatchDetailPage.tsx:762` et `:789` ;
règle : `src/lib/matchPayout.ts:11-13`.

**Preuve.** Le projet a écrit la règle :

> « la projection serveur prime. Ne jamais recalculer `prizePool - zoydFee -
> arbiterFee` pour l'affichage : `prizePool` vaut `maxPlayers x entryFee` dès
> la création, alors que le serveur calcule sur les fonds réellement bloqués.
> Un roster incomplet verse moins. »
> — `src/lib/matchPayout.ts:11-15`

…et ne l'applique qu'à moitié. Le détail d'un match affiche donc **deux
cagnottes différentes sur le même écran** :

```tsx
// MatchPlayers.tsx:98   → cagnotte THÉORIQUE
<InfoCard label="Cagnotte" value={formatZC(match.prizePool)} />

// MatchDetailPage.tsx:789 → cagnotte RÉELLE
<dd>{formatZC(match.projectedPayouts?.basis ?? pot)}</dd>
```

Le hub cumule le même écart : `HubMJPage.tsx:71` (`Σ match.prizePool`) et
`MatchCard.tsx:139` (« A gagner » = `pot`).

**Scénario concret.** Un 5VS5 lancé avec 3 joueurs présents : l'en-tête
annonce une cagnotte de `5 × entryFee`, la fenêtre de confirmation annonce
`3 × entryFee`. Le gagnant est crédité du second montant. L'écart n'est pas
une question de'arrondi : c'est le montant.

**Correction.** Utiliser `match.projectedPayouts?.basis` partout où une
cagnotte est affichée (MatchPlayers, MatchCard, HubMJPage), avec repli sur
`prizePool` quand la projection est absente. Le helper existe déjà
(`getWinnerPayout`, `getArbiterFee` dans `src/lib/matchPayout.ts`).

---

### F9 — MOYENNE — Les gains de tournoi sont comptés même quand le serveur n'a pas payé, et le montant est celui de l'équipe

**Fichiers** : `src/lib/communityInsights.ts:89-94` et `:437-451` ;
`src/lib/profileMetrics.ts:127-141` et `:213` ;
serveur : `server/tournament-engine.mjs:511-517`, `:662`, `:690-695`.

**Preuve.** Le serveur pose `entry.finalPlacement` (1, 2, 3) à la fin du
tournoi, **indépendamment** du règlement ; si le versement échoue, il est
consigné dans `tournament.pendingPayouts` (`tournament-engine.mjs:690-695`) et
rejoué par le cron. **Le front ne lit jamais `pendingPayouts`** (le type
`Tournament` du store ne le déclare même pas, `tournamentStore.ts:143` ne
déclare que `pendingRefunds`).

Second problème, symétrique : `tournament.payout.first` est le **total** de la
place (le serveur le crédite au capitaine, `tournament-engine.mjs:662`), mais
le front l'ajoute au `totalEarnings` de **chaque membre** :

```ts
// communityInsights.ts:437-451
const payout = getTournamentPlacementPayout(entry, tournament);  // = tournament.payout.first
for (const member of entry.members) {
  …
  record.totalEarnings = roundAmount(record.totalEarnings + payout);  // …à chacun
}
```

C'est exactement le piège que le projet a déjà corrigé pour les matchs
(`getWinnerPayoutPerPlayer`, `src/lib/matchPayout.ts:79-84`, et l'invariant
« getWinnerPayout renvoie le TOTAL DE L'EQUIPE » de `profileMetrics.ts:14-17`).
La correction n'a pas été reportée sur les tournois.

**Scénario concret.** Un tournoi dont le règlement a échoué (base saturée) :
le joueur voit son gain de tournament dans « Total Généré » du tableau de bord
des gains (`EarningsDashboard.tsx:131`) et dans le classement de la communauté
(`ClassementsPage.tsx:391-393`), alors que l'argent est dans
`pendingPayouts` et ne lui est pas crédité. Sur un 5VS5, chaque membre affiche
en plus **5 fois** le montant de la place.

**Correction.** (a) Exclure du décompte les entrées dont le placement figure
dans `pendingPayouts` — le champ est déjà dans la réponse serveur, il suffit de
le déclarer dans le type `Tournament` et de le lire. (b) Diviser le montant de
la place par la taille de l'équipe, sur le modèle de
`getWinnerPayoutPerPlayer`.

---

### F10 — MOYENNE — La suppression de compte appelle `logout()` seul : les stores de session ne sont pas purgés

**Fichiers** : `src/app/pages/ParametresPage.tsx:632` et `:653` ;
règle : `src/app/pages/ProfilPage.tsx:36-40`.

**Preuve.**

```tsx
// ParametresPage.tsx (DangerZone)
632:   const logout = useAuthStore((s) => s.logout);   // ← pas useLogout()
…
653:       logout();
```

`useAuthStore.logout()` ne vide que l'auth (`authStore.ts:124-126`). Le
`useLogout()` existe précisément pour ça, et l'invariant est écrit dans le
fichier voisin :

> « Passe par `useLogout`, PAS par `useAuthStore.logout()` : ce dernier ne fait
> que vider l'état local. […] les stores du compte précédent restaient en
> mémoire — visibles pour qui se connecte ensuite. »
> — `src/app/pages/ProfilPage.tsx:36-40`

**Scénario concret.** Le joueur supprime son compte : l'auth est vidée, mais
le solde, l'historique de transactions, les matchs, le chat, les amis et le
contexte de tournoi **restent en mémoire**. Le compte suivant qui se connecte
dans le même onglet les voit jusqu'au prochain rafraîchissement serveur.

**Correction.** Utiliser `useLogout()` dans `DangerZone` (après
`deleteOwnAccount`, qui invalide déjà la session côté serveur).

---

### F11 — MOYENNE — Course inter-comptes sur la session temps réel : la promesse en vol n'est pas invalidée à la déconnexion

**Fichiers** : `src/app/lib/realtimeClient.ts:113-145` et `:229-233`.

**Preuve.** `ensureRealtimeSession` mémoïse la promesse **sans la keyed par
utilisateur** :

```ts
// realtimeClient.ts:113-120
const ensureRealtimeSession = async (user: User) => {
  if (isSessionValid(activeSession, user)) return activeSession as RealtimeSession;
  if (sessionPromise) { return sessionPromise; }   // ← peu importe l'utilisateur
  …
```

et `disconnectRealtimeSocket` ne remet pas `sessionPromise` à `null` :

```ts
// realtimeClient.ts:229-233
export const disconnectRealtimeSocket = () => {
  identifiedUser = null;
  activeSession = null;      // ← sessionPromise n'est pas remis à null
  socket?.disconnect();
};
```

**Scénario concret.** Le joueur A est connecté ; un `POST
/api/realtime/auth/session` est en vol (jusqu'à 15 s, `AbortSignal.timeout(15000)`).
A se déconnecte → `disconnectRealtimeSocket()` → `sessionPromise` reste pointé
sur la promesse de A. Le joueur B se connecte dans la fenêtre :
`ensureRealtimeSession(B)` renvoie la promesse de A → `activeSession` = la
session de A → `currentSocket.auth = { token: session.token }` → **le socket se
connecte avec le jeton de A**. B reçoit alors les deltas de A
(`state:matches`, `chat:message`, `presence:snapshot`).

Le handler `wallet:update` est protégé par le garde multi-compte
(`socketConnectionStore.ts:208`), mais `onMatchesSnapshot`, `onChatMessage` et
`onPresenceSnapshot` ne le sont pas.

**Correction.** Remettre `sessionPromise = null` dans
`disconnectRealtimeSocket()`, et/ou vérifier `session.userId === user.id`
avant d'utiliser la session. Une session temps réel appartient à un compte,
pas à un onglet.

---

### F12 — MOYENNE — `bindRealtimeHandlers` n'enlève pas le handler `wallet:update` : les listeners s'empilent

**Fichiers** : `src/app/lib/realtimeClient.ts:161-203` (liste `off()` lignes
165-176, pose ligne 199) ; l'en-tête du fichier, lignes 13-15.

**Preuve.** Le module se warns lui-même :

> « PIEGE : `bindRealtimeHandlers` retire les handlers avant de les rebrancher.
> Une omission sur la liste des `off()` empile les handlers à chaque remontage :
> c'est le cas de `wallet:update`, posé mais jamais retiré. »
> — `src/app/lib/realtimeClient.ts:13-15`

Le code est conforme à ce avertissement : `wallet:update` n'est pas dans la
liste des `off()`.

**Scénario concret.** `connect()` est appelé à chaque changement de
`[enabled, isAuthenticated, userId]` (`useRealtimeHeartbeat.ts:81`) — donc à
chaque changement de compte et à chaque remontage. Chaque appel ajoute un
listener `wallet:update` supplémentaire. Les anciens sont neutralisés par
leur garde multi-compte, mais ils restent en mémoire, et le même événement est
appliqué N fois au store.

**Correction.** Ajouter `currentSocket.off('wallet:update');` à la liste. Le
commentaire d'en-tête n'a pas été appliqué — c'est exactement le type d'écart
qui survit parce que le piège est documenté au lieu d'être corrigé.

---

### F13 — FAIBLE — Le « hash de preuve » technique est affiché au joueur

**Fichiers** : `src/features/match/components/MatchResults.tsx:90-94` ;
construction : `src/app/stores/matchStore.ts:257-258` et `:377-384`.

**Preuve.** `proofHash` n'est pas un condensé : c'est une concaténation de
l'identifiant du match, du score et **des références de preuve** :

```ts
// matchStore.ts:257-258
const buildProofHash = (matchId, winnerTeam, scores, refs) =>
  [matchId, winnerTeam, scores.team0, scores.team1, ...refs.map((r) => r.toLowerCase())].join('|');
```

Et le client le **reconstruit localement** quand le serveur ne l'envoie pas
(`matchStore.ts:377-384`) à partir des captures.

**Scénario concret.** Le joueur lit « Hash de preuve : M-ABC|0|13|9|https://… »
sous son résultat. C'est un artefact interne affiché tel quel ; et si la
référence du serveur est présente, les URL des captures sont exposées à tous
ceux qui voient le match (la même fuite que S4 de `docs/audit-2/02-autorisation.md`,
côté front).

**Correction.** Ne pas afficher le `proofHash` à l'écran (ou n'afficher qu'un
condensé de 8 caractères calculé par le serveur).

---

### F14 — FAIBLE — Crash latent sur la recherche de tournois (`rules.mapPool` peut être `undefined`)

**Fichiers** : `src/features/tournament/pages/TournoisPage.tsx:82` ;
`src/app/stores/tournamentStore.ts:256`.

**Preuve.**

```ts
// TournoisPage.tsx:82
tournament.rules.mapPool.some((map) => map.toLowerCase().includes(query))
```

Le type déclare `mapPool: string[]`, mais le repli du store ne le fournit pas :

```ts
// tournamentStore.ts:256
rules: tournament?.rules || { mode: 'ranked', map: 'Unknown', scoreTarget: 13, bestOf: 1 },
```

→ `rules.mapPool` est `undefined` sur ce chemin → `undefined.some(…)` →
*« Cannot read properties of undefined (reading 'some') »*.

**Scénario concret.** Un tournoi enregistré sans `rules.mapPool` (payload
ancien, ou le chemin de repli ci-dessus) : le joueur tape dans la recherche
de la page des tournois → la page plante (`ErrorBoundary`).

**Correction.** `(tournament.rules.mapPool || []).some(…)` **et** compléter le
repli `rules` du store avec `mapPool: []`.

---

### F15 — FAIBLE — L'écran d'un salon BR confond « introuvable » et « erreur réseau »

**Fichiers** : `src/features/br/pages/BrLobbyDetailPage.tsx:76-84` et `:150-163`.

**Preuve.** Le `catch` affiche un toast pour toute erreur, mais le rendu
ligne 150 retombe sur l'écran « introuvable » dès que `lobby` est `null`,
quelle que soit la cause :

```tsx
150:   if (notFound || !lobby) {
…
156:       <p className="text-white/60 text-sm mb-6">Ce salon n'existe pas ou a ete supprime.</p>
```

**Scénario concret.** Un 500 transitoire ou un timeout : le joueur est told
« Ce salon n'existe pas ou a été supprimé » — une information fausse, sur un
salon qui existe et où il a payé son pass.

**Correction.** Distinguer `notFound` (404 `LOBBY_NOT_FOUND`) de `loadError` et
afficher le message d'erreur avec un bouton « Réessayer ».

---

### F16 — FAIBLE — Un mot de passe erré purge la session courante

**Fichiers** : `src/app/lib/apiClient.ts:59-76` ;
`server/http-utils.mjs:377-379`.

**Preuve.** `handleAuthError` purge sur **tout** 401 :

```ts
// apiClient.ts:63
const isAuthFailure = status === 401 || (status === 403 && code === 'AUTH_REQUIRED');
```

Or le serveur mappe `INVALID_CREDENTIALS` sur **401**
(`http-utils.mjs:377-379`) : une erreur de mot de passe est donc traitée
comme une expiration de session.

**Scénario concret.** Un joueur connecté ouvre `/auth/login` dans un autre
onglet et se trompe de mot de passe : les stores de session sont purgés et
`logout()` est appelé → **il est déconnecté de sa session dans l'autre
onglet**, sans raison visible.

**Correction.** Exclure `INVALID_CREDENTIALS` de la purge : c'est une erreur
de saisie, pas une expiration.

---

### F17 — FAIBLE — Le lint ne peut pas détecter les hooks conditionnels

**Fichiers** : `.eslintrc.json:1-13`, `package.json` (devDependencies).

**Preuve.** Le seul plugin déclaré est `@typescript-eslint` ; ni
`eslint-plugin-react-hooks` ni la config `plugin:react-hooks/recommended`
n'apparaissent. `eslint:recommended` ne contient pas ces règles. Donc
`react-hooks/rules-of-hooks` **n'est jamais exécutée**, alors que
`pnpm lint` (`--max-warnings 0`) tourne en CI.

**Conséquence directe.** F1 et F2 passent le lint sans être signalés, et
n'importe quel hook conditionnel futur passera aussi.

**Correction.** Ajouter `eslint-plugin-react-hooks` aux devDependencies et
`"extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended",
"plugin:react-hooks/recommended"]`. C'est le seul garde-fou automatique contre
la famille de bugs la plus coûteuse du projet.

---

### F18 — FAIBLE — Le test d'accessibilité analyse la page 404 et ne couvre aucun écran authentifié

**Fichiers** : `e2e/ui/accessibility.spec.ts:18-24` ; `src/app/routes.tsx:95`.

**Preuve.** La liste des pages auditées contient `/selection-mode` :

```ts
const PAGES = [
  { name: 'Accueil', path: '/' },
  { name: 'Connexion', path: '/auth/login' },
  { name: 'Inscription', path: '/auth/register' },
  { name: 'Mot de passe oublie', path: '/auth/forgot-password' },
  { name: 'Selection de mode', path: '/selection-mode' },   // ← la route est /mode
];
```

Or la route réelle est `path: 'mode'` (`routes.tsx:95`) : le test analyse la
**page 404**, qui ne contient aucun des composants de
`ModeSelectionPage`. Le test passe donc à vide.

Par ailleurs, les écrans où se passent les vraies interactions — portefeuille,
détail de match, chat, bracket, tableau de bord admin — ne sont **pas** dans la
liste.

**Correction.** Corriger le chemin (`/mode`) et ajouter les écrans
authentifiés à la liste (avec une session de test).

---

### F19 — FAIBLE — Contraste insuffisant sur les micro-textes `text-white/40` (3,7:1)

**Fichiers** : `src/features/match/components/MatchPlayers.tsx:67-69`,
`src/app/pages/LeaksPage.tsx:338`, `src/app/pages/LeaksPage.tsx:312` ;
`src/styles/theme.css` (palette) ; `e2e/ui/accessibility.spec.ts:71-74`.

**Preuve.** Sur le fond `#050505` (`--color-black`), un texte `text-white/40`
(40 % de blanc) compose `#696969` : luminance relative 0,141 contre 0,0015 pour
le fond, soit un rapport de contraste de **≈ 3,7:1**. Le seuil WCAG AA est
**4,5:1** pour un texte normal. Ces textes font 10 px : ils ne sont pas des
« grands caractères » (qui exigent 3:1).

Le budget axe du projet ne les voit pas : seuls les impacts `serious` et
`critical` sont retenus (`accessibility.spec.ts:71-74`), et le contraste est
classé `moderate` — le fichier le dit explicitement (« les règles `moderate`
(rapport de contraste, par exemple) sont bruitées par le theme sombre »).

**Scénario concret.** Un joueur malvoyant ne lit pas le `gameId` sous son
pseudo (`MatchPlayers.tsx:68`), ni les mentions de bas de page. Le défaut est
réel mais systématique : il porte sur tous les `text-white/40` en 10 px.

**Correction.** Passer ces micro-textes à `text-white/60` (≈ 5,7:1) ou
`text-white/50` (≈ 4,6:1), et ajouter `moderate` au budget axe sur un
échantillon de pages.

---

### F20 — FAIBLE — Le débordement horizontal est masqué, pas rendu scrollable

**Fichiers** : `src/styles/theme.css:60` ; `src/app/layouts/AppLayout.tsx:68`.

**Preuve.**

```css
/* theme.css:56-63 */
body { … overflow-x: hidden; … }
```

```tsx
/* AppLayout.tsx:68 */
<main id="main-content" className="flex-1 min-w-0 pb-24 md:pb-4 overflow-x-clip">
```

Le commentaire d'`AppLayout` assume le choix (« sans ça, le min-content des
descendants étire `main` au-delà du viewport […] Avec `overflow-x-clip`, ça ne
scrollait pas — mais le contenu était rogné »). C'est un choix défendable ;
le risque est qu'il **masque** un débordement réel au lieu de le signaler.

**Scénario concret.** Un élément plus large que le viewport (un tableau sans
`overflow-x-auto`, un bouton `whitespace-nowrap` comme « CRÉER UN WAGER »
dans `HubMJPage.tsx:192` sur un écran 320 px) est **coupé net** : le joueur ne
peut pas lire la fin du libellé et n'a aucun moyen de le savoir. Sur mobile,
le scroll latéral du navigateur est neutralisé par `overflow-x: hidden`.

**Correction.** Réserver le masquage au cas limite : garder `overflow-x-clip`
sur `main` (le `min-w-0` est le vrai correctif), mais **retirer
`overflow-x: hidden` du `body`** afin que le débordement reste atteignable
par le scroll natif, et tester à 320/360 px.

---

## 3. Contrat serveur — ce qui est conforme

Vérifié ligne à ligne contre `server/http-utils.mjs` et les 11 modules de
routes.

| Point | Verdict | Preuve |
|---|---|---|
| **Un 403 métier ne détruit PAS la session** | **Conforme** | `apiClient.ts:63` : la purge ne se déclenche que sur `401` ou `403 + AUTH_REQUIRED`. Un `403 ADMIN_REQUIRED`, `403 2FA_REQUIRED`, `403 FORBIDDEN`, `403 TRANSACTION_NOT_OWNED`, `403 ACCOUNT_NOT_ACTIVATED` ou `423 ACCOUNT_LOCKED` laisse la session intacte. **Le client ne déconnecte donc pas l'utilisateur sur un refus d'autorisation** — c'est la question posée, et la réponse est non. |
| **Un 401 purge bien la session** | Conforme | `apiClient.ts:64-75` → `purgeSessionStores()` + `logout()`, en file d'attente pour éviter les purges en cascade. |
| **Forme des réponses wallet** | Conforme | `GET /api/wallet/me` renvoie `{ wallet, user, withdrawal }` (`wallet.mjs:128-143`), `POST /api/wallet/verify-fedapay` renvoie `{ ok, amount, wallet, user }` (`:473-478`), `POST /api/wallet/withdraw` renvoie `buildWithdrawalAmounts()` (`:427`) — exactement les types de `walletApi.ts`. |
| **Codes d'erreur : pas de fuite technique** | Conforme | Le client mappe 47 codes vers un message lisible (`apiClient.ts:89-136`). Les ~35 codes du serveur absents de cette table retombent sur le **message du serveur**, qui est partout rédigé en français courant (`http-utils.mjs:344-472`) ; le `default` du mapping renvoie un 500 générique (« Une erreur serveur est survenue. »), jamais une stack. Le seul enrichissement client est `PAYOUT_FAILED`, explicitement tronqué à 300 caractères (`apiClient.ts:145-166`). **Aucun nom de table, aucun id interne, aucune stack n'atteint l'écran.** |
| **Codes serveur → statut HTTP** | Conforme | `AUTH_REQUIRED` 401, `FORBIDDEN`/`TRANSACTION_NOT_OWNED`/`ACCOUNT_NOT_ACTIVATED` 403, `INSUFFICIENT_FUNDS` et les conflits 409, `WITHDRAWAL_MIN` 400, `PAYOUT_FAILED` 502, `SERVER_BUSY` 503 — le client ne fait aucune hypothèse sur le statut, il lit `code`. |
| **`GET /api/matches` est public et le client le traite comme tel** | Conforme | `matchApi.ts:97-104` (avec la réserve de F7). |
| **`isMe` plutôt que `userId`** | Conforme | Le client ne lit jamais `userId` d'un joueur de match ; il utilise `isMe` / `pseudo` (`matchStore.ts:57-73`, `presenceStore.ts:7-13`). C'est le bon choix et il est tenu. |

---

## 4. Fuite entre comptes — ce qui est conforme

| Point | Verdict | Preuve |
|---|---|---|
| **Le purge est enregistré avant la première requête** | Conforme | `sessionPurge.ts` est un registre sans import ; le handler est branché **au chargement du module** `useAuthSessionBootstrap.ts:37`, lui-même importé au top-level par `App.tsx:44` → le handler existe avant le premier rendu et avant tout appel réseau. La purge est donc synchrone. |
| **La purge est isolate par store** | Conforme | `sessionReset.ts` : chaque étape dans son propre `try/catch` — une purge partielle n'empêche pas les autres stores d'être vidés. |
| **Le wallet est protégé contre une réponse tardive** | Conforme | `walletStore.ts:218-220` : `refreshFromServer(expectedUserId)` compare l'`userId` attendu avec l'utilisateur courant **avant** d'écrire ; sinon le solde et l'historique d'un autre joueur s'écrivaient chez le nouveau. Même garde sur `socketConnectionStore.ts:208` pour `wallet:update`. |
| **Le bootstrap chat vide les canaux à la déconnexion** | Conforme | `useChatSessionBootstrap.ts:11-15` : `replaceFromServer([], [])` quand il n'y a plus d'utilisateur. |
| **La présence est vidée à la coupure** | Conforme | `socketConnectionStore.ts:232` appelle `presenceStore.clearPresence()`. |

Les deux trous restants sur ce sujet sont **F3** (la déconnexion manuelle) et
**F11** (la session temps réel).

---

## 5. Points solides — à reproduire

Un futur lecteur doit savoir ce qui est **correct** : ces points ont été
vérifiés, pas supposés.

### B1 — La règle d'or de la gestion d'erreur : « un 403 métier ne détruit pas la session »

`apiClient.ts:59-76` implémente une distinction simple et bien documentée
entre **absence de session** (401) et **refus métier** (403) : seul le premier
purge. C'est exactement la règle que le serveur énonce
(`http-utils.mjs:395-398`). Tous les écrans qui manipulent l'argent ou
l'administration en dépendent. **À recopier dans tout nouveau client.**

### B2 — Le registre de purge sans import (`sessionPurge.ts`)

Un module sans aucune dépendance, qui stocke une fonction, et dont le
gestionnaire est branché au chargement du module qui connaît les stores.
Résout un cycle d'imports réel sans dynamiser l'import (ce qui aurait
provoqué un avertissement Rollup permanent). La purge est donc synchrone et
jamais retardée. **Pattern à recopier** pour tout nouveau store de session.

### B3 — `resetAllSessionStores()` : une purge, un `try/catch` par store

Une seule fonction, testable, qui vide les onze stores de session, chaque
étape isolée. Le problème de F3 vient de sa **duplication** dans `useLogout`,
pas de la fonction elle-même : la règle est « un seul point de purge ».

### B4 — Les gardes multi-compte du wallet et du socket

`walletStore.refreshFromServer(expectedUserId)` (`walletStore.ts:218`) et
`socketConnectionStore.onWalletUpdate` (`socketConnectionStore.ts:208`)
vérifient que l'utilisateur courant est bien celui attendu **avant** d'écrire.
C'est la bonne réponse au problème « une réponse HTTP arrive après un logout
suivi d'une reconnexion ».

### B5 — Le composant `Modal` : piège de focus complet

`src/app/components/ui/Modal.tsx` : `role="dialog"` + `aria-modal`, piège de
focus sur `Tab`/`Shift+Tab`, `Escape`, focus initial sur le premier élément
focusable, **restitution du focus au déclencheur** à la fermeture, et surtout
`onClose` conservé dans une **ref** (`:45-46`) pour ne pas rejouer l'effet à
chaque frappe — sans quoi, sur mobile, le clavier se fermait à chaque
caractère saisi. Le commentaire explique chaque piège. **C'est le modèle à
recopier pour toute modale maison.**

### B6 — Le retry avec backoff du portefeuille

`useWalletSessionBootstrap.ts:23` : `2000 → 5000 → 10000 → 20000` ms, avec un
garde-fou par utilisateur (`hydratedRef`) et annulation propre à
l'unmount. Le commentaire explique la raison : « avaler affichait 0 ZC alors
que le serveur en avait ». **C'est exactement le modèle qui manque au
bootstrap temps réel (F2).**

### B7 — `isMatchPayoutSettled` : « un résultat n'est pas un versement »

`matchStore.ts:215-216` : un type-guard qui distingue `payoutDistributed ===
true` de `'pending'` et `false`. Utilisé partout dans le chemin « match »
(`profileMetrics.ts:173`, `communityInsights.ts:420`, `MatchResults.tsx:56`).
La règle est aussi écrite dans le composant qui l'applique
(`MatchResults.tsx:8-10`) : « afficher un montant là-dessus, c'est annoncer
de l'argent qui n'est pas arrivé ». **Le même invariant manque sur les
tournois (F9).**

### B8 — La projection serveur prime sur le recalcul local

`src/lib/matchPayout.ts` : `getWinnerPayoutPerPlayer` lit
`projectedPayouts.perWinner` avant tout repli, et `getArbiterFee` lit
`projectedPayouts.arbiterFee`. Le commentaire documente le piège historique
(« la part annoncée était deux fois trop petite en 2VS2 »). Le mécanisme est
bon ; c'est son périmètre d'application qui est incomplet (F8, F9).

### B9 — `BrArbiterPanel` : le traitement du `2FA_REQUIRED`

`src/features/br/components/BrArbiterPanel.tsx:206-241` : sur
`ApiError.code === '2FA_REQUIRED'`, le panneau ouvre un champ TOTP, vérifie,
puis **rejoue l'action** — sans jamais déclencher le versement deux fois. **C'est le
pattern à extraire (F5).** Le panneau respecte aussi la règle « la
répartition affichée n'est pas la répartition versée » et « ne pas confirmer un
versement avant la réponse serveur ».

### B10 — `ErrorBoundary` + `RouteErrorBoundary`

Un `errorElement` sur **chaque** branche protégée de `routes.tsx`, une erreur
journalisée **avant** l'affichage du repli (`ErrorBoundary.tsx:41-43`), et un
écran d'erreur qui propose une issue (recharger / retour à l'accueil). Le
`ErrorBoundary` ne dépend d'aucun store, du routeur ni du design system :
il peut donc s'afficher quand tout le reste est cassé. **Bonne discipline.**

### B11 — L'anneau de focus et la cible tactile, en global

`src/styles/theme.css:45-47` applique `focus-visible:outline-2` à `a`,
`button`, `input`, `select`, `textarea` et `[tabindex]` — **une seule règle
pour toute l'application**, donc pas d'oubli possible. `:85-88` définit
`.touch-target` à 44 px minimum, utilisé dans tous les écrans. `:154-161`
neutralise les animations CSS sous `prefers-reduced-motion`, et
`MotionConfig reducedMotion="user"` (`App.tsx:61`) fait de même pour les 26
composants animés en JavaScript — le test e2e vérifie le **comportement
constaté** dans le DOM (`accessibility.spec.ts:95-115`), pas la configuration
déclarée.

### B12 — Les commentaires d'en-tête : des invariants, pas des décorations

Chaque store, chaque page et chaque module de `lib/` porte un en-tête
`INVARIANT` / `PIEGE` / `Voir aussi`. Ces invariants sont **exacts** : j'ai pu
les vérifier un par un (le cycle d'imports, le piège de `wallet:update`, le
`timestamp` vs `created_at`, la purge multi-compte, `isMe` vs `userId`…). Ce
qui manque, ce n'est pas la documentation : c'est l'application de deux
d'entre eux (F3 : la purge ; F12 : la liste `off()`).

---

## 6. Limites de cette relecture — **NON VÉRIFIÉ**

- **Rendu réel aux différentes largeurs** : les constats de débordement
  horizontal (F20) et de contraste (F19) sont déduits des classes CSS et des
  calculs de luminance, pas d'un rendu mesuré dans un navigateur à 320/360 px.
  L'élément précis qui déborde n'est pas identifié.
- **Comportement de `bootstrapReady` en production** : F2 est déduit du code
  (le `catch` ne remet pas le drapeau, l'effet ne rejoue pas). La fréquence
  réelle de l'échec du bootstrap temps réel sur l'hébergement n'est pas
  mesurée.
- **Course inter-comptes de F11** : le scénario suppose une déconnexion
  pendant la fenêtre de 15 s du `POST /api/realtime/auth/session`. Cette
  fenêtre n'a pas été rejouée en conditions réelles ; la fenêtre théorique
  est de 15 s et le déclencheur est une déconnexion très rapide.
- **État de production** : aucun journal serveur, aucune donnée en base n'ont
  été lus. La présence effective d'un tournoi en `pendingPayouts` (F9) ou
  d'une cagnotte gelée n'est pas confirmée.
- **Crash de F1** : déduit de l'invariant React « le nombre de hooks doit être
  identique entre deux rendus ». Le message exact et la ligne d'échec n'ont
  pas été observés dans un navigateur ; le raisonnement est vérifié par la
  lecture de l'ordre des hooks.
- **`useLogout` vs `resetAllSessionStores`** : l'écart est vérifié ligne à
  ligne, mais le fait que `resetAllSessionStores` soit lui-même correct dans
  *tous* les cas n'a été vérifié que par lecture (les stores ont des tests
  unitaires, mais `sessionReset` n'en a pas).
- **Les 14 stores** : les tests unitaires existants
  (`*.test.ts` dans `src/app/stores/`) n'ont pas été réécrits ni commentés ;
  je me suis appuyé sur le code source.

---

## 7. Ce qui n'est **pas** un constat

Pour éviter les redondances avec les audits déjà publiés :

- Les constats serveur **S1 à S15** (`docs/audit-2/02-autorisation.md`) et
  **C1 à C7** (`docs/audit-2/03-concurrence.md`) ne sont pas re-signalés ici.
  F9 et F8 ne sont que la **conséquence front** de deux décisions serveur
  documentées (le règlement échoué consigné dans `pendingPayouts`, la
  `prizePool` théorique).
- Les anomalies **V1 à V15** déjà corrigées ne sont pas ré-ouvertes : aucune
  **RÉINTÉRESSION** n'a été identifiée côté front. Les points F3 et F12 sont
  des applications incomplètes de correctifs **existants et documentés**
  (le `sessionReset` et l'en-tête de `realtimeClient`), pas des
  régressions de code corrigé.
- Les écarts de style, de nommage et de structure de fichiers sont hors
  périmètre : ce document ne décrit que ce qui casse, fuit, ment à
  l'utilisateur ou rend l'application inutilisable.
