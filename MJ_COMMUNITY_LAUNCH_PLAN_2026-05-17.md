# ZOYD MJ Community Launch Plan

Date: 2026-05-17

## 1. But du document

Ce plan transforme la vision ZOYD en feuille de route concrete pour livrer une premiere version publique exploitable par la communaute, avec le mode MJ uniquement.

Le principe directeur reste celui du document de vision:

- Trust > Features
- Simple -> Stable -> Scale
- MJ only avant toute ouverture BR
- Pas de commission plateforme sur matchs et tournois au lancement
- 2% uniquement sur les retraits

## 2. Etat reel du projet aujourd'hui

Le projet actuel est une base front-end tres avancee pour une maquette produit jouable, mais pas encore une plateforme communautaire prete en conditions reelles.

### Ce qui est deja bien pose

- Landing page, login, register, selection MJ/BR
- Onboarding joueur avec:
  - pseudo CODM
  - email
  - telephone
  - mot de passe
  - UID CODM
  - type d'appareil
  - type de controle
  - niveau CODM
  - rank MJ
  - rank BR
  - pays
  - pseudo streamer optionnel
- Hub MJ avec filtres et cartes de matchs
- Creation de match public/prive
- Detail de match avec:
  - inscription joueur
  - slot arbitre
  - check-in
  - ready
  - horaire
  - room CODM
  - validation du score
  - litige
  - canal de discussion
- Listing tournois
- Creation de tournoi
- Page tournoi + bracket
- Inscription tournoi solo/equipe
- Gestion de 1 ou 2 arbitres selon la taille du tournoi
- Wallet ZC
- Profil joueur
- Profil public
- Parametres
- Chat
- Classements
- Dashboard admin

### Ce qui est important a comprendre

Le produit compile et le build passe, mais l'etat actuel repose surtout sur des stores locaux Zustand persistants.

En clair:

- pas de backend reel
- pas de base de donnees distante
- pas d'authentification reelle
- pas de Mobile Money reel
- pas de temps reel reseau reel
- pas de stockage de preuves reelles
- pas de controle d'acces admin reel

## 3. Ce qui est deja aligne avec ta vision MJ

### Bonne direction produit

- Le ton du site parle de plus en plus au joueur et moins comme un back-office.
- Le parcours landing -> inscription -> choix du mode -> MJ est deja coherent.
- Le profil collecte deja l'essentiel des donnees utiles pour personnaliser l'experience.
- Les matchs et tournois sont deja filtres en fonction du profil de jeu.
- Le systeme de pass bloque, gain, arbitre et distribution locale respecte bien la logique economique de lancement.

### Bonne direction metier

- Match:
  - create
  - join
  - arbiter
  - check-in
  - ready
  - room
  - result
  - dispute
- Tournament:
  - inscriptions
  - bracket auto
  - bye
  - progression
  - podium
  - payout
- Le retrait a 2% est deja modele dans le wallet.
- Les tournois evitent deja la tranche 00h00 -> 07h00 dans la logique de scheduling.

## 4. Ecarts critiques entre la vision et le code actuel

## A. Fondations techniques manquantes

1. Authentification non reelle
- Le login/register creent ou injectent un utilisateur local.
- Les boutons Google et numero existent en UI mais ne sont pas branches.
- Il n'y a pas de verification telephone OTP effective.

2. Backend inexistant
- Aucun service API pour comptes, matchs, tournois, wallet, disputes, amis, admin.
- Toute la logique est dans le navigateur.

3. Temps reel non reel
- Le chat fonctionne localement.
- `socketStore` n'est pas relie a un vrai serveur.
- Le hook `useMatchRoom` est un prototype simule et n'est meme pas au coeur du flux principal.

4. Paiement non reel
- Depot et retrait sont simules par timeout.
- Aucun lien CinetPay, PayDunya, Flutterwave, MTN MoMo, Moov ou Orange Money.

5. Pas de stockage de preuves
- Les screenshots de resultats/litiges sont aujourd'hui du texte ou des references locales.
- Aucun upload, hash serveur, archive, moderation ou retrieval.

## B. Risques produit / confiance

6. Admin non securise
- Toute personne connectee peut atteindre `/admin` aujourd'hui.
- Le systeme de roles n'existe pas encore dans le modele utilisateur.

7. Social encore mock
- Les demandes d'amis, blocages et signalements existent, mais en logique locale simplifiee.
- Ce n'est pas encore un vrai systeme communautaire.

8. Nettoyage automatique incomplet
- Les matchs expirent apres 14 jours dans le store.
- Mais `cleanupExpired()` n'est branche a aucun scheduler global.

