# Partie 5 — Tournoi (audit-3)

**Relecture :** 2026-10-26, base `main` au `304602b`.
**Périmètre :** `server/tournament-engine.mjs` (1 479 lignes, lu intégralement),
`server/routes/tournament.mjs` (314 lignes, lu intégralement, croisement
autorisation/persistance), sweep tournois (`server/cron.mjs:552-595`),
sanitisation de diffusion (`state-helpers.mjs:288-337`). Croisements :
`tournament-engine.test.mjs`, ledgers `audit-2` (S3, S12, C4).
**Anti faux-positifs :** ledgers `docs/audit-2/`, invariants
`docs/05-invariants.md`, commentaires `PIEGE:`/`INVARIANT:` des sources.
**Méthode :** le constat C1 a été PROUVÉ par un reproducteur vitest exécuté
(harnais du test existant, 4 scénarios : 4, 5 et 7 entrées), puis supprimé ;
les sorties de logs sont citées ci-dessous.

## Verdicts par fichier

| Fichier | Verdict |
|---|---|
| `tournament-engine.mjs` | 1 CRITIQUE (C1 : byes non propagés — bracket auto-tranché ou gelé, monnaie détruite), 2 INFO (C3, C4) |
| `routes/tournament.mjs` | S3 CORRIGÉ (2FA sur le résultat, `:293-294`) ; S12 encore ouvert → FAIBLE (C2) |

## Ce qui a été vérifié et jugé solide (non re-constaté)

- **S3 (audit-2) corrigé** : `POST .../matches/:mid/result` passe par
  `require2faIfAdmin` (`routes/tournament.mjs:293-294`) — l'override admin
  coûte désormais une 2FA fraîche, comme prévu par le ledger.
- **Règlement** : `applyTournamentSettlement` écrit la dette `pendingPayouts`
  AU règlement (`:751-754`, invariant d'en-tête), arbitres servis avec try/catch
  isolé (`:717-744`), stats/XP idempotents (`applyUserSettlementOnce`, clé
  `tournament:<id>:entry`), `settleMatchLossWallet` no-op si la réservation est
  absente (idempotence naturelle, `wallet-engine.mjs:436-441`).
- **Reprises** : `retryPendingTournamentPayouts` rejoue les trois kinds
  (prize/forfeit/arbiter) et sort les succès de la liste (`:1171`) ;
  `retryPendingTournamentRefunds` ferme les comptes supprimés en
  `uncollectableRefunds` (pas de rejeu éternel, `:1083-1088`) et nettoie les
  entries remboursés (`:1102-1104`) ; `cancelStaleTournamentOnServer` refuse
  `completed`, conserve les dettes (`:1040-1041`).
- **Péremption (C4, audit-2)** : `getExpiredTournamentIds` vise `recruiting`
  ET `live` (`:1230-1237`), sweep toutes les 6 h sous mutex, motif honnête
  selon l'état (`cron.mjs:574-577`).
- **Garde du duel** : re-soumission refusée (`:1436-1438`), `winnerEntryId`
  borné aux deux participants (`:1443-1445`), scores finis, ≥ 0 et distincts
  (`:1446-1448`), `matchesHandled` incrémenté sur le clone (`:1462-1467`).
- **Route** : `entryFee` ≥ 0 + arrondi AVANT tout calcul de cagnotte
  (`:117-131`), toutes les mutations sous `withTournamentMutex` et suivies de
  `saveTournaments`, format 1VS1-5VS5 gardé AU MOTEUR (`:770-774`).
- **Inscription** : capitaine forcé à son propre pseudo (`:842-844`),
  coéquipiers résolus userId OU pseudo exact avec échec ferme (`:855-864`),
  roster complet + unicité des pseudos (`:883-905`), pass verrouillé
  `entryFee x teamSize` sur le capitaine (`:918-920`) — `lockEntryFee` refuse
  tout montant ≤ 0 (`wallet-engine.mjs:322-326`).
- **Dettes préservées au chargement** : `pendingPayouts`/`pendingRefunds`/
  `uncollectableRefunds` normalisés au snapshot (`:167-197`).

## Constats

### C1 — CRITIQUE : les gagnants de bye ne sont jamais propagés — le bracket s'auto-tranche (champion sans jouer, monnaie détruite) ou gèle

**Mécanisme.** Dans `normalizeMatches` (`tournament-engine.mjs:437-493`), la
boucle `while (changed)` reconstruit le tableau via une `map` (`:440`) ; quand
un match bye s'auto-avance, `placeWinner` est appelé DANS la callback
(`:481`) et pose le gagnant dans le match du tour suivant via
`nextMatches = mutatedMatches` (`:482`). Mais la callback des matchs suivants
du MÊME tour retourne `match` (le source, `:491`) et l'assignation finale
`nextMatches = nextMatches.map(...)` (`:440`) ÉCRASE la mutation posée
pendant le tour : le gagnant du bye disparaît du bracket. Comme
`scheduleMatches` ordonne les tours (`:339-385`), tout match de round 1
place son winner dans un match de round 2 — systématiquement écrasé au même
tour. (`advanceTournament` :592-594 place HORS de la `map` : les résultats
soumis par un arbitre ne sont pas touchés — d'où le contre-cas 4 entrées
qui fonctionne.)

**Preuve exécutée** (reproducteur vitest, harnais du test existant, sorties
loggées) :

- **5 entrées / maxEntries 8** (bracket 8, M3 = Player5 bye) : après le start,
  M3 est `finished` avec winner Player5 mais M6 (`main:2:2`) reste `pending`
  SANS entrant — Player5 jamais placé. En jouant le bracket jusqu'au bout :
  après la soumission de M5, la finale s'auto-avance avec Player1 (feeder M6
  vide → `shouldAutoAdvance` true, score 1-0 « Auto avance via bye ») et le
  bronze s'auto-avance avec Player3 → tournoi `completed` avec
  `pendingPayouts []` → le règlement TOURNE : placements `Player1:1`,
  `Player3:3`, **place 2 jamais attribuée**, Player5 sans placement.
