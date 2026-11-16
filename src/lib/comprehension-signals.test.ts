import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Les SIGNAUX DE COMPREHENSION d'un ecran.
 *
 * Pourquoi ce verrou
 * ------------------
 * « Un joueur comprend-il l ecran ? » ne se repond pas en relisant le
 * code : ca se repond en regardant l ecran. Les trois defauts trouves
 * en production etant tous des ecarts entre ce que l ecran ANNONCE et ce
 * qu il FAIT :
 *
 *  1. le classement annoncait « Rien n est affiche tant que l activite
 *     n existe pas encore » et affichait quand meme un rang (« #11 »)
 *     a un joueur qui n avait jamais joue ;
 *  2. les colonnes du classement etaient du jargon nu (« WR% », « FIAB. »,
 *     « V », « SETUP ») sans la moindre explication ;
 *  3. le tableau de bord proposait « Creer un match » a un joueur a
 *     0 ZC — or un match se paie : la premiere action reelle est le
 *     depot.
 *
 * Ce verrou verifie que ces trois corrections restent en place. C est un
 * verrou STRUCTUREL (le code dit ce qu il fait), pas une evaluation
 * du design : la qualite de la redaction, elle, se mesure dans le
 * parcours vivant.
 */
const source = (chemin: string) => readFileSync(resolve(chemin), 'utf8');

describe('Signaux de comprehension', () => {
  it('le classement ne donne pas de rang a un joueur sans activite', () => {
    const page = source('src/app/pages/ClassementsPage.tsx');

    // 1. L activite du joueur est CALCULEE (et non supposee).
    expect(page).toMatch(/const monActivite = useMemo/);
    expect(page).toMatch(/activityCount > 0 \|\| .*totalEarnings > 0 \|\| .*totalMatches > 0/);

    // 2. Le bloc « Ton rang » n est affiche que si le joueur a joue.
    expect(page).toMatch(/user && monActivite && myRank/);

    // 3. Sans activite, l ecran DIT qu il n est pas classe — et donne
    //    la marche a suivre.
    expect(page).toMatch(/Pas encore classé/);
    expect(page).toMatch(/Joue un premier match/);

    // 4. La phrase d introduction ne peut plus promettre le contraire.
    expect(page).not.toMatch(/Rien n.{0,12}est affiché tant/);
    expect(page).toMatch(/n'a encore jamais joué n'y figure pas/);
  });

  it('chaque colonne du classement explique ce qu elle mesure', () => {
    const page = source('src/app/pages/ClassementsPage.tsx');

    expect(page).toMatch(/EXPLICATION_COLONNES/);
    // Le jargon du tableau doit etre explique, colonne par colonne.
    for (const [colonne, explication] of [
      ['WR%', 'Taux de victoire'],
      ['FIAB.', 'Fiabilit'],
      ['ELO', 'classement interne'],
      ['V', 'victoires'],
      ['SETUP', 'quipement'],
    ] as const) {
      expect(page, `la colonne ${colonne} est expliquee`).toMatch(
        new RegExp(`${colonne.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`),
      );
      expect(page, `l explication de ${colonne} existe`).toMatch(
        new RegExp(explication.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')),
      );
    }
    // Et l infobulle est posee sur les en-tetes.
    expect(page).toMatch(/title=\{EXPLICATION_COLONNES\[activeColumns\./);
  });

  it('le tableau de bord propose le depot quand le joueur n a pas de ZC', () => {
    const dashboard = source('src/app/pages/DashboardPage.tsx');

    expect(dashboard).toMatch(/const sansZC = availableToSpend <= 0/);
    // A 0 ZC, la premiere action est le depot — pas un match qu il ne
    // peut pas payer.
    expect(dashboard).toMatch(/sansZC \? 'Recharge pour jouer'/);
    expect(dashboard).toMatch(/to="\/wallet"/);
    expect(dashboard).toMatch(/Recharger via Mobile Money/);
    // Le message explique pourquoi le depot est necessaire.
    expect(dashboard).toMatch(/droit d.entr.e est bloqu/);
  });

  it('le compte neuf a une premiere action claire (le serment)', () => {
    // Le serment d integrite est le PREMIER ecran d un joueur neuf : la
    // banniere dit ce qu il est et propose deux sorties (signer, ou voir
    // l arene d abord) — le joueur ne reste jamais bloque.
    const layout = source('src/app/layouts/AppLayout.tsx');
    expect(layout).toMatch(/Serment d.int.grit. . signer avant de miser/);
    expect(layout).toMatch(/Découvrir d'abord/);
    expect(layout).toMatch(/Signer/);

    // Et la modale explique CE QUE le serment protege, avant de signer.
    const covenant = source('src/app/components/integrity/IntegrityCovenantModal.tsx');
    expect(covenant).toMatch(/Ce que le serment prot.ge/);
    expect(covenant).toMatch(/Commencer le serment/);
  });
});
