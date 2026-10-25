# 03 — Sécurité

> Ce document décrit **ce que le code fait**, pas ce qu'il devrait faire.
> Chaque affirmation structurante porte sa référence `fichier:ligne`.
> Quand une affirmation n'a pas pu être vérifiée dans le code, c'est écrit.

Dernière vérification : lecture directe des sources du dépôt `Zoyd/`
(serveur `server/`, front `src/`, schéma `supabase/`, config `vercel.json`,
`render.yaml`).

---

## 1. Le principe directeur : **une garde côté client ne protège rien**

C'est la phrase la plus importante de ce document, et tout le reste en découle.

Une page React s'exécute dans le navigateur du joueur. Le joueur contrôle son
navigateur : il peut ouvrir la console, modifier le store, supprimer une
condition, appeler l'API avec `curl`. Un garde client n'est donc **jamais** une
barrière de sécurité : c'est au mieux un confort d'UX (éviter d'afficher une
page vide), au pire une **fausse impression de couverture** — le lecteur du
code croit que la route `/admin` est protégée, alors qu'elle ne l'est pas.

Deux exemples concrets dans ce dépôt :

- `src/app/routes.tsx:217` — `element: <AppLayout requireAdmin />` : la route
  `/admin` passe par une **prop**, pas par un garde React Router natif.
- `src/app/layouts/AppLayout.tsx:35-37` — si l'utilisateur n'est pas admin,
  on fait `<Navigate to="/mj" replace />`.

Ce que ces deux lignes protègent : **rien**. Le rôle lu par le client vient du
store `useAuthStore` (`src/app/layouts/AppLayout.tsx:17-19`), lui-même
hydraté par `GET /api/auth/me` (`server/routes/auth.mjs:313-326`). Le store
vit dans le navigateur : il est modifiable.

La seule barrière réelle est **côté serveur**. Et elle existe :
`requireAdmin2fa` (`server/admin-totp.mjs:152-175`) pour `/api/admin/*`,
complétée depuis (S1/S3, audit-2) par `require2faIfAdmin` sur les routes de
résultat.

Le fichier de test qui le prouve s'appelle `server/admin-totp-guard.test.mjs`,
et son en-tête pose la question frontalement
(`server/admin-totp-guard.test.mjs:8-12`) :

> *« La conclusion : rien à corriger. Un garde CLIENT ne protège d'ailleurs
> rien — n'importe qui peut appeler `/api/admin/*` sans navigateur, sans React.
> La seule barrière qui compte est `requireAdmin2fa`, côté serveur. »*

Ce document est construit autour de cette distinction.

---

## 2. Les gardes serveur — et pourquoi le front n'en est pas un

| Garde | Condition | Réponse | Source |
|---|---|---|---|
| `requireAdmin` | session + rôle `admin` | 401 / 403 | `server/admin-totp.mjs:129-141` |
| `requireAdmin2fa` | session + rôle `admin` + 2FA **activée** + 2FA **vérifiée** | 401 / 403 | `server/admin-totp.mjs:152-175` |
| `require2faIfAdmin` | session (tout rôle) ; **si admin seulement** : 2FA activée + vérifiée (fenêtre 5 min) | 401 / 403 `2FA_REQUIRED` pour l'admin ; le joueur passe sans code | `server/admin-totp.mjs:233-252` |

Le troisième garde est la réponse de S1/S3 (audit-2, livré le 23/10/2026) aux
routes qui **distribuent de l'argent tout en restant ouvertes au volontariat
A7** — matchs, tournois, `finish` BR : le joueur arbitre saisit et règle sans
code (l'autorité y est métier — l'arbitre désigné, cf. `05-invariants.md`
R7), tandis qu'une session admin doit présenter une 2FA fraîche (un mot de
passe compromis sans le TOTP obtient un 403, pas un paiement).

`requireAdmin` sert aux routes d'**enrôlement** de la 2FA (setup, enable,
verify, status) : exiger la 2FA pour activer la 2FA serait circulaire.
`requireAdmin2fa` sert à tout ce qui touche de l'argent ou de la modération.

### 2.1 Les quatre portes de `requireAdmin2fa`

Elles sont évaluées **dans cet ordre**, et chacune écrit sa propre réponse :

| # | Porte | Condition refusée | Statut | `code` | Ligne |
|---|---|---|---|---|---|
| 1 | **Session** | `getAuthenticatedAppSession(req)` renvoie `null` | 401 | *(aucun)* | `server/admin-totp.mjs:154-157` |
| 2 | **Rôle** | `session.user.role !== 'admin'` | 403 | `ADMIN_REQUIRED` | `server/admin-totp.mjs:158-164` |
| 3 | **2FA activée** | `!adminTotpSecrets.get(id)?.enabled` | 403 | `2FA_REQUIRED` (+ `requires2fa: true`) | `server/admin-totp.mjs:165-169` |
| 4 | **2FA vérifiée et non expirée** | `!session.admin2faVerified \|\| session.admin2faExpires <= Date.now()` | 403 | `2FA_REQUIRED` (+ `requires2fa: true`) | `server/admin-totp.mjs:170-173` |

Quatre portes distinctes, quatre réponses distinctes. La porte 3 et la porte 4
partagent le même `code` (`2FA_REQUIRED`) mais des messages différents : « active
la 2FA » contre « vérification 2FA requise pour cette action ». Le front peut
distinguer « je n'ai jamais configuré de 2FA » de « ma 2FA a expiré ».

### 2.2 Le garde ÉCRIT LUI-MÊME la réponse — l'appelant ne doit pas re-répondre

C'est un piège d'implémentation, et il est documenté dans le code parce qu'il
a déjà mordu.

`requireAdmin2fa(req, res)` **pose la réponse HTTP lui-même** quand il refuse
(`server/admin-totp.mjs:155`, `162`, `167`, `171`). Il renvoie `null`. L'appelant
doit donc se borner à «propager le refus », jamais à écrire une seconde
réponse :

```js
// server/routes/admin.mjs:115-116 — la forme correcte
const session = requireAdmin2fa(req, res);
if (!session) return true;
```

L'erreur à ne pas commettre est un `respondJson(res, 403, …)` derrière le
garde : les en-têtes sont déjà partis, Node lève `ERR_HTTP_HEADERS_SENT`, et la
route finit en 500 sur une réponse déjà écrite. Le commentaire de
`server/routes/wallet.mjs:105-109` le dit explicitement :

> *« `requireAdmin2fa` repond LUI-MEME (401/403 + code) : ne pas re-repondre
> derriere, sinon double ecriture d'en-tetes, avalee en ERR_HTTP_HEADERS_SENT. »*

Deux points de vigilance supplémentaires :

