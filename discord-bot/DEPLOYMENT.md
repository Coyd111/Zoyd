# DEPLOYMENT — Portal / Render / bot

**État au 06/11/2026, aligné à la réalité.**

## Invite — déjà publiée

`discord.gg/wfQCFTsEJk` est câblée dans `Zoyd/src/lib/social.ts` (source unique) et rendue par `LandingPage.tsx:533` via `SocialLinks`. Le site public l'affiche déjà, avec TikTok et WhatsApp. Transport: aucun changement nécessaire.

## Portal — gelé par Design

Le compte `zoyd111` (id 1551504341276295213) est désactivé par T&S (30/09/2026), considéré perdu. Le Developer Portal de l'application `Zoyd` est donc inaccessible. Aucune action Portal (reset token, invite app, Members Intent, réinstall) n'est possible aujourd'hui.

Fallback technique si un jour un compte administrateur revient : réactiver l'app = Portal → Bot → Reset Token (nouveau secret à Render uniquement) → Members Intent → Enable Community.

## Render — worker bot **obsolète, ne pas déployer en l'état**

Le worker actuel (src/index.mjs) est antérieur à la refonte :
- son flux tickets est mort (salon #support supprimé) ;
- son flux rôles "Nouveau → Joueur" inopérant (salon #roles supprimé ; rôle Nouveau remplacé par onboarding natif).

**Recommandation : pas de déploiement du worker actuel.** La spec dit natif d'abord. Si un déploiement se justifie un jour (appeal réussi, Community activée), il faut réécrire index.mjs d'abord, puis un blueprint Render neuf à partir de render.yaml (worker séparé, root `discord-bot/`, env = DISCORD_TOKEN sync:false, GUILD_ID, AUDIT_CHANNEL_ID).

## Option A — (attendu appeal) réécrire minimal

1. Réécrire `src/index.mjs` : welcome d'un membre (logs) + suggestCommunity rôle via bot (Community requis) + audit-log `/guilds/me`.
2. `npm install`, tester localement (ne tourne pas pour l'instant).
3. Render → New → Worker → Source = le dépôt → Root directory `discord-bot` → Free → Set vars (DISCORD_TOKEN secret) → Deploy.
4. Relancer `check.mjs` après un message "bot connecté" dans la console Render.

## Option B — ne jamais déployer le bot

Légitime pour un lancement natif. L'AutoModeration native et l'onboarding pré-rempli suffisent pour les 100 premiers membres.

## Ce qui est déployable aujourd'hui (si vraiment urgent)

Seulement l'infrastructure déjà live (Vercel + Render game server, celui du site). Aucun changement git ne doit partir sans ton accord explicite — le bot et le site sont découplés exprès.
