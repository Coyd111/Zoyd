# ZOYD — Audit UI/UX (registre des constats)

Date : 2026-11-03. Etat : COMPLETE — passe statique CLOSEE, passe 2 live
anonyme CLOSEE le meme jour (plan + resultats au chapitre 7).

Perimetre : tout le parcours interface de `Zoyd/src/` (pages, clusters
features, chrome, stores UI, lib, composants) + specs e2e UI relatives —
plus la passe live anonyme sur `https://zoyd.vercel.app/` (GET
uniquement, aucun appel authentifie, aucune ecriture).

Fait foi : ce fichier est le registre Temp (`zoyd-ui-audit.md`, 1291
lignes, fusion des 6 tranches `zoyd-ui-audit-01..06.md`) valide par
l'utilisateur (« registre fait foi ») puis installe ici avec son accord.
Conditions posees a l'installation : fichier NEUF (docs/audit* et
docs/audit-ux intacts), commit docs-only, aucune correction code dans
cette passe. Les ancres fichier:ligne valent au 2026-11-03.

Méthode : pile de lecture page par page sur tout `src/` (185 fichiers,
chaque fichier de l'inventaire lu intégralement), chaque constat repassé
en preuve grep / read exact avant inscription. Toute citation ci-dessous
est verbatim (copie exacte, accents compris). Declaration de prudence :
l'inventaire subagent (session
`ses_e5f22e66fffe6FKKJ13gKKl8mm`) a servi de CARTE de lecture ; aucun constat
n'est inscrit sans re-preuve personnelle.

Grille de sévérité (suivant les precedentes passes de l'audit) :
- P1 : bug reel visible par un joueur (divergence etat/affichage, action trompeuse).
- P2 : friction reelle mesurable (promesse non tenue, jauge qui ment,
  action destructive sans confirmation, couverture e2e faussée).
- P3 : cosmétique / cohérence / tests / code mort — aucun blocage joueur.

Contrainte respectée : PROD LECTURE-SEULE STRICTE (aucun GET à
`/api/*`, aucun appel authentifié) pendant la phase statique ; la phase
live n'utilisera que la navigation publique anonyme.

Regles du jeu : `docs/audit*/` et `docs/audit-ux/` sont GELES (ne jamais
modifier) ; l'installation eventuelle du rapport se fera dans un FICHIER NEUF
apres validation utilisateur. Les detections deja documentées en comments
dans le code (P13 C…, F4/F5, M1/M5, M-06) ne sont PAS re-accusées comme
découvertes : chapitre 5 liste leur statut (« corrigé », « corrigé pas
testé », « non corrigé »).

---

## 1. P1 — bugs reels (2 constats)

### P1-1. Le hub MJ affiche « Partie terminée » pour les matchs en litige, en attente d'arbitre ou archives — un litige se lit comme un match clos (cagnotte gelée incluse)

Preuve de référence — la source unique des statuts,
`src/app/lib/matchStatus.ts:25-42` verbatim :

```
export type MatchStatus =
  | 'recruiting'
  /** LEGACY : plus rien ne le produit depuis que `awaiting_arbiter` l'a remplace. */
  | 'full'
  /** Le match ne peut pas avancer : pas d'arbitre. */
  | 'awaiting_arbiter'
  | 'check_in'
  | 'ready'
  | 'in_progress'
  /** Resultat soumis, cagnotte gelee : les deux equipes doivent confirmer. */
  | 'awaiting_confirmation'
  | 'finished'
  /** Litige ouvert : l'admin tranche. */
  | 'disputed'
  | 'cancelled'
  | 'forfeited'
  /** Archive par le cron : le match n'existe plus pour le joueur. */
  | 'archived';
```

La chaîne de mapping du hub (`src/app/pages/mj/HubMJPage.tsx:237-255`
verbatim) couvre 8 statuts puis retombe sans commentaire sur `'finished'`
pour les 3 autres (`awaiting_arbiter`, `disputed`, `archived`) :

```
                  status={
                    match.status === 'recruiting'
                      ? 'open'
                      : match.status === 'full'
                        ? 'full'
                        : match.status === 'check_in'
                          ? 'check_in'
                          : match.status === 'ready'
                            ? 'ready'
                            : match.status === 'in_progress'
                              ? 'in_progress'
                              : match.status === 'awaiting_confirmation'
                                ? 'awaiting_confirmation'
                                : match.status === 'forfeited'
                                  ? 'forfeited'
                                  : match.status === 'cancelled'
                                    ? 'cancelled'
                                    : 'finished'
                  }
```

`MatchCard` rend alors le libellé « Partie terminée » pour ces matchs
(`src/app/components/MatchCard.tsx:58` verbatim :
`finished: { label: 'Partie terminée', accent: 'text-white/70' }`) —
soit, a l'ecran, pour un match dont la cagnotte est gele (litige),
exactement le message que les PIEGE du design promettent d'eviter.

Le store livre tous les statuts sans exclusion
(`src/app/stores/matchStore.ts:619-634`, `getFilteredMatches` : filtre sur
visibility/device/controller/format/status/minTrustScore — aucun rejet de
statut), donc le hub recoit VRAIMENT ces 3 statuts : le mapping est le seul
 endroit ou l'information disparaît.

Le contraste interne prouve que la règle « tout couvrir » existe déjà :
`src/app/components/admin/AdminTabShared.tsx:22-54` couvre TOUS les statuts —
`awaiting_arbiter` l.27 (tone) et l.44 (libellé), `archived` l.38 (tone) et
l.53 (libellé). La divergence est propre au hub et au détail (voir P1-2).

Impact joueur : sur `/mj`, un match en litige (argent du joueur gelé, en
attente de tranchage admin) s'affiche « Partie terminée » ; un match sans
arbitre s'affiche « Partie terminée » au lieu d'appeler un arbitre
(comportement que la page détail, elle, sait exprimer — incohérence entre
deux écrans du même objet). Cagnotte affichée : aucune divergence monétaire
constatée (le montant affiché est la cagnotte, gelée ou non ; le PIEGE
« perWinner » n'est PAS en jeu ici).

Correction suggérée : remplacer la cascade par une table d'export depuis
`matchStatus.ts` (statut -> libellé MatchCard) qui fera échouer TypeScript
dès qu'un futur statut du domaine manquera, comme le fait déjà
AdminTabShared.

### P1-2. Détail de match : « awaiting_arbiter » affiché en enum brut dans l'en-tête ; `disputed` et `archived` absents de MatchCard (contradiction avec ses propres invariants)

Preuves :

1. `src/features/match/pages/MatchDetailPage.tsx:72-83` — `statusLabels`
   contient `disputed: 'Litige ouvert'` mais PAS `awaiting_arbiter` ni
   `archived` ; consommation en l.229 :

```
  const statusLabel = match ? statusLabels[match.status] || match.status : '';
```

→ pour un match sans arbitre, `MatchHeader` affiche la chaîne brute
« awaiting_arbiter » (enum anglais technique) comme statut à l'écran ;
`archived` produirait « archived ». Rien dans la page ne traduit
l'invariant du store (l.70 : `import CLOSED_STATUSES` ; la page importe bien
la source, l'affichage ne s'en sert pas pour ce chip).

2. Contradiction directe avec l'invariant écrit au-dessus de
`MatchHeader` (`src/features/match/components/MatchHeader.tsx:9-12`)
verbatim :

```
 * INVARIANT : le libelle de statut est fourni par le parent, qui connait la
 * liste complete des statuts (awaiting_arbiter compris).
 * PIEGE : un match en attente d'arbitre est VIVANT : le libelle doit le
 * dire, sinon le joueur croit a un match termine.
```

Le parent viole l'invariant : `awaiting_arbiter` n'est pas compris.

3. `src/app/components/MatchCard.tsx:43` — l'union d'entrées n'a PAS
`disputed` (elle a `awaiting_arbiter` ; verbatim l.43 : `status: 'open' |
'full' | 'awaiting_arbiter' | 'check_in' | 'ready' | 'in_progress' |
'awaiting_confirmation' | 'finished' | 'forfeited' | 'cancelled'`) — une
carte ne peut donc JAMAIS présenter un litige, et `statusCopy` (l.47-61)
n'a pas de clé correspondante. `archived` est absent des deux. Le décalage
est masqué en pratique par le P1-1 (le hub force la chute en `'finished'`).

Impact joueur : en page détail, un match en attente d'arbitre lui parle
en enum machine (« awaiting_arbiter ») ; partout ailleurs le même état est
« En attente d'un arbitre » (MatchCard l.53, AdminTabShared l.44).
L'incohérence contredit le but exact de `matchStatus.ts`
(source unique écrite précisément pour éviter ca).

Correction suggérée : compléter `statusLabels` (détail) avec les 2 clés
manquantes ; ajouter `disputed` (et `archived`) à l'union + `statusCopy` de
MatchCard, en s'appuyant sur la table d'export de matchStatus.ts (même
correction de fond que P1-1).

Note cumulée (GAIN de la passe) : les deux P1 partagent une correction
unique — table source unique exportée depuis `matchStatus.ts`, consommée
par le hub, MatchCard et MatchDetailPage. Un seul chantier réglera les deux.
---

## 2. P2 — frictions reelles (5 constats)

### P2-1. La jauge de mot de passe monte a « Fort » (voire « Elite ») pour un mot de passe que le formulaire va rejeter

Preuves (même fichier, deux règles qui divergent) :

1. La règle de validation (`src/app/pages/auth/RegisterPage.tsx:104-108`
verbatim) exige majuscule + chiffre + CARACTERE SPECIAL :

```
      .string()
      .min(8, 'Minimum 8 caractères')
      .regex(/[A-Z]/, 'Doit contenir au moins une majuscule')
      .regex(/[0-9]/, 'Doit contenir au moins un chiffre')
      .regex(/[^A-Za-z0-9]/, 'Doit contenir au moins un caractère spécial')
```

2. La jauge affichée pendant la frappe
(`src/app/pages/auth/RegisterPage.tsx:197-207` verbatim) teste QUATRE
criteres — longueur 8, longueur 12, casse mixte, chiffre — mais jamais le
caractere special :

```
  const getPasswordStrength = (pwd: string) => {
    if (!pwd) return 0;
    let strength = 0;
    if (pwd.length >= 8) strength++;
    if (pwd.length >= 12) strength++;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength++;
    if (/\d/.test(pwd)) strength++;
    return strength;
  };

  const passwordStrength = getPasswordStrength(password);
  const strengthLabels = ['', 'Faible', 'Moyen', 'Fort', 'Elite'];
```

Consequences mesurables : « Azerty1234 » (10 car., casse mixte, chiffre,
PAS de special) atteint 3/4 = « Fort » puis est REJETE a la soumission par
la règle l.108 ; « Azerty1234567 » (13 car.) atteint 4/4 = « Elite »
(affiche comme reussite maximale) puis subit le même rejet. La promesse de
la jauge et la realite du formulaire divergent sur le seul critère qui
aurait permis de prevoir le cas.

Correction suggérée : ajouter le cinquieme criteres
(`if (/[^A-Za-z0-9]/.test(pwd)) strength++;`) OU remplacer l'etiquette par
une checklist explicite (regles cochées/non cochées sous le champ). La
checklist est preferable : elle dit a l'utilisateur CE QUI MANQUE au lieu
de re-couler la couleur.

### P2-2. Le test axe « Mot de passe oublie » balaye la page 404 : la garde heading n'est pas active pour cette entree, et le chemin cible n'existe pas

Preuves :

1. La cible du test (`e2e/ui/accessibility.spec.ts:22` verbatim) :

```
  { name: 'Mot de passe oublie', path: '/auth/forgot-password' },
```

2. Le chemin reel de l'app : `src/app/routes.tsx:89` (`path: 'forgot'`
sous `/auth`), lien reel `src/app/pages/auth/LoginPage.tsx:286`
(`to="/auth/forgot"`), declaration de la page
`ForgotPasswordPage.tsx:83` (`path="/auth/forgot"`). `/auth/forgot-password`
REND LE DOM DE LA 404 SPA (catch-all routes.tsx).

