# Audit UI/UX Strict — ZOYD (tunnels, écrans, vision 1–2 joueurs)

**Date :** 2026-11-09
**Périmètre :** `https://zoyd.vercel.app` uniquement (production, session réelle)
**Méthode :** parcours complet en navigateur avec un compte jetable (`UiAudit…`, supprimé après audit), text-over DOM + snapshot d'accessibilité page par page. Aucune passe produit / business — ici on ne juge que : comprends-tu en 5 sec ? peux-tu finir le tunnel sans aide ? sais-tu ce que ça te coûte en FCFA ? comprends-tu l'écran suivant ? te perds-tu en échec ?
**Contraintes produit respectées :** on garde les stats honnêtes à zéro, on garde WhatsApp comme contact (pas de mail pro à payer) et on ne pénalise pas « FedaPay non activé » tant qu'un message clair l'explique. On juge l'UI, pas l'offre.

---

## 1. En 5 secondes — ce que voit un joueur qui arrive

1. Landing : « Wagers sécurisés. Arbitre rémunéré. Mobile Money. » Prompt clair, mais **zéro indice de prix ni de chemin**. On clique `COMMENCER À JOUER`… et on tombe sur un questionnaire d'identité avant de voir un seul match.
2. Inscription : **3 étapes** (Identité → Profil CODM → Confirmation).
3. Serment d'intégrité plein écran (**10 clics**), avant le premier écran de jeu.
4. Choix du mode, hub vide (`1` match « MATCH ANNULÉ »), création, wallet, profil…

**Verdict 5 sec :** « J'ai signé plus de choses que je n'ai joué. »
C'est le mur n°1. Tout le reste en découle.

---

## 2. Tunnel par tunnel

### 2.1 Landing (anonyme)

**Vu en live :** hero « L'ARÈNE ULTIME DE CODM EN AFRIQUE », 2 CTA (`COMMENCER À JOUER`, `ARBITRER UN MATCH`), chiffres réels (`4+ JOUEURS / 0 MATCHS / 0 ZC / 0% PAIEMENTS HONORÉS`), match de démo `GHOST_229 vs SNIPER_DK — 200 ZC`, badges répétés 3× (`MULTIJOUEUR CODM / BATTLE ROYALE / WALLET ZC / MOBILE MONEY / TOURNOIS PUBLICS`), 3 étapes (`CRÉER TON COMPTE → CHOIX DE L'ARÈNE → MATCH ET GAINS`).

**Ce qui marche :** promesse en une phrase, double voie joueur/arbitre, garçons face/mobile/coopération sur le fond. Footer légal complet en 6 pages.

**Ce qui casse la compréhension :**
- **Jargon immédiat** : ZC, pass, ELO, Arbitre ZOYD — aucun glossaire à survol ou popover. Le premier joueur ne sait pas ce qu'est un *pass*.
- **Statistiques à zéro non cadrées** : l'honnêteté est assumée, mais sans une phrase de cadrage, « 0 % PAIEMENTS HONORÉS » se lit « personne n'a jamais gagné ». (Recommandation : garder les chiffres, ajouter « Programme pilote — chaque match arbitré compte. »)
- **Badges dupliqués 3 fois** = bruit vertical sur mobile, donne une impression de maquette.
- **Contact** : email `coyd2976@gmail.com` + WhatsApp — que tu gardes (pas de mail pro). L'UI devrait le dire en toutes lettres : « Support WhatsApp 8h–01h — email pro à l'ouverture publique », au lieu de juste lister un Gmail dans le footer.

**Avec tes contraintes, on garde tout :** zéro chiffré, contact WhatsApp. L'UI a juste à le dire sans te forcer à acheter un hébergeur mail.

**Sévérité :** Mineur (lisible). **P1 :** tooltip/glossaire ZC/pass/ELO sur les termes en jaune, dédupliquer les badges.

### 2.2 Inscription (`/auth/register` — 3 étapes)

**Vu en live — Étape 01 / 03 — Identité :** `Pseudo CODM`, `Email`, `Téléphone (+229 60 00 00 00)`, `Mot de passe` (8 + majuscule + chiffre + spécial, checklist + jauge), `Confirmation`, `CONTINUER`. Trois pastilles de progression.

**Étape 02 / 03 (d'après le code, non jouée au navigateur) :** appareil (téléphone/tablette/PC), contrôle (tactile/manette/émulateur/PC), `ID CODM (UID obligatoire)`, `Niveau CODM`, `Grade MJ / BR`, puis pays / streamer dans la suite.

**Étape 03 / 03 :** 18+ et CGU, cases explicites.

**Problèmes UI purs :**
- **Charge cognitive maximum à l'entrée** : pseudo + email + téléphone + mot de passe + confirmation + 4 règles + jauge, avant même de voir un salon. Le joueur CODM vient pour « rejoindre un pote », pas pour remplir un profil bancaire.
- **Le téléphone détermine les opérateurs Mobile Money disponibles** (cf. `payoutOperators.ts`). Ce n'est dit nulle part dans le formulaire. Le joueur saisit un numéro et découvrira plus tard qu'il ne couvre pas son opérateur.
- **Règles mot de passe sur deux endroits** (checklist + zod serveur). Corrigé pour la jauge (P2-1), mais le jogador adolescent saisit « Azerty123 » sans caractère spécial et se heurte à l'échec.
- **UID CODM demandé trop tôt** : le joueur n'a pas son UID sous la main, il abandonne pour « aller chercher le code dans le jeu » et ne revient plus.
- **Zéro bénéfice affiché** : pourquoi lier l'UID maintenant vs plus tard ?

**Vision 5 sec :** « Pourquoi tu veux mon numéro et mon UID avant de me montrer un seul match ? »

**Sévérité : Bloquant (abandon).** **P0 :** étape 1 réduite à pseudo + téléphone + mot de passe. Tout le reste dans le profil, après la première arène. Dire pourquoi le téléphone : « Ton numéro reçoit ton retrait. »

### 2.3 Serment d'intégrité (bloque tout `/mj`, `/wallet`, etc.)

**Vu en live :** modale plein écran `SERMENT D'INTÉGRITÉ — 2026-11-04`, `ÉTAPE 1/10 AVANT L'ARÈNE`, puis `ÉTAPE 2/10 PREMIER SERMENT` (`GAGNER AU PLEIN JEU — OUI / NON`), `ÉTAPE 3/10 À LIRE` (`J'AI LU — CONTINUER`), jusqu'à `ÉTAPE 10/10 LE DERNIER MOT` (`ENTRER DANS L'ARÈNE`). **10 clics pour apercevoir le premier match.** Une fois le serment, il est scellé serveur, idempotent.

