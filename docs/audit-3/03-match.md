# Partie 3 — Match (audit-3)

**Relecture :** 2026-10-26, base `main` au `0042747`.
**Périmètre :** `server/match-engine.mjs` (1 874 lignes, lu intégralement),
`server/match-status.mjs` (54 lignes, lu intégralement) + `shared/match-status.json`,
sweep arbitre (`sweepMatchesWithoutArbiter`) — croisements : `server/cron.mjs`
(filters de reprise), `routes/match.mjs`, `routes/admin.mjs`, `state-helpers.mjs`,
`src/lib/matchPayout.ts`.
**Anti faux-positifs :** ledgers `docs/audit-2/` (A9, C3, M24), invariants
`docs/05-invariants.md`, commentaires `PIEGE:`/`INVARIANT:` des sources.

## Verdicts par fichier

| Fichier | Verdict |
|---|---|
| `match-status.mjs` + `shared/match-status.json` | Propre — source unique serveur+front, legacy `full` documenté |
| `match-engine.mjs` | 1 MAJEUR (C1 : dérive écrase `awaiting_confirmation`), 1 FAIBLE (C2 : reprise sous-payée), 3 INFO (C3, C4, C5) |

Ce qui a été vérifié et jugé solide (non re-constaté, couvert par les ledgers
audit-2) :

- **Sortie d'argent unique** : `applyResultSettlement` refuse sans arbitre
  (`ARBITER_REQUIRED`, `:436-438`) et distribue le pot REELLEMENT verrouillé
  (`getLockedPot` sur les réservations wallet, `:200-208`), divisé entre les
  gagnants avec arrondi absorbé par le premier (`:483-488`).
- **Frais d'arbitre tenus à part** des erreurs joueurs (`arbiterErrors`,
  `:448/:597-603/:621-641`), créance notée APRÈS la tentative (`pendingArbiterFee`)
  et REPRISE par `retryPendingArbiterFees` (`:1711-1769`, idempotence
  `arbitration_fee:<matchId>`).
- **`match.payouts`** (A9) : versements réels notés une seule fois par
  (joueur, type) (`recordActualPayout :297-311`), projetés par
  `getProjectedPayouts` (`:216-269`).
- **Règlement différé** : résultat persisté avant l'argent
  (`deferSettlement :1090-1104`), double garde litige ouvert
  (`settlePendingMatchResult :1138-1142`), isolation des échecs dans le
  balayage d'expiration (`:1257-1282`).
- **Anti-forgery** : autorité = rôle réel de l'acteur (`:1024/:1036`),
  `winnerTeam` strict 0/1 (`:1028-1030`), preuves normalisées contre XSS
  (`isSafeProofRef :168-178`), soumission refusée sur match clos (`:1006-1008`).
- **Sweeps et ordre** : `runMatchAutomationOnServer` enchaîne échéances puis
  abandons (`:1656-1673`), `refundLockedEntry` idempotent, sweep arbitre
  REMBOURSE et saute les litiges ouverts (`:81-132`).
- JSDoc/pièges d'en-tête cohérents avec le code (PIEGE vérifiés un à un).

## Constats

### C1 — MAJEUR : la dérive de statut écrase `awaiting_confirmation` — pot gelé hors de tous les radars, fenêtre de contestation fermée par une action de jeu

- `getStatusFromMatch` n'a **aucune branche `awaiting_confirmation`**
  (`match-engine.mjs:326-364`) : dès que `match.result` existe, elle renvoie
  `finished` (`:335`). Or le statut `awaiting_confirmation` n'est posé QUE
  directement, hors dérive : `submitMatchResultOnServer` différé (`:1095`) et
  `resolveDisputeOnServer` (`:1432/:1448`).
- Dans `shared/match-status.json`, `awaiting_confirmation` est dans ACTIVE
  (`:2-10`) et `finished` dans CLOSED (`:11-16`).
