# Audit de production — 2026-11-19

> Audit fonctionnel et UI/UX de `https://zoyd.vercel.app` en production.
> Lecture seule, hors compte de test. Aucun salon, tournoi, match ni
> paiement n'a ete cree pour l'audit.

---

## 1. Cadre

| Element | Valeur |
|---|---|
| Front | `https://zoyd.vercel.app` |
| API | `https://zoyd.onrender.com` |
| Commit de production | `896a2c8` (`deployedCommitShort`, `stateTrusted=true`) |
| Profil navigateur | OpenCLI `zoyd`, profil Chrome `4e8u677f` |
| Session | `0A8E38065E2AAA3935632485DC53A7DB` |
| Viewport | 1264 x 575 (desktop) |
| Compte de test | `AUDITPROD19` (`6742000019`), niveau 150, MJ/BR Legendary, Benin |
| Etat du compte | serment d'integrite signe, streamer off, solde 0 ZC |

Methode : parcours reel ecran par ecran, snapshots d'accessibilite, sondes
DOM (textes rendus, roles ARIA, tailles de cibles, ordre des titres,
statuts HTTP), lecture du code source pour confirmer chaque defaut.
Aucune conclusion ne repose sur une seule capture : chaque constat a ete
rejoue ou recoupe dans le DOM et, quand c'etait possible, dans le code.

### Echelles de gravite

| Niveau | Sens |
|---|---|
| **P1** | Le ecran affirme quelque chose de faux, ou contredit l'etat reel. Trompe le joueur sur l'argent, les places ou son classement. |
| **P2** | Blocage ou friction reelle : navigation perdue, clavier inoperant, nom accessible absent, erreur HTTP incorrecte. |
| **P3** | Finition : copie, langue, typographie, etats vides, coherence visuelle. |

---

## 2. Synthese

- **Aucun bloquant** : inscription, connexion, activation, deconnexion,
  deep links proteges, depot, chat, profil, parametres, BR, tournois,
  classements et pages legales s'ouvrent et repondent.
- **Aucune erreur console** sur l'ensemble des ecrans visites.
- **Aucun echec reseau inattendu** (hors 404 attendus sur IDs invalides).
- **19 defauts** retenus : **5 P1**, **9 P2**, **5 P3**.
- Les P1 sont tous du meme genre : **l'ecran dit une chose, la donnee en
  dit une autre**. C'est le risque le plus couteux pour une plateforme
  dont la promesse est l'argent et le classement.

---

## 3. Defauts P1 — donnees fausses ou contradictoires

### ZD-01 — `/mode` : bandeau Battle Royale code en dur

- **Constat** : le bandeau BR annonce « 1 salon ouvert ici, 100 joueurs max,
  pass 20 ZC = 200 FCFA » et les puces « SALON 100 JOUEURS / PASS 20 ZC ».
  En production, le seul salon existant est **annule**, a **10 ZC** de pass,
  avec **0 / 100** joueurs. La page `/br` affiche « SALONS OUVERTS 0 ».
- **Preuve** : `/mode`, texte rendu ; comparaison avec `/br`.
- **Source** : `src/app/pages/ModeSelectionPage.tsx:194-200`.
- **Risque** : le joueur choisit un mode sur une offre qui n'existe pas et
  sur un prix faux.
- **Correctif** : calculer le bandeau depuis `useBrStore` (nombre de salons
  `scheduled`, `maxPlayers`, `passPrice` du prochain salon) et afficher un
  etat vide honnete quand il n'y en a aucun. Chaine de repli : « Aucun
  salon ouvert — cree le tien ».
- **Test rouge** : rendu de `/mode` avec un store BR vide et un salon a
  10 ZC ; verifier l'absence de « 1 salon ouvert », de « 100 joueurs » et
  de « 20 ZC » codes en dur, et la presence du prix reel.

### ZD-02 — `/br` et `/br/:id` : un salon annule affiche « Imminent »

- **Constat** : le salon `BR-MWI1V2TC-N0` porte le badge **ANNULÉ** et
  affiche, dans la meme carte, un compte a rebours **« Imminent »**. Le
  detail reprend le meme libelle.
- **Preuve** : `/br`, carte « SALON BR ISOLATED » ; `/br/BR-MWI1V2TC-N0`.
- **Source** : `src/features/br/pages/BrPage.tsx:47-57` (`countDown` ignore
  `status`), appel ligne 109.
- **Risque** : laisse croire qu'une partie annulee va demarrer.
- **Correctif** : passer `lobby.status` a `countDown` ; retourner « — » (ou
  « Annule ») pour `cancelled`, `finished` et `settling`. Le detail doit
  utiliser le meme helper, pas un second calcul.
- **Test rouge** : `countDown(datePassee, 'cancelled')` doit renvoyer autre
  chose que « Imminent » ; test de rendu de la carte annulee.

### ZD-03 — `/classements` : « Pas encore classe » et ligne au rang 11

