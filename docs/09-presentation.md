# ZOYD — La présentation complète, pour tout le monde

> **À qui s'adresse ce document ?** À qui que ce soit qui veut comprendre ce
> qu'est ZOYD — sans savoir programmer. Un joueur, un futur arbitre, un
> investisseur, un ami curieux, un chargé de projet, un agent de paiement. Si
> vous savez seulement utiliser un navigateur et un téléphone, ce document est
> écrit pour vous : chaque notion technique est expliquée en même temps qu'elle
> est utilisée.
>
> **Ce document ne remplace pas les autres :** la documentation technique du
> projet (documents `01` à `08`, entrée par `00-INDEX.md`) décrit chaque
> mécanisme avec ses preuves dans le code, ligne par ligne. Ici, on raconte la
> même chose en français courant. Chaque fois qu'un chiffre est avancé, il est
> **vérifié** : il vient de cette documentation ou du code, pas d'une
> impression. Si vous voulez la preuve d'une affirmation, le renvoi vers le
> document de référence suit presque chaque bloc.
>
> Rédigé le 02/11/2026, à partir de l'état du dépôt `Zoyd/` au commit
> `fbeb797` (branche `main`) ; relecture complète et mise à jour le
> 06/11/2026 au commit `e716637` : modèle d'équipe « squad libre »
> intégré (pass individuel, gains en parts égales) et comptes de tests
> actualisés ; reprise le soir même au commit `b780b44` : la sortie de
> match volontaire (annulation par le créateur) et le nettoyage 14 jours
> qui rembourse avant d'archiver. Les chiffres du produit (mise, commissions,
> fenêtres, plafonds) sont ceux **implémentés** — pas des promesses : ce
> document décrit ce qui tourne, pas ce qui est souhaité. Ce qui n'est pas fini
> est listé au chapitre 15.

---

## Table des matières