9. Partage prive incomplet
- Le match prive existe.
- Mais il manque le vrai partage par lien, copie d'invitation, deeplink et parcours d'arrivee.

10. Planning de match trop leger
- Les joueurs peuvent discuter.
- Mais il n'existe pas encore de systeme clair de proposition d'horaires, vote ou validation collective avant verrouillage arbitre.

11. Litiges tournois absents
- Les litiges match existent.
- L'equivalent tournoi n'est pas encore traite proprement.

## C. Ecarts avec ton intention produit

12. UID CODM devrait devenir obligatoire
- Il est encore optionnel dans le register actuel.

13. Politique de confidentialite profil a clarifier
- Tu veux cacher le type d'appareil sur les publications et sur le profil.
- Aujourd'hui le profil personnel et le profil public affichent encore des infos de setup.

14. Segmentation risque d'etre trop fine
- Le projet collecte `device` et `controllerType`.
- Pour le MVP, appliquer des restrictions dures sur les deux a la fois peut casser la liquidite.

## 5. Recommendation de scope realiste pour V1 communaute

Le plus gros risque de ZOYD n'est pas de manquer de fonctionnalites.
Le plus gros risque est d'ouvrir trop large sans confiance, sans support ops, et sans liquidite.

### Scope recommande V1

- MJ uniquement
- Pays initial unique:
  - Benin
- Formats publics:
  - 1VS1
  - 2VS2
- Tournois publics:
  - solo 1VS1 d'abord
  - 2VS2 ensuite
- Modes de jeu:
  - S&D
  - Hardpoint
- Map pool ferme:
  - 4 a 6 cartes maximum
- Fenetres horaires:
  - 07h00 -> 23h59
- Matchs prives:
  - oui, mais avec lien partageable simple
- Arbitres:
  - 1 arbitre par match public
  - 1 ou 2 arbitres par tournoi selon taille
- Commission:
  - 0% sur match/tournoi
  - 2% sur retrait

### Ce qu'il faut repousser apres lancement

- BR
- 3VS3 et 5VS5 si l'ops n'est pas stable
- Clubs
- Sponsoring
- Streaming integre
- Device filtering trop complexe
- Classements ultra-fins multi-pays des le jour 1

## 6. Donnees joueur utiles a collecter au MVP

### A garder absolument

- pseudo CODM
- UID CODM obligatoire
- telephone
- email
- mot de passe
- pays
- rank MJ
- niveau CODM
- type de controle
- type d'appareil
- pseudo streamer optionnel

### A ajouter si on veut mieux operer sans surcharger

- langue preferee
- plage horaire de jeu habituelle
- confirmation 18+ / majorite locale ou consentement legal
- acceptation reglement et politique anti-fraude
- canal prefere de contact support:
  - WhatsApp
  - email

### A ne pas ajouter tout de suite

- trop d'infos cosmetic
- clubs
- historiques avances non utiles au matchmaking initial

## 7. Decision produit conseillee sur appareil vs controle

Pour le MVP, il faut simplifier la logique de matching.

### Recommendation

- `controllerType` = critere principal de fairness
- `device` = critere secondaire de personnalisation et support

### Application conseillee

- Touch only
- Controller only
- Emulator / PC dans des pools separes ou `open`
- Le type d'appareil ne doit pas etre expose publiquement
- Le type d'appareil n'a pas besoin d'etre un filtre visible sur les cartes

Sinon on va trop fragmenter les joueurs et tuer la liquidite du lancement.

## 8. Ce qu'il faut livrer avant d'ouvrir a la communaute

## Bloc 1. Fondations obligatoires

1. Backend + base de donnees
- utilisateurs
- sessions
- matchs
- tournois
- wallet
- transactions
- notifications
- disputes
- amis
- roles

2. Auth reelle
- email + mot de passe
- login telephone OTP
- Google si utile
- verification telephone
- session persistante serveur

3. Roles et permissions
- joueur
- arbitre
- organisateur
- admin
- protection reelle des routes et des actions sensibles

4. Upload de preuves
- screenshots
- validation format/taille
- hash serveur
- archivage
- consultation admin

## Bloc 2. Economie et paiements

5. Wallet reel
- ledger transactionnel
- cash wallet
- bonus wallet
- locked balance
- pending winnings

6. Mobile Money
- depot
- webhook de confirmation
- retrait
- frais 2%
- seuil minimum 1500 ou 2000 FCFA a fixer clairement

7. Regles financieres serveur
- blocage immediat du pass
- remboursement si annulation / retrait autorise
- distribution auto gagnant + arbitre
- journal complet

## Bloc 3. Match public MJ

