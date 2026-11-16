import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Le design system, ses invariants.
 *
 * Pourquoi un verrou a part
 * -------------------------
 * Le design system n est utile que si ses garanties sont INVIOLABLES.
 * Une garantie posee dans un commentaire (« toutes les tailles gardent
 * min-h-[44px] ») n est qu une intention : le jour ou quelqu un
 * touche au composant, personne ne le voit.
 *
 * Ces tests lisent la SOURCE du composant : ils sont donc verifiables
 * sans navigateur, et ils echouent des que la garantie bouge.
 */
const source = (chemin: string) => readFileSync(resolve(chemin), 'utf8');

describe('Design system - invariants', () => {
  it('le Button garde une cible tactile de 44 px sur TOUTES ses tailles', () => {
    const button = source('src/app/components/ui/Button.tsx');
    // La cible tactile est dans la base cva : elle s applique donc a
    // toutes les variantes ET a toutes les tailles.
    expect(button).toMatch(/min-h-\[44px\]/);
    // Et elle ne doit pas etre neutralisee par une taille.
    const tailles = button.match(/^\s{8}(sm|md|lg|xl):\s*'([^']*)'/gm) || [];
    expect(tailles.length).toBeGreaterThanOrEqual(4);
    for (const ligne of tailles) {
      // Une taille peut REDIRE la cible (min-h-[44px]) : ce qui est
      // interdit, c est de la REDUIRE.
      const trouve = ligne.match(/min-h-\[(\d+)px\]/);
      if (!trouve) continue;
      expect(
        Number(trouve[1]),
        `la taille ${ligne.trim()} ne peut pas reduire la cible tactile`,
      ).toBeGreaterThanOrEqual(44);
    }
  });

  it('le Button ne soumet pas un formulaire par defaut', () => {
    const button = source('src/app/components/ui/Button.tsx');
    // Un `<button>` sans type soumet le formulaire : le defaut du
    // design system DOIT etre « button ».
    expect(button).toMatch(/type = 'button'/);
    // Et le type ne doit pas etre pose sur un lien (asChild).
    expect(button).toMatch(/type=\{asChild \? undefined : type\}/);
  });

  it('le Button expose les variantes et les tailles du design system', () => {
    const button = source('src/app/components/ui/Button.tsx');
    for (const variante of ['primary', 'secondary', 'ghost', 'danger']) {
      expect(button, `la variante ${variante} existe`).toMatch(new RegExp(`${variante}:\\s*'`));
    }
    for (const taille of ['sm', 'md', 'lg', 'xl', 'link']) {
      expect(button, `la taille ${taille} existe`).toMatch(new RegExp(`${taille}:\\s*'`));
    }
    // Les etats qui doivent rester lisibles.
    expect(button).toMatch(/disabled:opacity-50/);
    expect(button).toMatch(/disabled:cursor-not-allowed/);
  });

  it('la seule taille qui descend sous 44 px est la cible EN LIGNE', () => {
    const button = source('src/app/components/ui/Button.tsx');
    // WCAG 2.5.8 : une cible DANS une phrase est exempte de la taille
    // minimale. C est la seule exception du systeme, et elle doit
    // s appeler « link » — pas une classe posee a la main.
    const tailles = button.match(/^\s{8}(\w+):\s*'([^']*)'/gm) || [];
    for (const ligne of tailles) {
      const nom = /^\s{8}(\w+):/.exec(ligne)?.[1];
      const trouve = ligne.match(/min-h-\[(\d+)px\]/);
      if (!trouve) continue;
      if (nom === 'link') continue;
      expect(Number(trouve[1]), `la taille ${nom} garde la cible tactile`).toBeGreaterThanOrEqual(44);
    }
    expect(button).toMatch(/link: 'px-0 py-0 min-h-0'/);
  });

  it('le design system couvre les briques attendues', () => {
    const briques = [
      'Alert', 'Badge', 'Button', 'Card', 'Form', 'Input', 'Label', 'Modal',
      'ProgressBar', 'Separator', 'Sheet', 'Skeleton', 'Table', 'Tabs', 'Toggle', 'Tooltip',
    ];
    const ui = source('src/app/components/ui/Button.tsx');
    expect(ui.length).toBeGreaterThan(0);
    for (const brique of briques) {
      // Le fichier doit exister : le verrou echoue si une brique disparait.
      expect(
        () => readFileSync(resolve(`src/app/components/ui/${brique}.tsx`), 'utf8'),
        `la brique ${brique} existe`,
      ).not.toThrow();
    }
  });
});
