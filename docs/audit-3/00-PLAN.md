# Relecture post-correctifs — plan et suivi

**Ouverture :** 2026-10-26
**Base :** `main` au `491b9f0` — suite 93 fichiers / 1002 pass / 2 skip, typecheck 0, lint 0.
**Objet :** relecture complète du projet, partie par partie, APRÈS la livraison
des 13 rangs de l'audit-2 et du pass UX. Elle ne reprend pas les constats déjà
corrigés : elle vérifie l'état actuel.

**Méthode par partie :**
1. lecture des sources de la partie (régions critiques en priorité) ;
2. croisement avec les ledgers `audit-2/` (ce qui est censé être corrigé) ;
3. croisement avec les tests qui couvrent la partie ;
4. constats écrits dans le fichier de la partie, avec `fichier:ligne` et preuve.

**Gravités reprises :** CRITIQUE (argent ou compte en danger), MAJEUR (fonction
cassée ou divergeante), FAIBLE (bruit, doc fausse), INFO (remarque).

## Suivi

| # | Partie | Fichier de constats | État |
|---|---|---|---|
| 1 | Noyau serveur | `01-noyau-serveur.md` | terminé 2026-10-26 (3 FAIBLE, 4 INFO) |
| 2 | Données (persistence, state-helpers) | `02-donnees.md` | terminé 2026-10-26 (2 FAIBLE, 4 INFO) |
| 3 | Match | `03-match.md` | terminé 2026-10-26 (1 MAJEUR, 1 FAIBLE, 3 INFO) |
| 4 | Argent (wallet, paiement) | `04-argent.md` | terminé 2026-10-26 (1 MAJEUR, 1 FAIBLE, 2 INFO) |
| 5 | Tournoi | `05-tournoi.md` | - |
| 6 | Ligue | `06-ligue.md` | - |
| 7 | BR | `07-br.md` | - |
| 8 | Fondations (cron, moderation, chat, push) | `08-fondations.md` | - |
| 9 | Routes | `09-routes.md` | - |
| 10 | Realtime | `10-realtime.md` | - |
| 11 | Front lib | `11-front-lib.md` | - |
| 12 | Front stores | `12-front-stores.md` | - |
| 13 | Front pages et features | `13-front-pages.md` | - |
| 14 | Config et deploiement | `14-config.md` | - |
| 15 | e2e | `15-e2e.md` | - |
| 16 | Docs de service (00-08) | `16-docs.md` | - |

La synthèse finale : `00-SYNTHESE.md`, écrite à la clôture.