3. La garde anti-page-fantome existe (`e2e/ui/accessibility.spec.ts:79-84`
verbatim) mais n'est actif que si l'entree DECLARE un heading — l'entree
forgot n'en declare pas (l.22) :

```
      if (target.heading) {
        await expect(
          page.getByRole('heading', { level: 1, name: target.heading }),
          `la page ${target.path} doit rendre son titre, sinon axe analyse la page 404`
        ).toBeVisible();
      }
```

Le commentaire qui PRECISE le piege (l.75-78, verbatim) montre que le
mecanisme etait concu exactement pour ca et que l'entree l'ignore :

```
      // P15 C2 (audit-3) : verifier que la page rendue est bien celle
      // annoncee AVANT l'analyse. Un chemin fantome produit un DOM non vide
      // (la 404 de la SPA est rendue) — sans cette garde, axe-core analyse
      // cette page en la croyant la cible et le test reste vert a tort.
```

4. Coherence croisee : `e2e/ui/responsive.spec.ts:39` reference la BONNE
route `/auth/forgot`. Les deux suites portent des pages DIFFERENTES pour la
meme intention — la preuve que l'un des deux est faux, biais passe
inapercu jusqu'aujourd'hui.

Consequence : `ForgotPasswordPage` n'a AUCUNE vraie evaluation axe
(date d'aujourd'hui) : le test ronronne sur la 404. Correction : corriger
le chemin en l.22 vers `/auth/forgot` ET ajouter un `heading` (le titre
reel de la page) pour activer la garde.

### P2-3. Suppression d'ami en un clic, sans confirmation, cible tactile exiguë masquee au survol

Preuve — `src/app/components/social/FriendsWidget.tsx:201-212`
verbatim (conteneur + bouton de suppression) :

```
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => navigate(`/chat?dm=${encodeURIComponent(friend.id)}`)}
                          className="p-1.5 text-white/70 hover:text-zoyd-blue transition-colors"
                          title="Message"
                          aria-label={`Envoyer un message à ${friend.pseudo}`}
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => removeFriend(friend.id)}
                          className="p-1.5 text-white/70 hover:text-red-400 transition-colors"
                          title="Supprimer"
                          aria-label={`Supprimer ${friend.pseudo} des amis`}
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </button>
```