- **7 entrées / maxEntries 8** : M4 = Player7 bye (finished) mais Player7
  jamais placé ; M6 reçoit SEULEMENT le gagnant de M3 (soumission réelle,
  hors map) → `shouldAutoAdvance` false (feeder M4 a un winner, `:408`) → M6
  reste `pending` à un entrant, NON soumissible (`:1433-1435` exige deux
  participants) → la finale ne se joue jamais, le tournoi reste `live`
  (status final prouvé : `live`).
- **4 entrées (contrôle)** : `completed` en 4 soumissions — le chemin sans
  bye fonctionne, le bug est bien spécifique à la propagation des byes.

**Conséquences selon la topologie** (tailles vérifiables par le même mécanisme) :

- **Variante « auto-tranche »** (5-6 sur 8, 9-12 sur 16, ...) : la finale et
  le bronze se terminent TOUT SEULS dès qu'ils ont un entrant (feeder vide →
  `:407/:411-413` true) :
  1. le champion est désigné sans jouer la finale — les participants voient
     un podium issu d'un bracket troué ;
  2. la part `second` (30 % du playerPool, `buildPayout :74`) n'est versée à
     PERSONNE : l'argent débité des passes disparaît (les réservations des
     entrées sans placement sont CONSOMMÉES par `settleMatchLossWallet`,
     `:668-670`) — monnaie détruite, pas remise en jeu, pas remboursée ;
  3. le joueur qui a bénéficié du bye est PUNI : son match est fini « à sa
     gloire » mais il ne joue jamais son duel suivant, son pass est consommé
     et il ne reçoit rien.
