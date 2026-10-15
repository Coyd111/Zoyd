# Étape 1 — Sécurité & secrets

## Portée

- Les 35 variables d'environnement lues par le serveur : obligatoires ou
  optionnelles, avec ou sans valeur de repli.
- La matrice d'autorisation des 100 routes HTTP.
- Le rate limiting, les cookies de session, CORS et CSRF.
- Le traitement des secrets (codes d'activation, réinitialisation).

## 1. Variables d'environnement — constat principal

Le serveur lit **35 variables**. **19 n'ont aucune valeur de repli** : si elles
manquent, rien ne signale l'erreur — le service démarre et se comporte
mal. C'est le mode de panne le plus dangereux, parce qu'il est silencieux.

Or **25 de ces variables ne sont documentées nulle part** : ni `DEPLOYMENT.md`,
ni `README.md`. Et `render.yaml` n'en déclare que 17 sur 30. Conséquence
directe : un redéploiement chez un autre hébergeur, ou la création d'un
environnement de test, démarre un service incomplet qui ne le signale pas.

### Sans repli — absence = dégradation silencieuse

| Variable | Conséquence si absente |
|----------|------------------------|
| `SUPABASE_URL` | aucun client : **toute persistance perdue**, le serveur tourne en RAM |
| `SUPABASE_SERVICE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | idem |
| `ZOYD_ALLOWED_ORIGINS` | **aucun risque** : les trois origines de production sont écrites en dur dans `http-utils.mjs`, la variable n'est qu'additive |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | notifications push désactivées, sans impact métier |
| `METRICS_TOKEN` | `/metrics` répond 403 — comportement sûr |
| `ALLOW_DEBUG_CODES` | aucun secret en réponse (fail-closed, §4) |
| `ZOYD_ADMIN_PASSWORD` | seed admin impossible au premier démarrage uniquement |
| `RESEND_API_KEY`, `BREVO_API_KEY`, `SMTP_*`, `CODE_DELIVERY_WEBHOOK` | aucun canal d'envoi : **codes d'activation et réinitialisation impossibles à livrer** |
| `FEDAPAY_SECRET_KEY` | dépôts et retraits FedaPay inopérants |
| `ZOYD_DISABLE_SUPABASE`, `ZOYD_BR_START_EARLY_MS`, `NODE_ENV` | usage interne, tests et développement |

### Avec repli en dur

`PORT`, `ZOYD_REALTIME_PORT`, `LOG_LEVEL`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_FROM`, `EMAIL_FROM`, `TRUST_PROXY`, `ZOYD_API_KEY_ROTATION_DAYS`,
`ZOYD_RATE_LIMIT_MAX`, et les quatre `ZOYD_ADMIN_*` (valeurs par défaut
**publiques et visibles dans le dépôt**).

## 2. Matrice d'autorisation — conforme

100 routes analysées. Répartition des gardes :

| Garde | Routes |
|-------|--------|
| session joueur | 68 |
| session temps réel | 6 |
| session (token lu directement) | 5 |
| admin + 2FA | 8 |

### Fenêtre TOTP : de 90 s à 30 s

Le code 2FA n'est accepté que pendant SON pas de 30 s, au lieu de la
fenêtre ±1 pas (90 s) d'avant. Un code ne peut donc plus être rejoué
pendant une minute après son expiration.

Le prix, assumé : un téléphone dont l'horloge dérive de plus d'une
quinzaine de secondes verra son code refusé alors qu’il est affiché.
Pour que ce risque ne devienne pas un blocage, interface affiche le temps
restant, calculé sur **l'horloge du serveur** — celle qui valide. L'admin
voit « il expire dans 4 s — attends le code suivant » au lieu de
resoumettre un code périmé en croyant à une panne.

Le réglage est une constante unique, `TOTP_WINDOW_STEPS` dans
`server/admin-totp.mjs`. Passer à `1` rétablit les 90 s si un appareil
dérive trop.

Vérifié par les vecteurs officiels RFC 6238, plus deux tests qui prouvent
le basculement net : à la seconde 29 d'un pas le code passe encore, à la
seconde 30 il ne passe plus.
| admin | 4 |
| jeton métriques | 1 |
| **aucune — public par nature** | **8** |

Les 8 routes publiques sont : `register`, `login`, `activate`, `resend-code`,
`activation-email`, `forgot-password`, `/api/health`, `/api/leaderboard`.

Les six premières ne peuvent pas exiger une session — ce sont précisément les
routes qui permettent d'en obtenir une. Les deux dernières sont des lectures
publiques volontaires.

**Point de méthode important** : une première analyse en conclut à tort que
`change-password`, `logout` et `DELETE /api/auth/me` sont non protégées. Elles
lisent le token puis la session directement (`readBearerToken` +
`getAuthSession`), parce qu'elles doivent aussi fonctionner en l'absence de
session. L'outil a été corrigé pour reconnaître ce motif. Un audit qui se
fie à une seule signature se trompe — d'où la relecture route par route des
cas « aucune garde ».

## 3. Rate limiting

`server/rate-limiter.mjs`. Le plafonds par défaut s'assouplit
**uniquement** si `NODE_ENV === 'test'` **et** `ALLOW_DEBUG_CODES === 'true'`,
auquel cas `windowMs` passe à 1 ms et le plafond à `ZOYD_RATE_LIMIT_MAX`.

**Réserve (faible).** Ces deux variables suffisent à neutraliser toute la
protection. `NODE_ENV=test` est une valeur courante en développement et sur
certains hébergeurs ; si elle fuite en production, le rate limiting disparaît
sans le moindre signal — les garde-fous anti-bruteforce de l'authentification
comme ceux des retraits deviennent inopérants.

*Action proposée* : en plus des deux conditions, exiger que le service ne
démarre pas en mode détendu si `SUPABASE_URL` est défini (autrement dit, un
environnement réel qui se croit en test).

## 4. Secrets en réponse

`ALLOW_DEBUG_CODES` est en **fermeture par défaut** : les tokens et codes ne
sortent en réponse que si la variable vaut exactement la chaîne `true`.
`NODE_ENV` absent est traité comme production. C'est le bon sens.

## 5. CSRF et cookies — conforme

Le cookie de session est `SameSite=None` (cross-site obligatoire entre Vercel
et Render). Sans défense supplémentaire, une page tierce pourrait POSTer
`/api/wallet/withdraw` en `mode:'no-cors'` avec
`Content-Type: text/plain` — une *simple request*, sans préflight — en
profitant du cookie envoyé automatiquement.

`handleRequest` applique deux gardes sur `POST`, `PATCH`, `PUT`, `DELETE` :
origine sur la liste blanche, et `Content-Type: application/json` obligatoire.
La seconde suffit à bloquer l'attaque « simple request ». Le garde origine
laisse passer l'absence d'en-tête `Origin`, ce qui reste acceptable : un
navigateur envoie `Origin` sur toute requête cross-site mutante, et un
appelant sans navigateur n'a pas besoin du CSRF.

## 6. Comparaison du jeton `/metrics` — constat mineur

`server/routes/public.mjs` compare le jeton avec `!==`. La comparaison
s'arrête au premier octet différent, ce qui rend le temps de réponse
dépendant du nombre de caractères corrects.

L'exploitation réelle est peu probable : il faut mesurer la durée de hundreds
de requêtes à travers un réseau, sur un jeton de 256 bits. La correction
coûte trois lignes (`crypto.timingSafeEqual`) et supprime la classe de
problème.

## 7. Canaux d'envoi des codes — à documenter

Quatre canaux coexistent dans `code-delivery.mjs`, essayés dans l'ordre :
Resend, Brevo, SMTP, puis webhook. C'est une bonne défense contre la
panne d'un fournisseur, mais la precedence n'est écrite nulle part, et rien
ne dit lequel est actif en production. Un opérateur qui change `RESEND_API_KEY`
peut croire à tort que le canal a changé alors que le repli SMTP prend le
relais.

## 8. Code mort signalé

`lockFunds` / `unlockFunds` dans `src/app/stores/walletStore.ts` ne sont
appelées que par les tests. Elles portent un TODO d'UI optimiste sur des
fonds, qui attendait le `wallet:update` désormais émis par le serveur. Le
mécanisme existe ; le code, lui, est orphaned.