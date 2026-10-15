# Lecture exhaustive — constats

Lecture de l'intégralité du code (58 400 lignes : serveur, client, tests) faite
en parallèle par zone, puis **revérifiée à la main** avant d'être rapportée.

Une partie de ce qui suit vient des lecteurs automatiques et **n'a pas été
revérifiée** : c'est signalé explicitement. Un constat non revérifié n'est pas
un constat.

---

## CONFIRMÉS — revérifiés dans le code

### 1. Battle Royale : aucun verrou sur les actions de salon → double versement

**Gravité : haute. Confirmé.**

`server/routes/br.mjs:9` importe `withMatchMutex` et `withWalletMutex`.
**C'est la seule occurrence du fichier** : les deux sont importés, jamais
utilisés. Aucun mutex n'y est importé.

Le bloc `br.mjs:126-186` fait un read-modify-write sur toute la collection
`brLobbies` pour `join / leave / checkin / start / eliminate / finish`.

Le garde de `settleBrLobbyOnServer` (`br-engine.mjs:696`) teste
`status === 'finished' || 'settling'`, mais **sur le clone construit à partir du
même instantané**. Deux appels simultanés passent tous les deux le garde, et
exécutent tous deux la boucle de versement.

Au second passage, `releaseWalletWinnings` ne trouve plus la réservation
(`lockedEntries[lobby.id]` supprimée) et retombe sur `cashCredit = safeAmount`
(`wallet-engine.mjs:302-311`), sans re-décrémenter `lockedBalance`
(`Math.max(0, …)`).

**Conséquence : chaque gagnant est crédité deux fois de sa part, l'arbitre deux
fois de sa commission. ZC créés à partir de rien.** Et aucun invariant de
`verifyDataIntegrity` ne hurle : le contrôle vérifie
`lockedBalance == Σ lockedEntries`, pas le ledger. Le double crédit passe
invisible.

Le rate limiter `admin` (20 req / 5 min) laisse passer un double-clic.

**Variante, même cause :** deux `join` simultanés de joueurs différents. Les
deux lisent le même roster, `lockEntryFee` crédite les deux, puis
`replaceStateCollection` n'en conserve qu'un. Le joueur évincé **a payé son
pass et n'existe plus dans le salon**. Sa réservation ne sera ni remboursée ni
consommée : **100 % perdus pour lui**.

### 2. Battle Royale : le statut `settling` n'est jamais persisté avant les versements

**Gravité : haute. Confirmé.**

`status = 'settling'` et `player.settled = true` ne sont écrits que dans le
clone. Ils ne sont persistés qu'à `br.mjs:170`, **après** toute la boucle de
versement.

Les trois boucles de versement n'ont **aucun `try/catch`**. Si
`releaseWalletWinnings` lève (`USER_NOT_FOUND` sur un compte supprimé, ou
`SERVER_BUSY` — `persistence.mjs:1368` lève après rollback mémoire quand
l'écriture Supabase échoue), l'exception remonte et `saveBrLobbies` n'est
jamais appelé.

Résultat : les 3 premiers joueurs sont payés, le salon reste `'live'` en base
avec `settled = false`. L'arbitre relance → **ils sont payés une seconde fois**.
Le garde `'settling'` ne protège de rien puisqu'il n'est jamais persisté.

### 3. Tournois : la boucle des arbitres n'a pas de `try/catch`, celle des capitaines si

**Gravité : haute. Confirmé.**

`tournament-engine.mjs` — asymétrie vérifiée ligne à ligne :

- boucle des **capitaines** (`:5-32`) : `try { … } catch (err) { log.error(…) }`
- boucle des **arbitres** (`:34-45`) : **aucun `try`/`catch`**

Scénario :
1. Le dernier résultat fait basculer le tournoi en `completed`.
2. Les capitaines 1/2/3 sont payés.
3. `releaseWalletWinnings` d'un arbitre échoue (compte arbitre supprimé →
   `USER_NOT_FOUND`).
4. L'exception remonte. La route répond en erreur **sans `saveTournaments`**.
5. L'argent des capitaines est crédité, mais l'état du tournoi n'est pas
   persisté.
