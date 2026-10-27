# ZOYD — Synthèse de la relecture post-correctifs (audit-3)

**Ouverture :** 2026-10-26 — **Clôture :** 2026-10-27.
**Base :** `main` au `491b9f0` (suite 93 fichiers / 1002 pass / 2 skip,
typecheck 0, lint 0) ; dépôt au `2c23283` à la clôture.
**Objet :** relecture complète du projet, partie par partie, APRÈS la livraison
des 13 rangs de l'audit-2 et du pass UX. Elle ne reprend pas les constats déjà
corrigés : elle vérifie l'état actuel.

**Totaux : 122 constats — 1 CRITIQUE, 6 MAJEUR, 48 FAIBLE, 67 INFO.**

## Les 16 parties

| # | Partie | Fichier | Constats |
|---|---|---|---|
| 1 | Noyau serveur | `01-noyau-serveur.md` | 3 FAIBLE, 4 INFO |
| 2 | Données (persistence, state-helpers) | `02-donnees.md` | 2 FAIBLE, 4 INFO |
| 3 | Match | `03-match.md` | 1 MAJEUR, 1 FAIBLE, 3 INFO |
| 4 | Argent (wallet, paiement) | `04-argent.md` | 1 MAJEUR, 1 FAIBLE, 2 INFO |
| 5 | Tournoi | `05-tournoi.md` | 1 CRITIQUE, 1 FAIBLE, 3 INFO |
| 6 | Ligue | `06-ligue.md` | 2 FAIBLE, 4 INFO |
| 7 | BR | `07-br.md` | 1 FAIBLE, 4 INFO |
| 8 | Fondations (cron, moderation, chat, push) | `08-fondations.md` | 0 FAIBLE, 5 INFO |
| 9 | Routes (hors moteurs dédiés) | `09-routes.md` | 1 MAJEUR, 6 INFO |
| 10 | Realtime | `10-realtime.md` | 0 FAIBLE, 5 INFO |
| 11 | Front lib | `11-front-lib.md` | 0 FAIBLE, 6 INFO |
| 12 | Front stores | `12-front-stores.md` | 1 MAJEUR, 3 FAIBLE, 4 INFO |
| 13 | Front pages et features | `13-front-pages.md` | 2 MAJEUR, 11 FAIBLE, 4 INFO |
| 14 | Config et déploiement | `14-config.md` | 5 FAIBLE, 7 INFO |
| 15 | e2e | `15-e2e.md` | 4 FAIBLE, 3 INFO |
| 16 | Docs de service (00-08) | `16-docs.md` | 14 FAIBLE, 3 INFO |

## Les constats à traiter, par ordre de gravité

### CRITIQUE

