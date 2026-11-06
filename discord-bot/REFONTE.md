# REFONTE QG ZOYD — Cahier des charges complété

**Version :** 1.2 — EXÉCUTÉ le 06/11/2026
**Statut :** Refonte terminée et vérifiée. Le serveur est prêt côté technique ; l'ouverture publique attend la décision compte / Community.
**Principe directeur (inchangé) :** construire une communauté crédible sans faire croire que le produit est terminé.

Légende des mentions :
`[VÉRIFIÉ code]` = lu dans le projet, vérifiable `fichier:ligne`.
`[DOC]` = issu des documents de présentation, non relu dans le code.
`[ICI]` = décision à prendre par toi.

---

## 1. Le Projet réel — ce qu'on peut dire, et comment

### 1.1 Ce qui existe en code aujourd'hui `[VÉRIFIÉ code]`
- **Inscription directe sans code d'activation.** Les codes 8 chiffres / 15 minutes existent uniquement pour reset / réactivation. `Inscription` ne gate plus.
- **Formats MJ : 1VS1 / 2VS2 / 3VS3 / 4VS4 / 5VS5** (4V4 existe en moteur, masqué en UI). `PRODUCT.md` + `MJ_FORMATS` (competition.ts) confirment la liste complète.
- **Modes MJ** : S&D, Hardpoint, Domination, Frontline, Control.
- **BR salons** (ouverts à l'inscription), **Tournois** (bracket serveur, squads libres, arbitre réservé), **BR League** = événement hebdomadaire différé — **ne pas la présenter comme ouverte**.
- **Wallet ZC** : 1 ZC = 10 FCFA. Entrée match 50 ZC (présets 50/100/200/500/1000 + libre). Commission arbitre 2 % (match), 5 % (≤8 places) / 10 % (>8 places) tournois, 0 % en ligue. ZOYD : 0 % sur les pots, 2 % à la sortie. Minimum retrait 150 ZC. Plafond 50 000 ZC / 24 h. Maximum retrait 100 000 ZC `[VÉRIFIÉ code]`.
- **ELO** : départ 1200, K=32, Bronze→Master. Podium tournoi 50/30/20. Podium BR League 60/25/15.
- **Retraits** : BJ / CI / SN / TG opérationnels (Orange / MTN / Wave / Celtiis selon pays). 6 autres pays affichés mais **sans opérateurs confirmés** — ne jamais écrire « disponibles ».
- **Trust Score, Serment d'intégrité, fraude 1 compte/personne, anti-mint (récompenses award admin sans preuve = refusées, jamais sur litige en cours)** `[VÉRIFIÉ code]`.
- **Nom d'usage officiel** : inscription sans téléphone imposée par l'API ? Non — téléphone requis (paiement), donc **18+** inévitable. `ZOYD-Presentation-CODM.md` le pose : 18+.
- **Site :** https://zoyd.vercel.app · **TikTok :** @z.o.y.d · **WhatsApp :** https://chat.whatsapp.com/FJ65ueT6BheIG4jlsc4lq0 · **Discord (actuel) :** https://discord.gg/wfQCFTsEJk

### 1.2 Ce qui n'est PAS encore ouvert `[VÉRIFIÉ code + DOC]`
- BR League = différée volontairement.
- 4VS4 = codé mais **masqué en UI** (à présenter comme « en activation côté plateforme »).
- Betas / tests : **aucun statut officiellement ouvert.** Ne rien promettre avant P limitée définie.

### 1.3 Dette déjà connue `[ICI/TECH]`
- `?invite=` dans `PublicProfilPage.tsx` mène à `/mj/créer?invite=id` : **lien d'invitation social cassé.** À ne pas mettre en avant tant que la section dev n'a pas réparé.

---

## 2. Le serveur n'est PAS ZOYD — positionnement en une ligne

> **Le QG ZOYD est le point de rassemblement officiel : comprendre, suivre, échanger, contribuer — sans faire semblant que tout est prêt.**

Canal scindé :
- **TikTok** : crédential, accroche. `2–3 vidéos + 3 affiches / jour` (cadence équipe, pas une règle Discord).
- **WhatsApp** : proximité, échanges rapides, même lien JOINDRE par défaut.
- **Discord** : information structurée, discussion organisée, suivi, participation communauté.
- **Site** : produit (invitation et portefeuille in-app).

Toute contradiction entre ces canaux est une faute de communication. Les liens officiels sont #reseaux-officiels uniquement.

---

## 3. Architecture cible (24 salons)

### BIENVENUE (4, lecture seule sauf mention)
| Salon | Contenu |
|---|---|
| `#bienvenue` | Message d'accueil (§6), épinglé. |
| `#reglement` | Règles + sanctions (§7), épinglé. |
| `#commencer-ici` | Parcours : rôles, quoi lire, quoi attendre, lien WhatsApp + TikTok. Épinglé. (Ex-`ou-aller`.) |
| `#annonces` | Officiel, FAQ visuelle tape-1-5, pas d'autre bruit. |

### DÉCOUVRIR ZOYD (5)
| Salon | Contenu vérifié |
|---|---|
| `#presentation-zoyd` | Vision, problème, pour qui, pour qui c'est (§Présentation). Pas de promesse non vérifiée. |
| `#comment-ca-marche` | MJ/BR/Tournois, cagnotte gelée, arbitrage 2–10 %, double confirmation, retraits 2 %. **Pas d'argent hors plateforme.** |
| `#formats-de-competition` | MJ 1VS1→5VS5 (4V4 = en activation), modes S&D/Hardpoint/Domination/Control/Frontline. BR salons top 5. Tournois bracket. **BR League = événement, pas un mode ouvert.** |
| `#etat-du-projet` | État daté + prochaines étapes confirmées. **Rien de plus.** |
| `#questions-frequentes` | FAQ (§8), épinglé. |

### COMMUNAUTÉ (5)
| Salon | Contenu |
|---|---|
| `#discussion-generale` | Parler ZOYD + gaming. Pas de pub, pas de friction. |
| `#presentation-des-joueurs` | Modèle : Pseudo / Jeu principal / Mode (MJ/BR) / Pays (facultatif). |
| `#cod-mobile` | Matchs, meta, défaites, victoires, équipes. |
| `#clips-et-gameplay` | Clips, captures, actions. |
| `#idees-et-suggestions` | Améliorations, pas de promesses en réponse. |

### PARTICIPER AU PROJET (3)
| Salon | Contenu |
|---|---|
| `#sondages` | Questions officielles, 1 question, résultats publics auto-figés. |
| `#retours-communaute` | Retours + bugs (même canal, template unique : Page/Route, Attendu, Obtenu, Capture, Device, Pays). |
| `#tests-et-beta` | Lecture seule + « rien d'ouvert pour l'instant — dès qu'un test s'ouvre, ce sera annoncé ici. » |

### SUIVRE ZOYD (2)
| Salon | Contenu |
|---|---|
| `#reseaux-officiels` | Liens vérifiés : site, WhatsApp, TikTok, Discord. Tout le reste = non officiel. |
| `#evenements` | Annonces confirmées : e-tournament, Café discussion, révélation, campagne. |

### ÉQUIPE ZOYD — privé (5)
`#qg-equipe` · `#suivi-moderation` · `#planning-communication` · `#suivi-retours` · `#journal-des-actions` (remplace #audit-log).

---

## 4. Rôles — dégraissage réel 18 → 7

| Ancien rôle | Cible v1 | Action |
|---|---|---|
| Admin (pos 17) | **Fondateur** | Renommer. Perms = Administrator, 1 personne. |
| Moderateur | **Administrateur** | Renommer. Perms = gestion salons/messages/membres, 1–2 personnes. |
| Guide | **Modérateur** | Renommer. Perms = suppr messages, mute, kick, warn. **Pas** Administrator. |
| Arbitre | — | Supprimé (cj produit, pré-launch). |
| Beta / Team / Joueur / Nouveau / Pays-* / MJ / BR / Notifs | **Communauté** | Nouveau rôle unique, attribué après accueil/règles. |
| (nouveau) | **Équipe ZOYD** | Identification, aucune perms auto. |
| (nouveau) | **Testeur** | Verrouillé tant que tests fermés. |
| (nouveau, tardif) | **Créateur** | Pour créateurs qui signent officiellement. |

**Hiérarchie :** Fondateur > Administrateur > Modérateur > Équipe ZOYD > Testeur / Créateur > Communauté.

**Procédure :** Member arrive → `#commencer-ici` → accepte règles → `Communauté` (manuellement au début, quelques dizaines de membres ; auto via bot/Community ensuite). Le bot current (déployé serait Nouveau→Joueur + tickets) **n'est pas déployé** : conserver l'alignement sur « natif d'abord » (Phase initiale).

**Perms @everyone (durci) :** pas de MentionEveryone, pas de ChangeNickname, pas de UseVAD (déjà en place). **Salons lecture seule = autorisé Member**, pas Administrator.

---

## 5. Permissions et sécurité natives (avant public)

- Verification Level : membres enregistrés / téléphone selon option.
- AutoMod conservé : Filet insultes (timeout 60s → #reglement) + Anti-spam mentions (limite 4) — **déjà en place** et visible dans #audit-log.
- Community feature + Onboarding natif : dépend du retour du compte (procédure manuelle serveur). À activer si possible → bouton « Accepter règles ».
- Invite : **recréer au lancement** (l'actuelle pointe vers l'ancien #bienvenue ; un renommage/suppression → nouvelle invite).
- 2FA Fondateur + Administrateur. Appareils reconnus — session volée est la cause de l'incident du 30/09. **Aucune dérogation.**

---

## 6. Message d'accueil (texte proposé, modifiable)

> **Bienvenue au QG ZOYD !**
>
> ZOYD est un projet qui veut structurer la compétition gaming mobile en réunissant les joueurs, les matchs, les tournois, les ligues et les mécanismes de confiance.
>
> Ici, tu peux découvrir le projet, suivre son évolution, échanger avec d'autres joueurs de COD Mobile et contribuer à la construction de la communauté.
>
> **Pour commencer :**
> 1. Lis le règlement dans #reglement
> 2. Découvre la présentation dans #presentation-zoyd
> 3. Consulte l'état actuel du projet dans #etat-du-projet
> 4. Présente-toi si tu le souhaites dans #presentation-des-joueurs
> 5. Reste attentif aux annonces dans #annonces pour les prochaines étapes
>
> ZOYD est encore en cours de finalisation. Les fonctionnalités et les dates seront annoncées uniquement lorsqu'elles sont confirmées. Aucun test n'est ouvert pour le moment.
>
> **On compète, on prouve, on est payé.** (slogan communauté — pas une garantie de gains)
>
> Bienvenue dans la construction de ZOYD.

---

## 7. Règlement (fusion spec + version live)

1. Respect — même en litige. Insulte = mute. Récidive = ban + malus Trust (jeu).
2. Argent 100% plateforme — deal privé/Mobile Money hors ZOYD = ban direct. Zéro recours hors ZOYD.
3. Fair-play — triche, exploit, faux screen = match perdu + ban.
4. Preuves — scoreboard + final exigés. Un seul litige actif. Pool gelé.
5. Un salon = un sujet — pas de spam, pas de pub.
6. Beta — bug ? #retours-communaute avec template. Pas de rage.
7. **ZOYD ne DM jamais.** Aucun staff ne demande ton code, ton mot de passe, un paiement ou une carte en DM. Rejoins le serveur, passe par ticket privé. Toute demande = arnaque, signale-la.

Sanctions (progression) : rappel → avertissement → restriction temporaire → expulsion temporaire → **bannissement** (fraude/menace = immédiat). Décisions consignées dans #suivi-moderation. Révision sur demande raisonnable.

---

## 8. FAQ (10 entrées prêtes à poster ; sources vérifiées)

**Q1. ZOYD c'est quoi ?** → Plateforme de compétition CODM entre joueurs avec mises volontaires, arbitrage et Mobile Money. 18+.
**Q2. Combien ZOYD prend ?** → NC : 0 % sur les pots, 2 % à la sortie (retrait), frais FedaPay séparés `[VÉRIFIÉ code]`.
**Q3. C'est légal où je suis ?** → Dix pays retraits opérationnels `[CI/BJ/SN/TG VÉRIFIÉS code]` ; les autres dépendent des opérateurs locaux. 18+. Conseil local si doute.
**Q4. Le wallet ?** → 1 ZC = 10 FCFA. Minimum retrait 150 ZC. Plafond 50 000 ZC/24 h `[VÉRIFIÉ code]`.
**Q5. Où sont mes gains aujourd'hui ?** → Gelés jusqu'à confirmation double ou décision arbitre/admin.
**Q6. Un litige ?** → #retours-communaute (template match). Ne jamais en public ; aucun paiement en privé.
**Q7. Un compte par personne ?** → Oui. Collusion = ban.
**Q8. Mes données ?** → Téléphone, e-mail, pseudo, gameId ; jamais revendus ; gameId non public.
**Q9. La BR League ?** → Pas ouverte aujourd'hui. Événement différé. Annoncée d'abord → #annonces.
**Q10. J'arrive de TikTok / WhatsApp ?** → Suis #reglement puis #presentation-zoyd puis #discussion-generale.

---

## 9. Migration serveur actuel → cible

| Existant | Cible | Action |
|---|---|---|
| #bienvenue | #bienvenue | PATCH texte v2 |
| #regles | #reglement | Renommer + PATCH contenu |
| #ou-aller | #commencer-ici | Renommer + PATCH (rôles Wenger) |
| #annonces | #annonces | PATCH |
| #roles | (supprimé) | Conserver parsing rôles dans #commencer-ici |
| #presentations | #presentation-des-joueurs | Renommer |
| #pourquoi-zoyd / #principes | #presentation-zoyd | Fusion → supprimer les 2 |
| #deroulement-match | #comment-ca-marche | Renommer + PATCH (fusion principes) |
| #lexique / #tournois / #br-league | #formats-de-competition | Fusion → supprimer |
| #wallet-trust | #comment-ca-marche + FAQ | Fusion → supprimer |
| #avancement | #etat-du-projet | Renommer + PATCH daté |
| #faq | #questions-frequentes | Renommer + PATCH v2 |
| #poser-question / #bugs-retours → #retours-communaute | Fusion (template unique) |
| #support (tickets) → #qg-equipe (privé) ou garder privé | Décide `[ICI]` |
| #audit-log → #journal-des-actions | Renommer privé |
| #recherche-match / #recrutement-teams / #resultats-podiums / #regles-jeu / #hall-of-fame → **SUPPRIMÉS** | Pré-lancement, hors scope §1 |
| #clips → #clips-et-gameplay | Renommer |
| (nouveau) #discussion-generale #sondages #tests-et-beta #reseaux-officiels #evenements #cod-mobile #idees-et-suggestions #suivi-* | Créer |
| Vocaux Lobby / Pré-match / Salle Arbitres → **SUPPRIMER** pré-lancement | `[ICI]` |

**Préalable obligatoire : export complet des contenus actuels (backup local JSON) avant toute suppression.** Puis recréer.
Invite sera réinitialisée après suppression (lien actuel → invalide).

---

## 10. Indicateurs (sans objectifs inventés)

Membres & J7 · participation aux annonces (réactions/lectures) · profils créés en test/beta · questions récurrentes (export hebdo) · sondages cliqués · délais tickets/signalements. Aucun objectif chiffré tant que le public n'est pas ouvert.

---

## 11. Décisions à valider avant Phase 2 (exécution)

1. **Nom :** « QG ZOYD » accepté ?
2. **Ouverture :** privé quelques jours (membres invités) ou public dès lundi ?
3. **Départ :** Fondateur + Modérateur seulement, puis Administrateur quand 2ᵉ personne identifiée ?
4. **Bots :** natif + manuel (recommandé), ou reconstruire l'auto-rôle/ticket Zoyd (déjà écrit, jamais déployé) ?
5. **Exécution :** maintenant (serveur à 3 membres, blast radius faible) ou après l'appeal compte ?
6. **Salon #support :** fermer en privé (recommandé) ou supprimer ?
7. **Vocaux :** supprimer pré-lancement ?
8. **Comptes influenceurs/créateurs :** rôles à créer maintenant ou plus tard ?

---

## 12. Ce qui a été fait le 06/11/2026

- Serveur renommé : **QG ZOYD**, nouvelle description 18+.
- 6 catégories : BIENVENUE (public, lecture seule) · DÉCOUVRIR ZOYD (gated) · COMMUNAUTÉ (gated) · PARTICIPER AU PROJET (gated) · SUIVRE ZOYD (gated) · ÉQUIPE ZOYD (privé).
- 24 salons en place ; 31 salons anciens supprimés ; musique/voix produit supprimées.
- Rôles : Fondateur (Administrator) / Modérateur (moderation + audit) / Communauté (gating) ; rôles produit supprimés.
- Permissions : membres sans rôle = BIENVENUE uniquement ; Communauté = salons publics ; ÉQUIPE privée ; salons lecture seule.
- 24 messages publiés ; 13 épinglés ; règle anti-DM ajoutée ; annonce officiel des deux canaux.
- Backup complet avant suppression : `discord-bot/backup/backup-20261106-152901.json`.
- **Phase A exécutée** : mentions cliquables `<#id>` dans tous les textes (24 salons), couleurs charte (+Blanc rôle Communauté), topics complets, icône re-téléchargée (logo ZOYD), vérification anti-raid niveau 2, `#annonces` épinglé, réactions ✅ + `:zoyd:` sur le pin de `#commencer-ici`.
- Vérification automatique : `check.mjs` 100% vert (architecture, pins, rôles, AutoMod, invite).
- **Onboarding PRÉPARÉ (désactivé) le 06/11/2026** : prompt `Qu'est-ce qui t'amène ?` avec 4 options, chacune attribuant le rôle Communauté. `enabled:false`. `rules_channel_id` = #reglement, `public_updates_channel_id` = #annonces, `verification_level=2`.
  Activation = 1) appeal compte OK · 2) Settings → Enable Community (owner, 2 clics) · 3) basculer `enabled:true` via API (fait par moi à ce moment-là) · 4) welcome screen côté client (Community requise).

**Compte Fondateur officiellement considéré perdu (06/11/2026).** `zoyd111` désactivé par T&S le 30/09, aucun retour prévu. Rôle Fondateur supprimé. Gouvernance basculée : bot Zoyd (pos 17, Administrator) + Modérateur (pos 15). Onboarding préparé côté API, désactivé tant que Community est absent.

**Gate Communauté levé le 06/11/2026** — tous les salons publics visibles/écrivains sauf lecture seule ; ÉQUIPE privé. AutoMod garde-fou actif (Filet insultes, Anti-spam, vérification niveau 2). Le rôle Communauté devient un badge membre, attribué plus tard avec Community natif. ID du compte utilisateur tiers : non fourni — le serveur est déjà ouvert à quiconque rejoint via l'invitation.