Trois frictions en une action :
1. Le clic declenche IMMEDIATEMENT la mutation (`removeFriend`) : aucune
confirmation, aucun undo — recréer le lien exige une nouvelle demande
d'ami. Le widget protege ses écritures côté spam (commentaire l.12-14
verbatim : « une demande en attente est refusee tant qu'une autre est en
cours (pendingId) : le bouton doit rester desactive, sinon le joueur spamme
le serveur ») mais la destruction, plus grave, n'a AUCUN garde.
2. Cibles de 14 px (p-1.5 + icone 14), DEUX boutons adjacents (Message /
Supprimer) — une derapée (cible ratee d'un cheveu) supprime un ami sans
intention ; cible inférieure aux 44×44 recommandées (WCAG 2.5.5).
3. L'ensemble est `opacity-0 group-hover:opacity-100` (l.201) : invisible
SANS survol — sur mobile, le pattern group-hover ne rend jamais l'action
visible, on ne la trouve qu'en tapant sur la ligne.

Comparaison avec le cluster : `PublicProfilPage` ouvre une confirmation
inline pour BLOQUER/SIGNALER (deux étapes, l.163+) ; la suppression d'ami
est le seul geste destructif du cluster sans garde.

Correction suggérée : confirmation inline (« Supprimer ? » — second tap sur
le même bouton, pattern existant dans le code) et cibles plus larges
(p-2 minimum, ou aire d'appel étendue), en conservant la deco group-hover
au desktop mais en révélant aussi au focus clavier.

### P2-4. Demande d'ami depuis le profil public sans garde double-clic

Preuve — `src/app/pages/PublicProfilPage.tsx:146-158` verbatim
(`handleAddFriend` complet) :

```
  const handleAddFriend = async () => {
    if (!currentUser) {
      navigate('/auth/login');
      return;
    }
    try {
      await sendServerFriendRequest(id, 'Salut, jouons ensemble !');
      sendRequest(id, publicProfile.pseudo);
      toast.success(`Demande envoyée a ${publicProfile.pseudo}.`);
    } catch {
      toast.error("Impossible d'envoyer la demande.");
    }
  };
```

Pas de `pending` local : un double-tap lance DEUX POST
`/api/friends/send` — la garde serveur refuse la seconde (409), la toaste
d'erreur apparaît alors que la PREMIERE a reussi : experience confuse sur
le seul bouton socialement sensible de la page. Le friendsStore a DEJA ce
pattern (pendingId — commentaire FriendsWidget l.12-14) : il n'est pas
branche ici.

Correction suggérée : `const [sending, setSending] = useState(false)` +
`disabled={sending}` sur le bouton (pattern déjà établi dans le projet —
voir ParametresPage l.935 : `disabled={busy || ...}`).

### P2-5. Classement public : « TOP GAINS » / « VICTOIRES » re-trient le top 50 ELO du serveur, pas le classement reel de ces métriques

Preuves :

1. Données : UNE seule source trie ELO — déclaration de la page
(`src/app/pages/PublicClassementsPage.tsx:9-10` verbatim) :

```
 * - GET /api/leaderboard : joueurs Avec activite, tries par ELO, cache
 *   60 s, sanitises (sanitizeUserPayload), rate-limits 'default'.
```

2. Volume : `visibleCount = 50` (l.65 verbatim : « // = la requete : la
vitrine d'un premier ecran, pas l'export admin. »).

3. Les trois onglets (`PublicClassementsPage.tsx:67-71` verbatim) :

```
const tabs: { id: PublicTab; label: string; icon: React.ComponentType<{ className?: string }>; metric: string }[] = [
  { id: 'elo', label: 'TOP ELO', icon: Trophy, metric: 'ELO' },
  { id: 'earnings', label: 'TOP GAINS', icon: TrendingUp, metric: 'GAINS' },
  { id: 'wins', label: 'VICTOIRES', icon: Target, metric: 'V' },
];
```

4. Le tri client ecrase l'ordre SERVEUR sur le MEME jeu de 50
(`PublicClassementsPage.tsx:80-87` sorters verbatim ; appliqué en l.143 :
`return [...state.players].slice(0, visibleCount).sort(sorters[activeTab])…`) :

```
const sorters: Record<PublicTab, (left: PublicPlayer, right: PublicPlayer) => number> = {
  elo: (left, right) =>
    right.elo - left.elo || right.winRate - left.winRate || right.totalMatches - left.totalMatches,
  earnings: (left, right) =>
    right.totalEarnings - left.totalEarnings || right.wins - left.wins || right.elo - left.elo,
  wins: (left, right) =>
    right.wins - left.wins || right.winRate - left.winRate || right.totalMatches - left.totalMatches,
};
```

Un joueur excellent en gains HORS top 50 ELO n'apparait NULLE PART, alors
que l'onglet s'appelle « TOP GAINS ».

5. La promesse existe a trois endroits : sous-titre (l.183-184 verbatim : « Le
classement reel de la communaute ZOYD, servi par le serveur et rafraichi a
chaque visite. »), description SEO (l.153 verbatim : « Le classement reel
des joueurs ZOYD par Elo, gains et victoires. Aucune session requise. »),
et la note honnête du bas (l.355-358 verbatim :
`{state.total} joueurs classes — le top {entries.length} est affiche.`)
qui mesure le ratio global mais ne revele PAS que les deux sous-onglets
partent du même top-50 ELO. L'e2e connexe documente le comportement sans le
contester (`e2e/ui/classements-public.spec.ts:18-20` verbatim : « les TABS
publics sont TOP ELO / TOP GAINS / VICTOIRES seulement »).

Impact visiteur : le VRAI #1 gains peut être invisible ; la page qui se
dedit « le classement reel » est exacte pour ELO, fausse pour les deux
autres onglets. Deux remedes — (a) FRONT SEUL : rebaptiser les onglets
(ex. « ELO — SELECTION GAINS ») et ajouter une note d'une ligne ; (b)
SERVEUR : un endpoint (ou un parametre ?metric=) livre le top GAINS reel
de la communaute — LA solution juste, mais hors cadre front.
---

## 3. P3 — cohérence, cosmétique, tests, code mort (10 constats)

### P3-1. Bouton « Garder en vue » inopérant dans l'onglet matchs du dashboard admin

Preuve — `src/app/components/admin/AdminMatchesTab.tsx:109-114` verbatim :

```
              <button
                onClick={() => onNavigateToTab('matches')}
                className="bg-white/5 border border-white/10 text-white px-4 py-2 text-[10px] font-display font-black tracking-widest uppercase italic hover:border-white/25 transition-colors"
              >
                Garder en vue
              </button>
```

Ce bouton est rendu DANS l'onglet 'matches'. Le parent branche
`onNavigateToTab={(tab) => setActiveTab(tab as typeof activeTab)}`
(`AdminDashboardPage.tsx:494`) : le clic écrit l'état déjà courant.
Effet observé : aucun. C'est une action morte sur chaque carte de
match de l'onglet. « Traiter » (l.101-108, vers l'onglet litiges) est
utilisable uniquement quand le statut est 'disputed' ; le bouton d'à
côté ne sert jamais.

Correction suggérée : supprimer le bouton. Un vrai « suivre ce match »
supposerait un mécanisme (traceillage) qui n'existe pas côté app —
ne pas en simuler un (règle maison : pas d'UI fantôme).

### P3-2. Ligne de classement (version connectée) : aucune navigation possible sur mobile

Preuve — `src/app/pages/ClassementsPage.tsx` : la ligne mobile
(l.427-455) est un `<div className="md:hidden …">` statique — pas de
`Link`, pas de `onClick`, pas de `role="button"`. Le `Link` n'existe
que pour desktop (l.470-479 verbatim) :

```
                  {entry.href ? (
                    <Link
                      to={entry.href}
                      className="hidden md:grid grid-cols-12 gap-4 px-4 py-4 items-center"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-4 items-center">{content}</div>
                  )}
```

`entry.href` existe pour les joueurs à profil public — l.139 (et
l.170/190/208 pour les autres onglets) verbatim :

```
      href: item.hasPublicProfile && item.primaryUserId ? `/profil/${item.primaryUserId}` : undefined,
```

Sur mobile, la ligne s'affiche mais rien n'est cliquable : un joueur
mobile ne peut PAS rejoindre un profil depuis le classement.

Correction suggérée : envelopper `mobileContent` dans le même `Link`
conditionnel (ou rendre la ligne cliquable au tap).

### P3-3. Modales brutes sans Escape ni piège de focus, alors que le design system offre `ui/Modal`

Preuves, trois overlays de la même famille :

1. Confirmation d'annulation admin (`AdminDashboardPage.tsx:515`
verbatim) :

```
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Confirmer l'annulation du match">
```

2. Modale réglages notifications (`NotificationSettingsModal.tsx:73`
verbatim) :

```
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
```

3. Invite 2FA admin (`TwoFactorPrompt.tsx:63` verbatim) :

```
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Verification 2FA requise">
```

Chacun proclame `role="dialog" aria-modal="true"` mais n'implémente NI
fermeture par Escape NI piège de focus. Un clavier reste capable de
sortir de la modale dans la page derrière.

L'outil existe et est UTILISÉ ailleurs : `ui/Modal.tsx` gère Escape
(l.66 verbatim : `if (event.key === 'Escape') {`) plus le piège
(l.85 verbatim : `document.addEventListener('keydown', onKeyDown, true);`).
Consommateurs actuels de `ui/Modal` : `MatchDetailPage.tsx:57`,
`WalletPage.tsx:29`, `CreateMatchPage.tsx:47`.

Exemples contrastes du même audit : `CreateMatchPage.tsx:124-133`
(Escape correct sur l'annulation du wizard), `BottomNav.tsx:72-75`
(Escape correct sur le tiroir « Plus »).

Correction suggérée : brancher les trois overlays sur `ui/Modal`.
Impact utilisateur réel faible (souris ok), mais c'est de
l'accessibilité clavier anormale pour des écrans qui proclament ARIA.

### P3-4. Divergences des navigations (Sidebar desktop / Navbar / BottomNav mobile)

Preuves :

1. La Sidebar desktop n'a pas d'entrée WALLET
(`src/app/components/layout/Sidebar.tsx:28-36` verbatim) :

```
const navItems = [
  { icon: LayoutGrid, label: 'MULTIJOUEUR', path: '/mj' },
  { icon: Trophy, label: 'TOURNOIS', path: '/mj/tournois' },
  { icon: Zap, label: 'BR SALON', path: '/br' },
  { icon: ShieldCheck, label: 'BR LEAGUE', path: '/br-league' },
  { icon: BarChart3, label: 'CLASSEMENTS', path: '/classements' },
  { icon: TrendingUp, label: 'GAINS', path: '/earnings' },
  { icon: Newspaper, label: 'INFOS', path: '/infos' },
];
```

La BottomNav mobile l'a (l.35 verbatim :
`{ icon: Wallet, label: 'WALLET', shortLabel: 'WALLET', path: '/wallet' },`)
et la Navbar aussi (l.80, lien Wallet). L'invariant écrit sur
BottomNav l.8-10 verbatim : « la liste de destinations doit rester
coherente avec la Sidebar. Une destination presente dans l'une et
absente de l'autre est un ecran inaccessible pour un profil de
navigation donne. » La navbar relie les deux mondes, mais l'invariant
nommé est entre Sidebar et BottomNav — il n'est pas tenu.

2. « AMIS » et « MESSAGES » pointent tous deux `/chat`
(Sidebar l.40-42 verbatim) :

```
const socialItems = [
  { icon: MessageCircle, label: 'MESSAGES', path: '/chat' },
  { icon: Users, label: 'AMIS', path: '/chat' },
];
```

Deux entrées, même destination : l'utilisateur ne peut pas distinguer
« amis » (liste) de « messages » (conversations) dans la navigation.

3. Trois libellés pour la même destination /admin : « CONTROLE »
(Sidebar l.37 verbatim :
`const adminNavItem = { icon: ShieldCheck, label: 'CONTROLE', path: '/admin' };`),
« Control » (Navbar l.74), « ADMIN » (BottomNav l.165).

Correction suggérée : ajouter WALLET à la Sidebar, fusionner AMIS et
MESSAGES (ou distinguer les destinations), unifier le libellé admin.

### P3-5. Code mort : `ui/Sidebar.tsx` (port shadcn) n'est importé nulle part

Preuves :
- Le fichier existe : `src/app/components/ui/Sidebar.tsx` (~300 lignes,
port shadcn/ui complet, composants SidebarProvider / Rail / Menu /
Trigger).
- Recherche d'imports sur tout `src/` : `grep "ui/Sidebar"` → 0
résultat (aucun import, aucun re-export).
- Il porte ses propres dépendances (Radix Slot — imports l.23-24).

Le risque n'est pas un bug mais du dead weight : un port de design
system jamais branché, qui grossit le grep de future personne. Deux
issues possibles : (a) quelqu'un va le brancher (panneaux latéraux
prévus) ; (b) supprimer.