- **Constat** : le bandeau affirme « **Pas encore classé** — Joue un premier
  match pour entrer dans le classement », alors que la ligne
  `AUDITPROD19` figure dans le tableau **au rang 11**. L'introduction
  promet pourtant : « Un joueur qui n'a encore jamais joue n'y figure pas ».
- **Preuve** : `/classements`, onglet TOP ELO, texte rendu :
  `... PAS ENCORE CLASSÉ ... 11 AU AUDITPROD19 TOI BJ LEGENDARY 1200 ...`.
- **Source** : `src/app/pages/ClassementsPage.tsx:308-319` (calcul de
  `monActivite`), `358-369` (bandeau), `462-465` (ligne avec `rankIcon`).
- **Risque** : contradiction directe sur la position competitive du joueur.
- **Correctif** : une seule regle. Un joueur sans activite ne recoit aucun
  rang : soit il est exclu de `entries`, soit il est affiche dans une ligne
  « toi » distincte, hors classement, avec « Non classe » au lieu d'un
  numero. Le bandeau et le tableau doivent deriver du meme booleen.
- **Test rouge** : monter la page avec un utilisateur a `activityCount=0`,
  `totalMatches=0`, `totalEarnings=0` et un classement non vide ; verifier
  qu'aucun numero de rang n'est rendu pour `isMe`, et que le bandeau
  « Pas encore classe » est present. Deuxieme cas : activite > 0, rang
  affiche et bandeau absent.

### ZD-04 — `/mj/tournois` : « A gagner » et « Places ouvertes » incluent les archives

- **Constat** : l'en-tete affiche « 3 visibles / 76 ZC / 16 places » alors
  qu'**aucun tournoi n'est ouvert**. Les trois tournois sont termines ou
  annules. La cagnotte et les places sont additionnees sur **tous** les
  tournois, y compris ceux qui ne peuvent plus etre rejoints.
- **Preuve** : `/mj/tournois`, texte rendu et etat des cartes.
- **Source** : `src/features/tournament/pages/TournoisPage.tsx:94-105`
  (`tournaments.reduce` sans filtre), libelles `161-163`.
- **Risque** : promet de l'argent et des places qui n'existent plus.
- **Correctif** : calculer `playerPool` et `openSlots` sur
  `status === 'recruiting'` (et, si voulu, `live`), ou renommer les
  metriques en « Cagnotte historique » / « Places passees » et les sortir
  du bandeau d'action. La premiere option est preferee : un bandeau
  d'action ne doit sommer que de l'actionnable.
- **Test rouge** : jeu de donnees avec 1 tournoi `recruiting` a 20 ZC et
  4 places, plus 2 archives a 28 ZC et 12 places ; verifier « 20 ZC » et
  « 4 places », pas « 48 ZC » et « 16 places ».

### ZD-05 — `/mj/creer` : CTA de publication actif avec un solde insuffisant

- **Constat** : au recap, « SOLDE DISPO 0.0 ZC », « Il te manque 50.0 ZC
  pour publier cette partie », mais le bouton principal
  « **VERROUILLER LA MISE ET PUBLIER** » reste actif. Le clic renvoie vers
  `/wallet` avec un toast. Le titre du recap est « PRÊT À PUBLIER ».
- **Preuve** : `/mj/creer`, parcours 1VS1 > S&D/CRASH > mise 50 ZC >
  RECAPITULATIF.
- **Source** : `src/app/pages/mj/CreateMatchPage.tsx` (etape recap).
- **Risque** : le libelle promet une publication ; l'action reelle est un
  depot. Le joueur croit avoir publie ou ne comprend pas la redirection.
- **Correctif** : soit desactiver le CTA et le remplacer par
  « AJOUTER 50 ZC » qui mene au wallet, soit garder le CTA mais le
  renommer « AJOUTER 50 ZC POUR PUBLIER » et retirer « PRÊT À PUBLIER »
  tant que le solde est insuffisant. Une seule action, un seul mot.
- **Test rouge** : rendu du recap avec `balance < stake` ; le bouton
  principal doit porter le libelle de depot (ou etre desactive), et le
  titre ne doit pas dire « pret a publier ».

---

## 4. Defauts P2 — navigation, accessibilite, semantique

### ZD-06 — Deep links proteges : la destination est perdue

- **Constat** : ouvrir `/wallet`, `/mj/tournois/creer` ou `/profil` sans
  session redirige vers `/auth/login`. Apres connexion, l'application
  renvoie vers `/`, pas vers la page demandee.
- **Preuve** : deep links ouverts en navigation privee puis connexion avec
  `AUDITPROD19`.
- **Source** : `src/app/layouts/AppLayout.tsx:56` (redirection sans etat),
  `src/app/pages/auth/LoginPage.tsx:113` (`navigate('/')`).
- **Correctif** : rediriger avec `state.from = location.pathname +
  location.search` et, apres login, `navigate(from ?? '/')`. Ne conserver
  que les chemins internes (commencant par `/` et non `//`).
- **Test rouge** : Playwright — visiter `/wallet` deconnecte, se connecter,
  attendre `/wallet`. Variante : `/mj/tournois/creer`.