- Déclencheurs — pendant la fenêtre de confirmation de 30 min, une action de
  jeu ordinaire repasse par `updateMatchSnapshot` et BASCULE le match en
  `finished` (statut CLOS) alors que `payoutDistributed` vaut encore
  `'pending'` :
  - `toggleReadyOnServer` — pas de garde CLOSED ni `awaiting_confirmation`
    (`:855-879`, dérive à `:874-876`) ;
  - `checkInMatchOnServer` — idem, y compris un simple RE-check-in
    (`:831-845`) ;
  - `scheduleMatchOnServer` — ouvert aux participants (`:889-905`) ;
  - `setRoomDetailsOnServer` — arbitre/admin (`:917-948`).
  Les routes appellent le moteur directement, sans garde supplémentaire
  (`routes/match.mjs:189-199`, `:209-219`).
- Conséquences en chaîne sur un match dérivé (`finished` + `pending` +
  `confirmationDeadline` future) :
  1. le gagnant ne peut plus confirmer (`ALREADY_CONFIRMED`, `:1190-1192`) ;
  2. le perdant ne peut plus contester — `openDisputeOnServer` refuse tout
     statut CLOSED (`:1324-1329`), EXACTEMENT pendant la fenêtre où contester
     est prévu (`:1091-1094` : « c'est le seul moment ou le perdant peut
     encore contester ») ;
  3. `sweepPendingSettlements` ne l'élit pas : il exige
     `!confirmationDeadline || status === 'disputed'` (`cron.mjs:159-163`) —
     le dérivé a sa deadline ET un statut `finished` ;
  4. `sweepExpiredConfirmations` exige `awaiting_confirmation`
     (`cron.mjs:196-200`) ;
  5. automation et sweep arbitre sautent CLOSED (`match-engine.mjs:1567`,
     `:86`) ;
  6. l'annulation admin est REFUSÉE : le garde `match.result?.payoutDistributed`
     est truthy avec `'pending'` (`:1476`) et le message ment (« gains déjà
     distribués ») ;
  7. AUCUN log ne signale l'état — statut fermé + argent `pending` ne
     déclenche rien.
- Seul chemin de réparation : `POST /api/admin/matches/:id/resolve-dispute`
  (2FA, `routes/admin.mjs:655-676`) → `resolveDisputeOnServer` fonctionne sans
  litige actif, `action: 'settle'` par défaut (`:1399-1400`, `:1408-1414`).
  Réparation MANUELLE, sans détection ni piste de log : l'admin doit deviner
  l'état.
- Bilan : l'argent n'est pas perdu mais séquestré indéfiniment, et un perdant
  perd son droit de contester par un clic — la fonction « fenêtre de
  confirmation/contestation » est cassée par une action banale.

Piste de correctif (à arbitrer) : (1) dans `getStatusFromMatch`, renvoyer
`awaiting_confirmation` quand `result.payoutDistributed === 'pending'` et que
le statut courant n'est pas CLOSED — branche à placer AVANT
`result → finished` (`:335`) ; (2) ajouter les gardes CLOSED à
`checkInMatchOnServer` et `toggleReadyOnServer`.

### C2 — FAIBLE : reprise d'un règlement partiel — les gagnants restants sont payés sur le pot résiduel

- `applyResultSettlement` recalcule `getLockedPot` à CHAQUE essai (`:442`).
  Or `releaseWalletWinnings` libère la réservation de chaque gagnant payé :
  après un échec partiel, le pot résiduel ne contient que les impayés.
- Arithmétique vérifiée (1v1, mise E) : gagnant A servi (1,96 E sur pot 2 E),
  l'essai de B échoue → `payoutDistributed = 'pending'` → reprise cron
  (`cron.mjs:166-173`) : pot résiduel 1 E → B reçoit 0,98 E au lieu de 1,96 E.
  En 2v2, chaque impayé touche sa part divisée par le roster gagnant COMPLET
  (`winnerIds` du roster, `:480-486`) sur un pot résiduel amputé.
- La garde d'écriture unique (`recordActualPayout`) protège l'HISTORIQUE
  (`:281-288` : « une reprise reecrirait le montant historique avec une valeur
  recalculee sur un pot PLUS PETIT ») — le commentaire décrit exactement le
  problème de montant et n'en corrige que la trace, pas le versement.
