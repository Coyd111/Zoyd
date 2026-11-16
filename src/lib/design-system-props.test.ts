import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Les props du `<Button>` : pas de prop inventee.
 *
 * PIEGE : le design system laisse passer les props restantes sur la
 * balise DOM. Une prop inventeee — `justify-start`, `selected`,
 * `isActive` — atterrit alors dans le DOM, et React signale :
 * « Received `true` for a non-boolean attribute `justify-start` ».
 * L audit UI le voit (erreur console), mais seulement sur les ecrans
 * qui portent le bouton : un avertissement peut dormir des semaines.
 *
 * Ce verrou inspecte la SOURCE de tous les `<Button>` du projet.
 */

/** Les props que le design system consomme (elles ne vont pas au DOM). */
const PROPS_CONSOMMEE = new Set(['variant', 'size', 'fullWidth', 'animate', 'asChild']);

/** Les props HTML / ARIA legitimes sur un bouton. */
const PROPS_DOM = new Set([
  'type', 'disabled', 'name', 'value', 'id', 'key', 'ref', 'title', 'role',
  'href', 'target', 'rel', 'tabIndex', 'autoFocus', 'className', 'style',
  'onClick', 'onDoubleClick', 'onMouseEnter', 'onMouseLeave', 'onFocus',
  'onBlur', 'onKeyDown', 'onKeyUp', 'onPointerDown', 'onPointerUp',
  'onTouchStart', 'onTouchEnd', 'onContextMenu', 'onSubmit',
  'aria-label', 'aria-expanded', 'aria-pressed', 'aria-checked', 'aria-haspopup',
  'aria-controls', 'aria-describedby', 'aria-labelledby', 'aria-hidden',
  'aria-disabled', 'aria-current', 'aria-selected', 'aria-live', 'aria-atomic',
  'data-testid', 'data-state', 'data-value', 'data-index', 'data-key',
]);

const parcourir = (dossier: string, sortie: string[] = []): string[] => {
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) { parcourir(chemin, sortie); continue; }
    if (/\.tsx$/.test(chemin) && !/\.test\.tsx$/.test(chemin)) sortie.push(chemin);
  }
  return sortie;
};

describe('Design system - props du Button', () => {
  it('aucun Button ne porte une prop inventee', () => {
    const coupables: string[] = [];
    for (const fichier of parcourir(resolve('src'))) {
      const source = readFileSync(fichier, 'utf8');
      const lignes = source.split(/\r?\n/);
      lignes.forEach((ligne, i) => {
        if (!/<Button\b/.test(ligne)) return;
        // Le bloc de la balise : jusqu au '>' qui la clot.
        let bloc = ligne;
        let k = i;
        while (!bloc.includes('>') && k < lignes.length - 1 && k < i + 12) {
          k += 1;
          bloc += `\n${lignes[k]}`;
        }
        const props = [...bloc.matchAll(/(?:^|\s)([a-zA-Z][a-zA-Z0-9]*)=/g)].map((m) => m[1]);
        for (const prop of props) {
          if (PROPS_CONSOMMEE.has(prop) || PROPS_DOM.has(prop)) continue;
          coupables.push(
            `${fichier.replace(/\\/g, '/').replace(/^.*\/src\//, 'src/')}:${i + 1}  « ${prop} »`,
          );
        }
      });
    }
    expect(
      coupables.length,
      'props inventees sur un <Button> (elles atterrissent dans le DOM) :\n  '
      + coupables.join('\n  '),
    ).toBe(0);
  });

  it('le Button ne laisse passer que des props HTML a la balise', () => {
    const button = readFileSync(resolve('src/app/components/ui/Button.tsx'), 'utf8');
    // Les props consommees sont extraites (donc absentes de `...props`).
    for (const prop of ['variant', 'size', 'fullWidth', 'animate', 'asChild', 'type']) {
      expect(button, `« ${prop} » est extrait des props`).toMatch(new RegExp(`\\b${prop}[,\\s]`));
    }
    expect(button, 'les props restantes sont transmises').toMatch(/\{\.\.\.props\}/);
  });
});
