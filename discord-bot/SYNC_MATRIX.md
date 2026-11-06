# ZOYD Discord ↔ Dev — Matrice de sync

But : chaque commit côté `Zoyd/` qui change un flux doit mettre à jour le texte Discord correspondant. Jamais l'inverse.
Le jeu reste côté dev. Discord ne reproduit pas la plateforme : il sert à suivre, comprendre, échanger.

## Fichier site → salons Discord

| Changement côté site | Salons à mettre à jour |
|---|---|
| `RegisterPage.tsx`, `ActivatePage.tsx`, `authApi.ts`, `code-delivery.mjs` (inscription, codes, email) | `questions-frequentes`, `etat-du-projet` |
| `match-engine.mjs`, `MatchDetailPage.tsx`, `CreateMatchPage.tsx`, `HubMJPage.tsx` (cycle match, preuves, litiges) | `comment-ca-marche`, `formats-de-competition`, `retours-communaute` |
| `competition.ts` (formats, modes, maps, pays, rangs) | `formats-de-competition`, `etat-du-projet` |
| `tournament-engine.mjs`, `TournoisPage.tsx`, `TournamentBracketPage.tsx` | `formats-de-competition` |
| `league-engine.mjs`, `LeaguePage.tsx` | `formats-de-competition`, `evenements` |
| `wallet-engine.mjs`, `payment-engine.mjs`, `payoutOperators.ts`, `walletFunding.ts`, `walletStore.ts` (soldes, FedaPay, retraits, pays) | `comment-ca-marche`, `questions-frequentes` |
| `trustScoreStore.ts`, `ProfilPage.tsx`, `PublicProfilPage.tsx` | `comment-ca-marche`, `questions-frequentes` |
| `chatStore.ts`, `chatApi.ts`, `socialApi.ts` | `retours-communaute` |
| `notificationStore.ts`, push | `questions-frequentes` |
| `routes.tsx` (nouvelle page ou route) | `reseaux-officiels`, `etat-du-projet` |
| `utils.mjs` seuils XP, `match-engine.mjs` XP et Elo | (hall-of-fame supprimé pré-lancement) |
| `rate-limiter.mjs`, `persistence.mjs` | `questions-frequentes` |
| `admin-totp.mjs`, `AdminDashboardPage.tsx` (arbitrage) | `suivi-moderation`, `journal-des-actions` |

## Rituel hebdo (staff, dans `journal-des-actions`)

1. `git log` dev de la semaine → lignes du tableau touchées → textes édités via PATCH (pins conservés).
2. KPI : membres totaux et J7, onboarding complété, délai premier message en recherche-match, tickets ouverts et clos avec délai moyen, clips postés et votes, minutes vocales, messages d'aide sans réponse.
3. Règles : bump `regles` vX.Y daté seulement si conduite change, sinon ne pas toucher.
4. Feedback public : tout bug Discord remonté et corrigé côté jeu est annoncé en `annonces` (boucle CODM officiel).

## Règles d'édition

- PATCH sur message existant quand le salon est épinglé (`bienvenue`, `regles`, `faq`, `ou-aller`), jamais DELETE+POST.
- DELETE+POST ailleurs, avec suppression des notifs système type 6.
- 2000 caractères max, alinéas, une idée par paragraphe.
- Ne jamais promettre date, pays, format ou lot non validés par le code ou toi.
- Token bot uniquement en variable d'environnement Render, jamais en clair.

## Kit de vérification (`check.mjs`)

`DISCORD_TOKEN=xxx GUILD_ID=1551506556795883602 node check.mjs`

Vérifie en une passe : token, serveur, 31 salons, 4 épingles, 16 rôles, AutoMod, webhooks inconnus, invite officielle, activité suspecte (@everyone ou pièces jointes hors bot), acteurs audit log. Fin de sortie : checklist manuelle compte/portal/Render à suivre dans l'ordre.

À jouer : après un reset de token, après un partage du serveur, et comme rituel hebdo dans `audit-log`.
