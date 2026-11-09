# Audit UI/UX Critique — ZOYD (tunnels, écrans, vision utilisateur)

**Date :** 2026-11-09
**Site testé :** `https://zoyd.vercel.app` (production, navigateur réel) + audit code du front (`src/app/pages/`, `src/features/`)
**Pédagogie :** audit vu par 1–2 personnes qui découvrent ZOYD pour les 5 premières fois. On se met dans leurs yeux, on ne justifie rien, on cherche ce qui gêne, ce qui manque et ce qui casse la confiance.
**Verdict global :** concept fort, écosystème cohérent, mais plateforme vide + jargon argent non expliqué + tunnel de match long et fragile = risque d'abandon massif pour un joueur Benin/West-Afrique.

---

## 1. Ce qui marche (ne pas casser)

- **Promesse immédiate claire** : « Wagers sécurisés, arbitrage rémunéré, gains Mobile Money » + « L’ARÈNE ULTIME DE CODM EN AFRIQUE ».
- **Design cohérent** : noir / jaune / bleu, HUD tactique, scanline, grille tactique — on comprend tout de suite que c'est gaming, pas une banque.
- **Preuves légales sérieuses** : 6 pages (Conditions, Litiges, Anti-fraude, Confidentialité, Mentions, Jeu responsable) avec 18+, 1 ZC = 10 FCFA, litige 30 min, commission 2 % arbitrage, sanctions graduées.
- **Cibles tactiles 44 px** sur les liens auth / légales / actions — point noir corrigé précédemment, vérifié.
- **Accessibilité de base présente** : `aria-label`, `role="radio"`, `aria-current="step"`, `progressbar`, lien « Aller au contenu principal », focus visible.

---

## 2. Le problème N°1 : plateforme vide, chiffres qui trahissent

La landing affiche en live :
> **4+ JOUEURS, 0 MATCHS, 0 ZC DISTRIBUÉS, 0 % PAIEMENTS HONORÉS**

Et en démo :
> `MATCH DE DÉMO — GHOST_229 vs SNIPER_DK — CAGNOTTE 200 ZC`

**Vision joueur (Koffi, 19 ans, Cotonou, 3 jours de CODM) :**
> « C'est sérieux ou c'est un mockup ? 0 paiements honorés, ça a l'air que personne n'a jamais gagné. Et le match démo, c'est réel ou juste pour faire croire qu'il y a de l'activité ? »

**Critique :** afficher `0 % PAIEMENTS HONORÉS` en public est une erreur fatale de confiance. Un joueur qui doit déposer 1 500–5 000 FCFA lit : « personne n'a été payé ». De même, « 0 ZC distribués » alors que tu vends des gains Mobile Money.