8. Match flow serveur
- publication
- join equipe A/B ou auto
- slot arbitre unique
- verification eligibilite
- check-in time-boxe
- ready
- room reveal
- lancement
- resultat
- appel / litige

9. Scheduling plus propre
- proposition d'horaires
- choix final arbitre
- rappels automatiques
- auto-forfeit si absence

10. Match prive utile
- partage de lien
- code d'invitation
- page d'arrivee directe

## Bloc 4. Tournois publics MJ

11. Tournament ops
- creation
- moderation
- publication
- inscriptions
- verrous d'equipe
- slots arbitres
- lancement du bracket
- rooms par duel
- resultats
- podium
- distribution

12. Litiges tournoi
- litige sur duel
- gel des gains
- resolution admin

## Bloc 5. Confiance, moderation, support

13. Trust score serveur
- no-show
- litige perdu
- fraude
- matchs completes
- anciennete

14. Moderation
- reports
- bans
- wallet freeze
- historique actions admin

15. Support ops
- file de litiges
- file de retraits
- file de matchs en attente
- alertes sur tournois bloques

## Bloc 6. Community minimum viable

16. Chat
- global
- match
- prive
- systeme
- moderation minimale

17. Friends
- ajouter
- accepter
- supprimer
- bloquer
- signaler

18. Profils
- profil joueur
- profil public
- historique matchs
- gains
- trust
- streamer mode

## 9. Ce qu'il faut corriger dans l'existant avant lancement

### Corrections produit

- rendre l'UID CODM obligatoire a l'inscription
- retirer les infos d'appareil des profils publics
- clarifier si le type de controle reste visible publiquement ou non
- ajouter un vrai partage de match prive
- ajouter un vrai flux de propositions d'horaire
- ajouter des statuts et messages plus precis pour arbitre deja pris, pass insuffisant, fenetre de match fermee, etc.

### Corrections techniques

- ajouter un vrai modele `role`
- proteger `/admin`
- supprimer ou refondre les hooks/prototypes non relies
- brancher le nettoyage des matchs expires
- ajouter scripts `lint`, `test`, et idealement `typecheck`

## 10. Ordre de livraison recommande

## Phase 0 - Product freeze

- verrouiller le scope MJ V1
- verrouiller les formats ouverts au lancement
- verrouiller la politique appareil / controle
- verrouiller la politique de frais et de retrait minimum

## Phase 1 - Backend et auth

- schema DB
- auth
- users
- roles
- sessions

## Phase 2 - Wallet et paiements

- wallet ledger
- depot
- retrait
- blocage pass
- distribution

## Phase 3 - Match public MJ

- publication
- join
- arbitre
- chat
- check-in
- room
- resultat
- litige

## Phase 4 - Tournois MJ

- creation
- inscriptions
- arbitres
- lancement
- bracket
- resultats
- payouts

## Phase 5 - Operations / trust / admin

- admin secure
- moderation
- disputes
- withdrawal review
- logs

## Phase 6 - Social minimum

- amis
- chat prive
- signalement
- blocage

## Phase 7 - Polish lancement

- analytics
- monitoring
- empty states
- legal / CGU / reglement
- QA mobile
- stress tests

## 11. Definition simple du "pret pour la communaute"

ZOYD MJ est prete a etre ouverte a des vrais joueurs quand:

- un joueur peut s'inscrire vraiment
- verifier son numero
- crediter son wallet vraiment
- rejoindre un match vraiment
- etre notifie vraiment
- recevoir une room vraiment
- faire valider un resultat vraiment
- recevoir son gain vraiment
- ouvrir un litige vraiment
- obtenir une reponse admin dans un delai maitrise

Tant qu'un de ces maillons n'est pas reel, la plateforme reste en phase prototype produit.

## 12. Priorites absolues

Si on devait resumer en une liste ultra-pratique:

1. Auth + backend
2. Wallet + Mobile Money
3. Roles + securisation admin
4. Match public MJ end-to-end reel
5. Tournoi public MJ end-to-end reel
6. Trust + disputes + moderation
7. Chat + notifications reelles

## 13. Conclusion

Le projet actuel est deja tres bon comme base de produit:

- vision claire
- design coherent
- beaucoup de flux majeurs deja maquettes
- logique metier deja bien pensee

Mais pour une ouverture communaute, le vrai sujet n'est plus l'interface.
Le vrai sujet est maintenant l'infrastructure de confiance:

- backend
- paiements
- roles
- temps reel
- preuves
- moderation

La bonne strategie n'est pas d'ajouter encore 30 pages.
La bonne strategie est de prendre le coeur MJ deja visible, le rendre reel, le rendre fiable, puis seulement l'ouvrir.