### ZD-07 — `/mj/creer` : « TON ÉQUIPE » affiche en 1VS1

- **Constat** : en format 1VS1, l'etape MISE propose « TON ÉQUIPE —
  SQUAD ALPHA / SQUAD BRAVO », et le recap affiche « TON EQUIPE SQUAD
  ALPHA ». Un 1VS1 n'a pas d'equipe.
- **Preuve** : `/mj/creer`, format 1VS1, etapes 3 et 4.
- **Source** : `src/app/pages/mj/CreateMatchPage.tsx:845`.
- **Correctif** : masquer le selecteur d'equipe quand `format === '1v1'`
  et ne pas envoyer `team` dans le payload. Afficher l'equipe uniquement
  pour 2VS2 et au-dela.
- **Test rouge** : rendu 1VS1 sans le texte « TON EQUIPE » ; rendu 2VS2
  avec le selecteur.

### ZD-08 — `/mj/creer` : groupes ARIA sans nom accessible

- **Constat** : `#format-group` et `#gamemode-group` portent un
  `aria-labelledby` qui pointe sur **eux-memes** : le nom accessible est
  vide. `#map-pool` est un `role="group"` contenant des `role="radio"`,
  alors qu'un ensemble de radios doit etre un `role="radiogroup"`.
- **Preuve** : `/mj/creer`, etapes 1 et 2, attributs releves dans le DOM.
- **Source** : `src/app/pages/mj/CreateMatchPage.tsx:377` et `:432`.
- **Correctif** : donner un `id` au titre visible de chaque groupe et le
  referencer dans `aria-labelledby` ; passer `#map-pool` en
  `role="radiogroup"` (les cartes restent des radios). Verifier aussi les
  fleches haut/bas dans chaque radiogroup.
- **Test rouge** : Playwright/axe — chaque radiogroup a un nom accessible
  non vide ; navigation clavier dans `#map-pool`.

### ZD-09 — `/parametres` : onglets inutilisables au clavier, survol illisible

- **Constat** : les quatre onglets sont des `role="tab"` tous a
  `tabindex="0"` (aucun roving tabindex), les fleches gauche/droite ne
  changent pas d'onglet. Au survol de l'onglet actif, le fond reste sombre
  et le texte passe en noir : contraste quasiment nul.
- **Preuve** : `/parametres`, onglets CONFIANCE / JEU / NOTIFICATIONS /
  COMPTE ; inspection des attributs et survol.
- **Source** : `src/app/pages/ParametresPage.tsx`.
- **Correctif** : appliquer le motif ARIA tabs (un seul `tabindex=0`,
  fleches, Home/End, `aria-controls`/`aria-labelledby`) et une regle de
  survol qui ne s'applique pas a l'onglet actif (ou qui garde un contraste
  >= 4.5:1).
- **Test rouge** : Playwright — focus sur l'onglet actif, fleche droite,
  l'onglet suivant est selectionne et focus ; capture du style survole de
  l'onglet actif et calcul de contraste.

### ZD-10 — `/chat` et `/auth/login` : wrapper `tabindex=0` non nomme

- **Constat** : les boutons « ENVOYER » (chat) et « SE CONNECTER »
  (login) sont enveloppes dans un `div[tabindex="0"]` sans nom accessible.
  Le clavier s'arrete sur une cible muette avant le bouton.
- **Preuve** : `/chat` (champ vide), `/auth/login` ; arbre d'accessibilite.
- **Source** : `src/app/components/ui/Button.tsx:111-121` (wrapper Motion).
- **Correctif** : ne pas rendre le wrapper focusable quand il ne porte pas
  d'interaction propre (`tabindex="-1"`), ou y deplacer le role et le nom
  du bouton. Le focus doit atterrir sur le bouton, une seule fois.
- **Test rouge** : Playwright — parcours Tab sur `/auth/login` ; aucun
  element focalise sans nom accessible, et « SE CONNECTER » recoit le
  focus une seule fois.

### ZD-11 — `/auth/login` : H2 avant H1

- **Constat** : l'ordre des titres commence par un H2, puis un H1 plus bas.
- **Preuve** : `/auth/login`, arbre des titres.
- **Source** : `src/app/pages/auth/LoginPage.tsx`.
- **Correctif** : promouvoir le titre principal en H1 et rétrograder le
  premier H2, ou supprimer le H2 decoratif.
- **Test rouge** : test de rendu — le premier titre de la page est un H1,
  un seul H1.

### ZD-12 — Pages d'erreur de detail : H2 sans H1, « Reessayer » trop petite

- **Constat** : `/mj/tournois/AUDIT-INVALID` et
  `/br-league/AUDIT-INVALID` affichent un H2 sans H1. Le bouton
  « Reessayer » mesure **66 x 20 px**, sous la cible tactile de 24 px.
  Le titre de l'onglet reste generique.
- **Preuve** : URLs ci-dessus, mesures DOM.
- **Source** : pages d'erreur des features tournoi et ligue.
- **Correctif** : H1 sur le message d'erreur, bouton avec padding vertical
  pour atteindre au moins 44 x 44 px (ou 24 px minimum), titre d'onglet
  « Introuvable — ZOYD » via `SEOHead`.
