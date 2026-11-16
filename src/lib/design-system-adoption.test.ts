import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * L ADOPTION du design system : un mesureur, pas une impression.
 *
 * Pourquoi un verrou
 * ------------------
 * Le design system existe (`src/app/components/ui/`, 17 composants) mais
 * n etait utilise que dans 14 % des cas : 219 balises `<button>` brutes
 * contre 35 `<Button>`. Une balise brute n herite d aucune des garanties
 * du systeme : ni la cible tactile de 44 px, ni le contraste verifie, ni
 * l etat desactive lisible, ni le rayon, ni l animation.
 *
 * C est un probleme de QUALITE, pas d esthetique : ces 219 boutons
 * sont autant d occasions d avoir un ecran non conforme.
 *
 * Le verrou est un CRETOIR : le compte de boutons bruts ne peut que
 * DESCENDRE. Chaque tranche de conversion retire des fichiers de la
 * liste ; en reintroduire un casse le test.
 */

/** Les fichiers qui ont encore des balises `<button>` brutes, et combien. */
const RESTANTS: Record<string, number> = {
  'src/app/components/BootstrapFailedPanel.tsx': 1,
  'src/app/components/ErrorBoundary.tsx': 1,
  'src/app/components/RouteErrorBoundary.tsx': 1,
  'src/app/components/admin/AdminMatchesTab.tsx': 2,
  'src/app/components/admin/AdminOverviewTab.tsx': 2,
  'src/app/components/admin/AdminReportsTab.tsx': 7,
  'src/app/components/admin/AdminUrgencyTab.tsx': 5,
  'src/app/components/admin/AdminUsersTab.tsx': 3,
  'src/app/components/admin/TwoFactorPrompt.tsx': 2,
  'src/app/components/layout/Navbar.tsx': 1,
  'src/app/components/layout/Sidebar.tsx': 1,
  'src/app/components/ui/Modal.tsx': 2,
  'src/app/layouts/AppLayout.tsx': 2,
  'src/app/pages/AdminDashboardPage.tsx': 6,
  'src/app/pages/ChatPage.tsx': 5,
  'src/app/pages/ClassementsPage.tsx': 1,
  'src/app/pages/DashboardPage.tsx': 2,
  'src/app/pages/LandingPage.tsx': 1,
  'src/app/pages/LeaksPage.tsx': 6,
  'src/app/pages/ParametresPage.tsx': 2,
  'src/app/pages/ProfilPage.tsx': 1,
  'src/app/pages/PublicClassementsPage.tsx': 2,
  'src/app/pages/PublicProfilPage.tsx': 2,
  'src/app/pages/WalletPage.tsx': 6,
  'src/app/pages/auth/ActivatePage.tsx': 5,
  'src/app/pages/auth/ForgotPasswordPage.tsx': 1,
  'src/app/pages/auth/LoginPage.tsx': 1,
  'src/app/pages/auth/RegisterPage.tsx': 5,
  'src/app/pages/mj/CreateMatchPage.tsx': 17,
  'src/app/pages/mj/CreateTournamentPage.tsx': 7,
  'src/app/pages/mj/HubMJPage.tsx': 5,
  'src/features/br/components/BrArbiterPanel.tsx': 5,
  'src/features/br/components/BrLobbyCreatePanel.tsx': 4,
  'src/features/br/pages/BrLobbyDetailPage.tsx': 3,
  'src/features/br/pages/BrPage.tsx': 1,
  'src/features/league/components/AdminPanel.tsx': 5,
  'src/features/league/components/FinalResultsForm.tsx': 1,
  'src/features/league/components/QualificationPanel.tsx': 3,
  'src/features/league/pages/LeaguePage.tsx': 9,
  'src/features/league/pages/LeagueSeasonPage.tsx': 5,
  'src/features/match/components/MatchChat.tsx': 1,
  'src/features/match/pages/MatchDetailPage.tsx': 10,
  'src/features/tournament/components/BracketActions.tsx': 7,
  'src/features/tournament/components/BracketMatchCard.tsx': 1,
  'src/features/tournament/pages/TournamentBracketPage.tsx': 7,
  'src/features/tournament/pages/TournoisPage.tsx': 2,
  'src/main.tsx': 1,};

const parcourir = (dossier: string, sortie: string[] = []): string[] => {
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) { parcourir(chemin, sortie); continue; }
    if (/\.tsx$/.test(chemin) && !/\.test\.tsx$/.test(chemin)) sortie.push(chemin.replace(/\\/g, '/'));
  }
  return sortie;
};

/**
 * Les commentaires ne comptent pas : un docstring qui parle de
 * « `<button>` » gonflerait le decompte et ferait crier le verrou
 * pour rien. Seuls les balises REELLES comptent.
 */
const sansCommentaires = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((ligne) => !/^\s*(\*|\/\/)/.test(ligne))
  .join('\n');

const compter = (source: string) => {
  const propre = sansCommentaires(source);
  return {
    bruts: (propre.match(/<button\b/g) || []).length,
    designSystem: (propre.match(/<Button\b/g) || []).length,
  };
};

describe('Adoption du design system', () => {
  const fichiers = parcourir(resolve('src'));

  it('la mesure porte sur des fichiers reels', () => {
    expect(fichiers.length).toBeGreaterThan(50);
  });

  it('aucun fichier ne peut reintroduire de bouton brut', () => {
    const coupables: string[] = [];
    for (const fichier of fichiers) {
      const { bruts } = compter(readFileSync(resolve(fichier), 'utf8'));
      if (bruts === 0) continue;
      const relatif = fichier.replace(/\\/g, '/').replace(/^.*\/src\//, 'src/');
      const autorise = RESTANTS[relatif];
      if (autorise === undefined) {
        coupables.push(`${relatif} : ${bruts} bouton(s) brut(s) — fichier absent du cretoir`);
        continue;
      }
      if (bruts > autorise) {
        coupables.push(`${relatif} : ${bruts} bouton(s) brut(s) (cretoir : ${autorise})`);
      }
    }
    expect(
      coupables.length,
      'boutons bruts hors cretoir :\n  ' + coupables.join('\n  '),
    ).toBe(0);
  });

  it('le cretoir ne contient que des fichiers qui ont encore des boutons bruts', () => {
    // Un fichier liste dans le cretoir mais entierement converti : le
    // cretoir doit etre nettoye, sinon il ne protege plus rien.
    const obsoletes: string[] = [];
    for (const [relatif, autorise] of Object.entries(RESTANTS)) {
      const { bruts } = compter(readFileSync(resolve(relatif), 'utf8'));
      if (bruts < autorise) obsoletes.push(`${relatif} : declares ${autorise}, reel ${bruts}`);
    }
    expect(
      obsoletes.length,
      'cretoir perime (le fichier a ete converti) :\n  ' + obsoletes.join('\n  '),
    ).toBe(0);
  });

  it('l adoption progresse : le design system est le chemin par defaut', () => {
    let bruts = 0;
    let designSystem = 0;
    for (const fichier of fichiers) {
      const c = compter(readFileSync(resolve(fichier), 'utf8'));
      bruts += c.bruts;
      designSystem += c.designSystem;
    }
    const adoption = designSystem / (bruts + designSystem);
    // Le plancher suit l avancement : il ne pourra que monter.
    // Etat initial (2026-11-16) : 219 balises brutes pour 35 <Button>,
    // soit 13,8 %. La premiere tranche le fait passer au-dessus.
    expect(adoption, `adoption ${(adoption * 100).toFixed(0)} %`).toBeGreaterThanOrEqual(0.13);
  });
});