1. [ZOYD en une phrase, et l'image à retenir](#1-zoyd-en-une-phrase-et-limage-à-retenir)
2. [Le problème que ZOYD résout](#2-le-problème-que-zoyd-résout)
3. [Les personnages du récit](#3-les-personnages-du-récit)
4. [Le vocabulaire, version simple](#4-le-vocabulaire-version-simple)
5. [Le territoire : les grands blocs du site](#5-le-territoire-les-grands-blocs-du-site)
6. [La vie d'un match MJ, du début à la fin](#6-la-vie-dun-match-mj-du-début-à-la-fin)
7. [Les autres horloges : tournoi, ligue, salon BR](#7-les-autres-horloges-tournoi-ligue-salon-br)
8. [L'argent, de bout en bout](#8-largent-de-bout-en-bout)
9. [La technologie, expliquée comme à un débutant](#9-la-technologie-expliquée-comme-à-un-débutant)
10. [La sécurité, expliquée comme à un débutant](#10-la-sécurité-expliquée-comme-à-un-débutant)
11. [Les garde-fous automatiques (la machine qui ne dort jamais)](#11-les-garde-fous-automatiques-la-machine-qui-ne-dort-jamais)
12. [Les tests : le projet se vérifie lui-même](#12-les-tests-le-projet-se-vérifie-lui-même)
13. [Faire tourner la boutique : exploitation](#13-faire-tourner-la-boutique-exploitation)
14. [Où on en est aujourd'hui](#14-où-on-en-est-aujourdhui)
15. [Ce qui n'est pas fini (et c'est assumé)](#15-ce-qui-nest-pas-fini-et-cest-assumé)
16. [FAQ : les questions que tout débutant se pose](#16-faq-les-questions-que-tout-débutant-se-pose)
17. [Glossaire final](#17-glossaire-final)
18. [Annexe : les chiffres du projet](#18-annexe-les-chiffres-du-projet)

---

## 1. ZOYD en une phrase, et l'image à retenir

**La phrase.** ZOYD est une plateforme de compétition Call of Duty Mobile
pensée pour l'Afrique francophone, où deux joueurs (ou deux équipes de deux à
cinq) mettent chacun une somme d'argent en jeu, s'affrontent dans le jeu, et
un **arbitre** — un joueur comme les autres, rémunéré pour ce rôle — valide le
résultat. Les mises et les gains circulent en **ZOYD Coins (ZC)**, des jetons
de la plateforme convertibles en **FCFA** via le Mobile Money.

**L'image à retenir.** Imaginez un grand tournoi de baby-foot dans un quartier
populaire :

- les joueurs posent 500 F chacun dans une cagnotte en verre, au centre de la
  table, sous les yeux de tous ;
- un arbitre du quartier surveille la partie. Il ne joue pas contre eux :
  son travail est de vérifier qui a gagné, et il gagne lui-même une petite
  commission pour ce service ;
- quand la partie est finie, l'arbitre donne la cagnotte au vainqueur — moins
  sa commission ;
- si deux joueurs se disputent sur le résultat (« j'ai gagné ! », « non, c'est
  moi ! »), **la cagnotte reste sous le verre, gelée**, le temps de trancher ;
- le patron du café, lui, ne prend **rien** sur les mises : sa seule recette,
  c'est un très léger pourcentage quand un joueur veut **retirer** son argent
  pour le rendre en cash.

ZOYD, c'est ce café — mais en ligne, à l'échelle d'un pays, avec un véritable
système de paiement, des horloges automatiques et des tests informatiques pour
garantir que personne ne vole personne.

**Une phrase de cahier des charges** (tirée de la documentation du projet) :
« Un joueur ouvre un match, d'autres rejoignent en miseant, et un arbitre —
un joueur comme les autres — valide le résultat et est rémunéré pour ce
rôle. CODM est le premier terrain ; l'infrastructure est conçue pour en
ouvrir d'autres. » *(source : `docs/00-INDEX.md`, § 1.)*

---

## 2. Le problème que ZOYD résout

### 2.1 Le problème n° 1 : la confiance

Quand deux adversaires qui ne se connaissent pas veulent parier sur un match,
trois questions empoisonnent tout :

1. **« Est-ce que le perdant va vraiment payer ? »** Sur les groupes
   WhatsApp, entre joueurs, chacun a déjà entendu parler d'un match gagné…
   et jamais payé.
2. **« Qui décide du résultat ? »** Quand les deux camps ont chacun leur
   capture d'écran, le débat peut durer des jours, et il n'y a pas de
   juge neutre.
3. **« Et si on me vole dans le groupe ? »** Des intermédiaires recueillent
   les mises, personne ne contrôle leur caisse.

ZOYD répond aux trois : **l'argent est mis de côté dès l'inscription au
match** (techniquement, il est « verrouillé » — voir le chapitre 8 : il
quitte le portefeuille et n'appartient plus à personne, ni au joueur, ni à
l'adversaire, ni à la plateforme), **le résultat est validé par un arbitre
extérieur aux deux camps**, et **la cagnotte n'est libérée qu'après sa
décision**.

### 2.2 Le problème n° 2 : l'argent local

Le Mobile Money (envoyer de l'argent via son téléphone, sans banque) est la
manière normale de payer en Afrique francophone. Un site de compétition qui
ne parlerait que carte bancaire serait inutilisable pour la majorité des
joueurs. ZOYD est donc branché dès le premier jour sur le **paiement
Mobile Money** via un prestataire de paiement qui agrège les opérateurs,
et toute l'économie intérieure du site tourne en unités locales :
**1 ZOYD Coin (ZC) = 10 FCFA**. *(source : `docs/02-modele-metier.md`, § 1.2.)*

### 2.3 Le problème n° 3 : le silence des horloges

Un match sans règles de délai tombe toujours dans les mêmes pièges :
l'adversaire ne se présente pas, l'arbitre disparaît, le gagnant attend son
argent pendant des semaines. ZOYD a donc installé des **horloges
automatiques** partout : délai pour prendre son poste, délai pour saisir le
résultat, délai de confirmation, délais d'expiration, remboursements
automatiques. Elles sont décrites au chapitre 6 et la liste complète des
seize balayages automatiques est au chapitre 11.

### 2.4 Ce que ZOYD n'est PAS

C'est écrit noir sur blanc dans la documentation, et cela évite beaucoup de
malentendus : ZOYD n'est **pas** un site de tournois de l'ombre, **pas** une
place de marché, **pas** un casino — pas de machine à sous, pas de pari sur
un résultat extérieur, pas de « multiplicateur ». On ne mise que sur une
vraie compétition, contre un adversaire réel. Et ZOYD n'est
**pas** un produit Call of Duty Mobile : c'est une infrastructure de matchs
qui est *aujourd'hui* raccordée seulement à CODM, mais prévue pour
d'autres jeux du même type. *(source : `docs/00-INDEX.md`, § 1.)*

---

## 3. Les personnages du récit

Tout ZOYD se décrit avec six rôles. Chacun a ses droits, ses devoirs et
ses avantages.

### 3.1 Le joueur

C'est vous. Vous créez un compte (pseudo, email, mot de passe, identifiant
CODM, consentement légal 18+/CGU), vous alimentez votre portefeuille en
ZOYD Coins, et vous rejoignez un match ou un tournoi. Dans les formats
d'équipe (2v2 à 5v5), **chacun paie son propre pass** : le premier joueur
crée l'équipe (« capitaine » de nom seulement), les coéquipiers rejoignent
depuis leur compte et verrouillent la mise chacun pour soi. Le capitaine
n'encaisse jamais l'argent des autres, et les gains sont divisés en parts
égales versées **directement à chaque membre**. *(source :
`docs/02-modele-metier.md`, § 5.1 et § 7.5.)*

Il existe aussi une page de profil publique (statistiques, date
d'inscription, badges de confiance) et un système d'amis, de blocages et de
signalements.

### 3.2 Le créateur de match

Le premier joueur à ouvrir un match en choisit les règles : format (1v1 à
5v5), montant de la mise, nombre maximum de joueurs, mode de jeu et
paramètres CODM pertinents. Ce créateur n'a aucun privilège : dès que les autres peuvent rejoindre,
le match se déroule sans lui, et il pose sa mise comme tout le monde.

### 3.3 L'arbitre

C'est le personnage central, et il est volontairement démystifié : **un
arbitre est un joueur comme les autres**. Il possède un compte ZOYD ordinaire, sans titre particulier — à une
différence près : il accepte un poste dans un match. Une fois au poste,
il saisit le résultat à la fin, il
gère les délais (check-in, lancement), et il touche une **commission
d'arbitrage** qui varie selon le moteur :

| Compétition | Commission de l'arbitre |
|---|---|
| Match MJ (1v1 à 5v5) | **2 %** du pot verrouillé |
| Tournoi | **5 à 10 %** |
| Ligue | **0 %** — il n'y a pas d'arbitre du tout (voir 3.5) |
| Salon Battle Royale | **au plus 5 %** |

*(source : `docs/02-modele-metier.md`, § 1.2 et § 3.3.)*

L'arbitre a **cinq obligations** codifiées dans la documentation
(`docs/02-modele-metier.md`, § 3.2) : être présent, faire le lien avec la
partie CODM (créer la salle, partager les identifiants), lancer, saisir le
résultat, respecter les délais. S'il disparaît, les horloges
automatiques le remplacent pour protéger les joueurs (remboursement ou
traitement équivalent, voir chapitre 11).

Deux points importants :

- son paiement passe par le **même circuit sécurisé que les gains** (c'est la
  primitive `releaseWalletWinnings` du moteur de portefeuille, avec la
  protection anti-double-paiement — chapitre 8) ;
- si sa commission échoue au versement, elle est reprise automatiquement
  toutes les 30 minutes (chapitre 11).

### 3.4 Le visiteur de la page (il n'y a pas de « spectateur »)

Le mot « spectateur » suppose un œil admis à regarder la partie. ZOYD
refuse ce terrain : un salon CODM ne reçoit que les joueurs et
l'arbitre — en tournoi à plusieurs arbitres, ils se partagent les
salons, pour qu'aucune équipe qui ne joue pas observe une autre. Une
personne extérieure voit donc les **faits officiels** de la page : deux
pseudos en duel, l'heure de lancement, l'arbitre désigné, l'état des
fenêtres — pas le match. Pour cause : l'arbitre saisit le résultat
**à la fin**, jamais pendant, et ZOYD ne publie aucun flux de partie.
Le canal de discussion du match reste ouvert aux inscrits ; streamer un
match ou un tournoi est interdit en l'état, car le stream-sniping ne
peut être exclu. *(source : `docs/02-modele-metier.md`, § 3.4.)*

### 3.5 L'arbitre du salon Battle Royale (et le cas particulier du volontariat « A7 »)

Dans les salons Battle Royale, le rôle change de nature : l'arbitre est
**désigné à la création du salon** — par défaut, c'est le créateur, et il
peut choisir n'importe quel autre compte existant. Il n'est **jamais joueur**
de son salon, et il n'a pas besoin d'une permission particulière pour l'être :
c'est le principe du **volontariat A7**, une règle vérifiée par les gardes
du serveur. Il publie la salle, lance la partie, élimine les joueurs au fur
et à mesure et saisit le classement final. Sa commission est une part du
pot (au plus 5 %).

À l'inverse, dans les **ligues**, il n'y a **aucun arbitre** : toutes les
transitions (inscrire une journée, saisir le classement, verser les gains, faire
avancer la saison) sont réservées à l'équipe d'administration ZOYD, comme un
« juge et partie » assumée. La contrepartie, c'est l'authentification à deux
facteurs obligatoire pour les administrateurs (chapitre 10) : pour un
administrateur, un simple mot de passe volé ne suffit pas à déclencher un
paiement. *(source : `docs/02-modele-metier.md`, § 5.2 et § 10.)*

### 3.6 L'administrateur ZOYD

L'équipe qui fait tourner la plateforme. Ses outils sont regroupés dans un
tableau de bord (`/admin`) : supervision des comptes, des retraits à
vérifier, de la modération (sanctions), des rapports, des matchs et
tournois en cours, et des urgences. Ce qui distingue un administrateur d'un
joueur, côté serveur : son rôle est inscrit sur son compte, **et** toute
action sensible exige une double authentification fraîche (un code de son
téléphone, tout le temps revalidé — fenêtre de 5 minutes, chapitre 10).
Détail : quand une action redistribue de l'argent (un résultat de match,
un tournoi, la fin d'un salon BR), une session d'administrateur doit
présenter la double authentification elle aussi. Le joueur arbitre, lui,
passe sans code : son autorité est l'autorité métier (*« c'est moi l'arbitre désigné de ce match »*), pas le statut
d'administrateur. *(source : `docs/03-securite.md`, § 2.)*

### 3.7 La machine (les « crons »)

Le dernier personnage n'a pas de visage : ce sont des **travailleurs
automatiques** qui tournent en arrière-plan (en programmation, on les appelle
des « jobs cron »). Ils font le travail ingrat : réveiller les matchs oubliés,
rembourser les inscriptions périmées, relire les retraits qui n'ont pas reçu
de confirmation, reprendre un règlement interrompu par une panne. Le
chapitre 11 est leur portrait complet — seize balayages, du plus rapide
(30 secondes) au plus lent (6 heures).

### 3.8 Le prestataire de paiement, tiers de confiance de l'argent

Le prestataire n'est pas un personnage du site, mais c'est lui qui parle
avec le monde réel : quand vous déposez, l'argent arrive par Mobile Money ;
quand vous retirez, l'argent repart vers le Mobile Money. ZOYD ne garde pas
les vrais billets — il tient un grand livre de jetons (les ZC) et indique
quand faire entrer ou sortir le cash du monde réel.

---

## 4. Le vocabulaire, version simple

Ces mots reviennent partout dans le projet. Les voici expliqués une fois pour
toutes, dans un ordre qui va du plus quotidien au plus technique.

**ZOYD Coin (ZC).** Le jeton d'argent utilisé sur tout le site. **1 ZC = 10
FCFA.** On ne joue jamais directement en FCFA et on n'est jamais payé
directement en FCFA sur ses gains de match : l'économie intérieure est en ZC,
et seuls les dépôts et les retraits traversent la frontière. *(source :
`docs/02-modele-metier.md`, § 1.2.)*

**FCFA.** La vraie devise extérieure, versée ou rendue via Mobile Money.

**Portefeuille (« wallet »).** Le compte d'argent du joueur. Il n'a pas un
seul solde, mais **trois cases** (chapitre 8) : le *cash* (retirable), le
*bonus* (jouable mais pas retirable), et le *verrouillé* (la mise posée dans
une compétition en cours).

**Mise (« entry fee », le pass).** La somme que chaque joueur place au début
d'une compétition — en solo comme en équipe, chacun engage son propre
pass. Elle sort du cash d'abord, du bonus ensuite, et se range dans la
case verrouillée.

**Le pot, la cagnotte.** L'ensemble des mises d'une compétition. Attention à
une subtilité qui a coûté des mois d'audit : il y a le **pot théorique**
(ce que ferait le total si toutes les places étaient prises, affiché à la
création) et le **pot réel** (ce qui est *réellement* sous séquestre). Seul
le pot réel autorise un versement. Un match de 4v4 où seuls 6 joueurs sur 8
ont misé ne distribue pas les mises fantômes des deux absents — la
cagnotte versée est celle qui existe vraiment. C'est le garde « anti-mint »
(« mint » = frapper de la monnaie : se protéger de créer de l'argent qui
n'existe pas). *(source : `docs/02-modele-metier.md`, § 6.)*

**Séquestre (« lock »).** L'acte de poser la mise. La case « verrouillé » du
portefeuille porte le nom de la compétition : c'est l'argent en jeu, figé — on ne peut
plus le dépenser ailleurs, ni le retirer.

**Arbitre.** Voir § 3. Un joueur volontaire qui touche une commission.

**Check-in.** L'étape où chacun confirme sa présence (« je suis là, prêt à
jouer ») avant le lancement. Elle évite de lancer une partie pour un
adversaire qui ne viendra pas.

**Forfait.** La disqualification de celui qui ne se présente pas ou abandonne.
L'adversaire (ou celui qui est resté) est payé.

**Statut.** L'état d'une compétition dans le temps. Un match passe par :
`recruiting` (on recrute les joueurs), `awaiting_arbiter` (complet, mais
personne n'arbitre), `check_in` (déjà complet, chacun se pointe), `ready`
(tout le monde est prêt), `in_progress` (en jeu), `awaiting_confirmation`
(résultat saisi, attente de la fenêtre de contestation), puis
`finished`, `forfeited`, `cancelled`, `disputed` (litige) ou `archived`.
*(source : `docs/02-modele-metier.md`, § 4.1.)*

**Litige (« dispute »).** Le désaccord sur un résultat. Le statut du match
passe en `disputed` et **la cagnotte est gelée** : plus rien ne peut être
versé tant que le litige n'est pas tranché. *(source :
`docs/02-modele-metier.md`, § 4.5.)*

**Fenêtre.** Un délai maximum attaché à une étape — les horloges du
chapitre 6. Exemples : 2 h à l'arbitre, depuis sa prise de poste, pour
lancer, 2 h pour saisir le résultat, 30 min pour contester, 14 j de durée
de vie maximale d'un match sans résultat.

**Balayage (« sweep »).** Un tour automatique de l'oubli : un travail
périodique qui cherche « qu'est-ce qui est resté coincé trop longtemps ? »
et répare (rembourse, reprend, expire, archive). Chapitre 11.

**Commission de retrait.** La seule recette de ZOYD : **2 %** de ce qu'un
joueur déplace hors du site — sur 1 000 ZC retirés, 20 ZC restent à ZOYD. **Il n'y a pas de commission sur les mises, pas de part dans les
cagnottes** : le pot est redistribué à 100 %, moins seulement la part de
l'arbitre. *(source : `docs/02-modele-metier.md`, § 1.1.)*

**Prestataire de paiement.** Le tiers qui fait la traduction entre ZC et
Mobile Money.

**Dépôt / retrait.** Entrée de cash (via Mobile Money, il devient du ZC) et
sortie (le ZC redevient du Mobile Money, moins 2 %).

**Bonus.** Une part du solde qui peut servir à jouer mais pas à être
retirée. Règle d'or implémentée : à la mise, le **cash est consommé avant
le bonus** ; et la part d'un gain qui correspond à une mise jouée avec du
bonus **repart en bonus**, jamais en cash retirable. *(source :
`docs/02-modele-metier.md`, § 7.2.)*

**Session.** La preuve, du côté du serveur, que « cette personne est
connectée ». Elle vit dans un **cookie** (voir chapitre 10) nommé
`zoyd_auth`, invisible au JavaScript des pages. Une session se renouvelle
toutes les 30 minutes (rotation) et a une durée de vie absolue de
30 jours au total : au changement de mot de passe, chaque session est
révoquée. *(source : `docs/03-securite.md`, § 9.)*

**Le temps réel.** Le fil direct entre le site et le serveur (technologie :
Socket.IO). C'est lui qui pousse à l'écran « un match vient d'arriver ! »,
un message de chat, une notification ou une mise à jour de solde,
sans qu'on rafraîchisse la page.

**Cron.** Voir § 3.7. Un travail de fond programmé, qui tourne à un rythme
fixe (toutes les 30 secondes, toutes les 60 secondes,
toutes les 6 heures, etc.).

**E2E (« end-to-end »).** Les tests qui pilotent un vrai navigateur
(comme un utilisateur fantôme), de la page d'accueil jusqu'au clic final,
pour vérifier que le produit entier marche.

---

## 5. Le territoire : les grands blocs du site

À l'écran, ZOYD se parcourt comme une petite ville avec cinq quartiers. En
tout, l'application front compte 35 URLs (les 35 « adresses » de la
ville) organisées dans un catalogue connu du routeur. *(source :
`docs/08-frontend.md`, § 3.)*

### 5.1 L'entrée et la vitrine

La page d'accueil (`/`) et l'écran de choix de mode (`/mode`) présentent le
service : c'est la vitrine. Six pages légales sont chargées en permanence,
toujours accessibles : `/conditions` (CGU), `/reglement-litiges`,
`/anti-fraude`, `/confidentialite`, `/mentions`, `/jeu-responsable`. Ce
sont les panneaux obligatoires de la ville — et, de pair avec elles, le site
refuse d'inscrire un joueur qui ne les a pas acceptés (le serveur renvoie
une erreur dédiée si le consentement manque). *(source :
`docs/08-frontend.md`, § 3.1 ; catalogue d'erreurs `LEGAL_NOT_ACCEPTED` dans
`docs/04-api.md`.)*

### 5.2 Le quartier MJ — les matchs instantanés (le cœur)

C'est le produit d'origine : `/mj` liste et filtre les matchs ouverts, avec
une projection des gains par participant ; `/mj/creer` ouvre un match
(format 1v1 à 5v5, mise, paramètres CODM) ; `/mj/match/:id` est la salle
de match live, avec statut, joueurs, mises, arbitre, fenêtres et litiges. Le tout est mis à jour en direct par le fil Socket.IO.
*(source : `docs/08-frontend.md`, § 3.1, routes 14 à 16.)*

### 5.3 Le quartier tournois

`/mj/tournois` liste, `/mj/tournois/creer` ouvre, `/mj/tournois/:id` montre
le bracket (l'arbre du championnat) en direct. Le tournoi est une coupe à
élimination : des squads constituées joueur par joueur (le premier pose son
pass, chaque coéquipier verrouille le sien), des arbitres
répartis poste par poste, un tableau d'élimination directe. Les deux URLs « accentuées »
(`/mj/créer`, `/mj/tournois/créer`) existent en compatibilité pour les liens
partagés avant le renommage des adresses. *(source :
`docs/08-frontend.md`, § 3.1, routes 17 à 20.)*

### 5.4 Le quartier Battle Royale — les salons

`/br` liste les salons programmés, `/br/:lobbyId` donne le détail d'un
salon : programmation, joueurs, arbitre (le créateur par défaut), solde,
check-in, éliminations, classement. Les inscriptions se déroulent largement
hors temps réel : chaque action (rejoindre, quitter, se pointer, régler) est
un aller-retour normal avec le serveur. *(source :
`docs/08-frontend.md`, § 2 et cartographie produit.)*

### 5.5 Le quartier Battle Royale League (l'événement)

`/br-league` et `/br-league/:seasonId`. C'est le chapitre de saison :
inscriptions qualificatives, journées, finale, podium. Ce quartier est
complètement codé et testé, mais **il n'ouvrira pas avant au moins deux
semaines après l'ouverture publique** du produit — c'est inscrit au
calendrier de lancement, non au code. *(source : cartographie produit du
02/11/2026.)*

### 5.6 Le quartier argent — le portefeuille

`/wallet` (solde en trois cases, historique des mouvements, dépôt, retrait),
`/earnings` (tableau des gains), `/classements` (les meilleurs joueurs —
vide aujourd'hui, voir chapitre 14), et le profil `/profil` avec ses
statistiques et son score de confiance. *(source :
`docs/08-frontend.md`, § 3.1, routes 22 à 27.)*

### 5.7 Le reste du bâti : social, chat, paramètres

`/chat` (un canal global, un canal par match, la présence et l'indicateur
« qui est en train d'écrire »), `/parametres` (les réglages du compte), `/profil/:id` (profil public), et
`/admin` (tableau de bord de l'équipe, protégé par la double
authentification). En marge : la page `/infos`. *(source :
`docs/08-frontend.md`, § 3.1.)*

### 5.8 La ville cachée : ce que le visiteur ne voit pas

Le joueur voit la vitrine ; toute la sécurité, elle, est en dessous : un **serveur** (la salle des machines, chapitre 9), une **base de
données** (le grand livre), un **circuit de paiement** (Mobile Money) et une
**horlogerie automatique** (les crons). Le reste du document parle surtout
de cette ville cachée, car c'est là que la confiance est gagnée ou perdue.

---

## 6. La vie d'un match MJ, du début à la fin

Suivons un vrai match, du premier clic au dernier virement interne. Récit :
Aya crée un match 1v1 et mise 50 ZC ; Bassam le rejoint et pose ses 50 ZC ;
ils jouent, Bassam gagne. Le compte est simple : 100 ZC de mises, dont
2 ZC pour l'arbitre (2 %) et 98 ZC pour le gagnant — **l'argent se déplace,
rien n'est créé, rien n'est perdu**.

### 6.1 Acte 1 — la création et le recrutement (`recruiting`)

Aya choisit son format (1v1 à 5v5), la mise, le nombre maximum de joueurs et
les paramètres du match dans CODM. Le site affiche une **projection** : si
toutes les places sont prises, le pot fera « mise × places ». Aya pose sa
mise immédiatement : elle quitte sa case cash (puis bonus, si le cash ne
couvre pas) et se range dans la case **verrouillé**, à son nom, étiquetée
du numéro du match.

Le match apparaît dans la liste publique. D'autres joueurs arrivent… ou pas.
La phase de recrutement n'a pas d'horloge propre — mais le monde autour, oui :
dès que le tableau est complet sans arbitre, le balayage automatique laisse
**2 h au poste**, sinon il annule le match et rembourse tout le monde (et
ensuite, dans l'ordre : 2 h pour lancer, 2 h pour saisir le résultat). Un
compte ne peut pas poser la mise deux fois dans le même match (le serveur
refuse un second verrou : erreur `ALREADY_LOCKED`) ; et il refuse le verrou si
le solde ne suffit pas (`INSUFFICIENT_FUNDS`).

**La porte reste ouverte avant le lancement.** Un inscrit qui change d'avis se
retire (« Me retirer ») : son pass lui revient **intégralement**, la place se
rouvre et le statut redescend. Le créateur, lui, ne quitte pas son propre
match : tant que personne d'autre n'a posé de pass, il peut **annuler le
match** (remboursement intégral, le dossier quitte la liste publique) ; dès
qu'un adversaire est engagé, seule la modération peut le solder. Une fois le
match lancé, les mises jouent : plus personne ne sort par cette porte. Et si
un match reste figé **14 jours** (`recruiting`, `full` ou `check_in`), le
nettoyage automatique rembourse chaque verrou restant **avant** d'archiver le
dossier — jamais l'inverse. *(source : `docs/02-modele-metier.md`,
§ 7.2 et § 4.4.)*

### 6.2 Acte 2 — l'arbitre prend son poste (`awaiting_arbiter`)

Quand le tableau est complet mais qu'aucun arbitre n'a rejoint, le match
passe en `awaiting_arbiter` : **rien ne peut avancer**. Un arbitre (un
joueur comme les autres, jamais l'un des camps) prend le poste et bloque
son créneau.

Le rôle est bien protégé : le serveur vérifie que l'arbitre agissant est
bien celui désigné avant d'accepter toute action sensible (saisie du
résultat, lancement). Et quand une action de **rôle administrateur**
s'y ajoute (résultat de tournoi, fin d'un salon BR), la double
authentification fraîche est demandée aussi. *(source : `docs/01-architecture.md`, § 4.3 ; `docs/03-securite.md`, § 2.)*

### 6.3 Acte 3 — le check-in (`check_in`, puis `ready`)

Chacun se pointe. Tant qu'un joueur ne s'est pas pointé, le statut reste
`check_in`. Quand tous sont pointés, tous prêts, et l'arbitre installé, le
match devient `ready`. La **salle CODM** (les identifiants de la partie à
rejoindre) n'est publiée qu'au plus tôt **10 minutes
avant l'heure** — assez tôt pour rejoindre, assez tard pour empêcher toute
manipulation en avance. *(source : `docs/02-modele-metier.md`, § 9.)*

### 6.4 Acte 4 — le match lui-même (`in_progress`)

L'arbitre lance. Les joueurs jouent dans CODM ; la page du match suit le
statut en direct, et le chat du match (un canal de conversation créé
automatiquement pour ce match) sert de fil de discussion.

Deux fenêtres cadrent tout : l'arbitre a **2 heures** depuis sa prise de
poste pour lancer ; puis **2 heures** depuis le lancement pour saisir le
résultat. En coulisses, **un balayage automatique passe toutes les
30 secondes** : arbitre en retard dans la première fenêtre, le match est
annulé et les mises remboursées ; dépassée la seconde, même punition.
*(source : `docs/02-modele-metier.md`, § 9 ; `docs/01-architecture.md`, § 2.)*

### 6.5 Acte 5 — le résultat et la fenêtre de contestation (`awaiting_confirmation`)

L'arbitre saisit le résultat. L'argent n'est pas encore versé : le match
passe en `awaiting_confirmation`, et une fenêtre de contestation s'ouvre
pendant **30 minutes**. Si personne ne conteste, le règlement part tout seul — un balayage
automatique de 60 secondes s'en charge. *(source :
`docs/02-modele-metier.md`, § 9.)*

### 6.6 Acte 6 — le règlement (`finished`)

C'est le point unique où l'argent bouge : la fonction
`applyResultSettlement` du moteur de match. Son déroulé, en clair :

1. **Le pot réel** est lu (la somme des mises verrouillées, pas la
   projection) ;
2. L'arbitre reçoit **2 % du pot réel** ;
3. Le reste est divisé entre les gagnants — s'ils sont plusieurs, chacun
   prend une part égale, et le dernier en liste absorbe l'arrondi au
   centime (aucun fragment de ZC ne se perd ni n'apparaît
   de nulle part) ;
4. Le perdant voit sa case verrouillée se vider **sans retour** (sa mise
   est perdue, c'est le circuit `match_loss`, jamais un remboursement
   déguisé) ;
5. Chaque versement porte une **clé d'idempotence** (un anti-double-paiement) :
   si un incident interrompt le règlement, la reprise reconnaît les
   versements déjà faits — le même gain ne peut pas être payé deux fois.

*(source : `docs/02-modele-metier.md`, § 6, 7.1, 7.2 et 7.3.)*

### 6.7 Les finales possibles hors victoire

Un match ne se finit pas toujours par une victoire. Les autres issues —
toutes réglées automatiquement (payées ou remboursées) :

- **Forfait (`forfeited`)** : un joueur ne vient pas, abandonne en route, ou
  échoue au check-in. Son adversaire est automatiquement **payé**. 
- **Annulation (`cancelled`)** : pas assez de monde, arbitre absent, match
  jamais lancé. **Tout le monde est remboursé**, mise pour mise.
- **Litige (`disputed`)** : l'un des camps conteste le résultat dans la
  fenêtre de 30 minutes. La cagnotte est gelée, plus rien n'est versé
  jusqu'à résolution.
- **Expiration (14 jours)** : un match jamais lancé qui traîne plus de
  14 jours est purgé : chaque verrou restant est remboursé **avant**
  l'archivage du dossier, les mises repartent.
- **Archivage (`archived`)** : un match fini qui traîne dans le passé est
  archivé par un balayage lent (6 heures) pour que les pages restent
  légères.

*(source : `docs/02-modele-metier.md`, § 4 et § 9.)*

### 6.8 Les horloges, résumé en un tableau

| Étape | Délai total | Que se passe si l'échéance est dépassée |
|---|---|---|
| Prise de poste → lancement (phase A) | 2 h | annulation + remboursement |
| Lancement → résultat (phase B) | 2 h | annulation + remboursement |
| Contestation d'un résultat | 30 min | personne ne conteste → règlement unilatéral |
| Match sans résultat | 14 j | expiration de la compétition |

Le retrait d'argent possède ses propres horloges et plafonds (min 150 ZC,
plafond 50 000 ZC / 24 h) — chapitre 8.

---

## 7. Les autres horloges : tournoi, ligue, salon BR

Trois autres moteurs, trois autres horloges.

### 7.1 Le tournoi : la coupe à élimination

Le créateur ouvre un tournoi et **réserve tout de suite le poste d'arbitre
n° 1**. Le premier joueur d'une squad pose son pass, puis chaque coéquipier
rejoint la squad depuis son compte et verrouille le sien — squad ouverte à
tous, ou privée sur invitation. Les arbitres supplémentaires
complètent les postes. Le lancement est **impossible tant qu'un poste
d'arbitre manque** — le serveur refuse (toutes les cases doivent être
couvertes). Un bracket est tiré ; chaque duel est rattaché à un poste
d'arbitre (calcul : numéro du duel modulo le nombre d'arbitres). À la
fin, dès que le tournoi passe en `completed`, l'argent est versé : le
gain divisé en parts égales entre les membres de chaque squad du podium,
la commission de l'arbitre déduite, les mises des perdants absorbées. Horloge
propre : un tournoi jamais démarré après son
heure de lancement prévue a **24 h de grâce**, puis il est annulé et
remboursé par un balayage lent (6 heures).

*(source : `docs/02-modele-metier.md`, § 5.1 et § 9.)*

### 7.2 La ligue : l'événement administré

Une saison de ligue est créée par l'administration (`registering`). Les
joueurs bloquent un pass de **50 ZC**. Quand ils sont **au moins 10**, le
lancement des qualifications (`qualifying`) commence ; les inscrits sont
répartis au hasard en **5 journées** ; l'administration saisit le classement
de chaque journée. Le **top 40** avance à la finale ; podium : **60 % /
25 % / 15 %** du pot. Les non-podiums sont soldés (leur mise est absorbée
par le pot). Il n'y a pas d'arbitre : l'administration est le juge, et son
garde est la double authentification. Horloge propre : une ligue jamais lancée a **1 h de
grâce**, puis annulation et remboursement (balayage lent, 6 heures).

*(source : `docs/02-modele-metier.md`, § 5.2 et § 9.)*

### 7.3 Le salon Battle Royale : à la demande

Un joueur crée un salon programmé **entre 24 et 48 heures** plus tard ;
l'arbitre est désigné à la création (par défaut, c'est lui ; il peut choisir
un autre compte, et l'arbitre n'est jamais joueur). Les inscrits paient leur
pass à l'inscription — et **le quitter avant le lancement le rembourse, la
seule sortie d'argent remboursée de ce moteur**. À l'heure, l'arbitre lance
(au plus 10 min avant) ; les absents restent marqués `absent` et **leur
pass n'est pas remboursé** — il reste dans le pot, au profit de ceux qui
sont venus. Le pot est recalculé à ce moment depuis les verrous réels.
Pendant la partie, l'arbitre élimine au fur et à mesure ; à la fin, il
saisit le classement. Le règlement classe le **top 5** :
**40 % / 22 % / 13 % / 12 % / 8 %** du pot effectif (le dernier absorbe
l'arrondi) ; les places au-delà se soldent par la consommation du pass.
Le classement fusionne survie et éliminations : **70 % survie + 30 % kills**.

Trois horloges dédiées : un salon jamais lancé (ou abandonné en cours) est
annulé et remboursé toutes les 30 minutes ; un règlement interrompu est
repris toutes les 5 minutes (par l'arbitre du salon, qui relance la
fin de son propre salon) ; et chaque règlement porte le même filet
anti-doublon que les autres gains.

*(source : `docs/02-modele-metier.md`, § 5.3 et § 9.)*

### 7.4 Une règle économique à retenir

Chez tous les moteurs, la recette est la même : **le règlement ne verse
jamais plus que ce qui est réellement verrouillé.** Pour les matchs MJ et
les salons BR, le pot réel est la somme des verrouillages individuels. Pour
les tournois et les ligues, c'est un produit (tarif × inscriptions × taille
d'équipe), et le tarif est normalisé à l'entrée pour que le produit et la
somme des mises ne puissent jamais diverger. *(source :
`docs/02-modele-metier.md`, § 6.)*

---

## 8. L'argent, de bout en bout

C'est le chapitre auquel tout le reste sert. Chaque affirmation ici est
sourcée dans `docs/02-modele-metier.md` (le document de référence), qui
cite le code ligne par ligne.

### 8.1 Les trois cases du portefeuille

Un portefeuille ZOYD n'a pas un solde unique, mais trois cases :

| Case | Ce que c'est | Ce qu'il est possible d'en faire |
|---|---|---|
| Cash | De l'argent réel, entré par le portail Mobile Money | Jouer, ou être retiré (moins 2 %) |
| Bonus | De l'argent de promotion | Jouer seulement. Jamais retirable |
| Verrouillé | Une mise posée dans une compétition vivante | Rien. Il attend le règlement |

La mise part du cash d'abord, du bonus en secours. Quand la compétition
se règle, la case verrouillée se vide : soit le montant repart vers le
gagnant, soit la mise est absorbée par la perte, soit elle revient à son
propriétaire en cas d'annulation.

**Règle d'or :** à tout instant, chaque ZC du site est l'argent de
quelqu'un, et d'une seule personne. La plateforme ne crée pas d'argent
et ne fait disparaître rien.

### 8.2 Entrer : le dépôt

Le joueur ouvre la page portefeuille, choisit un montant, et le paiement
passe par Mobile Money via le prestataire. À la confirmation, le cash du
portefeuille est crédité de l'équivalent en ZC (1 ZC = 10 FCFA). La
fonction `depositToWallet` est la seule porte d'entrée de l'économie :
chaque ZC déposé est la trace écrite d'un paiement réellement effectué.
*(source : `docs/02-modele-metier.md`, § 7.1.)*

### 8.3 Miser : le verrou

À l'inscription à une compétition, la fonction `lockEntryFee` fait tout à
la fois :

- elle refuse un second verrou pour la même compétition
  (erreur `ALREADY_LOCKED`) ;
- elle refuse si le solde ne couvre pas la mise (erreur
  `INSUFFICIENT_FUNDS`) ;
- elle consomme le cash d'abord, puis le bonus ;
- elle crée la réservation dans la case verrouillée, avec son montant
  (part cash et part bonus séparées) et son instant ;
- elle écrit une transaction d'historique `entry_fee`, en montant
  négatif.

À partir de ce moment, la mise est hors de portée du joueur et n'appartient
plus à personne : ni lui, ni l'adversaire, ni la plateforme. Elle est sous
le verre de la cagnotte. *(source :
`docs/02-modele-metier.md`, § 7.1.)*

### 8.4 Gagner, perdre, être remboursé

Trois sorties effacent la réservation :

| Issue | Effet sur l'argent |
|---|---|
| Gain (joueur ou arbitre) | Le verrou est libéré, le montant versé en cash et/ou bonus selon la part de chacun ; transaction `prize_win` ou `arbitration_fee` |
| Perte | Le verrou est vidé **sans retour** ; l'argent est absorbé par le pot ; transaction `match_loss` |
| Annulation | La mise revient exactement là d'où elle venait ; transaction `refund` |

Trois gardes valent leur poids en or :

1. **Le perdant n'est jamais remboursé.** La perte a un circuit spécifique,
   et c'est le seul.
2. **La part bonus d'un gain reste bonus.** Si une mise contient du bonus,
   la part correspondante du gain ne devient jamais de cash retirable.
3. **Idempotence des gains.** Chaque versement porte une clé unique. Si le
   serveur tombe en panne au milieu d'un règlement, la reprise reconnaît
   les versements déjà faits : le même gain ne peut pas être payé deux fois.

*(source : `docs/02-modele-metier.md`, § 7.1 et § 7.2 ; l'anti-doublon est détaillé au § 6.)*

### 8.5 La part de l'arbitre

L'arbitre est payé par le même circuit que les gains, par un type
d'opération propre : `arbitration_fee`. Son montant dépend du moteur :
2 % du pot verrouillé pour un match, 5 à 10 % pour un tournoi, au plus 5 %
dans un salon Battle Royale, zéro en ligue (il n'y a pas d'arbitre, voir
chapitre 7). Si le versement de sa commission échoue, la
demande est notée à part et reprise toutes les 30 minutes par un balayage dédié. *(source : `docs/02-modele-metier.md`, § 1.2, § 3.3, § 7.5 et
§ 9.1.)*

### 8.6 Sortir : le retrait, la seule recette de ZOYD

Le retrait est l'opération la plus sensible du site. Il passe par toutes
les portes :

1. **Minimum 150 ZC.**
2. **Cash suffisant.** Le bonus ne passe jamais la porte.
3. **Plafond de 50 000 ZC sur 24 heures glissantes.**
4. **Commission de 2 %.** Net = brut − 2 %.
5. **Le débit porte le brut ; le net part en Mobile Money.** Si un joueur
   retire 1 000 ZC, son compte est débité de 1 000 ZC, et 980 ZC partent
   vers le Mobile Money. Les 20 restants sont la seule recette de la
   plateforme.

Un versement peut rester incertain : la confirmation du prestataire
n'arrive pas toujours. Ces retraits incertains sont placés dans une
file d'attente dédiée, et un balayage toutes les 30 minutes reprend leurs dossiers jusqu'à ce
qu'une réponse claire soit enregistrée. C'est la
« réconciliation ». *(source : `docs/02-modele-metier.md`, § 7.6 et
§ 9.1 ; erreur `PAYOUT_FAILED` dans le catalogue `docs/04-api.md`.)*

### 8.7 Les huit règles de sûreté, en langage courant

Ce sont les huit règles qui gouvernent le code du portefeuille
(source : `docs/02-modele-metier.md`, § 7.2) :

1. Un seul verrou par compétition : pas de double mise.
2. Solde suffisant : pas de verrou sans monnaie derrière.
3. Le cash est consommé avant le bonus.
4. Le perdant est débité, jamais remboursé.
5. Une victoire ne peut pas être payée deux fois.
6. La part bonus d'un gain reste bonus.
7. Un pass consommé compte pour sa valeur, jamais pour zéro : l'historique
   peut toujours reconstruire les soldes d'hier.
8. Les statistiques ont leur propre idempotence : un règlement rejoué ne
   recompte pas deux fois les victoires, l'ELO et l'XP.

### 8.8 Quelques exemples chiffrés

| Situation | Résultat |
|---|---|
| Match 1v1 à 50 ZC de mise, tout le monde jusqu'au bout | Pot réel 100 ZC. Arbitre : 2 ZC. Gagnant : 98 ZC. Perdant : 0 ZC. |
| Match 2v2 à 100 ZC par joueur, 4 inscrits | Pot réel 400 ZC. Arbitre : 8 ZC. Les 392 ZC se partagent entre les 2 gagnants : 196 ZC chacun. |
| Match 4v4 affiché à 100 ZC par joueur, 6 joueurs présents | Le « pot fantôme » de 8 places ne compte pas : pot réel 600 ZC. Rien n'est créé de nulle part. |
| Retrait de 1 000 ZC | Compte débité de 1 000 ZC. Mobile Money reçu : 980 ZC. Recette ZOYD : 20 ZC. |

Deux tests du dépôt verrouillent exactement ces cas (200 ZC réellement
verrouillés ne paient pas 392 ; 392 ZC se partagent entre deux gagnants,
pas 400 à un seul). C'est le garde « anti-mint », décrit au § 6 du modèle
métier.

---

## 9. La technologie, expliquée comme à un débutant

Ce chapitre explique les machines derrière le produit, avec des images
simples. Il ne demande aucune connaissance préalable.

### 9.1 Les sept grandes machines

| Machine | Image | Rôle à ZOYD |
|---|---|---|
| Le site (le "front") | L'enseigne et les vitrines | Tout ce que le joueur voit à l'écran : pages, boutons, couleurs. Hébergé sur **Vercel** |
| Le serveur (le "back") | La cuisine du restaurant | Le cerveau qui décide : inscriptions, verrous, règlements, horloges. Tourne sur **Render** |
| La base de données | Le grand livre de comptes | La mémoire durable, chez **Supabase** (une base PostgreSQL) |
| Le fil direct | Le talkie-walkie | La liaison temps réel (**Socket.IO**) qui pousse les changements à l'écran sans rafraîchir la page |
| La caisse externe | Le comptoir de change | **Le prestataire de paiement**, qui convertit Mobile Money ↔ ZC |
| Les réveils | Les crons | Les travaux de fond à heures fixes (changements de statut, remboursements) |
| La sonnette | Les notifications | Les notifications du téléphone et du navigateur (Web Push) |

Le site front est aussi une **PWA** : depuis le navigateur du téléphone, on
peut l'« installer » comme une application, et elle fonctionne dans la
mesure du possible sans réseau. *(source : racine `ARCHITECTURE.md` et
`docs/08-frontend.md`.)*

### 9.2 Une cuisine unique, un seul cuisinier

Le serveur ZOYD est ce que la documentation appelle un **monolithe
modulaire** à **processus unique**. Décomposons :

- **Monolithe** : un seul grand programme, pas des dizaines de petits
  services qui se parlent. Modulaire : à l'intérieur, le code est rangé par
  domaine dans **11 modules de routes** (santé/public, authentification,
  social, portefeuille, tournois, ligues, Battle Royale, matchs,
  administration, chat, temps réel) plus les **moteurs** de jeu (match,
  tournoi, ligue, salon BR, portefeuille) qui portent les règles métier.
- **Processus unique** : **un seul cuisinier** en cuisine. C'est une
  décision de sécurité, pas un accident : tout l'état vivant (les matchs en
  cours, les réservations, les positions de chacun) repose sous **un seul
  verrou**. Un deuxième cuisinier, sur une deuxième machine, verrait un
  verrou différent et l'argent pourrait être dépensé deux fois. Le serveur
  **refuse obstinément de démarrer** s'il détecte qu'on lui impose plusieurs
  processus. La documentation technique raconte le scénario catastrophe :
  deux instances, l'une retire 800, l'autre crédite 500, et une moitié
  d'argent disparaît en silence sans que personne ne s'en aperçoive.
  *(source : `docs/01-architecture.md`, § 1 et § 1.3.)*

### 9.3 Ce qui se passe au démarrage

Au démarrage, la séquence est stricte et chaque étape dépend de la
précédente (source : `docs/01-architecture.md`, § 2) :

1. Refus de démarrer si plusieurs processus sont demandés ;
2. Chargement de l'état depuis la base de données (avec trois tentatives) ;
   en cas d'échec, le serveur se met en mode **lecture seule** et affiche
   une sonde sèche `/api/health` dégradée ;
3. Chargement des secrets de double authentification des administrateurs ;
4. Contrôle d'intégrité des données ;
5. Création du canal de chat global (et un canal par match) ;
6. Reconstruction des index anti-doublons (gains, retraits) ;
7. Démarrage des travaux de fond (les crons) ;
8. Démarrage de l'horloge des matchs : un tour de service toutes les
   **30 secondes** ;
9. Ouverture du port d'écoute (port **4001** par défaut).

### 9.4 Le triage de chaque requête

Chaque appel d'un navigateur traverse un péage très organisé (source :
`docs/01-architecture.md`, § 3) :

1. L'URL est vérifiée ; les demandes préalables (OPTIONS) reçoivent une
   réponse simple ;
2. Pour les requêtes qui **modifient** (créer, miser, retirer), une garde
   CSRF vérifie l'**origine** de l'appel (le site appelant doit être dans
   la liste blanche) et le **format** du corps (JSON obligatoire) — c'est
   la protection expliquée au chapitre 10 ;
3. La requête est proposée aux 11 modules de routes, l'un après l'autre ;
   celui qui reconnaît son adresse répond et arrête la file ;
4. Personne ne répond : réponse « Route introuvable » (404) ;
5. Toute réponse est un petit paquet uniforme : `ok` (ça a marché ou non),
   `error` (le message humain, en français) et `code` (le code machine,
   stable, que les pages savent traiter). Les erreurs sont finement
   rangées : erreur de saisie (400), pas connecté (401), interdit (403),
   introuvable (404), conflit d'état (409 — par exemple le salon est
   plein), compte verrouillé (423), échec en amont (502), occupé (503). Un corps de requête
   est accepté jusqu'à **1 Mo**, limite stricte.

### 9.5 La mémoire du serveur, ses deux étagères

L'état vital vit dans la **mémoire vive** du processus : matchs, salons,
tournois, sessions. C'est la vitesse. La persistance (Supabase) est
l'armoire où l'état est rangé ; chaque compte a une ligne avec un compteur
**révision**, traité comme un ticket de caisse : pour écrire une
modification, l'écrivain doit présenter le numéro observé ; si le compteur
a bougé entretemps, la base refuse, et le code reprend depuis l'état frais
(mécanisme « OCC », expliqué chapitre 10). Les collections de jeu sont
gardées dans l'armoire comme un tableau de bord copié : leur protection,
c'est précisément ce processus unique de § 9.2. *(source :
`docs/02-modele-metier.md`, § 8.)*

### 9.6 La taille du chantier

Pour donner l'échelle, décompté sur le dépôt au commit `b780b44`
(06/11/2026) :

| Ensemble | Fichiers | Lignes |
|---|---|---|
| Front (`src/`) | 188 | 39 426 |
| Serveur (`server/`) | 135 | 45 085 |
| Tests E2E (`e2e/`) | 29 | 6 618 |
| Documentation (`docs/`, onze documents) | 11 | 12 275 |

Plus de 91 000 lignes de code, plus de 1 500 tests automatisés
(chapitre 12). Et pourtant, le projet tient dans peu de serveurs : un site
front sur Vercel, un unique processus backend sur Render, une base chez
Supabase — trois « tiers » auxquels s'ajoutent le prestataire de
paiement et le service de notifications push.

### 9.7 Les outils nommés

On trouvera ces noms dans la documentation ; la façon la plus simple de
les voir :

- **React / TypeScript / Vite** : l'atelier des écrans ;
- **Tailwind** : l'atelier look (couleurs, espacements) ;
- **Zustand** : les petits cahiers d'état du front (une douzaine de
  « stores » : authentification, portefeuille, matchs, tournois, chat,
  présence...) ;
- **React Router** : le livre des 35 adresses de la ville ;
- **Node.js** : le langage du serveur — du JavaScript côté serveur, sans
  framework Express : le service HTTP est écrit natif ;
- **PostgreSQL (via Supabase)** : la base de données ;
- **Vitest** et **Playwright** : les testeurs automatiques ;
- les **métriques Prometheus** : le compteur d'activité du site, exposé à
  `/metrics`, lisible par un outil de surveillance ;

### 9.8 Pourquoi ce choix d'architecture

Trois raisons se lisent dans la documentation : la **simplicité
d'exploitation** (un seul processus, un seul serveur, un seul état ; peu de
machines à surveiller) ; la **confiance dans l'argent** (pas de répartition
d'état entre machines qui risquerait de perdre de l'argent en silence ; et
une écriture bancaire exigeant le bon numéro de révision) ; et la
**lisibilité** (chaque module sert un domaine du produit, et chaque fichier
signifiant porte un commentaire d'en-tête expliquant son rôle, ses
invariants et ses pièges). *(source : `docs/00-INDEX.md`, § 7 ; cartographie.)*

---

## 10. La sécurité, expliquée comme à un débutant

Le projet a un document de sécurité complet (`docs/03-securite.md`). En voici
la substance, expliquée avec des images simples.

### 10.1 La phrase qui gouverne tout

**« Un garde côté client ne protège rien. »** C'est la première leçon du
document de sécurité, et c'est contre-intuitive pour un débutant. Le site
qui s'affiche dans votre téléphone est du code que **votre** appareil expose
et que vous pourriez modifier si vous saviez faire. Un bouton « réservé aux
admins » qui disparaît de l'écran ne veut donc jamais dire que le chemin est
fermé : la vraie barrière doit vivre sur le **serveur**, dans la cuisine, où
le visiteur ne va pas. C'est le principe qui organise chaque garde du
projet. *(source : `docs/03-securite.md`, § 1.)*

### 10.2 Le mot de passe

- Le mot de passe ne circule jamais en clair dans les fichiers : il est
  transformé par un algorithme lent (scrypt) avant d'être rangé. Lent, ici,
  est une sécurité : pour un utilisateur, être identifié reste instantané,
  mais pour un pirate essayant des milliards de combinaisons, la même
  opération coûte très cher. *(source : `docs/03-securite.md`, § 10.)*
- Une politique de robustesse refuse les mots de passe faibles (erreur
  `WEAK_PASSWORD`).
- Changer son adresse email exige de retaper le mot de passe du compte.
- Après trop d'échecs de connexion, le compte se **verrouille** (erreur
  `423 ACCOUNT_LOCKED`) — et ce verrouillage est **persistant en base**
  (vérifié en production, sonde verte).

### 10.3 Le cookie invisible (la session)

Après connexion, le serveur vous remet une « session » : un badge
d'identification stocké dans un **cookie** nommé `zoyd_auth`. Trois
propriétés le rendent solide : invisible au JavaScript des pages
(`HttpOnly`) — impossible à lire pour un code malveillant ; envoyé
uniquement en https (`Secure`) ; et sa valeur **tourne toutes les
30 minutes** (rotation) — même si un intercepteur copiait un ancien jeton,
il devient inutile. Au changement de mot de passe, chaque session du compte
est révoquée d'un coup. Durée de vie absolue : 30 jours. Une sanction
détruit aussi la session. *(source : `docs/03-securite.md`, § 9.)*

### 10.4 Le videur CSRF

Les navigateurs ont un comportement délicat : quand un appel part vers
le serveur, ils joignent automatiquement le cookie de session — y compris
si l'appel est passé par un autre site. Scénario : vous visitez un site
piégé pendant que votre session ZOYD est active ; le site piégé tente en
douce d'appeler « /api/wallet/withdraw » avec votre session. C'est le
CSRF. La défense à deux niveaux (source : `docs/03-securite.md`, § 5) :

- **Qui appelle ?** L'`Origin` de la requête doit être dans la liste
  blanche du serveur (`CSRF_ORIGIN_REJECTED` sans elle) ;
- **Comment appelle-t-on ?** Le corps doit être du JSON
  (`UNSUPPORTED_MEDIA_TYPE` sans) ;

Or un site tiers ne peut ni forger l'Origin, ni forger le type JSON, sans
déclencher la garde préalable du navigateur. Le videur vérifie ces deux
données avant tout autre traitement, sur les requêtes POST, PATCH, PUT et
DELETE.

### 10.5 Le compteur de requêtes (limiteur de débit)

Chaque catégorie d'action a un quota : c'est un **videur**, par groupe
(source : `docs/03-securite.md`, § 6) :

| Groupe | Quota | Fenêtre |
|---|---|---|
| auth (connexion, inscription, reset) | 50 | 15 min |
| auth_logout | 60 | 1 min |
| social (amis, signalements, recherche, création de match ou tournoi) | 30 | 1 min |
| wallet (dépôts, retraits, vérification Mobile Money) | 20 | 10 min |
| chat | 60 | 1 min |
| admin | 20 | 5 min |
| default (tout le reste) | 60 | 1 min |

Deux détails de conception : le logout a **son propre quota**, séparé du
login, pour qu'une salve de déconnexions n'épuise pas le quota des
connexions ; et le quota admin (20 / 5 min) est plus serré, car il
s'applique aux actions les plus sensibles. Côté adresse : le serveur lit
le dernier maillon de la chaîne des transmetteurs
(`X-Forwarded-For`).

### 10.6 La double authentification des administrateurs

Les actions d'administration (superviser, modérer, redistribuer un
retrait suspect) passent par un garde à **quatre portes**, dans cet ordre
(source : `docs/03-securite.md`, § 2.1) : 1) une session valable ;
2) un rôle admin ; 3) une 2FA **activée** pour le compte ; 4) une 2FA
**vérifiée** dans la fenêtre récente. La vérification 2FA n'est pas
inconditionnelle : la vérification 2FA vaut **5 minutes**, puis le serveur
la redemande. Le code (technologie TOTP, comme les applications
Authenticator) se renouvelle toutes les **30 secondes**. Une session admin
sans 2FA fraîche obtient un refus, pas un paiement. Et pour les routes de
résultat (match, tournoi, fin d'un salon BR) qui redistribuent de l'argent,
le garde `require2faIfAdmin` exige la 2FA fraîche **seulement si l'acteur
est admin** ; le joueur arbitre passe sans code : son autorité est
l'autorité métier (l'arbitre désigné). Détail : les quatre opérations de
mise en place de la 2FA (setup, enable, verify, status) sont protégées par
le simple garde admin, pas par la 2FA elle-même — sinon l'activation de la
2FA exigerait la 2FA, cercle impossible.

### 10.7 Ne jamais énumérer : quel compte si un compte existe ?

Les sites publics tombent dans un piège classique : « adresse email
inconnue » révèle si un compte existe — un renseignement précieux pour un
attaquant qui dresse la liste des cibles. Ici, le mot de passe oublié
répond **toujours pareil**, que l'adresse existe ou non ; la
réinitialisation répond avec une erreur **générique**. L'inscription, elle,
dit franchement les doublons (adresse déjà prise...), et c'est assumé :
le compteur de requêtes (§ 10.5) limite les tentatives massives possibles. *(source : `docs/03-securite.md`, § 11.)*

### 10.8 Le ticket de révision (OCC)

Image : un guichet muni d'un ticket numéroté. Pour écrire une
modification sur un compte, le serveur doit déclarer le numéro lu au
départ : « j'ai lu le compte en révision 42, écris-moi ceci ». Si la base
a avançé entretemps (révision 43), elle refuse, et le serveur reprend
depuis l'état frais. C'est l'**OCC** (contrôle optimiste de concurrence).
Périmètre honnête : il couvre les **comptes** (là où vit l'argent), pas
les collections de jeu (matchs,
salons, tournois, ligues), protégées par le processus unique du § 9.2 —
une limite documentée, assumée et affichée au chapitre 15. *(source :
`docs/02-modele-metier.md`, § 8 ; `docs/03-securite.md`, § 7.)*

### 10.9 Les en-têtes HTTP, la tenue du garde

Chaque réponse du serveur dispose un petit lot d'en-têtes de sécurité
(source : `docs/01-architecture.md`, § 5.1) : l'obligation d'être en https pendant un an (`Strict-Transport-Security`,
`max-age=31536000; includeSubDomains`), l'interdiction de deviner le type
du document (`X-Content-Type-Options: nosniff`), l'interdiction d'être
affiché dans un cadre extérieur (`X-Frame-Options: DENY`), la limite
d'information de l'origine (`Referrer-Policy`). La **CSP** (Content-Security-Policy, la
grosse garde des pages web) est posée côté **Vercel**, sur les documents
HTML — c'est le vrai mur contre le code détourné. Une autre précaution
(`X-XSS-Protection`) a été **retirée délibérément** : les navigateurs
modernes l'ont abandonnée ; la maintenir serait une simulation de
protection, pas une sécurité.

### 10.10 Le nettoyage du texte (sanitizeText)

Tout texte que les joueurs peuvent saisir (pseudo, messages) passe par un
nettoyage des caractères suspects (`sanitizeText`). Le document de sécurité
est franc sur sa nature : c'est une **garde d'intégrité** (empêcher les
caractères piégeux d'abîmer les données), une **liste noire** — pas une
barrière de sécurité absolue. La vraie protection contre l'injection de
code dans les pages reste la CSP du § 10.9. *(source :
`docs/03-securite.md`, § 14.)*

### 10.11 Ce que la sécurité ne couvre pas (c'est écrit)

La documentation tient la liste franche des menaces **non** couvertes
(`docs/03-securite.md`, § 16). Les deux familles majeures : les
collections de jeu ne sont pas protégées par l'OCC (assumé, la protection
est le processus unique) ; et un certain nombre de zones sont déclarées
« à surveiller ». Aucune de ces limites n'est cachée : c'est le contraire
d'un audit payé pour flatter.

---

## 11. Les garde-fous automatiques (la machine qui ne dort jamais)

### 11.1 Les seize balayages

Quand quelque chose reste bloqué (une personne a coupé le wifi, l'arbitre a
fermé son téléphone, le prestataire n'a pas répondu), l'argent ne doit
jamais rester suspendu par hasard. Seize balayages automatiques (les « crons »)
ouvrent l'horlogerie de fond. Voici la liste complète — **tous branchés** et
vérifiés par les tests (source : `docs/02-modele-metier.md`, § 9.1) :

| Rythme | Balayage |
|---|---|
| 30 s | Automation des matchs : fenêtres d'arbitrage (2 h × 2), absences, expiration 14 j |
| 60 s | Reprise des règlements de match interrompus |
| 60 s | Expiration des fenêtres de confirmation |
| 5 min | Reprise des règlements BR interrompus |
| 30 min | Reprise des commissions d'arbitre en échec |
| 30 min | Annulation des salons BR jamais lancés ou abandonnés (remboursement) |
| 30 min | Réconciliation des retraits incertains |
| 1 h | Contrôle d'intégrité des données |
| 6 h | Archivage des matchs inactifs : chaque pass restant est remboursé AVANT l'archivage — un échec de remboursement garde le match vivant pour le passage suivant |
| 6 h | Tournois jamais démarrés (grâce de 24 h dépassée) |
| 6 h | Reprise des remboursements de tournoi |
| 6 h | Reprise des gains de tournoi |
| 6 h | Reprise des gains de ligue |
| 6 h | Ligues jamais lancées (grâce de 1 h dépassée) |
| 6 h | Reprise des remboursements de ligue |
| au démarrage | Les balayages de 60 s, 30 min et 6 h tournent aussi une fois au boot |

### 11.2 Les armes non temporelles

À côté des horloges, trois armes permanentes :

- **l'anti-mint** (chapitre 8.4 et § 6) : ne jamais payer plus que le
  verrouillé ;
- les **clés d'idempotence** : rien n'est payé deux fois — gains, pertes,
  commissions, statistiques ;
- l'**OCC** : pas d'écrasement d'écriture sur les comptes.

### 11.3 Ce que tout cela donne, en résumé

Si un joueur coupe son téléphone au milieu d'un match ; si le prestataire ne
confirme pas un retrait ; si l'arbitre disparaît ; si le serveur est
redémarré pendant un règlement — un balayage repasse, reconnaît l'état, et tranche : reprise, remboursement
ou expiration. L'argent ne reste jamais sous le verre de la cagnotte par
accident.

---

## 12. Les tests : le projet se vérifie lui-même

Un code qui gère de l'argent ne doit pas être « probablement correct » :
il doit être **vérifié par des machines**, à chaque modification. ZOYD
tourne donc derrière une batterie de tests automatiques. *(source :
`docs/06-tests.md`.)*

### 12.1 Les trois niveaux

**Niveau 1 — les tests unitaires (les briques).** 1 222 tests unitaires
tournent après chaque modification. Ils rejouent
chaque moteur dans une miniature : un portefeuille artificiel, un match
construit de toutes pièces, une horloge simulée. Leur force : aller vite et viser
juste. Exemple canonique : le test qui prouve l'anti-mint — 200 ZC
réellement verrouillés, pot affiché 400, et le test **exige** que le
joueur ne reçoive que 196 (200 moins 2 %), pas 392. Autre exemple
célèbre : le test du garde admin, dont les 4 portes ont été neutralisées
une par une pour confirmer que chacune bloquait bien (la « recette de
mutation » documentée dans `docs/06-tests.md`).

**Niveau 2 — les tests E2E (le visite fantôme).** 259 tests, tous verts,
en deux familles : 14 fichiers de tests **API directe**, qui interrogent
le serveur HTTP comme un vrai client de bout en bout, et 11 fichiers de
tests **navigateur** (Playwright), qui pilotent un vrai navigateur — de
la page d'accueil jusqu'au clic final : s'inscrire, créer un match,
miser, contester, vérifier le solde. Ils prouvent que l'ensemble
marche, pas seulement les pièces.

**Niveau 3 — les tests live (contre la vraie production).** 39 tests dans
2 fichiers, **désactivés par défaut** : ils ne tournent que sur demande
explicite, avec une clef dédiée, car ils touchent la production réelle.
Ils existent pour les grandes occasions : vérifier un déploiement en
direct, la reprise après incident.

### 12.2 Chose rare : ce que les tests ne prouvent pas

Le document de tests consacre une partie entière à **ce que les tests ne
prouvent pas** — c'est rare et c'est sain. En substance : ils prouvent
que le code dit vrai dans les scénarios couverts ; ils ne prouvent **pas**
que la migration SQL a été appliquée en base de production, que
l'infrastructure tierce (Render, le prestataire) se comportera pareil
demain, ni que l'expérience forme le joueur. La sonde publique `/api/health` expose
certains états réels de production (colonne de révision présente,
verrouillage persistant, sanctions persistées), choses qu'un test
automatique ne peut pas toujours dire.

### 12.3 Attentes à chaque modification

Chaque modification passe par une file de gardes : la compilation
TypeScript, la qualité du front (ESLint, zéro avertissement toléré), la
construction du site, puis les 1 222 tests unitaires et les 259 tests E2E
lorsque le code est touché. C'est la même
recette, à chaque fois, sans exception.

---

## 13. Faire tourner la boutique : exploitation

*(source principale : `docs/07-exploitation.md`.)*

### 13.1 Qui héberge quoi

| Pièce | Fournisseur | Rôle |
|---|---|---|
| Site front | **Vercel** | Les pages, reconstruites à chaque mise à jour du code ; la CSP y est posée |
| Serveur back | **Render** | L'unique processus Node (la commande `startCommand` est dans `render.yaml`) |
| Base de données | **Supabase** | PostgreSQL (l'armoire) |
| Paiement | **Le prestataire de paiement** | Mobile Money ↔ ZC |
| Notifications | Web Push (VAPID) | La sonnette du navigateur |

Deux domaines coexistent : le site public (`zoyd.africa`) et le site
technique (`zoyd.vercel.app`), tous deux dans la liste blanche du serveur.

### 13.2 Le déploiement

Le code vit dans un dépôt Git. Chaque mise à jour de la branche principale
fait reconstruire le site front par Vercel et relancer le serveur sur
Render (avec sa commande `node server/realtime-server.mjs`). Les variables
d'environnement (clés du prestataire, secret des notifications, adresses
autorisées, etc.) sont dans `docs/07-exploitation.md` avec leur rôle et
leur comportement si elles manquent.

### 13.3 Le réveil du matin (cold start)

Le serveur Render dort quand personne ne l'appelle (offre gratuite). Le
premier visiteur attend alors son réveil : **environ 55 secondes**,
mesurées en production le 02/11/2026 (55,6 s sur `GET /api/leaderboard`).
Le front connaît ce cas : au réveil du serveur, la première requête passe
un message dédié, la deuxième requête passe. Une fois réveillé, le serveur
répond en millisecondes.

### 13.4 Savoir que tout va bien

Trois instruments de bord :

- **`/api/health`** : la sonde publique. Elle décrit l'état interne :
  état chargé et fiable (sinon, en lecture seule), colonne de
  révision présente, verrouillage des connexions persistant, sanctions
  persistées. Au 02/11/2026, toutes les sondes sont au vert et le
  podium public est vide (`players: []`) — cohérent, le produit public
  n'est pas encore lancé ;
- **`/metrics`** : compteurs et durées (en format Prometheus) — combien
  de requêtes, combien d'erreurs 500, la durée par route ;
- les **logs** : chaque requête est tracée en JSON structuré, avec
  des catégories limpides pour diagnostiquer.

Si l'état ne se charge pas au démarrage, le serveur **répond quand même**,
mais en lecture seule : `/api/health` renvoie 503 et les écritures
refusées. Mieux vaut un site qui crie « je suis en lecture seule » qu'un
site muet qui accepterait des opérations sur une mémoire vide.
*(source : `docs/01-architecture.md`, § 2.)*

### 13.5 Les migrations de base

Le schéma de la base (tables, colonnes, règles d'accès) vit dans
`supabase/schema.sql` et `supabase/migrate-rls-live.sql`. La colonne
`revision` de l'OCC a d'abord vécu **hors** de ces fichiers (découverte
documentée d'un audit), puis son ordre SQL a été **ajouté au dépôt** au
commit `b90264d`, avec un test de couverture du schéma et une sonde dans
`/api/health` — l'une des 16 anomalies racontées au chapitre 14. *(source : `docs/03-securite.md`, § 16.2 ;
`docs/00-INDEX.md`, § 8.)*

---

## 14. Où on en est aujourd'hui

Au 06/11/2026 (d'après `docs/00-INDEX.md`, la documentation des audits et
les sondes de production vérifiées le 02/11/2026) :

- **Le code est complet pour l'ouverture publique** des matchs MJ, des
  tournois, des salons Battle Royale et du portefeuille. La BR League (le quartier
  League) est codée et testée, mais restera fermée encore au moins
  deux semaines après l'ouverture du site.
- **Le classement public est volontairement vide** (`players: []`) :
  la communauté ne joue pas encore, l'ouverture est l'étape suivante —
  le podium se remplira au lancement.
- **La production est en santé** : la sonde `/api/health` expose toutes
  les sondes internes vérifiées le 02/11/2026 (état chargé et fiable,
  colonne de révision présente, verrouillage des connexions persistant,
  sanctions persistées).
- **16 anomalies majeures** identifiées par les audits successifs ont été
  **toutes corrigées** (V1 à V16, liste détaillée et datée dans
  `docs/00-INDEX.md`, § 8) — de la branche de paiement oubliée aux
  cagnottes fantômes, chacune portée par des tests précis.
- **Les audits du code sont documentés dans le dépôt** (`docs/audit-3/`,
  `docs/audit-4/`) : les 47 invariants d'argent numérotés (document 05), la liste des
  menaces couvertes et non couvertes, la recette de mutation des tests.
- Les raccordements aux trois tiers extérieurs (Supabase, le prestataire
  de paiement, notifications push) sont opérationnels.

## 15. Ce qui n'est pas fini (et c'est assumé)

Un document honnête doit dire ce qui reste. Voici la liste des chantiers
connus, chacun déjà identifié et documenté :

1. **Le webhook du prestataire** : la confirmation des paiements passe
   aujourd'hui par la route de vérification (et la réconciliation
   automatique aux 30 minutes) — un appel automatique du prestataire vers
   ZOYD (le « webhook ») reste à brancher pour raccourcir le délai de
   confirmation du dépôt.
2. **La montée en charge** : le serveur exige un **processus unique**
   (garde actif) ; en cas de grossissement de la communauté, il faudra un
   verrou partagé entre instances ou une extension de l'OCC — le
   scénario est chiffré et documenté.
3. **La page d'activation de compte** (`/auth/activate`) existe côté
   front, mais le parcours d'activation par lien email n'est pas encore
   branché de bout en bout.
4. **La table `wallet_transactions`** du schéma SQL n'est pas alimentée
   par le code actuel (l'historique de transactions vit dans la ligne du
   compte) — aligner les deux est un chantier de plus grande portée.
5. **Pas de moteur de litige séparé** : la gestion du litige vit dans le
   moteur de match (assumé : `docs/02-modele-metier.md`, § 10).
6. **BR League** : ouverture planifiée (au moins 2 semaines après
   l'ouverture publique), pas avant.

Voilà, en toute honnêteté, où en est le projet.

## 16. FAQ : les questions que tout débutant se pose

**Q. Combien ça coûte de jouer ?**
R. L'inscription est gratuite. Vous mettez la mise de votre choix à
l'inscription de la compétition, pourvu que votre solde la couvre — le
site refuse une mise que le portefeuille ne couvre pas. À la sortie du
site, le retrait coûte 2 % (min 150 ZC).

**Q. Qui décide du résultat si les deux camps racontent autre chose ?**
R. L'arbitre désigné saisit le résultat. En cas de désaccord, le match
passe en « litige » dans les 30 minutes qui suivent : la cagnotte est gelée
tant que le litige n'est pas réglé.

**Q. Et si l'adversaire ne vient pas ?**
R. Forfait : l'adversaire est payé automatiquement. Et si l'arbitre
n'arrive pas à l'heure (2 h) ou ne publie pas de résultat (2 h), un
balayage automatique annule le match et rembourse tout.

**Q. Comment ZOYD gagne-t-il de l'argent ?**
R. Uniquement le retrait : 2 % du montant sorti. Pas de commission sur les
mises, pas de pourcentage sur les cagnottes : le pot est redistribué à
100 % moins la part de l'arbitre.

**Q. Puis-je retirer mon bonus ?**
R. Non. Le bonus se joue, il ne se retire pas. Et il n'est consommé que
si le cash ne couvre pas toute la mise.

**Q. Puis-je jouer si mon solde est en bonus uniquement ?**
R. Oui, jusqu'à la hauteur du bonus. La mise consommera le bonus. Mais
vous ne pourrez pas retirer des gains dont la part vient du bonus.

**Q. Que se passe-t-il pendant une panne du serveur ?**
R. Le mode lecture seule : l'état présenté n'est pas fiable, le site
répond mais refuse les écritures. Si une panne coupe un règlement en
cours, un balayage programmé le reprend dès que le serveur revient, sans
payer deux fois qui que ce soit (idempotence).

**Q. Que se passe-t-il si mon paiement Mobile Money n'est pas confirmé ?**
R. Votre dépôt reste en attente, et la réconciliation relit sa trace
toutes les 30 minutes jusqu'à une réponse claire.

**Q. Pourquoi le site met-il parfois presque une minute à démarrer ?**
R. La machine Render dort quand le site n'est pas consulté ; le premier
visiteur l'attend en ~55 secondes (mesurée le 02/11/2026). Ensuite, le
site répond normalement.

**Q. Comment le site protège-t-il mon compte ?**
R. Mot de passe stocké avec un algorithme lent (scrypt), session dans un cookie
invisible qui tourne toutes les 30 minutes, verrouillage après trop
d'échecs de connexion, réponse identique aux tentatives de devinettes
(adresse email), retrait à double porte (minimum et plafond).

**Q. D'où vient l'argent du pot d'un tournoi qui paie des arbitres ?**
R. Des mises individuelles : chaque joueur pose son propre pass. La fin du
tournoi répartit les gains en parts égales entre les membres des squads du
podium, paie la commission des arbitres, et absorbe les mises des perdants.

**Q. Puis-je quitter un salon Battle Royale après avoir payé le pass ?**
R. Avant le lancement : oui, remboursé. Après le lancement : non — votre
absence triche les participants valides, votre pass alimente la
cagnotte.

**Q. Puis-je quitter un match MJ (1v1 à 5v5) après avoir payé le pass ?**
R. Avant le lancement : oui, remboursé intégralement — « Me retirer » rend
votre pass et rouvre une place. Après le lancement : non, les mises jouent.
Si vous êtes le créateur, vous ne quittez pas vous-même : tant que personne
d'autre n'a posé de pass, vous pouvez annuler le match (remboursement
intégral) ; dès qu'un adversaire s'est joint, la modération seule peut le
solder.

**Q. Tout est codé pour Call of Duty Mobile. Pourquoi parler
d'« infrastructure » ?**
R. Parce que le moteur (matchs avec mises, arbitre rémunéré, horloges) ne dépend pas
du jeu lui-même : ajouter un autre jeu ne demande pas de
repenser le socle — c'est l'ambition documentée du projet.

---

## 17. Glossaire final

| Mot | Sens en une phrase |
|---|---|
| ZC (ZOYD Coin) | Le jeton d'argent du site ; 1 ZC = 10 FCFA |
| FCFA | La devise du monde réel, entrée et sortie par Mobile Money |
| Pot | L'ensemble des mises d'une compétition |
| Pot fantôme | Le pot total « si toutes les places sont prises » — jamais versé |
| Séquestre / verrou | La mise posée dans une compétition, intouchable |
| Mise (entry fee, pass) | L'argent que chaque joueur engage pour entrer — son propre pass, même en équipe |
| Bonus | Un solde jouable mais jamais retirable |
| Cash | Le solde retirable |
| Arbitre | Un joueur volontaire qui encadre une compétition et est rémunéré |
| Check-in | La confirmation de présence avant le lancement |
| Forfait | La déqualification de l'absent ; l'autre camp est payé |
| Litige | Le désaccord sur le résultat ; cagnotte gelée tant qu'il dure |
| Statut | L'étape du récit de la compétition (recruiting, `check_in`, awaiting_confirmation…) |
| Fenêtre | Un délai maximum attaché à une étape |
| Balayage (sweep) | Un tour automatique de nettoyage : rembourser, reprendre, expirer |
| Cron | Un travail de fond programmé (30 s, 60 s, 30 min, 5 min, 1 h, 6 h) |
| Idempotence | « Le même paiement ne peut pas arriver deux fois » |
| OCC | Le ticket de révision qui bloque deux écritures qui se croisent |
| Webhook | L'appel automatique d'un tiers (le prestataire) vers ZOYD pour confirmer un paiement |
| Session | La preuve serveur que vous êtes connecté (cookie invisible) |
| Cookie | Le petit badge électronique que le site pose dans votre navigateur |
| CSRF | L'attaque où un site tiers force votre navigateur à agir sous votre session |
| Rate limiter | Le compteur de requêtes qui limite les débits abusifs |
| 2FA (TOTP) | Le second code à 30 s requis des administrateurs |
| E2E | Les tests qui pilotent un vrai navigateur de bout en bout |
| Webhook de retrait | La trace d'un versement Mobile Money en attente de confirmation |
| Cold start | Le ~55 s que met le serveur à se réveiller après un long silence |
| PWA | L'app du navigateur, installable sans store |
| Moteur | Le bloc de code qui porte une fonction de règle (match, tournoi, ligue, salon BR, portefeuille) |

## 18. Annexe : les chiffres du projet

Relevés le 07/11/2026 sur la base du commit `b780b44`, et sourcés dans
`docs/00-INDEX.md`, `docs/01-architecture.md`, `docs/08-frontend.md` et
`docs/06-tests.md` :

| Chiffre | Valeur | Source |
|---|---|---|
| Lignes de code front | 39 426 (188 fichiers) | `docs/08-frontend.md` |
| Lignes de code serveur | 45 085 (135 fichiers) | `docs/01-architecture.md` |
| Lignes de tests E2E | 6 618 (29 fichiers) | `docs/06-tests.md` |
| Tests unitaires | 1 222 passés (114 fichiers) | `docs/06-tests.md` |
| Tests E2E | 259 / 259 verts (25 fichiers : 11 UI, 14 API) | `docs/06-tests.md` |
| Tests live | 39, sur demande explicite (2 fichiers) | `docs/06-tests.md` |
| Documents du projet | 11 (celui-ci compris) | `docs/00-INDEX.md` § 7 |
| Invariants d'argent numérotés | 47 | `docs/05-invariants.md` |
| Anomalies d'audit corrigées | 16 (V1 à V16) | `docs/00-INDEX.md` § 8 |
| Balayages automatiques | 16, tous branchés | `docs/02-modele-metier.md` § 9.1 |
| URLs du front | 35 | `docs/08-frontend.md` § 3 |
| Modules de routes serveur | 11 | `docs/01-architecture.md` § 4 |
| Cold start en production | ~55 s (mesuré 02/11/2026) | `docs/07-exploitation.md` |

---

## Fin, et par où recommencer

Si vous n'avez retenu qu'une chose de ce document : **ZOYD organise la
confiance.** Un joueur mise, l'autre suit, l'arbitre juge — et une
mécanique d'horloges, de verrous, de tests et de défenses invisibles
garantit que l'argent ne peut ni se perdre, ni se doubler, ni s'envoler
vers le mauvais guichet.

Pour aller plus loin, entrez par `docs/00-INDEX.md` : chaque chapitre de
ce document pointe vers le document technique qui le démontre, citation
de code à l'appui. Une lecture utile suit le chemin : 02 (le modèle métier), 03 (la
sécurité), 08 (la construction côté navigateur).