6. L'arbitre resoumet : `wasCompleted = false` → `applyTournamentSettlement`
   **rejoue**. Capitaines payés une seconde fois.

**Le chemin d'échec est rare. La conséquence est un double gain.**

### 4. Verrouillage de connexion contournable par le format du téléphone

**Gravité : haute. Confirmé et démontré.**

`persistence.mjs:1542-1545` :

```js
const pk  = normalizePseudoKey(trimmed);   // trim + minuscule, ponctuation CONSERVÉE
const ek  = normalizeEmailKey(trimmed);
const phk = normalizePhoneKey(trimmed);    // chiffres uniquement
const lookupKey = pk || ek || phk;         // pk est TOUJOURS vrai si l'identifiant est non vide
```

`lookupKey` alimente le verrouillage (`:1548`, `:1564`), tandis que la résolution
du compte utilise les trois clés (`:1553`). Comme `pk` conserve la ponctuation,
**la clé de verrouillage est le pseudo normalisé, pas l'identifiant
effectivement résolu.**

Vérifié :

```
+2290165240654         pk=+2290165240654         phk=2290165240654
+229 01 65 24 06 54    pk=+229 01 65 24 06 54    phk=2290165240654
2290165240654          pk=2290165240654          phk=2290165240654
+229-01-65-24-06-54    pk=+229-01-65-24-06-54    phk=2290165240654
```

Quatre formats du **même** téléphone → quatre clés de verrouillage
différentes, un seul compte. Le compteur d'échecs repart de zéro à chaque
variation de format. Le verrou de 5 tentatives / 15 min **ne freine plus rien** ;
il ne reste que le plafond de 50 / 15 min par IP, contournable par distribution
d'IP.

### 5. La durée de vie des sessions n'a pas de plafond absolu

**Gravité : haute. Confirmé.**

`createTokenRecord` (`persistence.mjs:2159-2163`) fixe
`expiresAt = now + 6 h` **inconditionnellement**. `rotateAuthSession` (`:2321`)
appelle `createTokenRecord` → **chaque rotation, toutes les 30 min, repart de
+6 h**.

Un token volé utilisé en continu obtient une session renouvelée **indéfiniment**.
Le cookie n-expire que si le client devient inactif.

### 6. La déconnexion ne supprime pas la session mère

**Gravité : haute. Confirmé.**

`revokeAuthSession` (`:2368-2373`) :

```js
const hashes = session?.supersededBy ? [tokenHash, session.supersededBy] : [tokenHash];
```

Le commentaire juste au-dessus dit : *« Une session supplantée doit entraîner
sa fille : sinon la rotation deviendrait un contournement de la déconnexion. »*

Mais seul **le présenté et son successeur direct** sont supprimés. Le cas
inverse n'est pas traité : après une rotation A→B, présenter **B** (le cas
normal à la déconnexion) supprime B — **A reste valide** en mémoire jusqu'au
prochain `cleanupExpired` (toutes les 5 min).

Combiné au point 5, un cookie volé survit à la déconnexion de la victime.

### 7. Ré-enroller la 2FA admin n'exige aucun mot de passe

**Gravité : haute. Confirmé.**

`/api/admin/2fa/setup` (`admin.mjs:424-432`) exige `requireAdmin` — une session
— et **rien d'autre**. Aucun mot de passe.

Le garde anti-takeover repose sur `adminTotpSecrets.get(id).enabled`, un `Map`
**en mémoire**. `saveAdminTotpSecret` échoue en *best-effort* avec un simple log,
et `loadAdminTotpSecrets` avale l'erreur si la table est absente.

Scénario : ligne `admin_2fa_secrets` absente, serveur redémarré → Map vide →
`existing === undefined` → `setup` renvoie un **nouveau** secret, que
l'attaquant enrolle sur son téléphone, puis `enable` avec son propre code.
Accès financier complet.

L'asymétrie est frappante : **changer l'email exige le mot de passe actuel**
(`auth.mjs:393-399`), ré-enroller la 2FA non.

---

## RÉQUALIFIÉS — signalés, revérifiés, moins graves qu'annoncé

### 8. L'automate de match ne saute pas `awaiting_confirmation`