Correction suggérée : décision de produit à prendre. S'il survit sans
consommateur, le retirer du bond (et ses imports Radix associés).

### P3-6. Couleurs des graphiques de gains en dur, en contradiction avec le PIEGE du même fichier

Preuves — `src/app/pages/EarningsCharts.tsx` :

1. Le PIEGE auto-écrit (l.8-9 verbatim) :

```
 * PIEGE : les couleurs viennent du design system via les tokens CSS ; une
 * couleur codee en dur dans un graphique diverge du reste de l'UI.
```

2. La contradiction (l.43-48 verbatim) :

```
const tooltipStyle = {
  backgroundColor: '#0A0A0A',
  border: '1px solid rgba(255,255,255,0.1)',
  fontSize: '12px',
  fontFamily: 'monospace',
};
```

`#0A0A0A` est un hexadécimal brut. Idem l.59-61 (grille `#ffffff05`,
axes `#ffffff20`) et l.80 (`cursor={{ fill: 'rgba(255,255,255,0.05)' }}`).

3. Nuance : la couleur de SÉRIE (CHART_YELLOW, l.29) vient déjà de
`src/lib/chartColors` — le modèle à étendre existe.

Aujourd'hui le rendu est cohérent (le thème est noir). Le défaut est
l'entretien : si le thème surface change, ces hexadécimaux ne
suivront pas — exactement ce que le PIEGE promet d'eviter.

Correction suggérée : déplacer les 4-5 valeurs hexadécimales dans
`chartColors` (ou tokens CSS) et consommer de là.

### P3-7. La barre `StatusLane` du dashboard admin n'est pas proportionnelle

Preuve — `src/app/components/admin/AdminTabShared.tsx:235` verbatim :

```
      <div className={`${accent} h-full`} style={{ width: `${Math.min(100, count * 18)}%` }} />
```