**À corriger en P0 :**
- Retirer les stats à zéro tant qu'elles sont à zéro, ou les remplacer par : « Programme pilote — premiers joueurs fondateurs » + vrai nombre.
- Clarifier la démo : badge `DÉMO NON JOUABLE` et pas « MATCH EN DIRECT » (l'actuel `MATCH DE DÉMO` est ambigu).
- Ajouter 3 preuves qui manquent : 1 capture du wallet après gain, 1 témoignage arbitre, 1 explainer vidéo 30 s de « comment on joue et on est payé ».

---

## 3. Tunnel par tunnel — verdict critique

### 3.1 Landing (anonyme)

**Personas :** A = joueur, B = arbitre.
**Ce qui va :** 2 CTA parallèles clairs (`COMMENCER À JOUER` / `ARBITRER UN MATCH`), 3 étapes simples (compte → arène → gains), section dual-économie joueur/arbitre bien trouvée.

**Problèmes :**
- **Aucun élément d'aide / FAQ / support visible** en dessus de la ligne de flottaison. Un jeune qui hésite ne sait pas où cliquer s'il est bloqué.
- **Jargon dès la 1re phrase** : ZC, pass, ELO strict, Arbitre ZOYD — aucun glossaire à survol ou popover. Le premier joueur ne sait pas ce qu'est un pass.
- **Compression verticale** : stats, sections, carrousel de badges (`MULTIJOUEUR CODM / BATTLE ROYALE / WALLET ZC / MOBILE MONEY / TOURNOIS`) dupliqués 3 fois — bruit visuel sur mobile 360 px.
- **Footer légal surchargé mais OK.** En revanche, email `coyd2976@gmail.com` et WhatsApp `+2290165240654` — personnels, pas de domaine ZOYD. Ça érode la confiance paiement.
- **Aucun social proof réel** : pas de top 50 d'amis, pas de vidéo de match.

**Vision à 5 secondes :** « Ça a l'air pro mais vide. Je ne sais pas combien ça me coûte ni comment je perds de l'argent. »
**Priorité P1 :** mini-glossaire ZC/pass/ELO au clic, support WhatsApp/Discord dès le hero, argument « mise remboursée si forfait » mis en avant dès le hero.

### 3.2 Inscription (`/auth/register` — 3 étapes)

**Ce qui va :** multi-étapes qui découpe un long formulaire, password rules affichées, placeholder `+229 60 00 00 00` réaliste.

**Bloquants / Majeurs :**
- **Friction énorme** : pseudo + email + tel + pass + confirmation (étape 1), puis pays + UID CODM + niveau + rangs + controller + device (étape 2), puis 18+/CGU (étape 3). **Sans explication de pourquoi on demande le pays + le tel avant même le premier match.** Un adolescent CODM arrive pour « jouer contre un pote » et tombe sur un questionnaire d'identité bancaire.
- **Le téléphone détermine les opérateurs Mobile Money** — majeur et non dit clairement. Si le joueur met un numéro Orange CI alors qu'il est au Bénin, future erreur de retrait.
- **Mot de passe strict** (8 + maj + chiffre + spécial) mais le joueur ivoirien/beninois utilise souvent « Azerty123… » sans caractère spécial. La jauge de force a été corrigée, mais la friction reste.
- **Validation d'activation par email possible** : `ActivatePage` devrez apparaître après register. Le joueur qui n'a pas son email pourri (Gmail jetable) ne reçoit rien — chute silencieuse.
- **Aucun bénéfice promis pour remplir** : pourquoi lier l'UID CODM maintenant vs plus tard ?

**Vision joueur :** « Pourquoi tu veux mon numéro avant de me montrer un seul match ? »
**P0 :** repousser à plus tard tout ce qui n'est pas bloquant (UID, rangs, pays). Étape 1 = pseudo + tel + pass uniquement. Proposer le reste **dans** le profil, pas à l'inscription. Dire clairement : « Ton numéro sert à recevoir ton retrait Mobile Money ».

### 3.3 Connexion (`/auth/login`)

**Ce qui va :** champ générique email / tel / pseudo, mot de passe oublié, bouton « Afficher le mot de passe ».

**Problèmes :**
- **« CONNEXION PAR GOOGLE OU NUMÉRO : BIENTÔT DISPONIBLE — EMAIL + MOT DE PASSE POUR L'INSTANT »** : message d'excuse au lieu de fonctionnalité. En Afrique, le numéro de téléphone ou WhatsApp est le chemin principal ; l'email seul va tuer l'adoption.
- **Aucun toggle « Rester connecté »** explicite : le joueur ne sait pas si la session reste après fermeture de l'onglet.
- **Mot de passe oublié** : le parcours existe mais n'affiche pas que le lien d'activation arrive par email, pas WhatsApp.

**P1 :** connexion par numéro ou OTP WhatsApp (ou au minimum : « tu peux te connecter avec ton numéro »). C'est le format attendu sur CODM Afrique.

### 3.4 Serment d'intégrité (bloque tous les écrans après 1re connexion)

**Ce qui va :** rituel anti-triche bien conçu (scellé serveur, idempotent).

**Problème critique :** `AppLayout` rend `IntegrityCovenantModal` plein écran tant que `covenant.acceptedAt` est absent, **sans aucun chrome** derrière. Le nouvel arrivant qui vient de créer son compte découvre un mur fullscreen avec 10 clauses (F1..F10) **avant même de voir un seul match**. C'est un choc psychologique : « mais je n'ai rien fait encore ».

**Vision :** « Pourquoi on me fait signer un serment avant de jouer ? On ne me fait pas confiance ? »
**P0 :** limiter le serment à 3 clauses lisibles 10 s, ou demander **après le 1er match**, pas après le 1er compte. Ou au moins : sommaire + « J'ai lu » avant la liste, et un lien vers Anti-fraude.

### 3.5 Choix du mode (`/mode`)

**Ce qui va :** 3 cartes claires MJ / BR / BR League, liens dans la même zone (compte centralisé, wallet actif).

**Problème :** BR League affiche `ÉVÉNEMENT HEBDOMADAIRE — OUVERTURE DIFFÉRÉE` mais reste cliquable (`VOIR LA LIGUE`). Le joueur clique → écran vide / "bientôt". Promesse non tenue = frustration. Même chose BR : « Tu en seras l'arbitre » — mais beaucoup d'inscriptions refusent parce que l'arbitre dispose déjà d'un créneau ?

**P1 :** si un mode est fermé, afficher un vrai état « Non ouvert — rejoins la liste d'attente » + input WhatsApp pour prévenir, pas un bouton mort.

### 3.6 Hub MJ (`/mj`)

**Ce qui va :** filtres en grille (visible sur mobile, corrigé), recherche débouncée 300 ms, compteurs (Matchs actifs / Cagnotte / Arbitres demandés), bande BR secondaire.

**Problèmes :**
- **Arène calme (0 matchs) → « L’arène est calme. » + 2 boutons (Lancer / Recharger)**. Aucune invitation à devenir arbitre d'un match existant, ni à surveiller la file. Le joueur béninois ouvre l'app à 22h et voit « personne ». Il ferme. La plateforme vit dans la nuit : c'est là qu'il faut des matchs pré-créés ou des matchs bots d'entraînement.
- **Filtres opaques** : `SANS ARBITRE`, `FIABILITÉ 50+`, `PRÉSENCE`, `PRÊTS` — un novice ne sait pas ce qu'est `PRÉSENCE` vs `PRÊTS` vs `EN COURS`. Les statuts métier (`recruiting`, `check_in`, `ready`, `in_progress`, `awaiting_arbiter`, `awaiting_confirmation`) ne sont jamais expliqués en langage joueur.
- **Cartes de matchs** : `A gagner` (pot) + `Inscription` (entry fee) sans conversion FCFA, double écriture, pas de notion gagnant. Et `Arbitre à confirmer` est interprété comme « ce match est suspicieux » alors qu'il est simplement en recrutement.
- **Métriques basées sur le filtre** : si je filtre `1VS1`, « Cagnotte globale » passe de 3 000 → 200. Faux signal social.

**Vision joueur :** « Je ne sais pas ce que j'achète, ni ce que je gagne, ni pourquoi il n'y a personne. »
**P0 :** empty state dynamique (pas « Sois le premier » mais : 3 matchs à 50 ZC créés par l'équipe ZOYD, invitation arbitre, « matchs de créateurs présents à 20h »). P1 : conversion FCFA systématique (`50 ZC = 500 FCFA`), statut en langage joueur, tooltip filtres.

### 3.7 Création du wager (`/mj/creer` — 4 étapes) — le tunnel le plus critiqué

**Ce qui va :** progression en 4 temps, récap clair (format / mode / carte / pass / rôle / visibilité), confirmation avant enjeu, bouton corrigé en mode arbitre (tu l'as vu : `PUBLIER LE MATCH` vs `VERROUILLER LA MISE`).

**Reste critique :**
1. **Étape 3 (Mise) : prix par personne 50 / 100 / 200 / 500 / 1 000 ZC + champ libre.** Or le joueur n'a que **1 154,4 ZC** et voit `PASS 500 ZC`. En FCFA : **5 000 FCFA** pour un match instantané. Aucun avertissement « risque de perte réel », aucun « mise remboursée si l'arbitre ne se présente pas ».
2. **Estimations trompeuses** : `livePot = pass × maxPlayers`, `winnerShare = pot − 2 %` — mais si seulement 1 joueur sur 2 s'inscrit, le pot réel vaut half. La récap dit « Cagnotte totale (2 joueurs) » et `Solde après blocage` — or, pour un match à 2 slots dont un seul s'est inscrit, l'affichage reste le max théorique.
3. **Étape 2 Config :** `Prestes esports`, `score cible 15`, `BO3`, `picks en alternance` — jargon DuelX sans vulgarisation. Un joueur normal ne sait pas ce que BO veut dire.
4. **Étape 4 :** `Limite de temps: Libre` est une absence d'info, pas une info. Et `Visibilité: Privé` sans dire que le lien copié reste le seul canal d'invitation (partage ailleurs).
5. **Aucun brouillon sauvegardé** : si l'utilisateur ferme l'onglet pendant la saisie, tout est perdu. Le piège `chunk périmé` (tu l'as vu) causait la même perte — on a corrigé le reload, mais pas le brouillon.

**Vision à 5 secondes dans le tunnel :** « On me demande 5 000 FCFA, on ne m'explique pas ce que je gagne net après commission et après frais FedaPay, et on m'excuse de ne pas pouvoir payer. Je ne vais pas cliquer. »
**P0 :** écrire en FCFA au-dessus/below chaque montant ZC, exemple chiffré réel (ex. `100 ZC remboursés intégralement si abandon avant lancement`), ex. `Pot réel = pass × joueurs inscrits (ici 1/2 → 100 ZC bloqués, pas 200)`. P1 : brouillon auto via `localStorage` + recap sur FedaPay fees.

### 3.8 Détail match (`/mj/match/:id`) — le cœur de l'expérience

C'est **le point de douleur n°1** pour un joueur.

**Ce qui va :** séparation en-tête / joueurs / règles / actions / chat / timeline, confirmation des 2 équipes avec compte à rebours, litige avec ticket, partage par lien, 2FA admin expliquée.

**Ce qui ne va pas :**
- **Double gate `check-in` → `ready` → `launch`** sans ordre visible. Le joueur voit deux boutons côte à côte (`Présence confirmée` + `Je suis prêt`) sans savoir qu'il faut d'abord confirmer la présence, *puis* passer ready, *puis* que l'arbitre lance. Il reste bloqué en `check_in` si l'adversaire ne se présente pas, sans savoir que le match passe en forfait après le deadline.
- **Horaire du match** : `datetime-local` demandé à l'arbitre, mais le créateur le choisit à la publication sans voir ce que ça implique (`Toute équipe incomplète a l'heure du match passe automatiquement en forfait`).
- **Publication de salle CODM** : l'arbitre doit arriver dans CODM, créer une salle, puis écrire le nom + mot de passe dans ZOYD, cliquer `Partager la salle`. **Le joueur qui arrive le premier ne sait pas comment rejoindre la salle** : le code n'est envoyé que par l'arbitre, sans push, sans notif mobile native. S'il arrive avant, il attend dans le vide.
- **Fin de match / score** : l'arbitre tape manuellement les scores + collem des liens de preuves (texte) page par page. Aucune capture uploadée, aucun OCR, pas de photo de tableau des scores intégrée. Le `disputeState.evidence` est un champ texte libre (« Liens ou refs, séparés par des virgules ») — un joueur ne va pas héberger sa capture sur un lien externe pour prouver un score.
- **Confirmation des équipes** : `Confirmation des équipes` avec compte à rebours. Traduction joueur : « j'ai perdu, je ne confirme pas » → `awaiting_confirmation` gèle la cagnotte indéfiniment. Hors, visuellement, on ne sait pas qu'on a perdu ou gagné tant que tout le monde n'a pas confirmé. C'est le trou noir de confiance.
- **Espace spectateur** : bien expliqué (`tu n'es ni joueur ni arbitre`), mais il n'y a pas de suivi temps réel en spectateur (salle CODM pas recevable ?), donc le spectateur regarde juste un statut texte.

**Vision joueur en match :** « Je suis dedans, j'ai passé mon pass, je ne sais pas quoi faire en premier. L'autre n'arrive pas. Si je confirme, je perds mes gains. »
**P0 :** ordre imposé visuellement (1 Confirmer présence → 2 Ready → 3 Lancement auto par l'arbitre), timeline avec deadlines, et **reconfirmation claire : « Tu confirmes que l'autre a gagné »** vs « Confirmer le résultat ». P0 : preuves par upload image (presigned), pas un lien texte. P1 : push WhatsApp / SMS quand ton match démarre, notif quand la salle est partagée.

### 3.9 Wallet (`/wallet`) — l'argent, le point où tout se joue

**Ce qui va :** 4 soldes séparés (cash / bonus / bloqué / en attente), minimum retrait 150 ZC aligné sur presets, frais affiché avant validation, `WithdrawNotice` qui dit que FedaPay prélève ses propres frais.

**Critiques :**
- **Texte trompeur** : `Solde dispo : 1 154,4 ZC` — le joueur lit « déposable et retirable ». Or sur 1 154 ZC, une portion est en `bonus` (non retirable) et `locked` (dans les matchs). Aucune distinction visuelle. Il dépose 500 ZC et pense les retirer de suite, mais le retrait prend de 24 h (ouvrées) et il perd 2 % ZOYD + 1 % FedaPay non calculé.
- **FedaPay widget iframe** : l'utilisateur quitte ZOYD pour un iframe externe par opérateur (MTN, Moov, Celtiis). Dans l'iframe, il voit un téléphone à 8 chiffres (ex. `66000001`) et son nom. Beaucoup abandonnent ici (frais non expliqués, opérateur non trouvé).
- **Outils d'opérateurs verrouillés par pays** (BON) mais fragile : un Béninois qui change de SIM aura un faux pays payout → retrait désactivé avec un message technique.
- **Historique de transactions** : filtres `deposit / withdraw / prize_win`, mais pas de filtre `récompense arbitre` ni `litige`. Et rien n'explique `pendingWinnings` (gains en attente) vs `lockedBalance` (blocagés).
- **Retrait impossible en prod** (payout FedaPay `403` tant que le support n'active pas le compte marchand) — le joueur qui teste dépose et ne peut pas retirer. Le bouton est présent mais muet en sandbox. C'est un trou de confiance majeur tant que l'activation n'est pas faite.

**Vision joueur Wallet :** « C'est l'argent réel ou des jetons de jeu ? On me bloque mon argent pour une case à cocher, puis on me demande mon numéro pour retirer, mais ça ne marche pas. Je ne vais pas redéposer. »
**P0 :** récap avant dépôt en FCFA réel (`Tu déposes 500 ZC = 5 000 FCFA, reçu après validation`), explication FedaPay fees avant d'ouvrir le widget, modale « Retraits temporairement désactivés (activation FedaPay en cours) » au lieu d'un botones muet.

### 3.10 Profil / Paramètres / Sécurité

**Ce qui va :** 2FA TOTP bien implantée (copier le secret, code 6 chiffres, 5 min de validité par session), lockout par compte 5 échecs → 5 min.
**Critiques :**
- **Profil gamer (`levelCODM`, `rankMJ`, `rankBR`, `UID CODM`) obligatoire ?** On ne sait pas quelle valeur fausse son ELO ou casse sa vérification anti-triche.
- **La 2FA admin surprend** : un admin qui postule arbitre doit activer la 2FA avant (tu l'as vécu). Le message `Mode admin : la 2FA du compte est exigée avant de postuler` n'apparaît qu'après le clic. Il devrait être visible avant, dès qu'on est admin.
- **Notification params** : on/off binaires, mais sans explication de ce que « push Web » veut dire ni de délai (PWA, push WhatsApp ?).
- **Paramètres / Sécurité → TOTP** : copier/coller du secret manuel sans QR code. Enregistrer un secret TOTP à la main dans Authenticator sur téléphone quand le joueur n'a pas de scanner = friction massive.

**P0 :** QR code pour TOTP (au moins afficher le `otpauth://`), 2FA obligatoire expliquée à l'inscription admin, pas après.

### 3.11 Classements (`/classements`)

**Critique majeur :** la note elle-même casse la gamification :
> `les trois onglets partent du top 50 ELO servi par le serveur — chaque vue re-trie ces 50 joueurs sur sa métrique, et ne consulte pas la communauté entière.`

**Vision :** « Je suis top 50 ELO et je existe pour les gains aussi ? Le classement est faux ? »
**P0 :** servir 3 métriques réelles (top gains, top victoires, top ELO), pas un tri local. Et si c'est un MVP, le dire : `Classement en construction — premiers matchs arbitrés vendredi`.

### 3.12 BR / BR League / Tournois (`/br`, `/br-league`, `/mj/tournois`)

**Problèmes :**
- Promesses marketing (`500 joueurs, 5 jours, 1 finale`) vs 4 joueurs inscrits et `BR League différée`. Vide réel + ambition = clown.
- Tournois : `FINALE À 8 PLACES = 5%` vs `10% au-delà` — non expliqué pourquoi l'arbitre coûte plus cher quand il y a plus de joueurs. Et le split podium n'est pas chiffré avant engagement.
- Transfère de responsabilité : `Les vérifications de résultats sont automatiques` vs `L'arbitre tranche en cas de litige` — qui vérifie vraiment ?

**P1 :** ne pas afficher la BR League tant qu'elle n'est pas ouverte. Garder le salon BR seulement.

### 3.13 Chat (`/chat` — 1 channel par match)

Mini-chat par match, `scroll`, `mark read`. Pas de modération visible, pas de filtre insultes, pas de signalement dans le channel. Un match avec litige devient toxique et l'arbitre doit arbitrer sur le ton des échanges. prévoit `Un signaler` dans le chat.

### 3.14 Admin (`/admin` — 5 onglets)

**Ce qui va :** priorité, litiges, utilisateurs, signalements, overview, 2FA avec replay TOTP, lecture commissions.

**Problèmes vus dans tes captures :**
- Cartes `REVENUS ZOYD` et `SORTIES ARBITRES` à `N/D` sans bouton 2FA (corrigé par `f3133cb` : prompt auto au `2FA_REQUIRED` → lecture rejouée).
- Cartes KPI (`Litiges / Signalements / Salon live / Pools gelés`) coupées quand le viewport est petit — tu l'as dit.
- Compteurs incohérents : `MATCHS OUVERTS = 1` mais `VUE D'ENSEMBLE (0)` et `MATCHS (0)`. La file « priorité » ignore les matchs sans litige — libellé trompeur. Le `PRIZEPOOLS 400 ZC` alors qu'un 1VS1 à 100 = 200 (ancien match ? double-compte ?).
- **Aucune vue « combien j'ai payé aux arbitres aujourd'hui »** en FCFA réel. L'admin ne peut pas voir le flux trésorerie net en 5 sec.

**P1 :** aligner `openMatches` vs `priorityQueue`, afficher `litiges ouverts` partout, trésorerie journalière FCFA.

### 3.15 Pages légales & footer

**Points forts :** dates récentes (oct 2026), droit béninois, 18+, KYC multi-compte.
**Points noirs :**
- Contact : `coyd2976@gmail.com` + WhatsApp personnel. Pas de support ticket, pas de `support@zoyd…`. Pour un service d'argent, c'est le rédhibitoire (crainte d'arnaque).
- Conditions : `dépôts via FedaPay et opérateurs selon pays` puis list par pays — or l'inscription ne force pas le pays à être vérifié. Contradiction.
- Confidentialité en 4 phrases : aucune info cookies, Analytics, push, caméra.

**P0 :** remplacer email/WhatsApp par `support@zoyd.app` (alias réel) + ticket d'aide dans le profil. Ça changera la confiance d'un cran.

### 3.16 États techniques : 404, chunk périmé, bootstrap, connexion lente

**Ce qui va :** NotFound, bootstrap failed panel avec `Réessayer`, lazy retry par chunk.

**Ce qui reste fragile :**
- **Chunk périmé** : corrigé (`d781eb9`) mais le correctif demande un reload qui efface le formulaire en cours (`/mj/creer`). On a dit « brouillon à prévoir ».
- **Render cold start** : API Render en sleep = 30-45 s pour le premier appel après inactivité. Sur le front, skeleton indéfini puis `BootstrapFailedPanel`. Le joueur croit que le site est mort.
- **Aucun mode offline / slow 3G** : CODM en Afrique joue sur 4G fragile. Aucune file d'upload avec retry pour la preuve de litige.

---

## 4. Vue d'ensemble — « comment une ou deux personnes voient ça en 5 minutes ? »

**Joueur 1 (Koffi) :** « C'est tentant pour gagner de l'argent, mais il n'y a personne, et j'ai l'impression de devoir signer avant même de jouer. Je mets 5 000 FCFA sur un match qui démarrera sans adversaire ? Je vais attendre. »

**Joueur 2 (Awa, arbitre amatrice) :** « On me dit que je touche 2 % — combien c'est en vrai ? 200 ZC × 2 % = 4 ZC = 40 FCFA par match. Pour arbitrer 1 h dans CODM, ça ne vaut pas le coup. Et je dois activer la 2FA avant même de postuler ! »

**Admin (toi) :** « C'est jouable pour l'expérimentation mais je prévois déjà des incompréhensions sur les soldes, les dates de classement et les incidents. Je ne peux pas promettre un paiement tant que FedaPay ne m'a pas activé. »

**Verdict dur :** site compréhensible pour un early adopter qui connaît le wager et qui fait confiance à la marque, mais pas pour un nouvel arrivant CODM qui n'a jamais entendu parler d'arbitre rémunéré. Le tunnel demande de la confiance avant d'avoir montré la preuve.

---

## 5. Ce qui manque (fonctionnellement)

1. **Onboarding visuel** : 3 bulles « Comment on joue » en 30 s (créer → adversaire rejoint → salle CODM → confirmer). À afficher après la 1re connexion.
2. **Matchmaking** : proposition automatique « La Brigadier te propose un 1VS1 à 100 ZC à 20h » — aujourd'hui le joueur doit scroller le hub vide.
3. **Partage virale** : lien unique de match copiable (fait) mais aucun bouton WhatsApp/TikTok natif, aucun poster avec le `matchId` / QR pour affichage dans un groupe.
4. **Confirmation CODM vérifiée** (OCR des captures) : champs texte libres → décrédibilise l'arbitrage.
5. **Historique fiscal** : récap des gains par mois en FCFA pour justifier devant la famille / l'école / FedaPay.
6. **Temps réel mobile** : notifications push WhatsApp quand un adversaire te rejoint, la salle est partagée, ou le litige s'ouvre — le socket seul ne suffit pas sur mobile où l'app est fermée.
7. **Recrutement d'arbitres** par téléphone, pas par email : 2FA Google Authenticator sur le web sans QR = friction.
8. **Gamification** : missions (jouer le 1er match = 25 ZC bonus), streaks, invitations — pas juste ELO abstrait.

---

## 6. Roadmap P0 / P1 / P2 — pour être lisible, facile et liquide

### P0 — Bloquant confiance (1 semaine)
- Retirer `0 % PAIEMENTS HONORÉS` / `0 ZC` du public tant qu'ils sont à zéro. Remplacer par 3 badges fraude / preuve.
- Étape 1 inscription réduite à pseudo + tel + pass. Déporter le reste dans le profil.
- Wallet : message clair « Retraits FedaPay en cours d'activation » (tant que `403` marchand), et récap FCFA + frais FedaPay avant le widget.
- Affiche dans le détail match : déroulement en 3 temps (présence → ready → lancement), et timeline avec échéances.
- Preuves litige : upload image au lieu de texte liens.
- Contact support alias `support@zoyd.app` + bouton aide dans le profil. Pas d'email personnel.

### P1 — Conversion (2 semaines)
- FCFA systématique à côté de chaque ZC. Pass pro.
- `/mode` : BR League en « liste d'attente » plutôt que bouton mort.
- Empty state hub : matchs de démonstration de l'équipe ZOYD avec arbitre officiel à 20h / 22h.
- Classements 3 vraies métriques serveur.
- Push mobile (PWA + WhatsApp) sur `rejoint`, `salle partagée`, `litige ouvert`.
- QR code TOTP + avertissement 2FA admin avant le bouton « Postuler arbitre ».

### P2 — Faible friction
- Brouillon auto de création (`localStorage`).
- Recherche hub qui cherche sur `creatorPseudo` et `map` déjà fait, mais ajouter `mode` et `format` + filtre rapidité.
- Admin : trésorerie journalière FCFA + harmonisation compter `openMatches` / `priorityQueue`.
- Preuve d'ouverture de litige avec deadline 30 min affichée **dans** le match, pas seulement dans les conditions.

---

## 7. Une dernière phrase honnête

Le site est **bien construit techniquement**, mais l'audit technique n'est pas ce qu'un joueur voit. Il voit : **zéro preuve de paiement, zéro adversaire, trop de serments avant de jouer, et 5 000 FCFA de doute**. S'il est venu pour tenter, il va partir sans attendre le 2e match, et tu ne le verras plus.

Si tu ne corriges qu'une chose : montre une preuve chiffrée et un adversaire présent. Le reste suivra.