- **Variante « gel »** (7 sur 8, 3 sur 4, 13-15 sur 16, ...) : la demi-finale
  à un entrant reste pending pour toujours → finale jamais jouable → le
  tournoi reste `live` → `getExpiredTournamentIds` (`:1230-1237`) le rend à
  l'annulation 24 h après `startsAt` (sweep 6 h, `cron.mjs:566-578`) :
  passes remboursés (pas d'argent perdu) mais le tournoi joué à plus de
  moitié est jeté sans podium ni gains.
- **Classe touchée** : tout tournoi dont le round 1 contient un bye — soit
  la majorité des tournois dont les inscriptions ne remplissent pas une
  puissance de 2. Aucun test ne couvre le bracket : `bye`, `third_place`,
  `bronze` = 0 match dans `server/*.test.mjs`.

Aucune réparation automatique n'existe pour la variante auto-tranchée : le
tournoi est `completed`, hors sweep, hors annulation (`:1005-1007`).

**Piste de correctif** : ne pas reposer les placements PENDANT la `map` —
accumuler les mutations (byes) dans une liste et les appliquer après la map
complète (comme `advanceTournament` le fait déjà hors map), ou restructurer
en deux passes. Ajouter un test de bye en demi-finale (les deux variantes)
et un test du match de bronze à un entrant.

### C2 — FAIBLE : `notes` de tournoi toujours non sanitisé ni borné (S12, audit-2, encore ouvert)

- Les notes de duel sont tronquées d'aucun plafond et passées au bracket sans
  `sanitizeText` (`:1457`, stockées `:586`) ; les `rules.notes` de création
  idem (`:304` via `input.rules`).
- Le sanitizeur de diffusion ne les retire pas :
  `sanitizeTournamentForBroadcast` (`state-helpers.mjs:288-315`) ne touche ni
  `rules.notes` ni les `match.notes` (sanitizeMatchForBroadcast retire
  roomPassword/roomName/screenshots/creatorId, `:178` — pas `notes`) → le
  texte est persisté dans les snapshots et diffusé en public (GET
  `/api/tournaments/:id`, `routes/tournament.mjs:85`, sockets).
- React échappe le rendu (pas de XSS), donc le rang reste FAIBLE (bloat de
  stockage, contenu libre) : c'est le rang S12 d'audit-2 — non corrigé par le
  pass post-correctifs. A re-graver ici pour ne pas le perdre ; le règlage
  complet (tous les champs S12) reste du ressort d'un rang d'audit-2 ouvert.

### C3 — INFO : `shouldAutoAdvance` — branches identiques, code mort

- `:411-413` : `if (!feederNextMeta) return true; return true;` — les deux
  branches retournent `true`, le calcul `feederNextMeta` (`:411`) est sans
  effet. `:407` (`feederMatch` inexistant → `true`) est cohérent avec
  l'intention mais rend la fin de la fonction constante `true` : la garde
  utile réside entièrement dans `:408-409`.

### C4 — INFO : nomination d'arbitre sans garde de statut

- `assignTournamentArbiterOnServer` (`:1247-1268`) vérifie
  participant/arbitre-déjà/slot-libre mais PAS le statut : un joueur peut
  s'assigner comme arbitre d'un tournoi `cancelled` ou `completed` (slots
  restés vides) — mutation cosmétique de l'historique, sans effet sur
  l'argent (le règlement lit `arbiters` mais `arbiterShare` ne change pas) ;
  en `live`, tous les slots sont couverts au start (`:1300-1302`) donc le
  cas ne se présente pas.

### C5 — INFO : micro-remarques sans impact

- **ASCII** : 63 occurrences non-ASCII dans `tournament-engine.mjs` +
  `routes/tournament.mjs` (accents français de commentaires, tirets cadratins
  `—`, `×`) — même convention brisée que match-engine (partie 3) ; aucun CJK
  (grep vérifié).
- `createTournamentOnServer` fait confiance à la route pour `maxEntries`
  (2-256, `routes:113-115`) et `entryFee` ≥ 0 (`:117-119`) : le moteur ne les
  borne pas (`:792-793`), mais `lockEntryFee` refuse ≤ 0 et aucune création
  hors route n'existe — defense in depth inégale, sans impact réel.
- `normalizeTournamentSnapshot` :163-166 : commentaire dupliqué/déplacé
  (« Dette de remboursement : préservée au chargement… ») dont la suite
  orpheline se retrouve sous `pendingPayouts` — commentaire confus, code
  correct.

## Résumé

Un CRITIQUE prouvé par exécution : la `map` de `normalizeMatches` écrase les
placements posés pendant le tour, donc tout bye de round 1 n'envoie JAMAIS
son gagnant au tour suivant. Selon la topologie, le bracket s'auto-tranche
(finale et bronze finis automatiquement, champion désigné sans jouer, place 2
du pool jamais versée = monnaie détruite, pass du joueur-bye consommé) ou
gèle (demi-finale à un entrant non soumissible → annulation par le sweep à
24 h). Le contre-cas sans bye fonctionne : le bug est spécifique à la
propagation des byes, et aucun test ne couvre le bracket. Le reste du
domaine est solide : dettes au règlement, reprises idempotentes, péremption
(C4 audit-2) en place, 2FA sur l'override admin (S3 corrigé), inscription
verrouillée correctement. Un FAIBLE repris d'audit-2 (S12 : `notes` non
sanitisé ni borné, toujours ouvert), trois INFO.