- **L'ordre est inverted par rapport à l'habitude.** Dans
  `server/routes/wallet.mjs:104-110`, la 2FA est vérifiée **avant** le rate
  limit ; dans `server/routes/admin.mjs:114-116`, c'est l'inverse (rate limit
  d'abord, 2FA ensuite). Les deux ordres sont défendables, mais ils ne sont pas
  interchangeables : l'un compte la tentative avant de l'authentifier, l'autre
  l'authentifie avant de la compter.
- **Le `code` n'est pas décoratif.** `server/admin-totp.mjs:160-162` explique
  pourquoi : sans `code: 'ADMIN_REQUIRED'`, le client ne peut pas distinguer un
  403 d'autorisation d'une session expirée, et il déconnecte le joueur à tort.
  Conséquence concrète, côté front : `src/app/lib/apiClient.ts:36-53` ne purge
  l'état que sur un **401** ou sur un **403 `AUTH_REQUIRED`** — un 403
  `2FA_REQUIRED` ne déconnecte personne.

### 2.3 La fenêtre de vérification 2FA

- `markAdmin2faVerified` pose `admin2faExpires = Date.now() + 5 min`
  (`server/persistence.mjs:3160-3174`).
- Le marquage se fait sur la **session stockée**, pas sur la copie renvoyée :
  muter l'objet retourné par `getAuthSession` ne persistait rien
  (`server/persistence.mjs:3153-3156`). D'où l'appel
  `markAdmin2faVerified(readBearerToken(req))` dans les routes
  (`server/routes/admin.mjs:507`, `535`).
- La fenêtre **hérite de la rotation** : la session fille récupère le marquage
  de sa mère (`server/persistence.mjs:3095-3100`), et le marquage suit la
  chaîne de succession `supersededBy` (`server/persistence.mjs:3169-3173`).
  Sans cela, l'admin devrait ressaisir son code après chaque rotation de
  cookie.

### 2.4 Le TOTP lui-même

| Propriété | Valeur | Source |
|---|---|---|
| Algorithme | HMAC-SHA1, RFC 6238 | `server/admin-totp.mjs:16` |
| Longueur | 6 chiffres | `server/admin-totp.mjs:10` |
| Pas de temps | 30 s | `server/admin-totp.mjs:13` |
| **Fenêtre de tolérance** | **0 pas** (le code ne vit que SON pas) | `server/admin-totp.mjs:64` |
| Secret | 20 octets aléatoires, Base32 | `server/admin-totp.mjs:460` |
| Comparaison | `crypto.timingSafeEqual` | `server/admin-totp.mjs:96` |
| Type du code | `typeof code !== 'string'` → refus | `server/admin-totp.mjs:87` |

La fenêtre à 0 pas est un choix assumé, documented
(`server/admin-totp.mjs:49-63`) : un code ne peut pas être rejoué, sa durée de
vie est de 30 s au lieu de 90 s. Le prix — un téléphone dont l'horloge dérive
de plus d'une quinzaine de secondes voit son code refusé — est couvert par le
décompte affiché côté interface, calculé sur l'horloge **serveur**.

L'implémentation est validée par les **vecteurs officiels RFC 6238**
(`server/admin-totp.test.mjs:21-28`, `50-60`) et par des cas limites
explicites (`server/admin-totp.test.mjs:112-149`) : mauvais type, mauvaise
longueur, secret corrompu, zéros initiaux.

### 2.5 L'enrôlement de la 2FA est lui-même protégé

Trois gardes sur `/api/admin/2fa/setup` (`server/routes/admin.mjs:416-471`) :

1. **Mot de passe admin obligatoire** (`server/routes/admin.mjs:433-445`).
   Sans cela, un attaquant ayant seulement le mot de passe admin s'auto-enrôlait
   un code valide : le garde anti-takeover reposait sur `adminTotpSecrets`, un
   `Map` **en mémoire** (`server/admin-totp.mjs:24`) — vide au démarrage si la
   ligne de base manque.
2. **Ré-enrôlement refusé si une 2FA est déjà active**
   (`server/routes/admin.mjs:451-459`) → 409 `2FA_ALREADY_ENABLED`. Ré-enrôler
   exige de **connaître le secret courant**.
3. Le secret est persisté en base via `saveAdminTotpSecret`
   (`server/persistence.mjs:3902-3909`), qui **lève** si l'écriture échoue
   (`server/persistence.mjs:3906-3908`) — un secret perdu verrouillerait
   l'admin hors de toutes les routes d'administration.

Les secrets sont rechargés au démarrage
(`server/realtime-server.mjs:613-616`, `server/persistence.mjs:3911-3922`).

---

## 3. `server/admin-totp-guard.test.mjs` : le test qui prouve la barrière

Ce fichier mérite un paragraphe à part, parce que **c'est lui qui distingue
une vraie protection d'une impression de protection**.

### 3.1 Pourquoi il teste le garde, et non le routeur

`server/admin-totp-guard.test.mjs:14-17` : tester le routeur complet
(`server/routes/admin.mjs`) aurait embarqué `push-notifications.mjs`, qui
valide une clé VAPID **à l'import**. Le module `admin-totp.mjs` n'importe que
trois modules — c'est ce qui rend le test direct possible.

Les dépendances sont mockées (`server/admin-totp-guard.test.mjs:25-41`) :
`getAuthenticatedAppSession` est simulé, `respondJson` est une **copie
locale** qui observe les statuts sans rejouer la logique — le test ne teste
donc pas `respondJson`, il teste le garde.

### 3.2 Ce que le test couvre

| Cas | Attendu | Ligne du test |
|---|---|---|
| Sans session | 401 | `server/admin-totp-guard.test.mjs:89-93` |
| Joueur connecté | 403 + `ADMIN_REQUIRED` | `server/admin-totp-guard.test.mjs:95-101` |
| Admin sans 2FA activée | `2FA_REQUIRED` | `server/admin-totp-guard.test.mjs:103-109` |
| 2FA active mais non vérifiée | `2FA_REQUIRED` | `server/admin-totp-guard.test.mjs:111-116` |
| 2FA vérifiée mais expirée | `2FA_REQUIRED` | `server/admin-totp-guard.test.mjs:118-124` |
| **Admin avec 2FA active ET vérifiée** | **passe, session renvoyée** | `server/admin-totp-guard.test.mjs:126-130` |

Le dernier cas est le plus important, et le fichier le dit
(`server/admin-totp-guard.test.mjs:19-22`) :

> *« une suite composée uniquement de rejets passe aussi bien avec `() => null`.
> Sans cas positif, ce fichier garantirait n'importe quoi — y compris une
> fonction morte. »*

### 3.3 Sa mutation-testabilité — la recette pour le revérifier

Un test qui reste vert après avoir cassé le code ne prouve rien. C'est la
règle 5 de `docs/00-INDEX.md:123`, et `docs/00-INDEX.md:125-126` en tire la
conclusion : *« `server/admin-totp-guard.test.mjs` a été gardé parce que ses 4
portes ont été neutralisées une par une et détectées à chaque fois. »*

La recette, pour le revérifier soi-même — chaque mutation **doit** faire
échouer le test :

| Mutation | Test qui doit échouer |
|---|---|
| Porte 1 (session) : ne plus renvoyer `null` quand il n'y a pas de session | `server/admin-totp-guard.test.mjs:89-93` |
| Porte 2 (rôle) : supprimer le test `role !== 'admin'` | `server/admin-totp-guard.test.mjs:95-101` |
| Porte 3 (2FA activée) : supprimer le test `totpEntry?.enabled` | `server/admin-totp-guard.test.mjs:103-109` |
| Porte 4 (vérifiée / expirée) : supprimer le test `admin2faVerified` | `server/admin-totp-guard.test.mjs:111-116` et `118-124` |
| Retourner toujours `null` (garde mort) | `server/admin-totp-guard.test.mjs:126-130` |

Autrement dit : le test **couvre chacune des quatre portes séparément**, et
couvre le chemin heureux. Ce n'est pas un test de « la route admin répond
403 » — c'est un test de **la porte exacte qui a laissé passer**.

---

## 4. Ce qu'un garde client donne l'illusion de faire

Cette section est volontairement placed avant les mécanismes techniques : c'est
elle qui évite qu'un lecteur conclude « le `/admin` est protégé ».

| Ce que le code semble faire | Ce qu'il fait réellement | Source |
|---|---|---|
| « La route `/admin` est réservée aux admins » | Le client redirige vers `/mj` si `user.role !== 'admin'` — un `Navigate` que l'utilisateur peut contourner en éditant le store ou en appelant l'API directement | `src/app/layouts/AppLayout.tsx:35-37` |
| « La protection admin passe par une prop `requireAdmin` » | C'est un garde de **rendu**, pas un garde de **route** : il n'intercept.e aucune requête | `src/app/routes.tsx:216-220` |
| « Le rôle est vérifié avant l'accès » | Le rôle vient du `store` navigateur ; `updateUser` interdit `role` dans sa liste blanche (`src/app/stores/authStore.ts:108-114`) — bonne pratique d'hygiène, mais ce n'est pas une barrière : le code du navigateur est sous le contrôle de l'utilisateur | `src/app/layouts/AppLayout.tsx:17-19` |
| « Le menu n'affiche pas le lien admin » | `Sidebar` et `BottomNav` masquent le lien (`src/app/components/layout/Sidebar.tsx:32-34`, `src/app/components/layout/BottomNav.tsx:33`) — pure ergonomie | idem |
| « Le tableau de bord admin est protégé » | Les routes `/api/admin/*` exigent `requireAdmin` ou `requireAdmin2fa` **côté serveur** — là, c'est réel | `server/routes/admin.mjs:115-116`, `134-135`, `155-156`, `210-211`, `275-276`, `309-310`, `346-347`, `408`, `418`, `475`, `515`, `544`, `598`, `626` |

**La règle de lecture :** devant un garde, se demander « si j'efface le
navigateur et que j'appelle l'URL avec `curl`, qu'est-ce qui m'arrête ? ». Si
la réponse est « rien », le garde est de l'UX.

---

## 5. Le CSRF : deux niveaux, et les limites exactes de chacun

### 5.1 Le contexte rend la protection nécessaire

Le front est hébergé sur **Vercel** (`zoyd.vercel.app`), l'API sur **Render**
(`zoyd.onrender.com`). Ce sont deux origines différentes. Le cookie de session
doit donc être `SameSite=None` en production pour être envoyé par le
navigateur :

```js
// server/http-utils.mjs:47-56
sameSite: isProd ? 'none' : 'lax',
```

Sans défense supplémentaire, une page tierce peut POSTer
`/api/wallet/withdraw` en `mode:'no-cors'` avec `Content-Type: text/plain` —
une *simple request*, sans préflight — en profitant du cookie envoyé
automatiquement (`server/realtime-server.mjs:228-233`).

### 5.2 Les deux niveaux

Le garde est dans `handleRequest`, **avant** la table de routes
(`server/realtime-server.mjs:234-248`), donc il s'applique à toutes les
requêtes mutantes, pas route par route :

```js
// server/realtime-server.mjs:234-248
if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) { /* 403 CSRF_ORIGIN_REJECTED */ }
  const contentType = String(req.headers['content-type'] || '');
  if (contentType && !contentType.includes('application/json')) { /* 415 UNSUPPORTED_MEDIA_TYPE */ }
}
```

| Niveau | Garde | Bloque quoi | Limite |
|---|---|---|---|
| 1 | `Origin` sur liste blanche | Un navigateur tiers (page d'attaque) | **Absence d'`Origin` ⇒ pas bloqué** |
| 2 | `Content-Type` doit contenir `application/json` | La *simple request* `text/plain` | **Absence de `Content-Type` ⇒ pas bloqué** |

La liste blanche est `ALLOWED_ORIGINS` (`server/http-utils.mjs:60-67`) :
les trois origines de production sont **écrites en dur**
(`zoyd.vercel.app`, `zoyd.africa`, `www.zoyd.africa`), plus
`ZOYD_ALLOWED_ORIGINS` si défini, plus les origines de dev **uniquement hors
production** (`server/http-utils.mjs:59`).

### 5.3 Les limites, énoncées franchement

- **Pas d'`Origin` ⇒ pas bloqué.** La condition est `if (origin && …)`. Un
  client non-navigateur (curl, script, E2E) passe. C'est un choix assumé : un
  navigateur envoie `Origin` sur toute requête cross-site mutante ; un appelant
  sans navigateur n'a pas besoin d'un anti-CSRF, il n'a pas de cookie
  ambiant. Mais cela signifie que **le niveau 1 seul ne bloque rien** face à un
  client qui omet l'en-tête.
- **Pas de `Content-Type` ⇒ pas bloqué.** Même logique (`if (contentType && …)`).
  Le niveau 2 bloque `text/plain`, `application/x-www-form-urlencoded`,
  `multipart/form-data` — c'est-à-dire tout ce qu'un formulaire HTML ou un
  `fetch` en `no-cors` peut produire — mais laisse passer une requête sans
  en-tête de type.
- **Conséquence : les deux niveaux sont complémentaires, aucun seul ne suffit.**
  Un client qui omet `Origin` **et** envoie `Content-Type: text/plain` est
  bloqué par le niveau 2. Un client qui envoie un `Origin` tiers est bloqué par
  le niveau 1. Il faut omettre les deux pour passer — et un navigateur ne le
  peut pas.
- Le `preflight` `OPTIONS` est traité **avant** le garde
  (`server/realtime-server.mjs:223-226`) : sinon le préflight lui-même serait
  bloqué et plus rien ne fonctionnerait.
- Le WebSocket a **son propre** filtre d'origine, sur l'`upgrade`
  (`server/realtime-server.mjs:288-296`) et sur le transport polling
  (`server/realtime-server.mjs:297-307`) : `cors.origin` ne s'applique qu'au
  polling, donc l'`allowRequest` est indispensable. Sans lui, une page tierce
  pouvait ouvrir un socket authentifié avec le cookie de la victime.

---

## 6. Le rate limiter

Fichier : `server/rate-limiter.mjs`.

### 6.1 Les sept groupes

| Groupe | Plafond | Fenêtre | Où l'on s'en sert | Ligne de config |
|---|---|---|---|---|
| `auth` | 50 | 15 min | register, login, activate, resend-code, activation-email, forgot-password, reset-password, change-password, DELETE me, PATCH me | `server/rate-limiter.mjs:12` |
| `auth_logout` | 60 | 1 min | logout | `server/rate-limiter.mjs:16` |
| `social` | 30 | 1 min | routes sociales | `server/rate-limiter.mjs:17` |
| `wallet` | 20 | 10 min | deposit, withdraw, verify-fedapay | `server/rate-limiter.mjs:18` |
| `chat` | 60 | 1 min | chat | `server/rate-limiter.mjs:19` |
| `admin` | 20 | 5 min | toutes les routes `/api/admin/*` | `server/rate-limiter.mjs:20` |
| `default` | 60 | 1 min | reste des routes | `server/rate-limiter.mjs:21` |

La clé de bucket est `${ip}|${group}` (`server/rate-limiter.mjs:75`) : chaque
groupe a son propre compteur, mais les groupes partagent la même identité d'IP.

**Pourquoi `logout` a son propre groupe.** Le commentaire est sans ambiguïté
(`server/rate-limiter.mjs:13-15`) : `logout` est appelable sans session et ne
prouve rien ; le partager avec `auth` permettait à n'importe qui de renvoyer
429 sur **toutes** les routes d'authentification pendant 15 minutes. Derrière un
CGNAT mobile ou une IP d'entreprise partagée, tous les utilisateurs de cette IP
ne pouvaient plus se connecter du tout. Un déni de connexion de masse, gratuit.
La route elle-même documente le raisonnement (`server/routes/auth.mjs:461-475`).

### 6.2 La fenêtre — ce n'est pas une fenêtre glissante

Le code parle de `windowStart` / `windowMs`, et le terme « fenêtre glissante »
apparaît dans la documentation. **Le code implémente une fenêtre fixe**, ancrée
sur la **première requête** du bucket :

```js
// server/rate-limiter.mjs:77-90
const record = rateLimitBuckets.get(key);
if (!record || now - record.windowStart > config.windowMs) {
  // nouveau bucket : windowStart = now, attempts = 1
}
record.attempts += 1;
const allowed = record.attempts <= config.max;
const retryAfter = Math.ceil((record.windowStart + config.windowMs - now) / 1000);
```

Le compteur ne décroît pas requête par requête : il est remis à zéro d'un bloc
à l'expiration de la fenêtre. Conséquence pratique : un attaquant peut faire
`2 × plafond` requêtes en encadrant la frontière (la moitié juste avant la
bascule, la moitié juste après). Sur le groupe `auth` (50 / 15 min), cela
double théoriquement l'anti-bruteforce — l'anti-bruteforce **par compte**,
posé séparément (§ 10.4), absorbe le surplus.

Le nettoyage des buckets expirés tourne toutes les 60 s
(`server/rate-limiter.mjs:94-102`). Le plafond mémoire est de 50 000 buckets,
avec éviction du plus ancien (`server/rate-limiter.mjs:8`, `80-83`).

### 6.3 L'IP : on prend la **dernière** valeur de `X-Forwarded-For`

C'est un point qui mérite d'être lu mot à mot, parce que l'inverse est
l'erreur classique.

```js
// server/rate-limiter.mjs:180-195
const hops = forwarded.split(',').map(h => h.trim()).filter(Boolean);
const lastHop = hops[hops.length - 1];
if (lastHop && isValidIp(lastHop)) return lastHop;
```

**Le raisonnement** (`server/rate-limiter.mjs:167-175`) :

> Un proxy n'efface pas l'en-tête : il **APPEND** son IP. Un client peut donc
> envoyer `X-Forwarded-For: 1.2.3.4` et le proxy produit `1.2.3.4, <IP réelle
> du client>`. Lire `[0]` rendait cette valeur entièrement contrôlable par
> l'appelant : il suffisait de changer d'en-tête à chaque requête pour obtenir
> un bucket neuf et contourner complètement le rate-limit (donc le
> anti-bruteforce des 50 essais / 15 min). La dernière valeur est celle qu'a
> posée le proxy de confiance, donc la seule que l'appelant ne contrôle pas.

Autrement dit : le **premier** élément de la chaîne est le plus ancien, donc
le plus manipulable ; le **dernier** est le plus récent, donc posé par le
proxy de confiance.

Deux protections autour :

- `X-Forwarded-For` n'est lu **que si le pair TCP direct est un proxy de
  confiance** (`server/rate-limiter.mjs:151-161`) : loopback, `10.`,
  `192.168.`, `172.16-31.`, `fc`/`fd`, ou `TRUST_PROXY=true` (qui est le cas en
  production, `render.yaml:30-31`). Sinon c'est l'adresse du pair qui est
  utilisée.
- Le saut retenu doit être **une vraie adresse IP** (`isValidIp`,
  `server/rate-limiter.mjs:115-140`) : IPv4 avec octets ≤ 255, IPv6 avec une
  seule compression `::`, groupes de 1 à 4 hexets, IPv4 terminal accepté.

La même résolution d'IP est utilisée pour le handshake Socket.IO
(`server/realtime-server.mjs:333-337`) : sans cela, tous les joueurs tombaient
dans le même compteur de 10 connexions/minute.

### 6.4 Le relâchement « tests uniquement » : trois conditions cumulatives

```js
// server/rate-limiter.mjs:40-51
const TEST_ONLY_RELAXATION = process.env.NODE_ENV === 'test'
  && process.env.ALLOW_DEBUG_CODES === 'true'
  && process.env.ZOYD_DISABLE_SUPABASE === 'true';
```

Les trois conditions sont **cumulatives** :

1. `NODE_ENV === 'test'` — la production tourne en `NODE_ENV=production`
   (`render.yaml:9-10`), donc la branche est inatteignable chez nous.
2. `ALLOW_DEBUG_CODES === 'true'` — posée uniquement par le harness E2E.
3. `ZOYD_DISABLE_SUPABASE === 'true'` — **seule condition qui compte vraiment** :
   un service connecté à une base réelle ne peut pas se mettre en mode détendu,
   même si les deux premières se retrouvaient posées par mégarde.

> *« Sans cela, une seule variable erronée neutralise TOUS les garde-fous
> anti-bruteforce — auth, retraits, signalements — sans le moindre signal dans
> les logs. »* (`server/rate-limiter.mjs:44-47`)

Si les deux premières conditions sont réunies mais pas la troisième, le refus
est **journalisé explicitement** (`server/rate-limiter.mjs:53-58`).

Le mode détendu met `max = ZOYD_RATE_LIMIT_MAX` (100 000 par défaut) et
`windowMs = 1` (`server/rate-limiter.mjs:60-65`) : la fenêtre expirant en
1 ms, la limite est de fait inopérante.

Le comportement est verrouillé par un test dédié
(`server/rate-limiter-guard.test.mjs`) : le mode détendu s'active en E2E
(`server/rate-limiter-guard.test.mjs:52-61`), est **refusé** si une base réelle
est configurée (`server/rate-limiter-guard.test.mjs:63-73`), et la protection
reste active en production (`server/rate-limiter-guard.test.mjs:75-83`) et même
si `NODE_ENV` est posé par erreur (`server/rate-limiter-guard.test.mjs:85-96`).

**Historique :** le rapport d'audit `docs/audit/01-securite.md:94-108` signalait
que **deux** conditions suffisaient, et proposait d'exiger en plus l'absence de
base réelle. C'est fait : la troisième condition existe aujourd'hui
(`server/rate-limiter.mjs:42-51`). Le rapport d'audit est un instantané ;
`docs/00-INDEX.md:89-93` prévient que plusieurs de ses constats ont été
réfutés.

---

## 7. L'OCC (optimistic concurrency control) : `app_users.revision`

### 7.1 Le problème

Le verrou de `server/mutex.mjs` est un verrou de **processus** : il sérialise
les mutations dans **une** instance, et rien entre deux
(`server/mutex.mjs:1-15`, `server/persistence.mjs:396-400`). Pendant un
déploiement, Render fait coexister l'ancienne et la nouvelle instance.

### 7.2 Le mécanisme

| Élément | Détail | Source |
|---|---|---|
| **Colonne** | `app_users.revision` (BIGINT, compteur) | `server/persistence.mjs:492-497` |
| **Écriture conditionnelle** | `.eq('revision', revisionObservee)` + `revision: revisionObservee + 1` | `server/persistence.mjs:495`, `497` |
| **Détection de conflit** | zéro ligne mise à jour = conflit (PostgREST signale un conflit par un succès) | `server/persistence.mjs:485-506` |
| **Point d'entrée unique** | `ecrireUserRow` — **aucun** `sbUpsert('app_users', …)` ailleurs | `server/persistence.mjs:508-570` |
| **Rejeu** | jusqu'à 4 tentatives, sur l'état frais relu | `server/persistence.mjs:419`, `556-568` |
| **Base de calcul** | le payload est **relu en base** avant calcul, pas la copie mémoire | `server/persistence.mjs:1619-1635` |
| **Ligne disparue** | refusée, jamais recréée par un upsert | `server/persistence.mjs:537-551` |

Le point important — relire la base, pas la mémoire — est explicite
(`server/persistence.mjs:1603-1618`) :

> *« L'OCC compare une révision lue avant l'écriture. Il ferme donc la FENÊTRE
> — deux écritures qui se chevauchent. Il ne fermait pas la PEREMPTION : si
> l'instance A ecrit, puis l'instance B démarre, B lit une révision à jour et
> calcule pourtant depuis SA copie mémoire, antérieure à A. Aucune conflit
> n'est détectable — il n'y en a pas — et le CAS passe. »*

Le scénario d'argent est donné dans le même commentaire
(`server/persistence.mjs:1611-1614`) : `trackWithdrawalKey` n'écrit qu'en
mémoire ; si B écrase le payload de A, la clé d'idempotence **et** le débit de
A disparaissent, et un rejeu du même retrait déclenche un **second versement**.

### 7.3 L'invariant qui rend la chose tenable

Conditionner un seul chemin sur cinq donnerait une protection réelle pour un
seul d'entre eux, **avec l'apparence de couvrir les autres** — pire que le
risque assumé, parce qu'on cesse alors de chercher
(`server/persistence.mjs:407-416`).

D'où un test d'invariant, pas un test de conflit
(`server/occ-revision-invariant.test.mjs:8-26`) : le test vérifie qu'il n'existe
**aucun** `sbUpsert('app_users', …)` hors de `ecrireUserRow`
(`server/occ-revision-invariant.test.mjs:29-46`). C'est une propriété de la
structure, pas une discipline de relecture.

### 7.4 Le scénario multi-instance **perdu**

L'OCC ne couvre **que** `app_users`. Voici où le protection s'arrête :

- **Les collections d'état n'ont pas de colonne de révision.**
  `state_snapshots` (matchs, tournois, ligues) a pour schéma
  `kind / entity_id / payload / updated_at` — **aucune colonne `revision`**
  (`supabase/schema.sql:170-176`) — et s'écrit par `sbUpsert` direct
  (`server/persistence.mjs:3592`, `3475`). **L'OCC ne s'y applique pas** :
  deux instances qui modifient le même match s'écrasent toujours.
- **La colonne `revision` n'est pas dans `schema.sql`.** Le `CREATE TABLE
  app_users` (`supabase/schema.sql:7-18`) ne la contient pas, et il n'existe
  **aucun** `ALTER TABLE app_users ADD COLUMN revision` dans le fichier de
  migration — les seuls `ADD COLUMN` du schéma concernent `auth_sessions` et
  `user_reports` (`supabase/schema.sql:54-55`, `402-406`). Le DDL attendu
  n'apparaît que dans un message de log
  (`server/persistence.mjs:447`). Une base créée depuis `schema.sql` n'a donc
  **pas** la colonne.
- **La dégradation n'est pas visible dans `/api/health`.**
  `getHealthInfo` (`server/persistence.mjs:985-1038`) expose `stateTrusted`,
  `integrity`, `loginLockoutPersisted`, `sanctionsPersisted`… mais **pas**
  `revisionSupporte`. Le seul signal est un `log.warn`
  (`server/persistence.mjs:444-449`).
- **Si la colonne est absente**, le serveur retombe sur l'écriture
  **inconditionnelle** d'avant (`server/persistence.mjs:526-534`) : refuser les
  mutations serait pire que la fenêtre laissée ouverte, mais la fenêtre est
  alors ouverte.

---

## 8. Le `single-process-guard` : pourquoi le serveur refuse de démarrer

### 8.1 Le scénario chiffré

`server/single-process-guard.mjs:14-21` (et le commentaire jumelé dans
`supabase/schema.sql:61-72`) :

```
instance A : lit solde 1 000, retire 800  -> ecrit solde 200
instance B : lit solde 1 000, credite 500 -> ecrit solde 1 500
resultat   : solde 1 500. Les 800 de A ont disparu.
```

Aucun verrou ne l'empêche : ils sont dans deux espaces mémoire différents.
**800 ZC perdus, silencieusement.**

### 8.2 Pourquoi `/api/health` resterait vert

`server/single-process-guard.mjs:20-21` :

> *« Et rien ne le remarque : `/api/health` reste vert, parce que chaque instance
> est individuellement cohérente. »*

Concrètement, `/api/health` (`server/routes/public.mjs:60-71`) renvoie 200 si
`health.stateTrusted` est vrai, et `getHealthInfo`
(`server/persistence.mjs:985-1038`) ne contient **aucun** indicateur
« nombre de processus ». Le contrôle d'intégrité compares la mémoire à la base
(`server/persistence.mjs:1040-1049`) : avec deux instances, chacune est
cohérente **avec elle-même**, l'écart entre elles n'est pas mesuré.

### 8.3 Ce que le garde fait, et ce qu'il ne peut pas faire

| Situation | Comportement | Source |
|---|---|---|
| `WEB_CONCURRENCY > 1` | **Refus de démarrer** (throw) | `server/single-process-guard.mjs:110-121` |
| Worker de cluster (`cluster.isPrimary === false`) | **Refus de démarrer** | `server/single-process-guard.mjs:67-68`, `81` |
| `WEB_CONCURRENCY` illisible | Démarre **avec un avertissement explicite** | `server/single-process-guard.mjs:123-133` |
| Deux commandes de démarrage indépendantes | **Non détecté** | `server/single-process-guard.mjs:44-49` |

L'appel est fait **avant tout chargement d'état**
(`server/realtime-server.mjs:598`, dans `start()`), parce que charger puis
refuser laisserait des mutations en cours sur un état non piloté.

Le refus est limité aux cas **certains** : une valeur illisible ne prouve
rien, et « je ne sais pas » ne doit pas être confondu avec « je sais que c'est
bon » (`server/single-process-guard.mjs:74-76`, `97-102`).

Côté déploiement, `render.yaml:19-20` pose `WEB_CONCURRENCY=1` **explicitement**,
et le commentaire explique pourquoi (`render.yaml:11-18`) : auparavant, la
garantie ne tenait que par l'**absence** de `cluster` dans la commande de
démarrage — un concours de circonstances, pas une configuration.

---

## 9. Les sessions

### 9.1 Création, stockage, durée de vie

| Élément | Valeur | Source |
|---|---|---|
| Token | 32 octets aléatoires, hex (64 caractères) | `server/persistence.mjs:2882` |
| Stockage | **empreinte SHA-256** en mémoire et en base | `server/persistence.mjs:2815-2816`, `2890-2903` |
| Cookie | `zoyd_auth`, `HttpOnly`, `Secure` en prod, `SameSite=None` en prod | `server/http-utils.mjs:47-56` |
| TTL glissant | 6 h | `server/persistence.mjs:2821` |
| **Plafond absolu** | **30 jours**, calculé une fois et **hérité** par chaque rotation | `server/persistence.mjs:2840`, `2899-2900`, `3066` |
| Lecture du token | cookie `zoyd_auth` d'abord, sinon `Authorization: Bearer` | `server/http-utils.mjs:212-229` |

Un dump de la table `auth_sessions` ne donne **aucun** jeton utilisable :
seules des empreintes y sont (`server/persistence.mjs:2890-2892`). C'est
vérifié par `server/session-rotation.test.mjs:78-100`.

Le plafond absolu de 30 jours existe parce que le TTL de 6 h est glissant : un
jeton volé utilisé en continu obtenait une session renouvelée indéfiniment
(`server/persistence.mjs:2823-2838`). Il est persisté
(`absolute_expires_at`) pour survivre au redémarrage — mais la colonne est
optionnelle, et le serveur **le dit** s'il ne peut pas la poser
(`server/persistence.mjs:2842-2873`).

### 9.2 La rotation

| Paramètre | Valeur | Source |
|---|---|---|
| Déclenchement | session âgée de plus de **30 min** | `server/persistence.mjs:2948`, `3035-3045` |
| Fenêtre de grâce | **10 min** (l'ancien token reste valable) | `server/persistence.mjs:2945` |
| Anti-tempête | `rotationEmittedAt` : deux requêtes parallèles ⇒ **une** rotation | `server/persistence.mjs:3038-3040` |
| Livraison | `Set-Cookie` dans la réponse en cours | `server/http-utils.mjs:100-108` |
| Filiation | `supersedes` (mère → fils), persistée si les colonnes existent | `server/persistence.mjs:3086`, `3090-3094` |

Le `Set-Cookie` est posé **une seule fois par requête** et avant `writeHead`
(`server/http-utils.mjs:98-108`) : la rotation est asynchrone, elle se termine
souvent après l'écriture de la réponse.

Si la session mère a été supprimée pendant la rotation, le successeur est
**annulé** (`server/persistence.mjs:3070-3078`) — sinon une rotation en vol
recréait une session valide de 6 h après un logout.

### 9.3 La suppression et la filiation

`deleteAuthSession` ne supprime pas seulement le token présenté : il remonte la
chaîne `supersedes` et supprime aussi le successeur direct
(`server/persistence.mjs:3119-3151`). Le raison est donnée
(`server/persistence.mjs:3123-3134`) : présenter le jeton **fils** (le cas
normal après rotation) ne supprimait que le fils ; la mère demeurait valable
et **un cookie volé survivait au logout de la victime**.

### 9.4 La révocation de toutes les sessions au changement de mot de passe

`POST /api/auth/change-password` :

```js
// server/routes/auth.mjs:527-532
const newHash = await hashPassword(newPassword);
await updatePasswordHash(session.user.id, newHash);
revokeAuthSessionsForUser(session.user.id);   // toutes les sessions
deleteRealtimeSessionsForUser(session.user.id);
res.setHeader('Set-Cookie', serializeAuthCookie('', 0));
```

Le commentaire de `server/routes/auth.mjs:529` est explicite : *« B9 : révoque
TOUTES les sessions (une session attaquant ne doit pas survivre). »*

`revokeAuthSessionsForUser` (`server/persistence.mjs:2598-2613`) supprime
toutes les sessions de l'utilisateur, **filles comprises** (une rotation crée
une ligne distincte pour la même personne), et efface le `pendingToken` pour
qu'une rotation en vol ne puisse pas republier un successeur.

Le même mécanisme est appliqué à la réinitialisation par code
(`server/persistence.mjs:2589-2590`).

### 9.5 `skipRotation` au logout

```js
// server/routes/auth.mjs:477-484
// skipRotation: sans ça, getAuthSession déclenche une rotation
// fire-and-forget qui INSÈRE le nouveau token en mémoire de façon
// synchrone AVANT que la route ne supprime l'ancien => une session
// serveur valide de 6h survivait au logout (poste partagé).
const session = token ? getAuthSession(token, { skipRotation: true }) : null;
if (token) { deleteAuthSession(token); }
```

C'est un point de course réel : la rotation est asynchrone, mais elle **insère**
le nouveau token de façon synchrone. Sans `skipRotation`, le logout créait une
session valide de 6 h juste après avoir supprimé l'ancienne.

Le logout supprime aussi les sessions realtime du joueur
(`server/routes/auth.mjs:485-487`) et efface le cookie
(`server/routes/auth.mjs:490`).

`skipRotation` a un second usage : la vérification TOTP ne doit pas émettre de
`Set-Cookie`, sinon le cookie de la 2FA serait écrasé par celui de la session
mère (`server/persistence.mjs:2990-2993`).

### 9.6 La session est détruite par une sanction

`getAuthSession` supprime la session si le joueur fait l'objet d'une sanction
bloquante (`server/persistence.mjs:3019-3022`) : sans ce contrôle, un bannissement
ne prendrait effet qu'à la prochaine connexion, alors que les sessions durent
des heures. Même règle pour les sockets realtime
(`server/persistence.mjs:3195-3204`).

Le rôle realtime est **relu** à chaque lecture, pas figé à la création de la
session (`server/persistence.mjs:3205-3221`) : un admin rétrogradé garde
`role === 'admin'` sur ses sockets pendant toute la durée de vie de la session
(6 h) sinon.

---

## 10. Les mots de passe

### 10.1 La politique de robustesse

```js
// server/persistence.mjs:2528-2533
const isStrongPassword = (password) =>
  typeof password === 'string' &&
  password.length >= 8 &&
  /[A-Z]/.test(password) &&
  /[0-9]/.test(password) &&
  /[^A-Za-z0-9]/.test(password);
```

Soit : **≥ 8 caractères, une majuscule, un chiffre, un caractère spécial**.
Refus → `WEAK_PASSWORD` → **400** (`server/persistence.mjs:2535-2542`,
`server/http-utils.mjs:348-349`).

La politique est appliquée à **trois** endroits :

| Contexte | Ligne |
|---|---|
| Inscription | `server/persistence.mjs:1283` (dans `insertUser`) |
| Changement de mot de passe | `server/routes/auth.mjs:513` |
| Réinitialisation par code | `server/persistence.mjs:2584` |

### 10.2 Le stockage

| Élément | Détail | Source |
|---|---|---|
| Dérivation | `scrypt`, 64 octets | `server/persistence.mjs:239-245` |
| Sel | 16 octets aléatoires par compte | `server/persistence.mjs:240` |
| Format stocké | `salt:digest` en hex | `server/persistence.mjs:244` |
| Vérification | `crypto.timingSafeEqual`, avec contrôle de longueur | `server/persistence.mjs:271-279` |

**Limite assumée et documentée** (`server/persistence.mjs:241-242`) : le sel est
passé comme **chaîne hex** (UTF-8), pas comme `Buffer`. Cela réduit
l'entropie effective du sel. Le commentaire le dit : *« This reduces effective
entropy but is consistent between hash and verify. »* C'est un choix de
cohérence, pas un oubli.

### 10.3 Le changement d'email exige le mot de passe actuel

`server/routes/auth.mjs:410-434`. L'email est **l'identifiant** du compte : le
changer sans prouver son mot de passe permettrait à une session volée de prendre
la main définitivement. Le garde est explicite
(`server/routes/auth.mjs:404-409`).

### 10.4 Le verrouillage de compte

| Élément | Valeur | Source |
|---|---|---|
| Tentatives avant blocage | 5 | `server/persistence.mjs:2145` |
| Durée du blocage | 15 min | `server/persistence.mjs:2151` |
| Persistance | table `login_attempts`, clé = SHA-256 de l'identifiant | `server/persistence.mjs:2171-2172`, `2236-2240` |
| Clé de verrouillage | l'**identité résolue** (userId), pas la chaîne saisie | `server/persistence.mjs:2072-2085` |
| Sonde d'existence de la table | exposée dans `/api/health` | `server/persistence.mjs:2189-2213`, `1010` |

La clé de verrouillage est l'identité résolue, et non la chaîne saisie, parce
que `normalizePseudoKey` ne conserve que la casse et les espaces : quatre
façons d'écrire le même téléphone donnaient quatre clés, et le compteur
d'échecs repartait de zéro à chaque variation de format
(`server/persistence.mjs:2072-2084`).

L'identifiant n'est **jamais** stocké en clair dans `login_attempts` : la table
ne doit pas devenir un annuaire des pseudos et emails essayés en force
(`server/persistence.mjs:2161-2164`, `supabase/schema.sql:96-98`).

### 10.5 Le coût constant à la connexion

Un compte inexistant doit répondre **aussi lentement** qu'un compte existant.
Sinon la page de connexion devient un oracle d'énumération
(`server/persistence.mjs:2087-2100`) :

```js
// server/persistence.mjs:2101-2105
const compteExiste = Boolean(hash);
const [userId, passwordHash] = hash || [null, DUMMY_PASSWORD_HASH];
const motDePasseValide = await verifyPassword(password, passwordHash);
const attempt = await readLoginAttempt(compteExiste ? userId : DUMMY_LOGIN_KEY);
```

Le travail est payé **avant** de décider. L'empreinte factice est générée au
chargement du module (`server/persistence.mjs:2147-2150`).

---

## 11. L'anti-énumération

### 11.1 `/api/auth/forgot-password` : réponse identique

La route répond **toujours** 200 avec le même message, que le compte existe ou
non (`server/routes/auth.mjs:244-289`) :

```js
// server/routes/auth.mjs:278-284
respondJson(res, 200, {
  ok: true,
  found: true,   // conservé pour compatibilité, mais toujours à `true`
  message: 'Si un compte est associe a cet identifiant, un code vient d etre envoye. Verifie ta boite de reception.',
  ...(ALLOW_DEBUG_CODES && result.found && { resetCode: result.code }),
});
```

Le commentair explique pourquoi c'est **différent** de l'inscription
(`server/routes/auth.mjs:263-277`) :

> *« La reponse disait `found: false` ET un message different. C'etait un oracle
> d enumeration gratuit : il suffisait de soumettre un email pour savoir s il
> etait inscrit. Ici, contrairement a l inscription, rien n excuse de repondre :
> during l inscription, le joueur doit savoir quel champ est deja pris. Pour
> une reinitialisation, l attaquant n a aucun besoin legitime de le savoir, et
> l inscription d un compte inexistant ne peut pas « echouer » puisque rien n
> est cree a ce stade. »*

Le détail de l'envoi n'est pas non plus divulgué : répondre « le code a été
envoyé » quand rien n'a été envoyé guiderait l'attaquant vers les providers et
transporterait l'information par un canal secondaire
(`server/routes/auth.mjs:275-277`).

### 11.2 `/api/auth/reset-password` : erreur générique

`server/persistence.mjs:2570` : *« Code invalide ou expire. Demande un nouveau
code. »* — le même message pour compte inconnu, code faux et code expiré
(`server/persistence.mjs:2560-2584`). Cinq tentatives, puis le code est détruit
(`server/persistence.mjs:2578`).

### 11.3 L'inscription fait **contrairement** à tout, et c'est assumé

`server/routes/auth.mjs:59-62` renvoie `DUPLICATE_EMAIL`, et `insertUser`
lève `DUPLICATE_PSEUDO` / `DUPLICATE_EMAIL` / `DUPLICATE_PHONE`. C'est un choix
produit explicite : un joueur doit savoir quel champ est déjà pris
(`server/routes/auth.mjs:269-273`).

### 11.4 Le rate limiter est le contrepoids

L'énumération par `/api/auth/forgot-password` est bornée par le groupe `auth`
(50 / 15 min, `server/rate-limiter.mjs:12`), par IP.

---

## 12. Le proxy `/api/codm/*` : un risque réel, refermé

Les routes `/api/codm/store` (`server/routes/public.mjs:90`) et
`/api/codm/player/:id` (`server/routes/public.mjs:201`) relayent des appels
vers l'API Codashop.

**Le risque** (`server/routes/public.mjs:84-89`) :

> *« Session obligatoire : ces endpoints ne contiennent aucun secret, mais sans
> garde le serveur devenait un proxy Codashop gratuit pour tout Internet, sur le
> quota du forfait Render gratuit. L'usage metier est de rattacher le compte
> CODM d'un JOUEUR a son profil : un compte suffit. »*

La garde est présente sur les deux routes :
`server/routes/public.mjs:91-94` et `server/routes/public.mjs:204-207` — session
obligatoire (401 `AUTH_REQUIRED`) **puis** rate limiter `default`.

Le même raisonnement s'applique à `/api/codm/player/:id` : vérifier un UID CODM
est un acte de compte, pas une API publique (`server/routes/public.mjs:202-203`).

**Ce que la garde ne fait pas** : n'importe quel joueur authentifié peut
encore utiliser le serveur comme proxy, à 60 requêtes/minute par IP
(groupe `default`). Il n'y a pas de quota par compte, et l'IP du serveur
(ZOYD) est celle qui est exposée vis-à-vis de Codashop.

---

## 13. Les en-têtes : CSP, et pourquoi `X-XSS-Protection` a été retiré

### 13.1 La CSP — posée par Vercel, sur les documents

La CSP est dans `vercel.json:32`, appliquée sur `/(.*)` (`vercel.json:24-34`).
C'est le document HTML qui la reçoit — pas les réponses JSON de l'API.

| Directive | Valeur | Ce qu'elle dit |
|---|---|---|
| `default-src` | `'self'` | tout est refusé par défaut |
| `script-src` | `'self'` + `cdn.fedapay.com` | **pas** de `unsafe-inline`, **pas** de `unsafe-eval` |
| `style-src` | `'self'` `'unsafe-inline'` + `fonts.googleapis.com` + `cdn.fedapay.com` | `unsafe-inline` assumé, pour le `<style>` inline de `index.html` |
| `img-src` | `'self'` `data:` `blob:` `cdn.fedapay.com` | pas de `https:` générique |
| `connect-src` | `'self'` `wss://zoyd.onrender.com` `https://zoyd.onrender.com` + FedaPay + `fonts.googleapis.com` | seuls l'API et FedaPay sont joignables |
| `font-src` | `'self'` `data:` `fonts.gstatic.com` + FedaPay | |
| `media-src` | `'self'` `blob:` `data:` + FedaPay | |
| `frame-src` | les 4 endpoints FedaPay | le checkout FedaPay est encapsulé, rien d'autre |
| `frame-ancestors` | `'none'` | défense moderne contre le clickjacking |
| `base-uri` | `'self'` | interdit l'injection de `<base>` |
| `form-action` | `'self'` + les 4 endpoints FedaPay | un formulaire ne peut pas poster ailleurs |

Le `unsafe-inline` de `style-src` est le **seul** `unsafe-*` de la CSP, et il
est justifié côté serveur (`server/http-utils.mjs:129-130`).

### 13.2 Pourquoi `X-XSS-Protection` a été retiré

Le commentaire est dans le code (`server/http-utils.mjs:118-123`) :

> *« PAS de `X-XSS-Protection`. L'en-tete est deprecated et IGNORE par tous les
> navigateurs modernes ; sa variante `1; mode=block` a meme historique ment
> INTRODUIT des failles XSS (CVE-2011-2904) sur les vieux navigateurs qui,
> eux, l'appliquaient encore. Il ne protege rien aujourd'hui et donne une
> fausse impression de couverture : c'est la CSP de vercel.json qui fait le
> travail reel, cote document. »*

L'en-tête est **absent des deux côtés** : ni de `server/http-utils.mjs`, ni de
`vercel.json`. La protection réelle est la CSP (document) + l'échappement par
défaut de React (contenu) + `sanitizeText` (défense en profondeur, § 14).

### 13.3 Les en-têtes de l'API

`server/http-utils.mjs:110-131` :

| En-tête | Valeur | Rôle |
|---|---|---|
| `Access-Control-Allow-Origin` | l'origine **si elle est dans la liste blanche**, sinon `''` | `server/http-utils.mjs:79-82`, `93` |
| `Access-Control-Allow-Credentials` | `true` | indispensable au cookie cross-site |
| `Vary` | `Origin` | empêche le cache de servir une réponse à une autre origine |
| `X-Content-Type-Options` | `nosniff` | |
| `X-Frame-Options` | `DENY` | |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | |
| `Content-Security-Policy` | **absent** | une CSP sur une réponse JSON est inerte (`server/http-utils.mjs:127-131`) |

Côté front, `vercel.json:26-33` ajoute `Permissions-Policy:
camera=(), microphone=(), geolocation=(), payment=()` — non vérifié par le code
de l'API, c'est un en-tête de document.

Le cache est neutralisé sur les pages applicatives et sur `index.html`
(`vercel.json:12-22`) : `no-store, no-cache, must-revalidate`. Les assets
hashés, eux, sont en `immutable` 1 an (`vercel.json:6-11`).

---

## 14. L'encodage : une garde d'intégrité, pas de sécurité

`server/encoding-integrity.test.mjs` ne protège pas d'intrusion. Il protège la
**lisibilité du code**, et donc la survie des invariants.

Le constat qui a donné naissance au test
(`server/encoding-integrity.test.mjs:6-23`) : deux fois pendant la session, un
fichier source a été corrompu de la même manière — relu avec la page de code
ANSI, puis réécrit en UTF-8. Les accents devenaient « Ã¨ » / « Â§ ». Le
fichier passait encore `node --check` **et** les tests, et l'erreur
n'apparaissait qu'au lint.

> *« Pire : le contenu devient illisible pour l'auteur, donc les commentaires
> qui expliquent les invariants cessent d'expliquer quoi que ce soit. Sur ce
> dépôt, les commentaires portent une partie de la charge — plusieurs
> corrections n'ont de sens que parce qu'on lit pourquoi. »*

Le test :

| Cas | Ce qu'il vérifie | Ligne |
|---|---|---|
| Tous les `.mjs`, `.ts`, `.tsx`, `.js`, `.sql` du dépôt | aucune signature de double encodage | `server/encoding-integrity.test.mjs:42-64` |
| Fichiers critiques | `persistence.mjs`, `wallet-engine.mjs`, `routes/wallet.mjs`, `supabase/schema.sql` sont bien en UTF-8 lisible | `server/encoding-integrity.test.mjs:66-83` |
| Le fichier de test lui-même | est **exclu**, parce qu'il contient les signatures qu'il cherche | `server/encoding-integrity.test.mjs:47-53` |

Il ne détecte que le mojibake. Il ne dit rien d'une autre corruption.

### 14.1 `sanitizeText` — une liste noire, pas une garantie

`server/persistence.mjs:77-99` : retire `<svg>`, `<iframe>`, `<object>`,
`<embed>`, `<script>`, `<style>`, toute balise `<…>`, `javascript:`,
`vbscript:`, `data:` (sauf `data:image/`), les attributs `on*=`, puis échappe
`&`, `"`, `'`, et plafonne à 5 000 caractères.

C'est une **défense en profondeur**, pas la protection principale : la
protection principale contre le XSS stocké est l'échappement par défaut de
React, relayé par la CSP.

Limites connues :

- C'est une liste noire : une construction non prévue passe.
- L'ordre des remplacements échappe `&` **en dernier**
  (`server/persistence.mjs:94`), donc un texte déjà échappé (`&amp;`) devient
  `&amp;amp;`. Ce n'est pas une faille, mais c'est une perte de fidélité.
- `on\w+\s*=` (`server/persistence.mjs:93`) retire toute suite
  « mot-clé + = », y compris dans du texte innocent.

---

## 15. MENACES COUVERTES

| Menace | Garde | Où (fichier:ligne) | Preuve |
|---|---|---|---|
| Accès admin sans session | Porte 1 de `requireAdmin2fa` → 401 | `server/admin-totp.mjs:154-157` | `server/admin-totp-guard.test.mjs:89-93` |
| Accès admin avec un rôle non-admin | Porte 2 → 403 `ADMIN_REQUIRED` | `server/admin-totp.mjs:158-164` | `server/admin-totp-guard.test.mjs:95-101` |
| Opération financière sans 2FA | Porte 3 → 403 `2FA_REQUIRED` | `server/admin-totp.mjs:165-169` | `server/admin-totp-guard.test.mjs:103-109` |
| Opération financière avec 2FA expirée | Porte 4 → 403 `2FA_REQUIRED` | `server/admin-totp.mjs:170-173` | `server/admin-totp-guard.test.mjs:111-124` |
| Prise de contrôle d'un compte admin (secret 2FA perdu) | mot de passe admin exigé au setup | `server/routes/admin.mjs:433-445` | `server/admin-totp.test.mjs` |
| Ré-enrôlement 2FA par un attaquant | 409 `2FA_ALREADY_ENABLED` | `server/routes/admin.mjs:451-459` | — |
| Rejeu d'un code TOTP | fenêtre à 0 pas (30 s) | `server/admin-totp.mjs:64` | `server/admin-totp.test.mjs:63-109` |
| Implémentation TOTP non conforme | vecteurs officiels RFC 6238 | `server/admin-totp.mjs:72-100` | `server/admin-totp.test.mjs:21-60` |
| Comparaison de code temporelle | `timingSafeEqual` + type strict | `server/admin-totp.mjs:87`, `96` | `server/admin-totp.test.mjs:115-126` |
| Double réponse HTTP après un garde | contrat « le garde écrit, l'appelant propage » | `server/admin-totp.mjs:155`, `server/routes/wallet.mjs:105-109` | — |
| CSRF par formulaire tiers (`text/plain`) | Content-Type JSON obligatoire → 415 | `server/realtime-server.mjs:243-247` | — |
| CSRF par origine tierce | Origin sur liste blanche → 403 | `server/realtime-server.mjs:235-240` | — |
| Ouverture de socket WS par une page tierce | filtre d'origine sur l'upgrade | `server/realtime-server.mjs:288-296` | — |
| Contournement de l'anti-bruteforce par forge de `X-Forwarded-For` | dernier saut du XFF + pair de confiance | `server/rate-limiter.mjs:167-195` | `server/rate-limiter.test.mjs` |
| Déni de connexion de masse via `/logout` | groupe `auth_logout` séparé | `server/rate-limiter.mjs:13-16`, `server/routes/auth.mjs:461-475` | `server/auth-logout-quota.test.mjs` |
| Neutralisation du rate limit par une variable erronée | 3 conditions cumulatives + refus journalisé | `server/rate-limiter.mjs:40-58` | `server/rate-limiter-guard.test.mjs:63-96` |
| Brute-force par IP | 7 groupes, clés `ip\|groupe` | `server/rate-limiter.mjs:11-22`, `75` | — |
| Brute-force par compte | verrouillage 5 essais / 15 min, persistant | `server/persistence.mjs:2114-2129`, `2151` | `server/login-lockout.test.mjs` |
| Énumération de comptes par chronomètre | scrypt payé même sur compte inexistant | `server/persistence.mjs:2101-2105` | `server/login-timing.test.mjs` |
| Énumération via `/forgot-password` | réponse identique + `found: true` | `server/routes/auth.mjs:278-284` | — |
| Énumération via `/reset-password` | message générique unique | `server/persistence.mjs:2570` | — |
| Vol d'un hash de session par dump de la base | stockage en empreinte SHA-256 | `server/persistence.mjs:2815-2816`, `2890-2892` | `server/session-rotation.test.mjs:78-109` |
| Session volée qui survit à un logout | suppression de toute la filiation | `server/persistence.mjs:3119-3151` | `server/session-rotation.test.mjs:216-231` |
| Session qui survit à un changement de mot de passe | révocation de toutes les sessions | `server/routes/auth.mjs:529-531`, `server/persistence.mjs:2598-2613` | — |
| Session qui survit à un bannissement | session détruite à la lecture | `server/persistence.mjs:3019-3022` | — |
| Rôle admin figé sur un socket après rétrogradation | rôle relu à chaque lecture | `server/persistence.mjs:3205-3221` | `server/realtime-privilege-revocation.test.mjs` |
| Rotation qui ressuscite une session déconnectée | annulation si la mère a disparu | `server/persistence.mjs:3070-3078` | `server/session-rotation.test.mjs:198-214` |
| Double rotation en parallélisme | verrou `rotationEmittedAt` | `server/persistence.mjs:3038-3040` | `server/session-rotation.test.mjs:172-185` |
| Escalade de rôle par mass assignment | listes blanches de champs | `server/routes/auth.mjs:65-77`, `339-343` | `server/security-regressions.test.mjs` |
| Modification de l'email sans le mot de passe | reauthentification exigée | `server/routes/auth.mjs:410-434` | `server/password-conflict.test.mjs` |
| Mot de passe faible | politique + 3 points d'application | `server/persistence.mjs:2528-2542`, `1283` | — |
| Déni de service par corps de requête géant | plafond 1 Mo + coupure du socket | `server/http-utils.mjs:167`, `180-186` | — |
| Écrasement d'une écriture `app_users` concurrente | OCC `revision` + point d'entrée unique | `server/persistence.mjs:492-506`, `508-570` | `server/occ-revision-invariant.test.mjs` |
| Écriture conditionnelle contournée par un 6ᵉ chemin | invariant testé sur la source | `server/occ-revision-invariant.test.mjs:29-46` | idem |
| Argent perdu en multi-processus | refus de démarrer | `server/single-process-guard.mjs:106-121` | `server/single-process-guard.test.mjs` |
| Serveur utilisé comme proxy gratuit vers Codashop | session obligatoire sur `/api/codm/*` | `server/routes/public.mjs:91-94`, `204-207` | — |
| XSS stocké (défense en profondeur) | `sanitizeText` + CSP + React | `server/persistence.mjs:77-99`, `vercel.json:32` | — |
| XSS par un en-tête deprecated | `X-XSS-Protection` retiré, CSP en place | `server/http-utils.mjs:118-123` | — |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` | `vercel.json:28`, `server/http-utils.mjs:117` | — |
| Requête cross-origin lue par un tiers | ACAO vide si origine non listée + `Vary: Origin` | `server/http-utils.mjs:79-82`, `113`, `126` | — |
| Document admin mis en cache | `no-store` sur les routes applicatives | `vercel.json:12-22` | — |
| Code source corrompu (mojibake) | test d'intégrité d'encodage | `server/encoding-integrity.test.mjs:42-83` | idem |
| Secret de debug exposé en production | fail-closed sur `ALLOW_DEBUG_CODES` | `server/http-utils.mjs:73`, `server/routes/auth.mjs:89` | — |
| Jeton de métriques deviné par timing | `timingSafeEqual` | `server/routes/public.mjs:46-56`, `314` | — |

---

## 16. MENACES NON COUVERTES / À SURVEILLER

Cette section n'est pas moins importante que la précédente. Une liste de
menaces « couvertes » qui n'est pas accompagnée d'une liste de menaces
« ouvertes » donne une image fausse du système.

### 16.1 Le code des collections d'état n'est PAS protégé par l'OCC

`state_snapshots` (matchs, tournois, ligues) n'a **pas** de colonne `revision`
(`supabase/schema.sql:170-176`) et s'écrit par `sbUpsert` direct
(`server/persistence.mjs:3592`). L'OCC ne couvre que `app_users`.

→ **Conséquence :** en multi-instance, deux modifications concurrentes du même
match s'écrasent toujours. Le `single-process-guard` est aujourd'hui la seule
barrière réelle sur ce chemin — et c'est une barrière **opérationnelle**
(refus de démarrer), pas une garantie en base.

**À faire :** soit ajouter une colonne `revision` à `state_snapshots` et passer
les écritures par le même point d'entrée, soit assumer explicitement que
l'état multi-instance est interdit et le garantir par un contrôle de
déploiement.

### 16.2 La colonne `revision` n'est pas dans le fichier de migration

`supabase/schema.sql:7-18` ne déclare pas `revision`, et le fichier ne contient
**aucun** `ALTER TABLE app_users ADD COLUMN revision`
(`supabase/schema.sql:54-55`, `402-406` sont les seuls `ADD COLUMN`).

→ **Conséquence :** une base créée depuis `schema.sql` n'a pas la colonne ;
`occSupporte()` renvoie `false` (`server/persistence.mjs:435-451`) et le
serveur repasse en **écriture inconditionnelle** — la fenêtre multi-instance
est ouverte, silencieusement.

**À faire :** ajouter le `ALTER TABLE` à `schema.sql`. C'est trois lignes.

### 16.3 La dégradation de l'OCC n'est pas visible dans `/api/health`

`getHealthInfo` (`server/persistence.mjs:985-1038`) expose `stateTrusted`,
`integrity`, `loginLockoutPersisted`, `sanctionsPersisted`, mais **pas**
l'état de la sonde `revisionSupporte`.

→ **Conséquence :** le seul signal est un `log.warn` au premier usage
(`server/persistence.mjs:444-449`). Un orchestrateur qui surveille `/api/health`
ne voit pas la dégradation.

**À faire :** exposer `occRevisionPersisted: boolean` dans `getHealthInfo`,
comme `loginLockoutPersisted` — le précédent existe déjà
(`server/persistence.mjs:1006-1013`).

### 16.4 L'absence d'`Origin` et l'absence de `Content-Type` ne bloquent rien

CF. § 5.3. Les deux niveaux du CSRF ne bloquent que combinés.

**À surveiller :** l'introduction d'un client non-navigateur qui envoie des
mutations sans `Content-Type`, ou l'élargissement de la liste blanche
`ALLOWED_ORIGINS` à un sous-domaine non maîtrisé.

### 16.5 `TRUST_PROXY=true` est positionné en production

`render.yaml:30-31`. Le danger symétrique est documenté
(`server/rate-limiter.mjs:147-150`) : *« si le service est exposé directement,
n'importe qui forge son XFF. »*

→ **Conséquence :** la garantie « le dernier saut est posé par le proxy »
ne tient que si **tous** les sauts en amont sont honnêtes. Une chaîne
Cloudflare → Render, par exemple, verrait le dernier saut posé par Cloudflare
(bon) mais un intermediate falsifiable. **Non vérifié** : la chaîne de proxys
réellement en place devant Render n'est pas documentée dans le dépôt.

**À faire :** documenter la chaîne de proxys, ou passer à un en-tête de
contexte proprietary (`CF-Connecting-IP`, `True-Client-IP`) si l'hébergeur
frontal le garantit.

### 16.6 Le rate limiter est en mémoire, par IP

- Les buckets sont **en mémoire** (`server/rate-limiter.mjs:7`) : un
  redémarrage les remet à zéro.
- Le plafond mémoire est de 50 000 buckets avec **éviction du plus ancien**
  (`server/rate-limiter.mjs:8`, `80-83`) : un attaquant qui disperse ses
  requêtes sur beaucoup d'IP peut évincer les buckets légitimes.
- Le rate limiter est **par IP, pas par compte** : il ne protège pas un compte
  précis, il protège une IP. Le contrepoids par compte existe (§ 10.4), mais
  il est séparé et plus lent (5 essais).

### 16.7 Le verrouillage de compte est une arme de déni de service

Cinq échecs suffisent à bloquer un compte connu pendant 15 minutes
(`server/persistence.mjs:2123-2125`). Un attaquant qui connaît un pseudo peut
immobiliser la connexion de ce joueur pour 15 minutes, en cinq requêtes.

**À surveiller :** c'est le prix d'un anti-bruteforce par compte. Le rate
limiter par IP limite le débit, mais pas l'impact sur la cible.

### 16.8 Le secret TOTP est stocké en clair

`admin_2fa_secrets.secret` est le secret Base32, en clair
(`server/persistence.mjs:3905`, `supabase/schema.sql:266`). La table est
protégée par RLS « service role only »
(`supabase/schema.sql:290`, `310`), et le serveur utilise la clé
`service_role` qui contourne la RLS (`render.yaml:39-42`).

→ **Conséquence :** un dump de la base donne les secrets TOTP de tous les
admins. La base est donc la cible n° 1, pas le serveur.

### 16.9 L'écriture du secret 2FA peut échouer en silence

`server/routes/admin.mjs:462-466` et `501-505` : l'échec de
`saveAdminTotpSecret` est **journalisé** mais n'interrompt pas la route, qui
répond `ok: true`. Le secret reste en mémoire.

→ **Conséquence :** l'admin croit avoir activé sa 2FA ; après un redémarrage,
`adminTotpSecrets` est vide (`server/realtime-server.mjs:613-616`) et
`requireAdmin2fa` refuse en 403 `2FA_REQUIRED` — l'admin est **verrouillé hors
des routes financières et de modération** (fail-closed, donc pas de faille,
mais un blocage sans issue visible).

Note : `loadAdminTotpSecrets` avale ses erreurs
(`server/persistence.mjs:3920` : `catch { /* table may not exist yet */ }`),
donc une table manquante ne produit **aucun** signal.

**À faire :** exposer l'état de la table `admin_2fa_secrets` dans
`/api/health`, comme `login_attempts`.

### 16.10 Les codes d'activation et de réinitialisation vivent en mémoire

`memoryActivationCodes` (`server/persistence.mjs:2335`) et
`memoryPasswordResetCodes` (`server/persistence.mjs:2523`) sont des `Map` en
RAM. Un redémarrage les invalide. Ce n'est pas une faille (un code perdu oblige
à en demander un nouveau), mais c'est une source de support.

### 16.11 `/api/auth/resend-code` et `/api/auth/activation-email` sont des oracles d'énumération

`resendActivationCode` (`server/persistence.mjs:2431-2439`) lève
`USER_NOT_FOUND` si l'email est inconnu, et `ACCOUNT_ALREADY_ACTIVE` si le
compte est déjà actif. Idem `changeActivationEmail`
(`server/persistence.mjs:2451-2456`). Ces erreurs sont mappées en **404** et
**409** distincts (`server/http-utils.mjs:396`, `398`) et exposées telles
quelles (`server/routes/auth.mjs:201-210`, `228-237`).

→ **Conséquence :** contrairement à `/api/auth/forgot-password` (§ 11.1), ces
deux routes **révèlent** si un email est inscrit. Le seul frein est le rate
limiter `auth` (50 / 15 min par IP).

**À faire :** appliquer la même réponse indistinguable que sur
`forgot-password`.

### 16.12 Le mot de passe n'est pas revérifié avant chaque opération sensible

La 2FA admin est exigée sur les routes financières et de modération
(`server/routes/admin.mjs`, `server/routes/wallet.mjs:108`). Mais un joueur
connecté peut retirer des fonds **sans ressaisir son mot de passe** : la
session suffit (`server/routes/wallet.mjs:137-143`). C'est un choix cohérent
avec le modèle (la session EST lecredential), mais il faut le savoir : la
protection du compte repose entièrement sur le cookie `HttpOnly` + la rotation
+ la révocation.

### 16.13 `sanitizeText` est une liste noire

CF. § 14.1. Ce n'est pas la protection principale, mais ce n'est pas non plus
une garantie.

### 16.14 La CSP ne couvre pas l'API

La CSP est posée par Vercel sur le front. L'API (Render) ne renvoie pas de CSP
sur ses réponses JSON — c'est délibéré, une CSP y est inerte
(`server/http-utils.mjs:127-131`). Si l'API devait un jour servir du HTML,
elle n'aurait **aucune** CSP.

### 16.15 Ce qui n'a **pas** pu être vérifié dans le code

| Sujet | Statut |
|---|---|
| Le canal d'envoi des codes actif en production (Resend / Brevo / SMTP / webhook) | **non vérifié** — l'ordre de précédence est dans `server/code-delivery.mjs`, mais aucune variable d'environnement de production n'est lisible depuis le dépôt |
| La présence effective de la migration `login_attempts` en base | **non vérifiable localement** — l'état est exposé par `/api/health` (`loginLockoutPersisted`), pas par le code |
| La présence effective de la colonne `app_users.revision` en base | **non vérifiable localement** — et pas exposée dans `/api/health` (§ 16.3) |
| La chaîne de proxys devant Render | **non vérifié** (§ 16.5) |
| L'existence d'un `Content-Security-Policy-Report-Only` ou d'un rapport de violation | **non vérifié** — aucun endpoint de reporting dans le dépôt |
| La rotation du secret `service_role` Supabase | **hors périmètre du code** |

---

## 17. Récapitulatif des règles de lecture

1. **Une garde client n'est pas une barrière.** Chercher le garde serveur
   équivalent. S'il n'existe pas, la route est ouverte.
2. **Un garde qui écrit la réponse s'occupe de tout.** Ne jamais re-répondre
   derrière : `ERR_HTTP_HEADERS_SENT`.
3. **Un test qui ne peut pas tomber ne prouve rien.** Neutraliser la garde et
   vérifier que le test échoue — c'est ce qui a fait le tri
   (`docs/00-INDEX.md:112-127`).
4. **Une contre-mesure qui se dégrade doit être visible.** Le rate limiter
   s'est vu confirmer par un test dédié ; l'OCC, lui, se dégrade sans
   signal dans `/api/health` (§ 16.3).
5. **Une liste de menaces couvertes sans liste de menaces ouvertes est un
   rapport de complaisance.** Les deux sections sont ici.