**P5 C1 — Tournoi : les gagnants de bye ne sont jamais propagés** (`05-tournoi.md:57`).
Un entrant dont l'adversaire est un bye n'écrit jamais de `winnerEntryId` dans
le match fantôme : le round suivant voit un match « auto-tranché »
(champion désigné sans avoir joué, monnaie d'entrée détruite pour les autres)
ou un bracket gelé. Prouvé par un reproducteur vitest exécuté puis supprimé
(4, 5 et 7 entrées).

### MAJEUR (6)

1. **P4 C1 — Argent : le vocabulaire de statuts payout ne connaît pas `sent`** (`04-argent.md:49`).
   Un payout FedaPay réellement payé reste « en attente » pour toujours : ni
   l'affichage joueur, ni les stats de commission ne voient la sortie réelle.
2. **P3 C1 — Match : la dérive de statut écrase `awaiting_confirmation`** (`03-match.md:47`).
   Le pot gèle hors de tous les radars et la fenêtre de contestation est fermée
   par une action de jeu.
3. **P9 C1 — Web Push mort en silencieux** (`09-routes.md:86`).
   La résolution utilisateur → souscription ne peut JAMAIS aboutir côté serveur :
   la chaîne complète (résolution, subscribe, purge) est branchée mais la
   résolution ne renvoie jamais la clé attendue. Toute la fonctionnalité est
   morte sans un seul test rouge (cf. P15 C5 : couverture absente).
4. **P12 C1 — Stores : la demande d'ami envoyée plante le tableau de bord pour toute la session** (`12-front-stores.md:77`).
5. **P13 C2 — Front : la salle CODM n'est jamais livrée au front** (`13-front-pages.md:157`).
   `sanitizeMatchForBroadcast` retire `roomName`/`roomPassword` de TOUTES les
   sorties sans dérogation participant/arbitre ; `canLaunch`
   (`MatchDetailPage.tsx:231`) exige des champs toujours absents → le bouton
   « DÉMARRER LE MATCH » est TOUJOURS inerte. Tout match 1v1 ARBITRÉ créé depuis
   l'UI ne peut jamais démarrer, se régler, ni payer la commission promise.
   (Les matchs MJ sans arbitre restent fonctionnels.)
6. **P13 C1 — Front : `/br` est inaccessible depuis toute la navigation standard** (`13-front-pages.md:128`).
   Ni `BottomNav` (mobile) ni `ModeSelectionPage` n'exposent `/br` — le bouton
   BR mène à `/br-league`. Le public cible (mobile) n'a AUCUN chemin vers les
   salons BR ; seule la Sidebar desktop y mène.

### FAIBLE notables (au-delà du bruit, ce qui trompe un lecteur)

- **P15 C1** — trois tests e2e verrouillent l'ancien contrat « création BR
  admin-only », divergent du contrat réel **A7** : suite rouge à l'exécution
  (`15-e2e.md:148`).
- **P16** — les documents de service se contredisent eux-mêmes : 02 (A7
  §3.1/§10 vs §5.3 ; sweep §4.4 vs §9.1), 05 (corps V5 « à faire » vs table
  « résolu » ; double V14), 03 (§16.2 « revision à faire » vs provisionnée
  `schema.sql:94-95`) ; `openapi.yaml` décrit un contrat Bearer/login-token/
  deposit-sans-2FA qui n'existe plus ; `00-INDEX` porte des chiffres de
  cadrage faux (server 99→116 fichiers, src 193→180, 846→1002 tests) et une
  table §8 structurellement cassée (V13/V15 absents).
- **P4 C2** — plafond journalier de retrait contournable par la fenêtre
  glissante de 200 entrées (les plafonds d'ARGENT restent tenus par les tests
  de réconciliation — pas de perte possible).
- **P6 C1/C2** — NaN-fail-open sur `placement`/`kills` de journée ; sweep
  stale ligue sans garde d'effectif ni course au boot.
- **P1 C1** — `CLIENT_ABORTED` non mappé : une coupure client devient un
  faux 500.
- **P14** — `DEPLOYMENT.md` : quatre affirmations fausses (C1) et typos
  (C5) ; `ENV_SETUP.md` obsolète (C2) ; gabarits `.env` avalés par
  `.gitignore` (C3, C4).

## Motifs récurrents (ce que la re-lecture révèle à l'échelle du dépôt)

1. **Le contrat produit A7 (25/10) n'a pas été déployé partout.** Le code
   serveur l'applique (`br-engine.mjs:330-339` — volontariat authentifié),
   le §5.3 du doc 02 le décrit — mais le §3.1/§10 du même doc, trois specs
   e2e et le tableau de la partie 7 le contredise encore. Un même changement
   de contrat exige : code, tests, doc (corps + tables), en-têtes.
2. **Les instantanés chiffrés ne sont jamais repassés.** Comptes de fichiers,
   tailles, nombres de tests : chaque passe docs (20/10, 26/10) a laissé les
   chiffres précédents en place — 00-INDEX et 06-tests affichent trois
   générations de chiffres différentes, dont aucune n'est la baseline
   actuelle (116 fichiers server, 180 src, 1002 tests).
3. **« Testé » n'égale pas « branché ».** P9 (push) : chaîne complète testée
   au niveau unité, morte en production, aucun wiring-test. P5 (byes) :
   tests verts sur un bracket auto-tranché. La règle de l'audit-3 reste
   valable : la preuve du branchement exige de traverser le chemin de
   production.
4. **Le drift doc/code des en-têtes du 20/10** (`ce039e8`) : les docs 03/04
   n'ont JAMAIS été repassés ; les citations `fichier:ligne` y sont décalées
   de +38 à +80 lignes (les ancrages par nom de symbole tiennent, eux).
5. **La discipline anti faux-positifs a payé.** Plusieurs affirmations des
   ledgers ont été infirmées EN RELISANT le code (P13/P15 : leave ligue
   rembourse, sanctions réelles, serveur force `found: true` en reset, aucune
   salle CODM en BR) — aucun rang d'audit-3 n'a été gravé sans preuve croisée.

## Verdict global

Le noyau du produit est solide : OCC complète, sortie d'argent unique gardée
par l'arbitre, idempotences durables (retraits, gains, dettes), sessions et
sanctions persistées, garde admin 2FA à quatre portes mutées et détectées,
CI bloquante sur typecheck/lint/e2e. Les 7 constats de gravité élevée sont
concentrés sur des chaînes TRANSVERSALES (bye, statut FedaPay `sent`, salle,
push, navigation) — précisément celles que ni les tests unitaires (par
construction), ni les e2e locaux (mode mémoire) ne traversent, et que la
suite live ne lance que sur demande explicite.

## Ordre de correction proposé

1. P5 C1 (CRITIQUE) — propagation des byes, avec un test de bracket qui
   traverse le chemin réel.
2. P4 C1 — reconnaître `sent` dans le vocabulaire payout (+ témoin
   double-payout actuellement sauté, cf. doc 06 §4.6).
3. P3 C1 — la dérive de statut ne doit jamais écraser `awaiting_confirmation`.
4. P9 C1 — réparer la résolution Web Push, et un wiring-test (le type de test
   qui a manqué).
5. P13 C2 puis P13 C1 — dérogation participant/arbitre pour la salle, ou
   serveur-only `canLaunch` ; `/br` dans BottomNav + ModeSelectionPage.
6. P12 C1 — la demande d'ami ne doit pas casser le dashboard.
7. P15 C1 — réaligner les 3 specs e2e sur A7 (suite verte).
8. P16 — passe unique sur les docs de service : en-têtes datés, tables
   résumé cohérentes avec les corps, chiffres recalés sur la baseline
   courante, `openapi.yaml` régénéré ou retiré.

## Ce qui a été vérifié et jugé sain (aperçu)

- Noyau serveur (P1) : logger, mutex, supabase (jamais de repli anon),
  single-process-guard, metrics, rate-limiter (3 conditions de relaxation),
  code-delivery (allowlist anti-SSRF).
- Données (P2) : OCC intégrale (rollback, rejouer sur état frais,
  fail-closed), chargement paginé, idempotences dans le portefeuille,
  lockout haché, sanctions à la lecture.
- Match (P3, hors C1) : sortie d'argent unique, `payouts` réels (A9),
  règlement différé, anti-forgery, isolation des échecs du sweep.
- Argent (P4, hors C1) : `releaseWalletWinnings` idempotent et anti-
  blanchiment, refus de rembourser un payout peut-être parti, file de
  réconciliation dédiée.
- Tournoi (P5, hors C1) : S3 corrigé (2FA sur override), dettes écrites au
  règlement, reprises idempotentes, péremption deux états.
- Ligue (P6) : 2FA sur les 5 routes d'argent, compensation join, garde
  prototype sur `dayKey`, finale strictement validée.
- BR (P7) : C1/C2/C4 audit-2 corrigés et verrouillés par tests ; crons
  verrouillés par salon ; reprise `settling` idempotente.
- Fondations (P8) : tous les jobs d'argent ont garde anti-chevauchement +
  verrou + boot immédiat ; moderation, channel-presence, push-notifications
  (création) propres.
- Routes (P9, hors C1) : auth (mass assignment fermé, révocations
  complètes), wallet (10 PIEGE réels), admin (2FA + CSV échappé).
- Realtime (P10) : CSRF deux niveaux, CORS sur upgrade WS aussi, rate limit
  de handshake, auth du handshake fail-closed.
- Front lib (P11) : les 13 événements socket croisés une à une avec le
  serveur ; SW et chaîne push cliente propres (la casse est côté serveur).
- Front stores (P12, hors C1) : match, wallet, chat, notification, auth,
  toast, socket — invariants appliqués, gardes multi-compte réelles.
- Front pages (P13, hors C1/C2) : features match/tournament/league/br
  fidèles à la projection serveur ; auth, profil, legal, mj propres.
- Config (P14, hors FAIBLE) : CI cohérente (Node 22, pnpm 11, hoisted),
  vercel.json/render.yaml/index.html sains ; cache immutable assets +
  no-store pages correct.
- e2e (P15, hors C1) : harnais remarquable (un contexte HTTP par acteur),
  suites argent/auth/br/social solides.
- Docs (P16, hors FAIBLE) : qualité de raisonnement rare — citations
  systématiques, réserves explicites, auto-critique honnête.