- **Test rouge** : rendu des deux pages — un H1, bouton dont la boite
  fait >= 24 px de haut, titre d'onglet non generique.

### ZD-13 — 404 applicative renvoyee en HTTP 200

- **Constat** : `/route-inexistante` rend bien la page 404, mais le statut
  HTTP est **200**. Les moteurs et les moniteurs voient une page valide.
- **Preuve** : requete HTTP directe sur une route inconnue ; rendu 404.
- **Source** : `vercel.json` — rewrite catch-all `/(.*)` vers
  `/index.html`.
- **Correctif** : a court terme, ajouter `<meta name="robots"
  content="noindex">` sur `NotFoundPage` et un `SEOHead` dedie. A moyen
  terme, une fonction edge qui renvoie un vrai 404 pour les chemins
  inconnus (liste blanche des routes de l'app).
- **Test rouge** : test e2e ou script de deploiement — `GET
  /route-inexistante` doit renvoyer 404 (ou, a defaut, contenir
  `noindex`).

### ZD-14 — `/classements` : deux colonnes « RANG », top 3 sans rang lisible

- **Constat** : l'en-tete affiche « RANG ... RANG ... » : la premiere
  colonne est la position numerique, la seconde est en realite le grade
  (`BRONZE`, `LEGENDARY`). Les trois premiers n'ont pas de numero : ce
  sont des icones (couronne/medailles) sans nom accessible.
- **Preuve** : `/classements`, TOP ELO ; en-tetes et lignes.
- **Source** : `src/app/pages/ClassementsPage.tsx:74-92`.
- **Correctif** : renommer la colonne de grade en « GRADE » (ou « RANG
  MJ ») ; donner un `aria-label` aux icones de podium (« Rang 1 »,
  « Rang 2 », « Rang 3 »).
- **Test rouge** : rendu — un seul en-tete « RANG », presence de
  « GRADE » ; les trois premieres lignes exposent un nom accessible
  contenant leur rang.

---

## 5. Defauts P3 — copie et finition

### ZD-15 — Accents manquants recurrents

- **Constat** : libelles sans accents dans BR, tournois et parametres :
  `DEBUT`, `REPARTITION`, `GARDEES`, `REPERES`, `reimbourse`, `preleve`,
  `organise`, `vehicules`, `desinscription`.
- **Preuve** : `/br`, `/br/:id`, `/mj/tournois`, `/parametres`.
- **Correctif** : corriger les chaines a la source (pas de remplacement
  global aveugle), puis ajouter un test de copie qui interdit les mots
  fautifs dans les ecrans concernes.
- **Test rouge** : test de rendu par ecran — absence de `reimbourse`,
  `preleve`, `DEBUT`, etc.

### ZD-16 — Anglais residuel dans les libelles visibles

- **Constat** : « Variant in-game » dans la creation BR et « Details » sur
  chaque carte de salon.
- **Preuve** : `/br` (creation et cartes), source
  `BrLobbyCreatePanel.tsx:282` et `BrPage.tsx:135`.
- **Correctif** : traduire les libelles visibles (« Variante en jeu »,
  « Detail ») ; garder les identifiants techniques en anglais uniquement
  dans le code.
- **Test rouge** : rendu de la creation et de la liste BR — absence de
  « Variant » et de « Details » dans le texte visible.

### ZD-17 — Repartition BR affichee en fractions sous « Total 100 % »

- **Constat** : les parts sont affichees `0,4` et `0,22` alors que le
  total est annonce « 100 % ». L'unite n'est pas la meme.
- **Preuve** : `/br`, formulaire de creation, section repartition.
- **Correctif** : multiplier par 100 a l'affichage (40 % / 22 %), ou
  afficher « 0,40 » et « 0,22 » avec un total « 1,00 ». Ne pas melanger
  fractions et pourcentages.
- **Test rouge** : rendu du formulaire — les parts et le total partagent
  la meme unite.

### ZD-18 — `/earnings` : graphique vide sans etat vide

- **Constat** : sans gains, le graphique est un cadre vide, sans texte
  expliquant qu'il n'y a pas encore de donnees ni comment en obtenir.
- **Preuve** : `/earnings` avec `AUDITPROD19`.
- **Correctif** : etat vide dedie (« Aucun gain pour l'instant — termine
  un match ou un tournoi pour voir ta courbe »), avec un CTA vers
  `/mode`.
- **Test rouge** : rendu avec `earnings=[]` — presence du message et du
  CTA, absence de conteneur de graphique vide.

### ZD-19 — Pages legales : adresse de contact sur Gmail

- **Constat** : l'adresse d'assistance publique est
  `coyd2976@gmail.com` (footer de toutes les pages legales et page
  Mentions). Pour une plateforme qui manipule de l'argent, une adresse
  Gmail personnelle baisse la credibilite et la delivrabilite.
- **Preuve** : `/mentions`, `/conditions`, `/confidentialite` ;
  `LegalLayout.tsx:32`.
- **Note** : la numerotation des sections est visuellement correcte
  (`1.` suivi d'une marge CSS) ; seul le DOM concatene le texte. Ce point
  n'est pas un defaut.
- **Correctif** : utiliser une adresse du domaine (`contact@zoyd.gg` ou
  equivalent), avec redirection vers la boite de support.
- **Decision du 2026-11-21** : les coordonnees actuelles sont conservees.
  Aucune boite du domaine n'existe (`zoyd.gg` et `zoyd.app` ne resolvent
  pas, `zoyd.com` n'a pas de MX) ; afficher une adresse inventee serait pire
  que le Gmail actuel. Le point reste ouvert jusqu'a la mise en place d'une
  boite support reelle.
- **Test rouge** : rendu de la page Mentions — l'adresse affichee
  appartient au domaine de l'application.

---

## 6. Verifie sans defaut

- Inscription en 3 etapes, validation des champs, activation, connexion,
  deconnexion.
- Validation « CHOISIS UN MODE ET UNE CARTE. » avant publication.
- Redirection solde insuffisant vers `/wallet` avec toast explicite.
- Modal de depot : `role="dialog"`, `aria-modal`, focus piege, Escape
  ferme, presets coherents.
- Deep links proteges : redirection effective vers `/auth/login` (le
  retour post-login est le defaut ZD-06, pas la protection).
- Chat : creation de discussion, etat vide, formulaire.
- Profil public, profil prive, parametres (4 onglets), wallet, earnings.
- `/br`, `/br-league`, `/mj/tournois`, `/mj/tournois/creer`, `/infos`,
  `/mode`, `/auth/*`, 404, 6 pages legales : rendu, titres, liens.
- Aucune erreur console, aucun echec reseau inattendu sur le perimetre.

---

## 7. Limites de l'audit

- **Admin** : `/admin` et la saison de ligue complete exigent un email
  admin, un mot de passe et un secret TOTP. Non audites.
- **IDs reels** : le match `M-MWHYO9FS` (termine, 10 joueurs) et le tournoi
  `T-MJ-MWJ5RZ3E` (termine, 8 entrees, 8 matchs) ont ete examines le
  2026-11-23. Aucune saison de ligue n'existe en production
  (`GET /api/leagues` renvoie `total: 0`) : seul l'etat vide de
  `/br-league` est verifiable.
- **Mobile/tablette** : audite le 2026-11-23 a 360 x 800 et 768 x 1024 sur
  13 ecrans joueur. Aucun debordement horizontal ni clip interne. Trois
  familles de cibles tactiles sous 44 px ont ete corrigees (ZD-22).
- **Performance** : mesure du 2026-11-23 sur cache froid et CPU x4. La
  connexion transfere 589 Ko et rend son LCP a 6,7 s ; le bundle total
  pese 2,0 Mo brut, dont 365 Ko de graphiques charges seulement sur
  `/earnings`. Pas de donnees terrain Lighthouse/Web Vitals.
- **Paiement** : le widget FedaPay de production ouvre bien
  `sandbox-checkout.fedapay.com` avec une cle `pk_sandbox` (mode sandbox
  assume avant lancement). Le parcours de bout en bout est documente dans
  `docs/architecture.md` (11 depots sandbox credites) ; aucun depot reel
  n'a ete effectue et les cles live restent a configurer avant ouverture
  publique.
- **Artifact de test** : les transitions d'etape de `/mj/creer` sont
  pilotees par animation et ne progressent pas dans un onglet Chrome non
  visible (`visibilityState=hidden`). Ce n'est pas un defaut utilisateur
  constate ; cela impose seulement de garder la fenetre au premier plan
  pendant les tests.

---

## 8. Plan de correction propose

Chaque correctif suit la regle : **test rouge d'abord**, puis vert, puis
gates et push. Commits ASCII, francais, `INVARIANT :` / `PIEGE :` la ou le
code fige une regle.

### Lot 1 — Verite des donnees (P1)

| Ordre | Defaut | Test rouge |
|---|---|---|
| 1 | ZD-02 countdown BR | unite sur `countDown` + rendu carte annulee |
| 2 | ZD-04 metriques tournois | rendu avec archives + tournoi ouvert |
| 3 | ZD-03 classement | rendu sans activite + rang masque |
| 4 | ZD-01 bandeau `/mode` | rendu avec store BR vide / salon 10 ZC |
| 5 | ZD-05 CTA recap | rendu solde insuffisant |

### Lot 2 — Navigation et accessibilite (P2)

| Ordre | Defaut | Test rouge |
|---|---|---|
| 1 | ZD-06 deep link | Playwright retour vers `/wallet` |
| 2 | ZD-09 onglets parametres | clavier + contraste |
| 3 | ZD-08 groupes ARIA | axe + clavier radiogroup |
| 4 | ZD-10 wrapper focusable | parcours Tab login/chat |
| 5 | ZD-11 H2 avant H1 | ordre des titres |
| 6 | ZD-12 pages erreur | H1 + cible 24 px |
| 7 | ZD-14 classement | en-tetes + noms accessibles |
| 8 | ZD-13 soft 404 | statut HTTP ou noindex |
| 9 | ZD-07 equipe 1VS1 | rendu 1VS1 / 2VS2 |

### Lot 3 — Copie et finition (P3)

ZD-15, ZD-16, ZD-17, ZD-18, ZD-19.

### Gates avant chaque commit

```text
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
npx eslint src server e2e scripts
npx vitest run
npx playwright test
npx vite build
```

Puis push sur `main`, verification du commit deploye sur
`https://zoyd.vercel.app/version.json` (ou l'endpoint equivalent), et
controle visuel du ou des ecrans corriges en production.

---

## 9. Journal des preuves

| Date | Ecran | Preuve |
|---|---|---|
| 2026-11-19 | `/mode` | « 1 salon ouvert ici, 100 joueurs max, pass 20 ZC » |
| 2026-11-19 | `/br` | badge `ANNULÉ` + « Imminent » sur `BR-MWI1V2TC-N0` |
| 2026-11-19 | `/classements` | « Pas encore classe » + ligne `AUDITPROD19` rang 11 |
| 2026-11-19 | `/mj/tournois` | « 3 visibles / 76 ZC / 16 places », aucun tournoi ouvert |
| 2026-11-19 | `/mj/creer` | solde 0 ZC, CTA « VERROUILLER LA MISE ET PUBLIER » actif |
| 2026-11-19 | `/mj/creer` | « TON EQUIPE SQUAD ALPHA » en 1VS1 |
| 2026-11-19 | `/br/BR-MWI1V2TC-N0` | « Imminent », « reimbourse », « preleve » |
| 2026-11-19 | `/mj/tournois/AUDIT-INVALID` | H2 sans H1, « Reessayer » 66 x 20 px |
| 2026-11-19 | `/route-inexistante` | page 404 rendue, HTTP 200 |
| 2026-11-19 | `/parametres` | onglets `tabindex=0`, fleches inoperantes, survol illisible |
| 2026-11-21 | `/br` | « Organisé par », « Détail », parts `40/22/13/12/8/5`, « Total 100 % » |
| 2026-11-21 | `/earnings` | « Aucun gain pour l'instant » + CTA « Trouver un match » vers `/mode` |
| 2026-11-21 | `/parametres` | « Infos gardées privées » (GAMING), « ta présence » (NOTIFICATIONS) |

---

## 10. Etat des correctifs

| Lot | Defauts | Commit | Etat |
|---|---|---|---|
| 1 - verite des donnees | ZD-01 a ZD-05 | `bf712ad` | corrige, deploye, verifie en production |
| 2 - navigation et accessibilite | ZD-06 a ZD-14 | `d46249b` | corrige, deploye, verifie en production |
| 3 - copie et finition | ZD-15 a ZD-18 | `2d7ea8a`, `7656acb` | corrige, deploye, verifie en production ; ZD-19 differe (coordonnees actuelles conservees) |
| 4 - donnees reelles et mobile | ZD-20 a ZD-22 | `318f7c2`, `ab0ad16` | corrige, deploye et verifie en production |
| 5 - images et polices | ZD-23, ZD-24 | `4079ef5`, `8f836b7` | corrige, deploye et verifie en production |

Verification production du Lot 1 (`buildId bf712ad0f2ad`) : `/mode` ne
promet plus ni prix ni capacite ; `/classements` affiche `NC` pour le compte
sans activite ; les chunks `CreateMatchPage` et `BrPage` servis contiennent
les nouveaux libelles. Tests ajoutes : `lobbyTiming`, `tournamentMetrics`,
`rankingOrder`, `publishCta`, e2e `mode-hierarchie` et assistant de match.

Verification production du Lot 2 (`buildId d46249b87af3`) :
`/route-inexistante` renvoie HTTP 404 alors que `/mj/creer` et
`/br-league/inconnue` restent servis en 200 ; `/auth/login` n'a qu'un H1 et
aucun `div[tabindex="0"]` ; `/parametres` expose quatre onglets avec un seul
`tabindex=0`, et la fleche bas deplace le focus et la selection ; le deep
link `/wallet` revient sur `/wallet` apres connexion ; `/mj/creer` en 1VS1
ne montre aucun « Ton equipe » aux etapes 3 et 4 et ses trois radiogroups
sont nommes ; `/classements` n'affiche qu'un `RANG`, une colonne `GRADE` et
trois rangs de podium nommes ; les details tournoi et ligue inconnus
affichent un H1, le titre « Introuvable — ZOYD » et un bouton de 44 px.
Tests ajoutes : `postLoginRedirect`, `vercel-rewrites`, e2e
`parametres-tabs`, `focus-order`, `detail-errors`, `classements-auth` et
extensions de `auth-flow` / `ui-audit-flows`.

Verification production du Lot 3 (`buildId 7656acb77255`) :
`/br` affiche « Organisé par », « Détail », « Ton pass est prélevé » et
« des joueurs présents », sans « Details » ni « Variant in-game » ; le
formulaire de creation montre « Variante en jeu », des parts
`40 / 22 / 13 / 12 / 8 / 5` et « Total 100 % » ; `/parametres` affiche
« Infos gardées privées » (onglet GAMING) et « ta présence » (onglet
NOTIFICATIONS) ; `/profil` affiche « Tes repères CODM » ; `/earnings`
affiche l'etat vide « Aucun gain pour l'instant », le CTA « Trouver un
match » vers `/mode` et aucun conteneur de graphique ; `/mentions`
conserve l'adresse actuelle sur decision du 2026-11-21.
Tests ajoutes : `payoutDisplay`, `walletInsights`, extension de
`copy-rules` (`present`, `presence`, `confirmee`, `BrArbiterPanel`) et
e2e `earnings-empty` + assertions BR sur les libelles accentues.

---

## 11. Audit complementaire du 2026-11-23

### ZD-20 - champs absents d'un match ancien rendus « undefined »

- **Constat** : `/mj/match/M-MWHYO9FS`, match termine reel, affiche
  « BOundefined », « Score cible : undefined », « Score Alpha : undefined »
  et « Score Bravo : undefined ». Ce match ancien ne porte pas
  `rules.bestOf`, `rules.scoreTarget` ni `result.scores.*`.
- **Correctif** : `src/features/match/matchDisplay.ts` formate une valeur
  absente en tiret cadratin sans inventer de valeur ; `MatchRules` et
  `MatchResults` passent par ce formateur. Les libelles du resultat sont
  accentues (« Score confirmé », « Gains distribués ») et la phrase de
  match clos parle de gains « réglés » et d'un resultat « réexaminé ».
- **Test** : `matchDisplay.test.ts`, ecrit rouge avant le module (5 cas).

### ZD-21 - panneau « Rejoindre le tournoi » sur un tournoi termine

- **Constat** : `/mj/tournois/T-MJ-MWJ5RZ3E`, tournoi termine avec 8/8
  inscriptions, affiche encore « Rejoindre le tournoi », le solde du
  lecteur et « Cout inscription » : une action que le serveur refusera.
- **Correctif** : `shouldShowJoinPanel` ne rend le panneau que si le
  tournoi recrute, ou si le lecteur a deja une inscription ou un poste
  arbitre. Le titre suit le statut (« Tournoi terminé », « Tournoi
  annulé ») et le solde/l'inscription ne s'affichent qu'en recrutement.
  « Cout inscription » devient « Coût d'inscription ».
- **Test** : `joinPanel.test.ts`.

### ZD-22 - cibles tactiles sous 44 px a 360 px

- **Constat** : a 360 px, « Jouer maintenant » et « Voir tout » rendent
  15 px de haut, le lien BR League et « Hub MJ » / « Voir les tournois »
  24 px. Les liens « Retour aux matchs » et « Retour aux tournois »
  restaient a 24 et 40 px.
- **Correctif** : classe `touch-target` (44 x 44 px) sur ces liens, sans
  changer leur libelle ni leur destination.
- **Test** : e2e `responsive.spec.ts` test F. Rouge avant correctif avec
  six mesures a 15/24 px, vert apres.

### Mesure de performance

Mesure du 2026-11-23 sur `/auth/login`, cache froid et CPU x4 :
TTFB 1,4 s, DOM 4,8 s, LCP 6,7 s, CLS 0,001, 589 Ko transferes. Le
bundle de production pese 2,0 Mo brut (60 fichiers) ; les plus gros
morceaux sont `vendor-charts` (365 Ko, charge seulement par `/earnings`),
`vendor-react` (358 Ko), `index` (310 Ko) et `vendor-motion` (129 Ko).
Les sept visuels presse pesent 1,3 Mo a eux seuls ; ils sont deja
`loading="lazy"` hors priorite. Aucun correctif de performance n'a ete
applique dans ce lot : le gain demanderait des variantes responsives
d'images et un audit des polices, a arbitrer avec le design.

### Paiement

Le widget s'ouvre en production sur `sandbox-checkout.fedapay.com` avec
une cle publique `pk_sandbox`, conformement au mode sandbox assume avant
lancement (`docs/architecture.md`). Les operateurs MTN MoMo, Moov Money
et Celtiis sont proposes. Aucun depot n'a ete conclu pendant cet audit :
le parcours de bout en bout est celui, deja documente, des 11 depots
sandbox. Avant ouverture publique, il faudra remplacer les cles par des
cles live, rejouer un depot reel de faible montant et verifier le credit
serveur.

### Gates du Lot 4

`tsc` application et serveur, eslint `src server e2e scripts`, 178
fichiers / 1672 tests Vitest, Playwright 308 passes (1 flaky de connexion
sous charge, repasse seul), `vite build`. Verification production apres
deploiement : aucune chaine `undefined` sur le match reel, panneau
d'inscription absent du tournoi clos, cibles tactiles mesurees a 44 px.

---

## 12. Arbitrage performance du 2026-11-24

### ZD-23 - images plein format sur des cadres petits

- **Constat** : sur `/auth/login` a 390 x 844 et DPR 3, la production
  transfere 588,4 Ko, dont 52,4 Ko pour le wordmark rendu a 142 px de
  large et 49,5 Ko pour un portrait de fond a 5 % d'opacite. Les sept
  key arts JPEG ne declaraient aucune variante responsive.
- **Correctif** : 28 variantes WebP, de 240 a 1440 px selon la largeur
  du fichier d'origine, sont declarees dans `illustrations.json`.
  `srcsetIllustration` les ordonne pour `Illustration` ; `srcsetPourUrl`
  couvre aussi les images deja resolues d'`EmptyPanel`. Les JPEG restent
  disponibles pour les images de partage et le repli. Le wordmark passe
  par `<picture>` avec `logo-480.webp` (11,1 Ko) et `logo.webp`
  (18,9 Ko), sans supprimer le PNG.
- **Tests** : trois verrous dans `illustrations.test.ts` (fichiers,
  largeurs et helpers) et trois e2e dans `images-responsives.spec.ts`.
  Rouge initial : sept visuels sans variantes et helpers absents ; vert
  apres generation et branchement.

### ZD-24 - fontes variables avec axes et tables inutilises

- **Constat** : les quatre fontes latines de la connexion pesent
  161,2 Ko transfers (160,1 Ko sur disque). Inter embarque l'axe
  100-900 alors que sa face est declaree 300-600 ; JetBrains Mono
  embarque 100-800 alors que l'interface n'utilise que 400 a 800.
- **Correctif** : sous-ensembles WOFF2 conserves dans `public/fonts/`.
  Inter est instance a 300-600, JetBrains Mono normal et italique a
  400-800 ; Outfit garde son axe, son sous-ensemble suffisant au budget.
  Seules les fonctions `kern`, `liga`, `clig` et `calt` sont conservees.
  Les caracteres de l'interface, les ligatures OE/oe et le latin-ext
  restent couverts ; le Y trema majuscule reste en latin-ext comme dans
  les fichiers Google Fonts d'origine.
- **Mesure sur disque** : Outfit 31,5 -> 28,2 Ko, Inter 47,1 -> 30,3 Ko,
  JetBrains Mono 39,5 -> 28,4 Ko, JetBrains Mono italique 42,0 ->
  30,1 Ko. Total 160,1 -> 117,0 Ko (-26,9 %).
- **Tests** : `fonts.test.ts`, rouge avec quatre fichiers au-dessus de
  31 Ko et 160,1 Ko cumules, vert apres optimisation. Les huit fichiers
  WOFF2 ont ete relus avec `fontTools` pour verifier les axes et les
  caracteres accentues.

### Mesure comparative du Lot 5

Meme page `/auth/login`, viewport 390 x 844, DPR 3 et cache froid. La
baseline est la production du 2026-11-24 ; l'apres est le build Vite
local, seul le poids transfere etant compare entre ces environnements.

| Mesure | Avant | Apres | Gain |
|---|---:|---:|---:|
| Total des ressources | 588,4 Ko | 476,0 Ko | 112,4 Ko (-19,1 %) |
| Quatre fontes | 161,2 Ko | 118,2 Ko | 43,0 Ko |
| Wordmark + portrait | 101,9 Ko | 41,7 Ko | 60,2 Ko |

Le LCP local n'est pas compare au LCP de production : reseau, serveur et
charge CPU different.

### Verification production du Lot 5

Build `8f836b757151`, 13/13 controles passes sur `/auth/login` :

- mobile 390 x 844 DPR 3 : `portrait-ghost-564.webp` et
  `logo-480.webp` sont selectionnes, `logo.png` et tous les JPEG presse
  sont absents des requetes ;
- desktop 1280 x 900 : `duel-operateurs-1440.webp` est selectionne et
  aucun JPEG presse n'est telecharge ;
- les quatre fontes latines pesent 118,2 Ko sur les deux viewports ;
- le total mobile est 485,6 Ko, soit 102,8 Ko de moins que la baseline
  production de 588,4 Ko (-17,5 %).

Ces controles verifient les ressources reellement choisies par le
navigateur. Ils ne constituent pas une nouvelle mesure LCP : la variabilite
reseau deja constatee empeche d'attribuer un gain de delai au seul lot.

### Gates du Lot 5

`tsc` application et serveur, eslint `src server e2e scripts`, 179
fichiers / 1679 tests Vitest, Playwright 312 passes (0 echec, 0 flaky),
`vite build`. Les trois nouveaux tests images sont inclus dans la suite
complete. La premiere execution Playwright a ete interrompue par le
budget de 40 minutes pendant la derniere spec ; la relance isolee avec un
budget de 60 minutes a abouti en 47,5 minutes.

---

*Rapport etabli le 2026-11-19 sur le commit de production `896a2c8`.
Aucune donnee de production n'a ete modifiee en dehors du compte de test
`AUDITPROD19`, cree puis utilise pour les parcours.*