- Fenêtre étroite : échec transitoire (base/wallet) pendant la boucle de
  règlement avec au moins un gagnant déjà servi et persisté. FAIBLE.

Piste de correctif : figer la base du règlement au premier essai (ex.
`result.settlementBasis = lockedPot`) et rejouer les parts impayées depuis
cette base — la garde d'idempotence du wallet garantit l'absence de double
paiement.

### C3 — INFO : auto-lancement sans arbitre — un état que la dérive conteste immédiatement

- `toggleReadyOnServer` : roster complet, tous prêts, PAS d'arbitre → le match
  passe `in_progress` + `startedAt` en écriture directe (`:867-873`), documenté
  dans le JSDoc (`:849`).
- Mais TOUTE mise à jour suivante repasse par la dérive : roster plein sans
  arbitre → `awaiting_arbiter` (`:352`) — le `in_progress` écrit est écrasé à
  la première mutation. Un résultat reste de toute façon impossible sans
  arbitre (`:1024-1026`), et le sweep arbitre rembourse (2 h de la création,
  phase B car `startedAt` posé, `:92-108`). Sans impact d'argent —
  incohérence d'état auto-contradictoire.

### C4 — INFO : preuves de litige — plafond par appel, pas cumulatif

- `normalizeProofRefs` coupe à 10 refs PAR appel (`:179-180`) ;
  `addEvidenceToDisputeOnServer` concatène sans plafond global (`:1822`) :
  chaque POST d'un participant/arbiter/admin peut ajouter 10 refs × 2 000
  caractères, indéfiniment — stockées dans le payload de `state_snapshots`.
  Pas de XSS (`isSafeProofRef` tient), uniquement du bloat de stockage.

### C5 — INFO : micro-remarques sans impact

- `submittedBy` du client est conservé dans `fullResult` (`:1071`) : l'autorité
  reste le rôle réel (PIEGE tenu, `:1024/:1036`) et `system-no-show` /
  `admin-dashboard` sont nulled à la diffusion (`state-helpers.mjs:231-233`) ;
  une autre valeur forgée reste un label cosmétique.
- `creatorTeam` non validé (`input.creatorTeam ?? 0`, `:679`) : un créateur
  peut poser son slot hors 0/1 (ex. 3) — il se pénalise seul (traité perdant
  au règlement, `:481`) ; les autres joueurs ne sont pas impactés.
- `getWinnerPayout` (`:187`) calcule sur le pot THÉORIQUE de la création
  (`prizePool` et `arbiterFee` figés à la création) : consommé par le front
  (`src/lib/matchPayout.ts:110`, PIEGE « total de l'équipe » documenté) — la
  valeur réelle est dans `match.payouts` (A9). Usage à re-vérifier côté export
  admin (partie 9).
- **ASCII** : 171 occurrences non-ASCII dans `match-engine.mjs` (commentaires
  accentués, tirets cadratins, `×`, `…`) ; `match-status.mjs` est propre.
  Anomalie de CONTENU : `:1695` contient 钱包 (U+94B1 U+5305, « portefeuille »
  en chinois) au milieu d'un commentaire français (« base indisponible,
  钱包 indisponible ») — résidu d'IME/traduction, hors convention ASCII.

## Résumé

Un MAJEUR dans la machine à états : la dérive `getStatusFromMatch` ne connaît
pas `awaiting_confirmation` et reclassifie tout match à résultat en
`finished` (statut CLOS) dès qu'une action de jeu passe par
`updateMatchSnapshot` — confirmations impossible, contestation fermée, quatre
radars de reprise eludés, annulation admin refusée avec un message faux,
aucune détection ; seule une résolution admin manuelle sans litige peut
réparer. Le reste du règlement est solide : pot verrouillé, division exacte,
frais arbitre tenus à part et repris, idempotence, isolation des échecs. Un
FAIBLE sur la reprise sous-payée après échec partiel (pot résiduel), trois
INFO.