Une file = 18 % de largeur, plafonné à 100 % à partir de 6 : la barre
n'exprime PAS une proportion. Exemple : 2 vs 11 éléments → 36 % vs
100 %, ~2,8x visuel pour un ratio réel de 5,5x. Le compte exact est
affiché à côté, donc aucune fausse information chiffrée ; le défaut
est purement visuel (une barre qui inspire une proportion qu'elle
n'a pas).

Correction suggérée : largeur réellement proportionnelle
(`count / maxCount * 100`) ou suppression de la décoration. Pas
d'urgence.

### P3-8. La classe `bg-orange-400` du score de confiance est construite dans un store — dépend du scanner Tailwind

Preuves :

1. `src/app/stores/trustScoreStore.ts:83` verbatim :
`if (score >= 30) return 'bg-orange-400';` — une classe Tailwind
construite dans un store (fichier .ts).

2. Le scanner Tailwind v4 indexe l'ensemble du source, .ts compris :
la classe est donc générée aujourd'hui — la barre de progression du
toast warning fonctionne (fausse alerte d'une première passe levée,
vérifiée le 2026-11-03 par grep exhaustif : aucun autre
`bg-orange-400` nu dans src/).

3. Le risque est purement un risque d'entretien : renommer le
fichier, le déplacer, restructurer le store peut faire sortir la
classe du scan et disparaitre SILENCIEUSEMENT (une barre qui ne
s'affiche plus sans erreur de build). Précédent maison : les
couleurs de série exportent déjà par `src/lib/chartColors`.

Correction suggérée : à moyen terme, regrouper les couleurs de confiance
dans un module partagé et les référencer de là. Aucun bug actuel.

### P3-9. `handleCancelMatch` recharge la liste même après un échec

Preuve — `src/app/pages/AdminDashboardPage.tsx:378-386` verbatim :

```
      } else {
        toast.error(error instanceof Error ? error.message : 'Annulation admin impossible.');
      }
    } finally {
      setLoadingAction(false);
    }
    // Annulation admin : la liste des matchs et les compteurs changent.
    await reloadReports();
```

Le `await reloadReports()` est TOUJOURS effectué, y compris après le
`toast.error` du else. Consequence : un appel API inutile après
échec, mais inoffensif (lecture serveur fait foi — invariant l.16-18
du même fichier). Classe du constat : P3 mineur, purement de
parcimonie.

Correction suggérée : déplacer `await reloadReports()` dans le try
(après le succès uniquement).

### P3-10. Le compteur « arbitresNeeded » du hub MJ ne distingue pas les litiges

Preuve — `src/app/pages/mj/HubMJPage.tsx:78` verbatim :

```
    const arbitersNeeded = filteredMatches.filter((match) => !match.arbiter && match.status !== 'finished' && match.status !== 'cancelled' && match.status !== 'forfeited' && match.status !== 'awaiting_confirmation').length;
```

Le filtre exclut finished / cancelled / forfeited /
awaiting_confirmation mais PAS 'disputed'. Or dans un litige, c'est un
ADMIN qui tranche (commentaire matchStatus.ts l.37-38 : « Litige
ouvert : l'admin tranche. ») — pas un arbitre. Si un litige survient
sur un match resté sans arbitre, le compteur « X arbitres attendus »
est surcompté.

Impact : mineur (fréquence faible — un match a rarement survécu à sa
phase sans arbitre). À corriger dans le MEME chantier que le P1-1
(table de statuts unique).
---

## 4. Inventaire des coquilles (typographie, accents, libellés)

Regime : le projet écrit ses libellés UI en MAJUSCULES stylisées, ce qui
rend les accents manquants TRÈS visibles (l'accent est le plus souvent
réclamé par le mot français lui-même). On ne relève ci-dessous QUE les
écarts à une orthographe française correcte sur du texte AFFICHÉ à un
joueur/admin, plus les débris de commentaires choisis. Chaque entrée
porte : fichier:ligne + verbatim exact. Deux catégories : 4.1-4.3 =
affiché ; 4.4 = commentaires seulement.

Note de méthode : la signature visuelle du projet fait des accents
manquants un motif constant (« equipe » à chaque écran ne serait pas une
coquille isolée mais une règle de réduction). On ne liste donc pas les
mots isolés tolérables (ex. « Elite ») : seuls les départs
d'orthographe, les mots sans signification et les débris sont
consignés.

### 4.1 Texte affiché aux joueurs (joueur connecté et visiteur)

1. `src/app/components/layout/Navbar.tsx:65` verbatim :
`<div className="flex items-center gap-2">{serverConnected ? 'Serveur connecte' : 'Hors ligne'}</div>`
— attendu : « Serveur connecté ». Affiché EN DIRECT (indicateur du
statut du socket).

2. `src/app/components/profile/ProfileView.tsx:267,270,277,292,331,398` :
- l.267 verbatim : `Carriere Joueur` (attendu « Carrière Joueur » ; titre
  de section) ;
- l.270 verbatim : `label="Matchs joues"` (attendu « Matchs joués ») ;
- l.277 verbatim : `Carriere Arbitre` ;
- l.292 verbatim : `label="Matchs completes"` (attendu « Matchs complétés » ;
  cellule de score de confiance, mot inexistant à la place du verbe) ;
- l.331 verbatim :
  `body="Les prochains matchs terminés apparaîtront ici, avec leur resultat et ce qu'ils ont rapporte."`
  (« resultat » sans accent, « rapporte » attendu « rapportés ») ;
- l.398 verbatim :
  `body="Les participations et podiums apparaîtront ici des que les tournois seront Terminés."`
  (« des que » sans accent, « Terminés » avec majuscule invasive au
  milieu de phrase).

3. `src/app/pages/PublicProfilPage.tsx:154` verbatim :
`` toast.success(`Demande envoyée a ${publicProfile.pseudo}.`) ``
— attendu « envoyée à ».

4. `src/app/pages/PublicClassementsPage.tsx` (page vitrine, la plus
exposée) :
- l.43 verbatim :
  `// lignes uniquement (PAS de lien /profil/:id —see INVARIANT).`
  — débris de commentaire (« —see », mélange anglais) : à nettoyer en
  conservant le contenu (la règle INVARIANT citée existe réellement).
- l.183-185 verbatim : « Le classement reel de la communaute ZOYD, servi
  par le serveur et rafraichi a chaque visite. » (reel, communaute,
  rafraichi, a) ;
- l.189-196 (bande stats) verbatim abrégé :
  « joueurs actifs / matchs joues / distribues / paiements honores »
  (joues, distribues, honores sans accents) ;
- l.249-252 verbatim :
  « Le serveur n'a pas repondu. Aucun rang invente n'est affiche : reessaie
  dans un instant. » (repondu, invente, affiche) ; bouton « Reessayer »
  (l.253, attendu « Réessayer ») ;
- l.265 verbatim : « Cette vue se remplira des que des matchs auront ete
  joues et arbitres sur ZOYD. » ;
- l.357 verbatim : `{state.total} joueurs classes — le top {entries.length}
  est affiche.` (classes, affiche).

5. `src/app/pages/ClassementsPage.tsx` :
- l.69 verbatim : `{ id: 'teams', label: 'EQUIPES', icon: Users },`
  (libellé affiché, attendu « ÉQUIPES ») ;
- l.313-314 verbatim :
  « Ces classements bougent avec les matchs et tournois déjà joues sur
  ZOYD. Rien n'est affiche tant / que l'activité n'existe pas encore. »
  (« déjà » accenté mais « joues » n'est pas — incohérence à l'intérieur
  d'une même phrase).

6. `src/app/pages/EarningsDashboard.tsx` :
- l.228 verbatim : `Ton evolution sur 30 jours` (titre du graphique) ;
- l.240 verbatim :
  `aria-label="Graphique d'evolution des gains sur 30 jours"` ;
- l.264 verbatim :
  `aria-label="Graphique de repartition des matchs joues et arbitres"`.

### 4.2 Ancres admin (visibles par les modérateurs)

1. `src/app/pages/AdminDashboardPage.tsx` :
- l.402 verbatim :
  « Vue opérationnelle pour prioriser les litiges, garder un oeil sur les
  passes bloqués et agir vite sur les comptes qui degringolent en trust. »
  (« oeil » sans Œ ; « passes bloqués » : mot vague, probablement « files »
  ou « matchs bloqués » — à clarifier par l'auteur) ;
- l.406 verbatim : `label="Reports"` (FocusCard de la bande d'en-tête)
  — « Reports » est un anglicisme (tous les autres libellés du tableau
  disent « signalements ») ;
- l.449 verbatim : `{exporting ? 'EXPORT...' : 'EXPORTER L HISTORIQUE (CSV)'}`
  — apostrophe manquante dans « L HISTORIQUE » ;
- l.460 verbatim :
  `Sauvegarde a faire tous les 3 mois. 2FA requise.` (« a faire ») ;
- l.489 verbatim :
  « Signalements indisponibles : la table n'a pas pu etre lue. Les
  compteurs ci-dessous ne reflètent pas la file reelle — ne conclu pas que
  personne ne signale. » (« etre », « reelle » sans accents ; « ne conclu
  pas » attendu « conclus ») ;
- l.112-115 verbatim (disjecta de commentaire) :

```
  // La dependance \matches.length\ est retiree. Chaque match recu par socket
  // declenchait deux appels API et une rehydratation complete — alors qu un
  // signalement n a AUCUN rapport avec le nombre de matchs. La dependance
  // n exprirnait aucune intention : elle ne faisait que du bruit.
```

  — `\matches.length\` (backslashes là où la pile visait des
  backticks) ; « exprirnait » (mot hybride de « exprimait ») ; plusieurs
  apostrophes omises (« qu un », « n a AUCUN »).
- l.122-123 doublon verbatim :

```
  // Le rafraichissement suit desormais les VRAIES causes : ce montage, et
  // Le rafraichissement suit desormais les VRAIES causes : ce montage, et
```

2. `src/app/components/admin/AdminReportsTab.tsx` :
- l.62-63 verbatim : `legere: { label: 'LEGERE', ... }` et
  `a_qualifier: { label: 'A QUALIFIER', ... }` (LEGERE, A QUALIFIER) ;
- l.67 verbatim : `harassment: 'Harcelement',` ;
- l.70 verbatim : `no_show: 'Absent / forfe',` — « forfe » : coupé de
  l'anglais « forfeit » au milieu d'un libellé français ; attendu
  « Absent / forfait » ;
- l.134 verbatim :
  « La table des signalements n'a pas pu etre lue. Aucun signalement
  n'est traite ci-dessous — pas « aucun signalement a traiter ». » ;
- l.187 verbatim : « Sanction recommandee : … » ;
- l.191 verbatim : « Note de moderation (visible dans la trace) » ;
- l.197 verbatim : `placeholder="Contexte, preuves, decision…"` ;
- l.255-261 verbatim : `aria-label="Confirmer le bannissement definitif"` /
  « Bannissement <strong>definitif</strong> de … ? Sa session sera fermee
  immediatement et il ne pourra plus se connecter. » (textes de
  l'alertdialog sans accents).
- l.291 & 298 verbatim : « Sanctions en cours … Bannir sans pouvoir lever
  enfermerait un joueur sans recours. Une erreur de moderation se corrige
  ici. » ;
- l.325 verbatim : `{revokingId === sanction.id ? 'Levee…' : 'Lever'}` ;
- l.336 verbatim : `Traites recemment ({traites.length})` ;
- l.344 verbatim : `traite le {formatWhen(report.reviewedAt)}`.

3. `src/app/components/admin/AdminUsersTab.tsx` (texte JSX affiché aux
admins, pas un commentaire) :
- l.50 verbatim : `Watchlist Joueurs` (anglicisme en titre de section) ;
- l.52-53 verbatim :
  « Les profils sont tries pour mettre devant les signaux qui melangent
  reports, litiges et perte de trust. »
  — « tries » sans accent ; « reports » anglicisme (partout ailleurs :
  « signalements ») ; « trust » anglicisme (partout ailleurs : « score de
  confiance » / « fiabilité ») ;
- l.78 verbatim : `Aucun compte remonte dans cette vue.` ;
- l.134 verbatim : `Profil non indexe` (attendu « indexé »).

4. `src/app/components/admin/AdminOverviewTab.tsx` :
- l.66 verbatim : `Aucune urgence locale remontee.` ;
- l.116 verbatim : `body="Salons actuellement en cours et a surveiller."` ;
- l.145 verbatim : `Aucun evenement recent.`.

### 4.3 apiClient (erreurs traduites, servies aux joueurs sur des codes réels)

Fichier : `src/app/lib/apiClient.ts`.
- l.172 verbatim :
  `code === 'UNKNOWN_ERROR' ? 'Session expiree. Veuillez te reconnecter.' : friendlyMessage,`
  — « expiree » sans accent ET mélange de registre (« Veuillez te » :
  vouvoiement + tutoiement dans la même phrase) ; tout le fichier dit
  « tu » ;
- l.179 verbatim :
  `code === 'UNKNOWN_ERROR' ? 'Accès refuse. Tu n'as pas les permissions necessaires.' : friendlyMessage,`
  (« refuse » sans accent final, « necessaires ») ;
- l.119 verbatim :
  `'2FA_REQUIRED': 'Vérification 2FA requise : ouvre Paramètres > Sécurité.',`
  — vérifie : formulation correcte et accentuée (aucune action) ;
- l.217 verbatim (message cold-start, bien écrit — référence) :
  `'Délai dépassé — le serveur se réveille (offre gratuite). Attends quelques secondes puis réessaie.'`
  — à observer en phase live (cold start ~55 s documenté).

### 4.4 Débris de commentaires (code non affiché, mais nettoyés pendant les passes précédentes)

1. `src/app/components/layout/BottomNav.tsx:28-31` verbatim :

```
  // shortLabel = version affichee dans la barre. A 360 px, cinq cellules de
  // ~61 px chiaquent MUTIJOUEUR (11 chars a 11 px tracking-widest) en
  // 'MULTIJ...' sous ellipsis CSS : 3 des 5 destinations etaient tronquees.
  // L烟火aria-label garde le libelle complet pour l'accessibilite, et le
```

— « chiaquent » (verbe sans signification en l'état), débris CJK
« 烟火 » collé dans « L烟火aria-label »,
« MUTIJOUEUR » (L manquant ; le libellé réel l.32 est correct :
`label: 'MULTIJOUEUR'`). Commentaires SEULEMENT, mais la codebase a
déjà subi des nettoyages de débris équivalents (passe commentaires
audit-6, commit 0e0f537) : cohérence avec la règle maison.

### 4.5 Libellés fonctionnels à comparer entre surfaces (récap)

Mots qui divergent d'un écran à l'autre pour la même chose (rapports
dans P3-4 et les lignes citées) :
- « CONTROLE » / « Control » / « ADMIN » (P3-4) ;
- « Reports » (AdminDashboard l.406) vs « signalements » (onglet
  l.470, AdminUsersTab) ;
- « EQUIPES » (ClassementsPage l.69, sans É) ;
- « Watchlist Joueurs » / « reports » / « trust » (AdminUsersTab l.50/
  52-53) vs le vocabulaire FR du reste de l'admin.
---

## 5. Suivi des precedents (distinguer corrigé / corrigé pas testé / non corrigé)

Regle de cette passe : les constats deja documentés par les audits
precedents et tracés dans le code (P13 C…, P15 C…, F4/F5, M1/M5, M-06)
ne sont PAS re-accusés ici. Ce qui a été VU en lecture :

- P13 C3 (bouton Message mort par ami) — CORRIGE : le bouton ouvre
  désormais `/chat?dm=<id>` (FriendsWidget l.204-208 verbatim :
  `` onClick={() => navigate(`/chat?dm=${encodeURIComponent(friend.id)}`)} ``
  + `aria-label` nommé). Nuance : ni ce bouton ni le bouton Message
  voisin n'ont de garde double-clic (deux navigations possibles) —
  mineur, non inscrit (P2-4 porte le voisin direct).
- P13 C5 (modale notifications fantaisie : 5 toggles morts + .ics faux) —
  CORRIGE : épurée (NotificationSettingsModal l.4-17 explique la retraite
  et les conditions de réintroduction). Sa co-quille reste un overlay
  brut sans Escape (P3-3).
- P13 C8 (bootstrap par identité, pas par transport) — CORRIGE et
  COMMENTE (RootLayout l.15-19 verbatim : « le bootstrap des collections
  depend de l'IDENTITE (user?.id), pas du transport »).
- P13 C11 (couleur de confiance cohérente partout) — CORRIGE :
  ClassementsPage applique getTrustColor via le store aux deux variantes
  (l.414-421 desktop, l.448-452 mobile verbatim commenté en JSX).
- P13 C16 (isMe force inclus au classement) — PRESENTE et documentée
  (ClassementsPage l.13-17 : exception VOULUE en tension avec la règle) :
  pas un défaut.
- P15 C2 (chemin /mode) — CORRIGE (routes.tsx:94-97 = `/mode`), mais la
  même famille de piège EST TOUJOURS VALIDE dans accessibility.spec.ts
  l.22 (P2-2 ici).

Verdict de famille : les passes de nettoyage précédentes ont bien
repris leur domaine ; la dette restante est concentrée dans 3 zones —
hub/détail MJ (P1), clavier admin/notifications (P3-3), navigation
(Sidebar/BottomNav, P3-4).

## 6. États (loading / vide / erreur / cold start) — topologie vérifiée

Ce qui a été CONFIRMÉ en lecture (les états existent et sont dédiés sur
les écrans critiques) :

- PublicClassementsPage : 4 états explicités (`PublicLoad` l.89-92
  verbatim : `{ status: 'loading' } | { status: 'error' } | { status:
  'ready'; players; total; stats }`) + bande stats optionnelle si
  /api/stats en panne (l.113 verbatim : « /api/stats est accessoire :
  sa panne n'arrete pas le classement ») + CTA reload (l.245-253). Le
  panneau d'erreur interdit le rang inventé (l.246 verbatim : « Aucun
  rang invente n'est affiche »).
- PublicProfilPage : squelette + panneau d'échec bootstrap + repli
  « indisponible » (vérifié dans la passe — l.30-60) + confirmation
  inline de blocage/signalement.
- HubMJPage : état vide dédié (l.262-278, arène calme + 2 CTA), filtres,
  et bande D5 secondaire STATIQUE (l.281-319, aucune requête).
- AdminDashboard : bande 503 dédiée `reportsUnavailable` (l.485-491
  verbatim : « Signalements indisponibles : la table n'a pas pu etre lue.
  … ») — l'écran dit VRAI quand la file n'est pas lue. Deux modales
  d'actions (resoudre/cancel) munies de gardes double-clic
  (`resolvingId`, `revokingId`, `setLoadingAction`).
- apiClient : cold start documenté UI (l.217, message « le serveur se
  réveille (offre gratuite) ») + 47 codes traduits + purge de session
  hiérarchisée 401/403 (l.11-13 verbatim : « seul un 401 - ou un 403
  explicitement code AUTH_REQUIRED - purge l'état »).
- Profil/paramètres : états vides explicites + 2FA F5 complet
  (compte à rebours `aria-live`, garde double-clic, saisie filtrée).

Lacunes d'état NOTÉES : aucune sur les écrans ci-dessus ; les marges
restantes sont portées par les P1/P2/P3 (chapitres 1 à 3).

## 7. Phase 2 live — ce qui sera vérifié (plan)

Contraintes live : GET anonyme UNIQUEMENT ; zéro appel API authentifié ;
zéro écriture ; zéro `POST`. Domaines : `zoyd.africa` et
`zoyd.vercel.app` (deux hébergeurs déclarés). Cold start attendu
(~55 s — message TIMEOUT apiClient l.217 accepté, PAS un bug).

Checklist live :
1. `/` : hero, marquee ticker, strips, footer (libellé /mode « MJ + BR »),
   CTA login/register, video hero >= 768 px (S-7 — verifier absente en
   dessous), 404 catch-all propre.
2. `/mode` : deux grandes cartes (MJ, BR = salons), bande BR League
   étiquetée differé, cohérence avec mode-hierarchie.spec.ts.
3. `/classements` : vrai serveur — boards live, bande stats, footer
   (« {total} joueurs classes — le top 50 est affiche »), AUCUN lien
   /profil (INVARIANT l.16-17), CTA auth.
4. `/auth/login`, `/auth/register`, `/auth/forgot` : les trois routes
   RÉELLES ; jauge de mot de passe testée à la main (P2-1 — saisir
   « Azerty1234567 » sans special : observer « Elite » puis le rejet au
   submit) ; badge « En ligne » decoratif de LoginPage (verdict).
   `/auth/forgot-password` (le mauvais chemin du test) DOIT tomber sur
   la 404 — confirmation directe de P2-2.
5. Pages légales (6) + cohérence ASSISTANCE (même contact partout,
   LegalLayout l.9-10).
6. `/mj`, `/wallet`, `/earnings`, `/admin` : DOIVENT rediriger vers
   /auth/login (AppLayout) — la frontière anonyme. Aucun accès
   authentifié n'est tenté.
7. 404 : DOM propre (le même DOM qu'axe a analysé par ERREUR durant le
   test P2-2).
8. Console + network : absence d'erreurs, polling de secours
   (RootLayout) si le socket n'est pas connecté ; screenshots desktop
   + 360 px (déclinaison des sondes responsive.spec).

Cadence de collecte : lecture brute + screenshots par page, PUIS
constitution du chapitre 8 (compléments live) dans le merge final.

### Resultats de la phase 2 live (2026-11-03, sous le plan ci-dessus)

Conditions realisees : fenêtre 800×582 (dpr 1), puis passe 360×740.
Cible unique `https://zoyd.vercel.app/` (voir A). GET uniquement : les
seules requêtes API état émises par les pages elles-mêmes
(`/api/auth/me`, `/api/stats`, `/api/leaderboard`) — aucun appel
authentifié, aucun POST, aucune écriture. Logs console / réseau et arbres
d'accessibilité collectés page par page ; captures d'écran via une
instance de capture séparée (fichiers listés en G).

#### A. Périmètre effectif : zoyd.africa est mort, la tournée porte sur zoyd.vercel.app seul

1. `zoyd.africa` : `ERR_TUNNEL_CONNECTION_FAILED` puis DNS vide
   (`Resolve-DnsName` ne rend RIEN pour zoyd.africa, alors que
   `zoyd.vercel.app` rend deux A records). La tournée live a donc été
   exécutée intégralement sur `zoyd.vercel.app`.
2. Débordement documentaire : `docs/09-presentation.md:1203-1204`
   verbatim : « Deux domaines coexistent : le site public (`zoyd.africa`)
   et le site technique (`zoyd.vercel.app`), tous deux dans la liste
   blanche du serveur. » — à la date de l'audit, `zoyd.africa` ne résout
   pas : l'affirmation de coexistence n'est plus vérifiable depuis la
   gestation (et l'entrée suivante). Peut-être deja constaté ailleurs
   (docs/03 l.1151) — inscrit ici comme écart doc/réalité du parcours UI.
3. Le site `zoyd.vercel.app` servait la build d'un précédent deploy
   (recon du 02/11) : la tournée du 03/11 n'a rien trouvé de
   DEGRADÉ ; la tournée est une CONFIRMATION D'ÉTAT, pas une
   correction.

#### B. les parties du checklist (plan ci-dessus) : résultat par résultat

1. `/` — CONFORME. Titre « ZOYD — Wagers sécurisés et arbitrage rémunéré
   sur CODM », vidéo hero PRESENTE a 800 px (1 balise `<video>`,
   `hero-bg.mp4`, largeur 785 px), marquee ticker rendu
   (« PROFIL JOUEUR UNIQUE /// MULTIJOUEUR CODM /// BATTLE ROYALE ///
   WALLET ZC /// MOBILE MONEY /// TOURNOIS PUBLICS »), bande stats
   réelle (« 2+ JOUEURS INSCRITS — 0 MATCHS JOUÉS — 0 ZC DISTRIBUÉS —
   0% PAIEMENTS HONORÉS » — accents corrects au DOM : sonde innerText
   `JOUÉS/DISTRIBUÉS/HONORÉS` positif), match de vitrine
   « GHOST_239 VS SNIPER_OK » cagnotte « 200 ZC », footer complet
   (INSCRIPTION / CONNEXION / MJ + BR / CLASSEMENTS + 6 liens légaux +
   Discord / TikTok / WhatsApp). `docs/` inchangé.
   - S-7 CONFIRMÉ LIVE : à 360 px, `document.querySelectorAll('video')`
     renvoie 0 (la seule vidéo héros disparait sous 768 px,
     `SHOW_HERO_VIDEO`) : le garde audit-prod 2026-11-01 fonctionne
     encore en production.
2. `/mode` — CONFORME au plan : deux grandes cartes (Multijoueur,
   Battle Royale) + bande « BR LEAGUE » étiquetée
   « ÉVÉNEMENT HEBDOMADAIRE / OUVERTURE DIFFÉRÉE » + « VOIR LA LIGUE »,
   + skip-link « Aller au contenu principal ». Titre de document
   « Mode de jeu — ZOYD ». A 360 px : alignement vertical impeccable,
   cartes empilées, aucun débordement. MAIS voir C-1 (coquille live)
   et C-2 (vidéos de fond en mobile).
3. `/classements` — CONFORME au plan : title « Classements publics —
   ZOYD », heading « LES MEILLEURS », tablist « Types de classements
   publics » avec TOP ELO / TOP GAINS / VICTOIRES, bande stats
   « 2 JOUEURS ACTIFS — 0 MATCHS JOUES — 0 ZC DISTRIBUES — 0%
   PAIEMENTS HONORES » (les 3 accents absents confirment
   `PublicClassementsPage.tsx:189-196`), empty-state « AUCUN
   CLASSEMENT POUR LE MOMENT » + « Cette vue se remplira des que des
   matchs auront ete joues et arbitres sur ZOYD. » (confirme
   `PublicClassementsPage.tsx:265`), CTA auth « CRÉER UN COMPTE » /
   « SE CONNECTER ». INVARIANT zéro lien /profil : probe
   `a[href*=profil]` = 0 (page entière, tous onglets) — tenu en
   production. La note du bas `{state.total} joueurs classes` n'est
   PAS rendue quand la base est vide (aucun board) : condition
   d'affichage, non un défaut. La vitrine ne voit AUCUN rang inventé :
   `GET /api/leaderboard?limit=50` → 200 avec total 0 affiché
   « AUCUN CLASSEMENT » (comportement honnête, conforme code).
4. `/auth/login` — CONFORME : heading IDENTIFICATION, badge
   « ACCÈS JOUEUR SÉCURISÉ », champs labels « EMAIL, TÉLÉPHONE OU
   PSEUDO » / « MOT DE PASSE » (`autocomplete` : username,
   current-password), bouton CONNEXION, options désactivées
   « CONTINUER AVEC GOOGLE — BIENTÔT DISPONIBLE » / « CONNEXION PAR
   NUMÉRO — BIENTÔT DISPONIBLE » (honnête, non-US), footer
   « PAS ENCORE DE COMPTE ? CRÉER MON COMPTE » + lien « Mot de passe
   oublié ? ». `GET /api/stats` est bien fait (200) mais AUCUN chiffre
   n'est rendu à 800 px (bande sous lg — panneau promo caché) ;
   à 1280 px (screenshot) les chiffres réels s'affichent :
   avatars « Z O Y » (initiales du marque, pas de fausses
   témoins sociaux) + « 2 joueurs inscrits » — la promesse du
   commentaire `LoginPage.tsx:211-214` (« On affiche les donnees
   reelles ») est tenue. Badge « EN LIGNE » (panneau promo, pastille
   verte animée) : DÉCORATIF confirmé (aucun filière avec
   `serverConnected`, uniquement navbar) ; verdict du plan : badge
   cosmétique, sans impact fonctionnel — à inscrire au registre
   complements comme confirmation (pas un défaut, NOTÉ
   pour la éventuel) : si le serveur est en cold-start, le badge dit
   quand même « En ligne » alors que la connexion échoue ; le
   contraste (toast « Connexion au serveur impossible » vs badge
   « En ligne ») existe théoriquement — non observé en live (le
   badge n'est rendu qu'au ≥ 1024 px, fenêtre de test 800).
5. `/auth/register` — CONFORME : wizard « ÉTAPE 01 / 03 — IDENTITÉ »,
   5 champs (PSEUDO CODM, EMAIL, TÉLÉPHONE, MOT DE PASSE,
   CONFIRMATION DU MOT DE PASSE) avec autocompletes corrects
   (username / email / tel / new-password), bandes « — » du panneau
   promo côté stats en attente (chargée asynchronihé). JAUGE MDP
   TESTÉE À LA MAIN : saisie de « Azerty1234567 » (13 car., casse
   mixte, chiffre, PAS de caractère spécial) → jauge affiche 4/4
   segments + étiquette « ELITE » (screenshot registre :
   `u8-register-jauge-elite.png`). P2-1 confirmé live en sa moitié
   jauge ; le rejet au submit (zod l.104-108) n'a PAS été exécuté en
   live (POST interdit) — le constat P2-1 reste complet côté statique.
   À 1280 px, bande stats du panneau promo accentuée CORRECTEMENT
   (« 0 MATCHS / 0 ZC DISTRIBUÉS / 2 JOUEURS ») : la divergence
   d'accents est bien une seule page (`PublicClassementsPage`),
   PAS un motif global — complément au chapitre 4.
6. `/auth/forgot` — CONFORME : title « Mot de passe oublié — ZOYD »,
   heading « MOT DE PASSE OUBLIÉ » (avec accent), instructions
   « Indique ton pseudo, email ou numéro. Tu recevras un code de
   vérification. », bouton retour connexion, CTA « RECEVOIR LE CODE ».
   La route réelle existe (P2-2 corrigeable).
7. `/auth/forgot-password` — P2-2 CONFIRMÉE LIVE : la route rend la
   404 de la SPA (title du document « 404 — ZOYD », h1 « 404 »,
   h2 « ZONE NON TROUVÉE », paragraphe « Cette page n'existe pas ou
   a été déplacée. » + liens ACCUEIL / CONNEXION). Le e2e axe
   `accessibility.spec.ts:22` balaye EXACTEMENT cette page :
   démonstration complète du constat en production.
8. Pages légales ×6 — TOUTES rendues, title + h1 du layout commun :
   `/conditions` (« CONDITIONS D'UTILISATION »), `/reglement-litiges`
   (« RÈGLEMENT DES LITIGES »), `/anti-fraude` (« ANTI-FRAUDE »),
   `/confidentialite` (« CONFIDENTIALITÉ »), `/mentions`
   (« MENTIONS & ASSISTANCE »), `/jeu-responsable`
   (« JEU RESPONSABLE »). Navigation légale partagé (le même bandeau
   6 onglets sur chaque page) présent. Cohérence ASSISTANCE tenue :
   contact unique `coyd2976@gmail.com` + WhatsApp « +2290165240654 »
   (« ÉDITEUR DU SERVICE ... Email : coyd2976@gmail.com 2.ASSISTANCE
   WhatsApp : +2290165240654 Email : coyd2976@gmail.com ») — conforme
   à l'INVARIANT `LegalLayout.tsx:9-10` (« le contact d'assistance
   doit être le MEME partout ») et au bloc ASSISTANCE partagé
   (`LegalLayout.tsx:33-39`).
9. Frontière anonyme — CONFIRMÉE SUR LES 4 : `/mj`, `/wallet`,
   `/earnings`, `/admin` redirigent chacune vers `/auth/login` en
   production (un visiteur anonyme, aucun endpoint authentifié
   appelé, aucun accès à la console admin). L'AppLayout gère la
   frontière comme prévu.
10. 404 catch-all — PROPRE : chemin arbitraire `/zxy-inconnu-42` rend le
    même DOM 404 (h1 404 / ZONE NON TROUVÉE / liens) avec AUCUNE
    erreur console.

#### C. Nouveaux constats live (non relevés dans la passée statique)

1. **Coquille « salons competitifs » sur la carte Multijoueur**
   (`src/app/pages/ModeSelectionPage.tsx:124` verbatim) :
   « Matchs publics, tournois, salons competitifs et progression
   joueur déjà liés à ton compte. » — « competitifs » sans accent,
   affiché live en production à 800 ET 360 px (screenshot
   `u8-mode-800-fullpage.png`, carte Multijoueur). Attendu :
   « compétitifs ». Le reste du libellé de la carte est correct
   (« déjà liés à ton compte »).
2. **Coquilles du bloc CTA auth « VOIS TON RANG AUSSI » de /classements**
   (`src/app/pages/PublicClassementsPage.tsx:370-371` verbatim) :
   « Cree un compte, joue un match arbitre, et entre dans les
   classements — ELO strict, gains Mobile Money, reputation verifiee. »
   — « Cree » (attendu « Crée »), « reputation » (attendu
   « réputation »), « verifiee » (attendu « vérifiée »). Ironie : le
   bouton voisin est correctement accentué (« CRÉER UN COMPTE »).
   Affiché live (screenshot `u8-classements-800-fullpage.png`) ; le
   bloc est sous l'empty-state — il remplace la note bas
   `{state.total} joueurs classes` quand le board est vide.
3. **Les vidéos de fond de /mode échappent au garde S-7** :les deux
   cartes de `/mode` embarquent le MÊME `hero-bg.mp4`
   (`assets/codm/videos/hero-bg.mp4`, autoplay, muted, loop,
   preload=metadata, largeur rendue 303 px à 360) — 2 instances
   chargées en MOBILE 360 px, alors que la landing coupe la même
   vidéo sous 768 px (S-7). Le fichier fait ~1,36 Mo (constat
   audit-prod 01/11 du registre précédent) ; sur un forfait mobile
   africain, /mode coûte ~2,7 Mo la carte héros. Classement : P3
   (perf, réseaux Afrique), à corriger avec le MEÎME garde que
   S-7 (`SHOW_HERO_VIDEO`) sur « ModeSelectionPage », ou CSS
   `content-visibility`/`hidden md:block` + media-queries. NOUVEAU
   constat (non relevé en statique — reside a la regle « video >=
   768 » n'avait été écrite QUE pour la landing).

#### D. Compléments aux constats statiques (attestation live)

1. Cold start RENDER : REPRODUIT LIVE (sur une déploiement froid la
   session, la première charge) : `GET /api/auth/me` fait 30 724 ms
   sans réponse (timeout) → toast « Connexion au serveur impossible…
   Réessayer » affiché (comportement DÉSIGNÉ,
   `useAuthSessionBootstrap.ts:75-77`), puis
   `GET /api/stats` → 200 en 32 857 ms ; le toast s'auto-dismissé
   ensuite (conteneur `aria-live` vide). Une page fraîche après réveil
   : `/api/auth/me` 401 (836 ms anonyme — purge session par design),
   `/api/stats` 200 (305 ms), console = 1 erreur du 401
   « Failed to load resource » SEULEMENT (bruit attendu par la
   page, non bloquant).
2. `GET /api/stats` est appelé par quatre surfaces (LandingPage:67,
   LoginPage:55, RegisterPage:158,
   PublicClassementsPage:109) : appel 200 répété sur /, /auth/login,
   /auth/register, /classements en production — cohérent avec
   l'inventaire statique.
3. `P2-5` (onglets « TOP GAINS » / « VICTOIRES ») : la base est vide
   en production (total 0) : aucun re-tri OBSERVABLE (les 3 onglets
   existent avec leur layout mais rien à trier). Le constat reste un
   comportement de code (le re-tri de la même instance fournie), non
   révisionnable live.
4. `P1-1` / `P1-2` (statuts MJ), `P2-3/P2-4` (amis), `P3` admin :
   TOUS auth-only, non jouables en phase GET anonyme — restent
   entierement statiques.

#### E. Points NEUTRES observés live (pas des défauts, pour mémoire)

1. Les sections ARBITRAGE / MOBILE MONEY de la landing utilisent des
   reveals d'apparition (framer-motion `whileInView`) : un
   screenshot full-page prise SANS scroll les capture invisibles
   (opacité initiale 0) — artefact de capture (comparé sur
   capture fullpage « scrollée » puis « directe »), pas un bug
   produit. Takaways pour l'audit : toute preuve full-page du même
   type doit scroller d'abord.
2. `401 /api/auth/me` sur chaque première visite anonyme (console
   rouge) : comportement DÉSIGNÉ (a soleil vérifié l'anonymat de
   purge session `apiClient.ts:11-13`) ; aucun impact UI (aucun
   toast ni blocage, page publiques normales).
3. Appels sociaux du footer landing vers discord.gg / tiktok.com /
   chat.whatsapp.com : liens externes (objets e2e hors périmètre
   audit UI), rendus như « icones » sans libellé textuel ; aucune
   anomaly live constatée au DOM (href corrects).

#### F. Constat d'état (peut aiguiser un futur objet)

Chiffres affichés en production AUJOURD'HUI : 2 joueurs inscrits, 0
match, 0 ZC distribué, 0% paiements, 0 joueurs classés. La vitrine
assume l'absence de données (aucun chiffre inventé) : c'est la ligne
« rang inventé interdit » (`PublicClassementsPage.tsx:246`) tenue au
stade zéro. La landing et les bandeaux communs ne font AUCUNE
compagne de présence fictive ( Vergleich P13 C5 : la fausse social
proof retirée) — GOOD : aucun constat.

#### G. Pièces vivantes (captures)

Répertoire `C:/Users/coffi/AppData/Local/Temp/zoyd-shots/` :- `u8-landing-800-fullpage.png` — landing 800 full page (stats, marquee,
  carte démo, L/ARBITRE, 6 sections).
- `u8-mode-800-fullpage.png` — /mode 800 (2 cartes + bande BR LEAGUE ;
  coquille « salons competitifs » visible).
- `u8-classements-800-fullpage.png` — /classements 800 (bande stats
  sans accents, empty-state, bloc « VOIS TON RANG AUSSI »).
- `u8-login-1280-viewport.png` — /auth/login 1280 (badge EN LIGNE
  décoratif + chiffres réels « Z O Y — 2 joueurs inscrits »).
- `u8-register-jauge-elite.png` — jauge MDP « ELITE » worthless sans
  caractère spécial (P2-1).
- `u8-404-forgot-password.png` — /auth/forgot-password → 404 DOM (P2-2).
- `u8-legal-mentions-800.png` — /mentions 800 (bloc ASSISTANCE +
  navigation légale).
- `u8-landing-360.png` + `u8-mode-360.png` + `u8-login-360.png` +
  `u8-classements-360.png` + `u8-legal-360.png` + `u8-404-360.png` —
  passe responsive 360 px (sondes responsive-spec).
- `u8-landing-800-scrolled.png` — landing 800 après scroll (les
  reveals ARBITRAGE / MOBILE MONEY visibles).

Verdict d'étape : le parcours anonyme livre correspond aux écrans
documentés : aucun défaut bloquant au-vivant ; cinq preuves
consolidées live (P2-1 jauge, P2-2 404 test-axe, S-7 étanchéité,
zéro lien /profil, frontière authentifiée) ; 3 constats nouvelle
(C-1 coquille mode, C-2 coquilles CTA auth, C-3 vidéos /mode
mobile) qui s'ajoutent au registre. Le registre est prête pour
l'installation docs.
## 8. Recapitulatif complet pour décision

- 2 P1 (bug d'affichage de statut MJ, hub + détail, un chantier unique).
- 5 P2 (jauge mot de passe ; test axe sur 404 ; suppression d'ami ;
  double-clic demande d'ami ; top gains/victoires = top ELO).
- 10 P3 (bouton mort admin ; classements mobile ; modales clavier ;
  navigations divergentes ; ui/Sidebar mort ; couleurs de charts en dur ;
  StatusLane ; bg-orange-400 fragile ; reload sur échec ; arbitresNeeded).
- Coquilles : 30+ ancres affichées (4.1/4.2/4.3) + 2 familles de débris
  (4.4) + incohérences de nommage (4.5).
- Suivi précédent : famille P13/P15 sous contrôle (section 5).
- Phase live : checklist section 7 (uniquement GET anonyme).

Proposition d'étape : l'utilisateur valide (ou amende) ce registre,
puis decide (a) l'installation d'un fichier docs NEUF (par ex.
`docs/10-ui-audit.md`) ou (b) de rester en Temp ; ensuite la phase live
complete le registre (chapitre 8), et l'entrée cartographie
`## 10 octodecies` est écrite à la cloture.