Signalé comme « haute » : le perdant pourrait prendre la cagnotte en basculant
son état prêt.

**Revérifié : le scénario ne tient pas.** `isTeamReadyForLaunch` →
`getTeamCheckInCount` compte **`isCheckedIn`**, pas `isReady`. Basculer
`isReady` ne change rien au calcul. Et `isCheckedIn` est **monotone** : la seule
écriture est `player.isCheckedIn = true` (`match-engine.mjs:521`), aucune route
ne permet de le décocher.

La lacune reste réelle mais latente : `awaiting_confirmation` n'est ni dans le
skip de l'automate (`TERMINAL_STATUSES = ['finished','cancelled','forfeited']`)
ni un motif d'arrêt. Le risque reel est un `cancelForAutomation` sur un
match de plus de 14 jours en attente de confirmation — pas le vol de pot
décrit.

**À corriger quand même**, mais comme durcissement, pas comme faille.

---

## RAPPORTÉS, NON REVÉRIFIÉS — à traiter comme pistes

Les lecteurs automatiques ont relevé ceci ; je ne l'ai **pas** confirmé et ne
l'affirme donc pas encore :

- Tournois : aucun mécanisme de reprise si un `releaseWalletWinnings` échoue sur
  un capitaine → mise verrouillée sans sortie possible.
- Matchs : `applyResultSettlement` échoue si **un seul** joueur est payé en
  erreur ; les réussis sont définitifs, et une fois `payoutDistributed = false`
  plus aucun cron ne rejoue → joueur non payé définitivement.
- Matchs : la commission d'arbitre peut faire échouer un règlement pourtant
  complet (tous les joueurs payés, match bloqué indéfiniment).
- Matchs : `resolveDisputeOnServer` avec `action:'settle'` rejoue
  `applyResultSettlement` sans vérifier l'idempotence → sur-distribution.
- Énumération de comptes : `forgot-password` renvoie `found`, et son temps de
  réponse diffère ; `register` renvoie 4 codes 409 distincts ; `login` ne lance
  pas scrypt si le compte n'existe pas (oracle de temps) et renvoie 423 après
  5 échecs.
- `PATCH /api/auth/me` accepte un `phone` sans validation → peut occuper la clé
  vide de l'index d'unicité.
- Un seul bucket `auth` (50 / 15 min) pour 9 routes, dont `/api/auth/logout`
  qui ne demande aucune authentification → 50 appels suffisent à renvoyer 429
  sur toutes les routes d'authentification pendant 15 min. Sur IP partagée
  (CGNAT mobile), c'est un déni de connexion de masse.
- `getClientIp` suppose que le proxy de confiance **ajoute** son IP à
  `X-Forwarded-For`, sans rien vérifier.
- Codes d'activation indexés sur l'email **brut** : un changement d'email avec
  une casse différente trouve le compte mais ne supprime pas l'ancien code.
- Arrondi : le pot de tournoi est calculé sur le **produit**
  `entryFee × entries × teamSize` alors que le verrouillé est la **somme des
  arrondis** par équipe. Un tarif à 3 décimales crée ou détruit quelques
  centimes. N'existe pas côté match et BR, qui relisent les réservations.
- `getRealtimeSession` ne teste pas les sanctions : un joueur banni garde son
  socket 6 h (lecture seule, pas d'impact monétaire).

---

## Zones lues sans constat solide

Pour qu'on ne croie pas à une omission : rate limiting, CSRF (double garde
Origin + `Content-Type`), comparaisons de secrets (`timingSafeEqual` partout),
rejeu des codes d'activation et de reset (supprimés après usage), révocation
de sessions au changement de mot de passe, normalisation des identifiants,
arrondis monétaires en drift (ré-appliqués à chaque écriture), répartition BR
validée à 100 %, couverture 2FA des routes administratives, contrôle
d'intégrité des portefeuilles, gestion des ports SMTP bloqués sur Render.

**Contexte utile :** la majorité de ces zones sont propres parce qu'elles ont
été reprises par les étapes précédentes de l'audit. Les trouvailles ci-dessus
portent sur des chemins que l'audit n'avait pas ouverts — le règlement BR, les
sessions, la 2FA de ré-enrôlement.