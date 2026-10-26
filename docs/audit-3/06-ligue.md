# Partie 6 — Ligue (audit-3)

**Relecture :** 2026-10-26, base `main` au `3a24166`.
**Périmètre :** `server/league-engine.mjs` (1 239 lignes, lu intégralement),
`server/routes/league.mjs` (430 lignes, lu intégralement), crons ligue
(`cron.mjs:440-504` fermeture auto, `:821-889` sweep stale + retry refunds,
`:732-756` retry payouts). Croisements : `league-engine.test.mjs`,
`league-settlement-recovery.test.mjs`, ledgers `audit-2` (S2, C4, décision
produit sur la garde admin).
**Anti faux-positifs :** ledgers `docs/audit-2/`, invariants
`docs/05-invariants.md`, commentaires `PIEGE:`/`INVARIANT:` des sources.

## Verdicts par fichier

| Fichier | Verdict |
|---|---|
| `league-engine.mjs` | 1 FAIBLE (C1 : NaN-fail-open sur `placement`/`kills` des résultats de journée), 3 INFO (C3, C5, C6) |
| `cron.mjs` (zones ligue) | 1 FAIBLE (C2 : sweep stale sans garde d'effectif, course au boot), 1 INFO (C4 : duplication de la logique de qualification) |
| `routes/league.mjs` | Propre — 2FA sur les 4 routes d'argent, compensation join côté route |

## Ce qui a été vérifié et jugé solide (non re-constaté, couvert par les ledgers audit-2)

- **S2 (audit-2) corrigé** : les 4 routes qui touchent à l'argent exigent
  `requireAdmin2fa` — résultats de journée (`:277`), advance-to-final
  (`:301`), final-results (`:319`), remboursement d'un pass (`:398`), lecture
  des paiements (`:418`).
- **Compensation join côté route** : si `saveLeagues` échoue après le moteur,
  la route rembourse le pass (`:186-199`) — le balayeur ne rattrapait pas ce
  cas.
- **`lockEntryFee` refuse tout montant ≤ 0** (`wallet-engine.mjs:322-326`) —
  un pass à 0 ZC ne peut pas bloquer un slot de qualification.
- **Anti-pollution de prototype sur `dayKey`** : double garde whitelist
  `DAY_KEYS` + `hasOwnProperty` (`:485-488`) — `qualificationGroups['__proto__']`
  ne peut plus contaminer le process.
- **Validation stricte de la FINALE** : doublons de joueurs (`:636-639`),
  places uniques et entières 1..40 (`:640-647`), TOUS les finalistes classés
  (`:656-661` — le garde audit-2 qui empêchait 40 % du pot d'être absorbé sans
  versement) ; `Number.isInteger` ici, donc pas de NaN côté finale.
- **Le fichier connaît le piège NaN sur entryFee** : `:1088-1093` porte le
  garde `Number.isFinite` avec le commentaire exact (`NaN < 0` et `NaN > 500`
  sont tous deux faux) — appliqué aux réglages, PAS aux résultats de journée
  (C1).
- **Tarif figé dès la première inscription** (`:1101-1103`) — les mises
  bloquées correspondent toujours au pot affiché ; plafond `maxPlayers` ne
  peut pas descendre sous l'effectif inscrit (`:1080-1083`).
- **Garde de statut du remboursement manuel** : `completed`/`cancelled`
  refusés (`:1187-1189`) — le pot d'une saison soldée ne peut plus être
  recalculé à la baisse (le rang audit-2 correspondant est corrigé).
- **Repartition mordante** : `assignPlayersToDays` REFUSE au-delà de 100
  joueurs/jour (`:286-293`) au lieu de surpeupler silencieusement —
  `LEAGUE_PLAYERS_PER_DAY = ceil(500/5)` (`:70`).
- **Statuts distincts et cohérents** : pass payé/verrouillé/consommé
  (`:1224-1237`), dettes conservées (`pendingPayouts` au règlement `:822-827`,
  `pendingRefunds` + `uncollectableRefunds` aux deux reprises).
- **Garde anti-chevauchement cron** : les deux sweeps ligue ont un drapeau
  `running` (`leagueCloseRunning :389/:442-446`, `staleLeagueRunning
  :826/:828`) et tournent sous `withLeagueMutex`.

## Constats

### C1 — FAIBLE : résultats de journée — `placement` et `kills` acceptent NaN (fail-open), standings corrompus de façon persistante

- La garde de placement (`:536-538`) est `Number(r.placement) < 1 ||
  Number(r.placement) > 100` : avec `placement: "abc"`, les deux comparaisons
  sont fausses → la valeur NaN PASSE. Puis `PLACEMENT_POINTS[NaN]` vaut
  `undefined` → `survivalPoints` 0 (`:544`), et `placements.push(NaN)`
  (`:565`) corrompt `standings`.
- `kills` (`:543`) : `Number(r.kills || 0)` — sans `Number.isFinite`, un
  `kills: "abc"` donne `killPoints: NaN` (`:545`) → `points: NaN` (`:552`) →
  `totalPoints += NaN` (`:563`) → le classement (`:571`) trie sur un NaN.
  Sans borne inférieure : `kills: -100` rend un `totalPoints` négatif
  (sabotage d'un joueur du classement).
- Le même fichier APPLIQUE le garde correct aux réglages (`:1091`,
  `Number.isFinite` + commentaire expliquant exactement ce piège NaN) et la
  FINALE l'applique aussi (`:641`, `Number.isInteger`) — seuls les résultats
  de journée restent fail-open.
- Effet en chaîne : les standings décident de la qualification (top →
  finalistes, `advanceToFinalOnServer`) donc de qui touchera le podium —
  une journée corrompue déplace la qualification d'une saison entière, et
  l'erreur est persistée dans les snapshots.
- Reachable UNIQUEMENT par un admin avec 2FA fraîche (routes `:277`/`:319`,
  moteur : `role !== 'admin'` `:508-509`) ; le corps passe brut
  (`routes/league.mjs:280-287`). Les tests couvrent `placement: 0` et `101`
  (`league-engine.test.mjs:799,806`) mais aucun cas NaN ou négatif.

FAIBLE et pas plus : exploitable seulement par un admin authentifié 2FA —
c'est un garde d'intégrité inégal dans le fichier, pas une faille
d'autorisation. Piste de correctif : répliquer la garde `:1091` sur
`placement`/`kills` (entier, `kills >= 0`), et exiger l'unicité des places
de journée comme la finale le fait déjà.

### C2 — FAIBLE : le sweep stale annule une saison PLEINE — pas de garde d'effectif, course avec le cron de fermeture au boot

- `getStaleLeagueSeasonIds` (`:915-936`) vise `registering` dès que
  `registrationCloses` est passé de plus d'une heure — il NE vérifie PAS
  `registeredPlayers.length >= 10`. Son commentaire (`:901-903`) et celui du
  cron (`:822-824`) assument « moins de 10 inscrits », mais le code ne le
  vérifie jamais.
- Le cron de fermeture (`cron.mjs:441-504`, toutes les heures) exige bien
  `>= 10` (`:458`) mais n'a PAS de premier passage différé au boot
  (contrairement au contrôle d'intégrité `:550`, `setTimeout 30 s`, ou au
  sweep stale lui-même `:861`, `setTimeout 22 s`).
- Scénario : une saison pleine (10+ inscrits) atteint sa clôture pendant que
  le serveur est arrêté (ou le tick fermeture sauté, `:442-445`). Au
  redémarrage, `sweepStaleLeagues` tourne à +22 s (`:861`) sous graceMs 1 h
  par défaut (`:833` sans 2e argument) et ANNULE la saison pleine avant que
  le cron de fermeture ait pu tourner : passes remboursés en masse,
  qualification jamais lancée, et le motif logué est FAUX —
  « pas assez d inscriptions avant la date de cloture » (`cron.mjs:843`,
  sous le commentaire « Motif honnete » `:839`).
- La course résiduelle fermeture (1 h) vs stale (6 h + boot) existait déjà ;
  le vrai ajout est le boot immédiat du stale SANS l'équivalent pour la
  fermeture.
- FAIBLE : fenêtre de course réelle mais bornée (redémarrage autour d'une
  clôture), remboursements propres (pas d'argent perdu), l'admin peut
  relancer une saison.

Piste de correctif : donner à `getStaleLeagueSeasonIds` la garde
`registeredPlayers.length < 10` (c'est ce que son propre commentaire
annonce), ou donner au cron de fermeture un boot immédiat AVANT le sweep
stale.

### C3 — INFO : `patchUserForLeagueOutcome` et `patchUserForTournamentOutcome` sont du code mort

- `patchUserForLeagueOutcome` (`league-engine.mjs:220-227`) : défini,
  jamais appelé (grep : définition seule). `patchUserForTournamentOutcome`
  (`tournament-engine.mjs:232-239`) : même constat. Les règlements passent
  directement par `applyUserSettlementOnce` (`:743`, `:764`, `:784`,
  `:806`). Deux blocs morts identiques dans les deux moteurs — à supprimer
  ou brancher, sinon ils divergent silencieusement du vrai chemin.

### C4 — INFO : le cron de fermeture duplique `startLeagueQualificationOnServer` au lieu de l'appeler

- Le bloc `cron.mjs:453-492` recopie la logique du moteur
  (`startLeagueQualificationOnServer :429-472`) : assignation des groupes,
  init des standings, passage `qualifying`, horodatage. Seul
  `assignPlayersToDays` est partagé ; le reste est dupliqué — et a DÉJÀ
  dérivé : le cron tolère `p.userId || p.id || p` (`:460,472`) quand le
  moteur lit `p.userId` (`:441`). Toute future évolution (nouveau champ de
  standings, nouvelle journée) devra être faite deux fois.

### C5 — INFO : arrondis indépendants du podium — sur-distribution d'environ 1 ZC possible ; finale à moins de 3 finalistes

- `buildLeaguePayout` (`:95-100`) arrondit 60/25/15 % séparément :
  `second` + `third` peuvent chacun arrondir un demi vers le haut. Avec le
  tarif par défaut (50 ZC) et un effectif impair, la somme versée dépasse le
  pot de 1 ZC (ex. 11 inscrits : 330 + 138 + 83 = 551 pour un pot de 550) ;
  avec des tarifs décimaux, quelques centimes. Micro — création monétaire de
  1 ZC par saison au plus, non cumulable.
- Une saison `final` dont les finalistes tombent sous 3 (remboursements
  admin pendant la finale — possibles, le garde `:1187-1189` ne bloque que
  `completed`/`cancelled`, et `finalists` est splicé `:1204`) voit
  `podium.second`/`podium.third` rester `null` (`:671-678`) : les parts
  25 %/15 % ne sont ni versées ni tracées comme dette (`:760`/`:780` ne
  s'exécutent pas). L'argent reste dans les passes consommées (pas de perte
  pour le système, mais des joueurs qui ont payé ne peuvent plus rien
  recevoir, sans trace).

### C6 — INFO : reprise d'un forfeit — stats de participation possiblement en retard

- Dans le règlement, un joueur non-podium reçoit `settleMatchLossWallet` +
  `applyUserSettlementOnce` (stats `leaguesPlayed`, XP) sous le même mutex
  (`:804-814`) ; si le tout échoue, la dette consignée est
  `{ kind: 'forfeit' }` (`:818`). La reprise (`:850-852`) rejoue SEULEMENT
  `settleMatchLossWallet` et `return` — sans `applyUserSettlementOnce` :
  le pass est bien consommé au retry, mais `leaguesPlayed`/XP restent en
  retard pour ce joueur. Cosmétique (aucun ZC en jeu), asymétrie de reprise
  seulement.

## Résumé

Deux FAIBLE : (1) les résultats de JOURNÉE acceptent NaN sur `placement` et
`kills` — garde fail-open exactement là où le fichier sait pourtant l'écrire
(`:1091`, finale `:641`) — corrompant persistamment les standings qui
décident de la qualification et donc du podium ; (2) le sweep stale annule
une saison PLEINE faute de garde d'effectif, avec un boot immédiat (+22 s)
que le cron de fermeture (1 h) n'a pas — un redémarrage autour d'une clôture
tue une saison pleine avec un motif de log faux. Le reste du domaine est
solide : 2FA sur les 4 routes d'argent (S2 corrigé), compensation join côté
route, validation stricte de la finale (tous classés, places uniques), tarif
figé dès la première inscription, garde de statut du remboursement, dettes
de gains et de remboursement conservées et reprises. Quatre INFO (code mort
×2, duplication cron/fermeture déjà dérivée, arrondis indépendants ±1 ZC et
podium réduit sans trace, reprise forfeit sans stats).
