# Étape 6 — Qualité, tests et dépendances

## Portée

Ce que les tests couvrent vraiment, ce qu'ils ne couvrent pas, et l'état de
santé du code au sens de la dette.

## 1. La couverture n'avait jamais pu être mesurée

**Sévérité : moyenne. Corrigé.**

`vitest.config.ts` déclarait `coverage.provider: 'v8'` et `package.json`
proposait `test:coverage`. Mais **`@vitest/coverage-v8` n'était dans aucune
dépendance**. La commande échouait :

```
MISSING DEPENDENCY  Cannot find dependency '@vitest/coverage-v8'
```

Même famille de défaut que le `jsdom` fantôme de l'étape 4 : l'outillage
annoncé n'existait pas. Le projet *paraît* mesurer sa couverture ; il ne le
fait pas. Dépendance ajoutée (`^4.1.11`), `pnpm-lock.yaml` régénéré.

## 2. Couverture réelle, une fois mesurée

| Zone | Statements | Branches |
|---|---|---|
| Serveur (18 fichiers) | 61,8 % | 54,1 % |
| Client (26 fichiers) | 33,2 % | 33,8 % |

Réserve honnête sur ces chiffres : la couverture ne compte que ce que les
tests unitaires exécutent. Les 135 tests E2E API exercent les routes HTTP,
qui apparaissent ici comme non couvertes alors qu'elles le sont en pratique.
Le 61,8 % serveur sous-estime donc la couverture réelle ; l'écart est surtout
côté client, où il n'y a aucun test de bout en bout qui rattrape la misère.

## 3. La 2FA de l'admin n'avait aucun test

**Sévérité : haute. Corrigé.**

`server/admin-totp.mjs` (149 lignes) porte la vérification TOTP qui conditionne
**toute opération financière d'administration** :attribution des primes de match,
remboursements, retraits forcés, ligues. Aucun test ne l'atteignait.

C'est une implémentation maison — base32, HMAC-SHA1, troncature dynamique —
écrite à la main, donc le genre de code qui peut être « plausible » sans être
juste. Une erreur d'un bit dans l'écriture du compteur ou dans le découpage du
HMAC ne produit **aucune erreur visible** : le code est simplement refusé, et la
2FA de l'administrateur devient inutilisable.

15 tests ajoutés, dont les **vecteurs de test officiels de la RFC 6238** (annexe
B, SHA-1) sur le secret `12345678901234567890`. **L'implémentation est
conforme à la norme** : les six vecteurs passent, ainsi que la tolérance
±1 pas de temps, le refus hors fenêtre, et les cas limites (mauvaise longueur,
non numérique, `undefined`, nombre, objet, secret corrompu, zéros initiaux).

Couverture du module : **0 % → 66 %**.

## 4. Le contrat « delta → fusion » n'était pas verrouillé

**Sévérité : moyenne. Corrigé.**

`useRealtimeHeartbeat` porte un avertissement explicite : le socket diffuse
des deltas, donc il faut `hydrateFromServer` (fusion) et jamais
`replaceFromServer` (remplacement), « sinon effacerait tous les autres matchs ».
Un commentaire n'est pas une garantie : rien ne testait que la fusion préserve
bien les matchs absents du delta.

10 tests ajoutés sur `matchStore`, couvrant : conservation des matchs absents du
delta, ajout d'un match inconnu, application du statut, refus d'un delta plus
ancien que l'état local, égalité d'horodatage, repli sur `createdAt`,
absence de doublon quand le delta répète un match, tri final, et delta vide.

La logique est correcte — elle était simplement non protégée contre une
régression future. Couverture du fichier : **14 % → 39 %** (branches 0 % →
32 %).

## 5. Stores client sans test : le point faible assumé

Les moins couverts sont précisément ceux qui portent l'état affiché :

| Fichier | Statements |
|---|---|
| `friendsStore.ts` | 3 % |
| `presenceStore.ts` | 11 % |
| `tournamentStore.ts` | 12 % |
| `matchStore.ts` | 39 % (après correctif) |
| `realtimeClient.ts` | 19 % |

C'est le même coin que l'étape 4 : le défaut de reconnexion vivait dans
`socketConnectionStore` et `useRealtimeHeartbeat`, et personne ne l'avait
remarqué parce que rien n'y était testé. Le motif est clair, et il n'est pas
terminé. `friendsStore` à 3 % est le prochain candidat naturel — c'est aussi
le store concerné par le constat « signalements jamais relus » de l'étape 3.

## 6. Hygiène du code : propre, vérifié

Trois choses vérifiées parce qu'elles sont des suspects naturels. Aucune n'est
un défaut.

- **Marqueurs de dette** : 4 correspondances pour `TODO|FIXME|HACK|XXX`, les
  quatre sont des faux positifs — « Hackney Yard », le personnage « Hacker »,
  un format d'identifiant `LS-XXXX` dans un commentaire. **Zéro dette
  déclarée** dans tout le projet.
- **`console.*` résiduels** : 8 occurrences, toutes légitimes — 4
  `console.warn` de `RootLayout` qui signalent l'échec d'un polling, 3 dans le
  logger, 1 dans un commentaire de commande à copier. Aucun log de débogage.
- **Assertions tautologiques** : aucun `expect(true)`, aucun `expect('x').toBe('x')`
  dans la suite.

## 7. Anti-rejeu TOTP : analysé, et requalifié

**Sévérité : informationnelle.**

`verifyTotp` n'enregistre pas les codes déjà utilisés : un code valide reste
réutilisable pendant sa fenêtre. L'observation est exacte, mais la conclusion
naïve — « il manque une protection anti-rejeu » — serait fausse ici.

L'endpoint `/api/admin/2fa/verify` peut être appelé autant de fois que
voulu avec le même code. Un attaquant qui récupère un code valide n'a donc
rien à gagner à le rejouer : il lui suffit de le vérifier lui-même. La
protection anti-rejeu n'ajouterait rien tant que la vérification reste
idempotente.

La vraie borne est la **fenêtre de validité** : ±1 pas de 30 s, soit jusqu'à
90 s d'acceptation. La réduire à zéro supprimerait le rejeu, mais aussi
la tolérance à une dérive d'horloge — réelle sur des Android d'entrée de gamme.
Arbitrage à trancher en connaissance de cause, pas par automatisme.

Le bruteforce, lui, est déjà couvert : quota `admin` à 20 tentatives par
fenêtre de 5 minutes, et l'endpoint exige une session administrateur valide
avant même de vérifier le code.

## 8. Point de robustesse relevé au passage

Les secrets 2FA vivent dans un `Map` en mémoire (`adminTotpSecrets`). Ils sont
donc perdus au redémarrage, et seraient divergents entre deux instances. La
2FA redevient simplement « non active », et `requireAdmin2fa` répond alors
`403 2FA_REQUIRED` : les opérations financières sont bloquées jusqu'à réactivation.

C'est **fail-closed**, donc le bon sens de défaillance. C'est aussi un problème
de disponibilité pour un administrateur unique : un déploiement suffit à
réinitialiser la 2FA. Persister les secrets serait la suite logique ; c'est un
changement de schéma, pas un nettoyage.