**Ce qui marche :** texte de valeur (« Ta signature », « même jeu pour tous »), pas de sanction cachée, une seule fois.

**Ce qui casse :** le rituel remplace le contenu. Le joueur vient de créer un compte, il n'a jamais joué, et il signe déjà. En Afrique, le premier écran doit être un match, pas un serment.
Aucune vue préalable du site (pas d'arène, pas de match, pas de réel) avant les 10 `/10`. Même Google Authentifie avant, pas après.

**Sévérité : Bloquant.** **P0 :** serment après le premier match, ou résumé 3 clauses + « tu pourras le relire avant chaque saison ». Laisser le joueur voir `/mj` avant le serment.

### 2.4 Choix du mode (`/mode`)

**Vu en live :** `CHOISIS TON TERRAIN DE JEU`, 3 cartes : `CODM MULTIPLAYER — DISPONIBLE / MODE OUVERT` (`ENTRER EN MJ`), `BATTLE ROYALE — DISPONIBLE / SALONS OUVERTS` (`ENTRER EN BATTLE ROYALE`), `BR LEAGUE — ÉVÉNEMENT HEBDOMADAIRE / OUVERTURE DIFFÉRÉE` (`VOIR LA LIGUE`). Couplet commun : compte centralisé, wallet actif, profil unique.

**Problème UI :** la 3e carte dit « ouverture différée » mais propose quand même `VOIR LA LIGUE`. En cliquant, le joueur tombe sur `Aucune saison de ligue pour le moment.` Bouton mort = promesse non tenue.
De même dans le hub MJ, la bande BR du bas `ENTRER EN SALONS` est en concurrence directe avec le CTA principal `CRÉER UN WAGER`.

**Sévérité :** Majeur. **P1 :** si fermé, bouton `REJOINDRE LA LISTE D'ATTENTE` avec WhatsApp, pas `VOIR`.

### 2.5 Hub MJ (`/mj`)

**Vu en live (compte jetable) :**
> `MATCHS ACTIFS 1 / CAGNOTTE GLOBALE 200 ZC / ARBITRES DEMANDÉS 0`
> Filtres : `TOUS / 1VS1 / 2VS2 / 3VS3 / 4VS4 / 5VS5` puis `TOUS / OUVERTS / PRÉSENCE / PRÊTS / EN COURS / SANS ARBITRE / FIABILITÉ 50+`, recherche `Chercher une carte, un mode ou un joueur…`, `CRÉER UN WAGER`.
> **Une seule carte** : `MATCH ANNULÉ / SHIPMENT / 1VS1 / A GAGNER 200 ZC / INSCRIPTION: 100 ZC / FRONTLINE / BO1 / 15 PTS / 1/2 JOUEURS / ARBITRE CONFIRME / PUBLIÉ IL Y A 4H / HORAIRE A FIXER / ÉQUIPE ALPHA / ÉQUIPE BRAVO / VOIR LE MATCH`.

**Ce qui marche :** filtres en grille (plus rien en scroll caché), recherche débouncée 300 ms, `CAGNOTTE GLOBALE` met en avant l'argent à gagner, bande BR secondaire en bas.

**Ce qui casse :**
- **« MATCHS ACTIFS 1 » + carte « MATCH ANNULÉ »** : contradiction visible. Un match annulé ne devrait pas compter comme actif, ni être promu dans le hub. Le joueur lit : « le site est cassé ou plein de faux matchs ».
- **Jargon statut inexpliqué** : `OUVERTS / PRÉSENCE / PRÊTS / EN COURS` sans tooltip. Le nouveau venu ne peut pas distinguer *présence* (check-in) de *prêts* (ready).
- **Carte illisible en 5 sec** : `A GAGNER 200 ZC` + `INSCRIPTION: 100 ZC` sans conversion FCFA (`200 ZC = 2 000 FCFA`), sans « pot réel = pass × joueurs inscrits (ici 1/2) ».
- **`HORAIRE A FIXER`** : un match sans heure dans un hub ouvert, pour un joueur qui veut « jouer maintenant », c'est une impasse.
- **`ARBITRE CONFIRME` sur un match où l'arbitre est un compte d'audit** (`ArbC955683`) : le joueur se demande si c'est un vrai arbitre, qui décide.
- **Métriques basées sur le filtre** : si je filtre `1VS1`, « Matchs actifs » change — signal social faux.

**Sévérité : Bloquant (confiance).** **P0 :** exclure les matchs annulés du hub et du compteur, ou les afficher dans un onglet `Historique / Annulés`. P1 : conversion FCFA systématique, tooltip chaque statut, horaire réel par défaut (`Dès que l'équipe est complète`).

### 2.6 Création du wager (`/mj/creer` — 4 étapes)

**Vu en live :** `CONFIGURE TON WAGER / CRÉER UN WAGER`, barre de progression `01 FORMAT / 02 CONFIG / 03 MISE / 04 RECAP`.
Étape 1 : `CHOISIS LE FORMAT` (5 cartes `1VS1 … 5VS5`, bouton `CONTINUER` désactivé sans format). Tu as récemment corrigé le récap arbitre (`PUBLIER LE MATCH` vs `VERROUILLER LA MISE`).

**Ce qui marche :** progression en 4 temps, format en cartes grandes, bouton désactivé quand rien n'est choisi, récap final avant enjeu, bouton corrigé pour l'arbitre (`2ddc361`).

**Ce qui reste critique (vécu par 1–2 joueurs) :**
- **Mise sans prix réel** : `50 / 100 / 200 / 500 / 1 000` en ZC sans conversion FCFA. Le joueur ne convertit pas 1 ZC = 10 FCFA dans sa tête. Il voit « 500 » et ne sait pas que c'est 5 000 FCFA.
- **Pot théorique vs pot réel** : `CAGNOTTE 200 ZC` pour `INSCRIPTION 100 ZC` avec `1/2 joueurs`. Il n'est pas dit que le pot réel vaut le double du pass seulement quand le match est plein.
- **Rôle arbitre :** il est placé à l'étape 3 (Mise) alors qu'il conditionne tout le match. Un joueur qui choisit le format, puis la carte, puis arrive à « Ton rôle » comprend qu'il a rempli le mauvais formulaire.
- **Visibilité `Privé/Public`** : `Privé` est coché sans dire que le partage se fait uniquement par lien copié (et que le match n'apparaîtra pas dans le hub).
- **Aucun brouillon conservé** : fermer l'onglet pendant la saisie efface tout. Vécu dans l'audit : le joueur qui a rempli les 4 étapes et se retrouve sur « UNE MISE À JOUR EST ARRIVÉE » doit tout recommencer (même si le reload est corrigé).
- **Langage** : `Picks en alternance par manche`, `Preset esports — FRONTLINE`, `BO1` — supposent une culture wager jamais expliquée.

**Sévérité : Majeur.** **P0 :** FCFA à côté de chaque ZC, exemple chiffré « pot réel = pass × joueurs inscrits », rôle arbitre en étape 1 (ou dès le format), brouillon `localStorage` + recap avant génération.

### 2.7 Détail d'un match (`/mj/match/M-MW9372YF`)

**Vu en live :**
> `MATCH ANNULÉ / SALLE DU WAGER / SHIPMENT / FRONTLINE / 1VS1 / Wager: 100 ZC / Cagnotte: 200 ZC / Créé par cafard 23 / ARBITRE ArbC955683 / HORAIRE A fixer`
> `SQUAD ALPHA 1/1 CAFARD 23 CAPITAINE EN ATTENTE EN ATTENTE / SQUAD BRAVO 0/1 SLOT LIBRE`
> `FORMAT 1VS1 / BEST OF BO1 / SCORE CIBLE 15 / ARMES Toutes permises / SÉRIES Interdites / COMPÉT. Interdites / CORPS A CORPS Interdit`
> `ENTRER DANS LA PARTIE — COPIER LE LIEN / PARTAGER`
> `MATCH CLOS — Ce match est cloture et ses mises ont ete remboursees. Pour tout reclamant, contacte le support.`
> `PRESENCE SALON 1/1 presents, 0 check-in, 0 prets. / ARBITRE ATTENDU / SYNC 15:07 / CANAL TACTIQUE / CANAL ACTIF / 1/1 PRESENTS / 1 LECTURE(S)`

**Ce qui marche :** en-tête complet, règle format, partage par lien, explication de remboursement, présence / check-in / prêt affichés, chat par match, canon « canal actif ».

**Ce qui casse la compréhension :**
- **Un match dont le statut dit « `MATCH ANNULÉ` » mais dont l'action dit `EN ATTENTE` en double** : le joueur ne sait pas s'il peut attendre ou s'il doit quitter.
- **Arbitre `ArbC955683`** : un pseudo d'audit pris pour un vrai compte. L'utilisateur ne peut pas distinguer un arbitre de confiance d'un anonyme.
- **Double gate `PRESENCE → PRÊTS`** : pour le créateur le bouton `Confirmer ma présence` et `Je suis prêt` sont côte à côte, sans ordre. Il ne sait pas qu'il doit d'abord confirmer sa présence, puis attendre le `ready` de l'adversaire, puis attendre l'arbitre qui lance.
- **Salle CODM** : l'arbitre doit publier le nom/mot de passe CODM après l'avoir créé (champ `datetime-local` + salle + mot de passe). Le joueur qui est déjà là ne reçoit pas de push quand la salle arrive. Il attend dans le vide.
- **Fin de match** : scores saisis à la main, preuves = liens texte (`Captures d'écran (liens ou refs, séparés par des virgules)`) au lieu d'upload image. Le joueur ne va pas héberger sa capture sur un lien externe pour prouver sa victoire.
- **Confirmation des équipes** : l'écran `Confirmation des équipes` avec compte à rebours ne dit pas « tu confirmes que l'autre a gagné ». Le joueur perdant clique « Confirmer » et réalise qu'il vient de perdre ses gains.
- **Espace spectateur** : bien expliqué mais sans suivi temps réel en spectateur — il regarde un statut texte.

**Sévérité : Bloquant (cœur).** **P0 :** ordre numéroté (1 Présence → 2 Ready → 3 Lancement arbitre), deadline visible sur chaque étape, upload photo pour les preuves au lieu de liens texte, formulation « Confirmer que l'adversaire a gagné ».

### 2.8 Wallet (`/wallet`)

**Vu en live :**
> `LE COFFRE-FORT (WALLET) — Recharge via Mobile Money, verrouille tes wagers et retire tes gains`
> `SOLDE DISPO 0 ZC ~0 FCFA / CASH RETIRABLE 0 ZC Pret au retrait / EN JEU 0 ZC Parties et tournois en cours / BONUS ZC 0 ZC Utilisable, non retirable`
> `DÉPÔT MOBILE MONEY (AJOUTER DES ZC) / RETIRER / MES GAINS`
> `EN UN COUP D'ŒIL — GAINS EN ATTENTE 0 ZC / FRAIS DE RETRAIT 2% / RETRAIT MINIMUM 150 ZC`
> `18+ — NE MISE QUE CE QUE TU PEUX PERDRE. FRAIS ET CONDITIONS · JEU RESPONSABLE`
> `HISTORIQUE DE TON SOLDE — TOUS / AJOUTS / RETRAITS / GAINS / TON SOLDE N'A PAS ENCORE BOUGE`

**Ce qui marche :** 4 soldes séparés cash / en-jeu / bonus, conversion FCFA affichée (`~0 FCFA`), minimum retrait et frais publiés, disclaimer 18+, historique réactif.

**Ce qui casse :**
- **`Pret au retrait`** sur un solde `0 ZC` est une phrase commercialement fausse. Le joueur lit « je peux retirer » alors qu'il n'a rien.
- **4 soldés sans pédagogie** : `EN JEU` vs `EN ATTENTE` vs `BONUS` sont des étiquettes métier sans exemple. Le joueur ne sait pas pourquoi l'argent de sa mise disparaît de `SOLDE DISPO` dès la création.
- **Dépôt via widget FedaPay iframe** : l'utilisateur quitte ZOYD vers un iframe par opérateur. Le widget demande `66000001` + nom/prénom. Il ne voit pas ses presets ZC (150/200/500/1 000).
- **Aucun exemple réel de transaction** : `TON SOLDE N'A PAS ENCORE BOUGE` sur un compte qui vient de s'inscrire est honnête mais froid. Pas de guide « 1) dépôt 150 ZC = 1 500 FCFA → reçu → 2) mise 100 ZC → 3) gain 198 ZC → 4) retrait ».
- **Retrait désactivé en sandbox** : le bouton `RETIRER` existe mais échoue en `403` côté marchand FedaPay non activé. Sans le message « Activation à l'ouverture publique » (proposé), le joueur croit que c'est un bug de son téléphone.

**Sévérité : Majeur.** **P0 :** remplacer `Pret au retrait` par `Ton cash retirable`, FCFA sur chaque preset, une phrase « Activation FedaPay à l'ouverture publique » sous le bouton RETIRER.

### 2.9 Profil (`/profil`)

**Vu en live :**
> `UIAUDIT292383 / FIABILITÉ 100 / SCEAU D'INTÉGRITÉ — SCELLÉ LE 09/11/2026 / BENIN / TOUCH / ID CODM: 674492383 / MEMBRE DEPUIS / BEGINNER 0 / 1000 XP / MODIFIER LE PROFIL / SE DÉCONNECTER`
> `CARRIÈRE JOUEUR — CAGNOTTE GAGNÉE 0 ZC / MATCHS JOUÉS 0 / TAUX DE VICTOIRE 0% / TOURNOIS 0 / 0`
> `CARRIÈRE ARBITRE — MATCHS ARBITRÉS 0 / COMMISSIONS GÉNÉRÉES 0 ZC`
> `SCORE DE FIABILITÉ (TRUST SCORE) SCORE GLOBAL 100/100 / MATCHS TERMINÉS 0 / LITIGES 0 / FORFAITS CONNUS 0 / Un bon Trust Score te permet d'acceder aux wagers High Rollers et de postuler comme Arbitre rémunéré`
> `TES REPERES CODM NIVEAU 50 / RANK MJ bronze / RANK BR bronze / PAYS Benin`
> `MATCHS RÉCENTS AUCUN MATCH RÉCENT — Les matchs terminés apparaîtront ici, avec leur résultat et ce qu'ils ont rapporté. / TOURNOIS RÉCENTS VOIR LES TOURNOIS AUCUN TOURNOI RÉCENT`

**Ce qui marche :** on voit directement qui on est, niveau CODM, pays, appareil, contrôle, date de membre.

**Ce qui casse :**
- **Fiabilité 100/100 à 0 match** : score maximal sans preuve. Le joueur se demande si le score compte quelque chose ou s'il est juste un chiffre déco.
- **High Rollers** : les « pariseurs de gros » sont mentionnés sans dire à partir de quel montant on devient High Roller et si c'est un statut fermé.
- **Two personas in one screen** : joueur vs arbitre en deux blocs, bien, mais 100 XP / 1000 XP sans explication (qu'est-ce qui rapporte de l'XP ?).
- **MVP vs Growth** : `MODIFIER LE PROFIL` est en lien secondaire, alors que c'est là que le joueur corrigera son pays / UID après s'être trompé à l'inscription.

**Sévérité :** Mineur. **P1 :** afficher `—` plutôt que `100/100` tant que 0 match, expliquer XP dans un tooltip.

### 2.10 Paramètres (`/parametres`)

**Vu en live :** onglets `COMPTE / SÉCURITÉ / GAMING / NOTIFICATIONS / A SAVOIR`. Dans `COMPTE` : `PSEUDO — Le nom qui t'identifie. L'arbitre s'en sert pour dire qui a gagne`, `EMAIL — Le changer demande de confirmer ton mot de passe`, `TÉLÉPHONE — Utile pour vérifier ton compte et recevoir tes retraits`, `PAYS` (liste : Benin, Côte d'Ivoire, Sénégal, Togo, Cameroon, Gabon, RDC, Nigeria, Ghana, Autre), `BI0 / MODE STREAMER`, `ZONE DANGER — SUPPRIMER TON COMPTE EST DÉFINITIF… RETIRE D'ABORD TON SOLDE CASH (MINIMUM 150 ZC)`.

**Ce qui marche :** explications claires sous chaque champ, avertissement zone danger lisible.

**Ce qui casse :**
- **La liste pays est plus large que les pays payout** (FedaPay : BJ, CI, SN, TG selon le code). Le joueur camerounais coche `Cameroon` et découvre ensuite que le retrait est désactivé sans lien avec son pays.
- **`MODE STREAMER` avant même d'avoir joué un match** : fonctionnalité sans contexte pour un nouvel arrivant.
- **2FA entrée admin uniquement** : côté utilisateur normal, la sécurité n'est visible que dans l'onglet `SÉCURITÉ`. Le nouvel arrivant qui vient de subir la 2FA admin pour postuler arbitre ne comprend pas pourquoi la 2FA apparaît en postulation, pas dans le profil.

**Sévérité :** Mineur. **P1 :** n'afficher que les pays avec paiements actifs, ou dire lesquels le sont.

### 2.11 Chat (`/chat`)

**Vu en live :** `MESSAGES / EN LIGNE: 1 / NOUVELLE DISCUSSION / CHAT GLOBAL ZOYD / AMIS EN LIGNE Aucun ami connecté / CHAT GLOBAL ZOYD 1 EN LIGNE / AUCUN MESSAGE DANS CETTE DISCUSSION`.
Le chat est fractionné par match (`match-<id>`) et par global.

**Ce qui casse :**
- **En ligne: 1** : c'est le joueur lui-même. Zéro ami en ligne sur un chat global qui promet 1 en ligne fait ressentir l'abandon.
- **Aucun mécanisme anti-toxicité visible** (signalement, filtre, modération) dans le canal du match, alors que c'est là que les litiges naissent.
- **Aucun bouton de partage de salle** dans le match qui est pourtant censé être le canal de coordination avec l'arbitre.

**Sévérité :** Majeur pour l'expérience en match. **P1 :** intégrer le partage de salle dans le chat du match, signaller dans le thread.

### 2.12 Classements (`/classements`)

**Vu en live (compte jetable, 0 match) :**
> `CLASSEMENTS JOUEURS / LES MEILLEURS / Ces classements bougent avec les matchs et tournois déjà joués. Rien n'est affiché tant que l'activité n'existe pas encore.`
> `TON RANG: #1 / TOP 50% / ZONE: BENIN / TOP ELO / TOP GAINS / VICTOIRES / ACTIVITÉ / ÉQUIPES / PAR PAYS / PAR CONTRÔLE`
> Tableau : `RANG / JOUEUR / PAYS / RANG / ELO / WR% / GAINS / FIAB.`
> `UI — UIAUDIT292383 — TOI — BJ — BRONZE — 1200 — 0% — 0 ZC — 100`
> `CA — CAFARD 23 — -- — LEGENDARY — 1200 — 0% — 0 ZC — 100`

**Ce qui casse :**
- **Un compte neuf est `LEGENDARY`-adjacent à 1200 ELO avec 0% win et 0 match** : le score de départ donne l'impression d'un classement truqué, pas d'un niveau.
- **Deux entrées à 1200**, toi `#1` et `CAFARD 23` juste derrière, tous deux à 0% win : le classement ne distingue rien.
- **Filtres `ÉQUIPES / PAR PAYS / PAR CONTRÔLE / ACTIVITÉ`** en plus des 3 vues (`TOP ELO / TOP GAINS / VICTOIRES`) : charge cognitive pour un nouvel arrivant sans matchs.

**Sévérité : Majeur.** **P0 :** pas de position `#1` tant que 0 match (afficher `—`), pas d'ELO 1200 par défaut visible comme un vrai niveau (marquer `ELO initial`).

### 2.13 Earnings (`/earnings`)

**Vu en live :**
> `TABLEAU DE BORD FINANCIER / SUIVI DE TES CAGNOTTES ET DE TES COMMISSIONS D'ARBITRAGE`
> `TOTAL GÉNÉRÉ 0 ZC / CAGNOTTE (JOUEUR) 0 ZC / COMMISSIONS (ARBITRE) 0 ZC / BILAN DE JEU (30J) 0 ZC / PAS DE MOUVEMENTS`
> `TON ÉVOLUTION SUR 30 JOURS — 30 JOURS / 11…07 / 0ZC 1ZC 2ZC 3ZC 4ZC` (axe)
> `RÉPARTITION DE L'ACTIVITÉ PAS ASSEZ DE PARTIES POUR AFFICHER CETTE VUE`
> `FIABILITÉ 100/100 / STATUT: VÉRIFIÉ ZOYD`
> `DISPONIBLE 0 ZC / EN JEU 0 ZC / RETIRABLE 0 ZC / EN ATTENTE 0 ZC`
> `DERNIERS MOUVEMENTS AUCUN MOUVEMENT RÉCENT ENREGISTRÉ / 0ZC`

**Ce qui casse :**
- **`STATUT: VÉRIFIÉ ZOYD` avec 0 activité** : badge de confiance mensonger. Le joueur se dit : vérifié sur quelle base ?
- **Courbe 30 jours avec axe 0-4 ZC** et aucun point : bruit graphique inutile. `PAS ASSEZ DE PARTIES` est plus honnête, mais le graphique aurait dû être remplacé par le message, pas l'inverse.
- **4 cases `DISPONIBLE / EN JEU / RETIRABLE / EN ATTENTE` dupliquent le wallet** : en deux endroits le joueur ne sait pas où se trouve son argent.

**Sévérité :** Mineur. **P1 :** supprimer le badge `VÉRIFIÉ` tant que 0 preuve, remapper vers le wallet.

### 2.14 BR (`/br`) & BR League (`/br-league`) & Tournois (`/mj/tournois`)

**Vu en live :**
- **BR** : `ZOYD BATTLE ROYALE / BR — UN SALON, 100 JOUEURS / Un seul match, une seule map, jusqu'au dernier survivant…` + `LE PASS N'EST JAMAIS REMBOURSE UNE FOIS LA PARTIE LANCEE — Tu payes ton pass a l'inscription… Seule une desinscription avant l'heure de depart rembourse integralement.` Compteurs `SALONS OUVERTS 0 / EN COURS 0 / JOUEURS INSCRITS 0 / CAGNOTTE 0 ZC`, `Aucun salon programme pour le moment. Les salons sont ouverts 24 a 48 h a l'avance.` Maps listées (Isolated, Blackout, Krai, Rebirth), `Plafond effectif = minimum(mode, map)`, `gains en ZC (1 ZC = 10 FCFA)`.
- **BR League** : `500 joueurs. 5 jours de qualification. 1 finale. Le meilleur…` / `CYCLE EN COURS — / JOUEURS INSCRITS 0 / POT TOTAL — / PLACES RESTANTES — / Aucune saison de ligue pour le moment.`
- **Tournois** : `TOURNOIS ZOYD / Retrouve les tournois ouverts… Ce que tu vois ici correspond déjà à ton profil de jeu.` `TOURNOIS VISIBLES 0 / A GAGNER 0 ZC / PLACES OUVERTES 0` + filtres `A REJOINDRE / EN COURS / TERMINÉS / TOUS / 1VS1…` et `AUCUN TOURNOI OUVERT — Aucune inscription n'est ouverte pour tes filtres du moment.`

**Ce qui marche :** la règle du pass BR est la plus claire du site (déjà citée en exemple de bonne pratique). La ligne `gains en ZC (1 ZC = 10 FCFA)` pose le taux.

**Ce qui casse :**
- **BR League : 500 joueurs annoncés, 0 en attente** : même honnêteté que les stats, mais sans phrase de cadrage pilote. Le joueur se met en attente d'une ligue vide indéfiniment.
- **Tournois : `Ce que tu vois ici correspond déjà à ton profil de jeu`** est incompréhensible si on a filtré 5VS5. Le joueur en solo ne sait pas s'il rate des tournois.
- **Les 3 modes répètent 0 / 0 / 0 / 0** : d'une arène vide à 3 arènes vides, la perception d'absence est triplée.

**Sévérité :** Majeur. **P0/P1 :** masquer la BR League tant qu'elle n'est pas ouverte, ou afficher une liste d'attente WhatsApp ; dans Tournois, dire `Aucun tournoi pour ton format et ton niveau` au lieu de l'excuse générique.

### 2.15 Pages légales (6 pages)

**Vues en live (anonyme) :** `Conditions`, `Litiges`, `Anti-fraude`, `Confidentialité`, `Mentions`, `Jeu responsable` — toutes datées (oct 2026), avec lien retour accueil, email + WhatsApp répétés.

**Ce qui marche :** droit béninois, 18+, multi-compte = suspension, commission 2 % arbitrage, litige 30 min avec preuves, fraude graduée, plafond quotidien retrait 50 000 ZC, double frais FedaPay expliqué.

**Ce qui casse :**
- **Langage expert** : `litige temps réel`, `compte = une personne physique = un UID CODM`, `FedaPay`, `payout` — sans glossaire.
- **Conditions : 18 ans minimum** mais aucun mécanisme de vérification visible à l'inscription hors case.
- **Le joueur qui arrive à 20h pour payer n'a qu'un numéro WhatsApp** — même si on garde ton choix budgétaire, l'écran légal est le seul qui le redise en plein, pas un bandeau en haut du wallet.

**Sévérité :** Mineur. **P2 :** glossaire popover sur les pages légales.

### 2.16 états techniques : 404, chunk périmé, bootstrap, Render cold

**Vus :** `NotFound` (page introuvable), `RouteErrorBoundary` « UNE MISE À JOUR EST ARRIVÉE » (reload auto en 2 s depuis `d781eb9`), `BootstrapFailedPanel` (squelette puis erreur + Réessayer).
**Ce qui casse en pratique :** l'écran « UNE MISE À JOUR EST ARRIVÉE » est un écran d'erreur sur un écran de saisie. Le joueur perd le contenu du formulaire en cours (`/mj/creer`). Aucun brouillon n'est restauré.
Et Render en sleep = 30 s de squelette au premier chargement, sans « on réveille le serveur… ».

**Sévérité :** Majeur sur `/mj/creer`. **P0 brouillon localStorage sur step 3.**

---

## 3. Navigation globale

Barre haut : `0 ZC / UI / navbar` (avatar + cloche notification + engrenage paramètres + se déconnecter). En bas : `MULTI / TOURNOI / MSGS / WALLET / PLUS` (BottomNav sur mobile).
**Ce qui marche :** 5 voies claires, solde toujours visible, avatar = profil.
**Ce qui casse :**
- **`PLUS`** ne dit pas ce qu'il contient (classements ? BR ? earnings ? admin ?). Le joueur veut voir les gains, il doit ouvrir `PLUS` pour trouver `EARNINGS`.
- **Aucune aide / FAQ / support dans la navigation** : le joueur perdu n'a nulle part où cliquer hors WhatsApp.
- **Cloche notification** avec compteur `1` tant qu'on n'a pas ouvert le chat, même sans message.

**P1 :** `PLUS` en 4 sections visibles (`JOUER / GAGNER / SUIVRE / MOI`), aide `?` dans la navbar.

---

## 4. États vides — la mécanique de la solitude

Presque tous les écrans répètent le schéma « AUCUN X — Les X apparaîtront ici quand… ».
**La forme est bonne** (message + ligne d'explication). **Le fond est usant** : wallet, profil, classements, earnings, BR, tournois, chat disent tous « il n'y a rien ». À l'arrivée, l'utilisateur a ouvert 8 écrans dont 8 disent « rien ». Il conclut : « personne n'est ici ».
**P0 :** un seul écran `L'Arène est calme` dans le Hub MJ avec les matchs à créer, au lieu de 8 fois rien dans chaque écran. Les autres écrans ne devraient pas rappeler qu'ils sont vides, ils devraient juste orienter vers le hub (`Voir les matchs ouverts`).

---

## 5. Accessibilité / lisibilité (mobile et desktop)

**Ce qui marche :** cible 44 px sur la plupart des boutons, `aria-label` copiables, `role=radio`, `aria-current=step`, `progressbar`, lien d'évitement, 10 px micro-texte mais toujours majuscule et mono-espacé.

**Ce qui casse :**
- **Le 10 px mono** est courant aux États-Unis, pas en Afrique subsaharienne (téléphone 4,7", soleil). Sur 360×640, `FIABILITÉ 50+`, `SANS ARBITRE`, `ARBITRE ATTENDU / SYNC 15:07` sont en 10 px et peu contrastés. Le joueur doit zoomer pour jouer.

---

## 6. Ce qui manque — screens et éléments absents

1. **Onboarding 30 s** : 3 bulles « Créer → Adversaire rejoint → Salle CODM → Confirmer » après la connexion. Visible dans la formation CodM du joueur, pas dans les conditions.
2. **Aide / FAQ** : un `?` dans la barre avec une réponse par tunnel.
3. **Glossaire ZC/pass/ELO/payout** : popover au clic sur les termes en jaune.
4. **Preuves upload image** dans le litige (photo du score).
5. **Notifs mobile** : `salle partagée`, `adversaire rejoint`, `ton match démarre` — là où l'app est souvent fermée.
6. **QR code TOTP** (au lieu de secret à copier à la main).
7. **Dépôt guide en FCFA** : « 150 ZC ≈ 1 500 FCFA, tu receives X après frais » avant l'iframe FedaPay.
8. **Partage WhatsApp** dans `COPIER LE LIEN / PARTAGER` (lien de match avec QR + pseudo).

---

## 7. Tableau prioritaire (que de l'UI)

| # | Écran | Problème | Sévérité | Fix UI minimal |
|---|---|---|---|---|
| 1 | Serment | 10 `/10` bloque avant 1er match | Bloquant | résumé 3 clauses, après le 1er match |
| 2 | Inscription | 3 étapes avant 1 match | Bloquant | étape 1 = pseudo + tel + mot de passe |
| 3 | Hub MJ | `ACTIFS 1` + carte `MATCH ANNULÉ` | Bloquant | exclure annulés du hub et du compteur |
| 4 | Création | ZC sans FCFA, pot théorique, brouillon perdu | Majeur | FCFA + pot réel + brouillon localStorage |
| 5 | Détail match | Présence → Ready sans ordre, preuve liens texte | Bloquant coeur | ordre numéroté + upload image |
| 6 | Wallet | `Pret au retrait` à 0 ZC, retrait muet | Majeur | cadrage activation + FCFA sur presets |
| 7 | Classements | `#1` à 1200 ELO à 0 match | Majeur | pas de rang ni ELO tant que 0 match |
| 8 | BR League | `500 joueurs` pour 0 inscrits | Majeur | liste d'attente WhatsApp ou masquer |
| 9 | Erreur chunk | perte du formulaire | Majeur | brouillon + reload non destructif |
| 10 | Profil / Earnings | `100/100` et `VÉRIFIÉ ZOYD` à 0 activité | Mineur | `—` tant que pas d'activité |
| 11 | Navigation | `PLUS` opaque, aucune aide, cloche à 1 | Mineur | sections d'aides + ? |

---

## 8. Ce que je garde (avec tes contraintes)

- Stats honnêtes à zéro — **je garde**. J'ajoute juste la phrase qui les cadre.
- Contact WhatsApp — **je garde**. Je propose le libellé « WhatsApp, email à l'ouverture publique » au lieu d'exiger un mail payé.
- Promesse de paiement — **je garde**. Je propose « Activation à l'ouverture publique » en sandbox, pas un bouton retiré.

**Verdict UI/UX strict :** le joueur comprend « la promesse », mais ne comprend pas « le chemin » (serment → questionnaire → arène vide → création sans prix → match sans ordre → wallet sans cadre). Il s'épuise avant la première salle CODM. Corrige le chemin sans toucher à la promesse, et le produit devient jouable.

*Compte jetable `UiAudit292383` créé pour l'audit puis supprimé par `DELETE /api/auth/me` (200). Aucune autre donnée touchée.*
