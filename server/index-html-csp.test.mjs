import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

// Le durcissement CSP a retiré `unsafe-inline` de `script-src` : c'est
// volontaire. Mais l'astuce de chargement de police
// `preload` + `onload="this.rel='stylesheet'"` dependait d'un handler inline,
// et son blocage n'a PAS levé d'erreur visible : la police n'etait simplement
// jamais appliquee, le navigateur signalant juste « preloaded but not used ».
// Ces tests verrouillent la regle pour qu'elle ne revienne pas.

const INLINE_HANDLER = /\son(?:load|error|click|change|submit|input|focus|blur|keyup|keydown|mousedown|mouseup|mouseover|mouseenter|touchstart)\s*=/i;

describe('index.html : aucune execution inline', () => {
  it("n'a aucun gestionnaire d'evenement inline", () => {
    const lignes = html.split('\n');
    const coupables = lignes
      .map((ligne, i) => ({ ligne: ligne.trim(), numero: i + 1 }))
      .filter(({ ligne }) => INLINE_HANDLER.test(ligne));
    expect(coupables, `handlers inline : ${JSON.stringify(coupables)}`).toHaveLength(0);
  });

  it("n'a pas de balise preload qui bascule en stylesheet via onload", () => {
    // L'astuce qui a casse la police : `rel=preload` + `onload` qui change le
    // `rel`. Sans l'astuce, plus d'avertissement « preloaded but not used ».
    expect(html).not.toMatch(/rel="preload"[^>]*onload=/i);
    expect(html).not.toMatch(/onload=[^>]*rel=['"]?stylesheet/i);
  });

  it('charge la police par une balise stylesheet reelle', () => {
    // Sans cela, la police ne part jamais : c'etait le bug invisible.
    expect(html).toMatch(/<link[^>]+rel="stylesheet"[^>]+fonts\.googleapis\.com/i);
  });

  it("ne conserve aucun rel=preload orphelin", () => {
    const preloads = html.match(/rel="preload"/g) || [];
    expect(preloads).toHaveLength(0);
  });

  it("ne contient qu'un seul script inline, et c'est du JSON-LD", () => {
    // `<script type="application/ld+json">` est une DONNEE, pas du code
    // execute : `script-src` ne s'y applique pas. Tout autre script inline
    // serait bloque.
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)]
      .map((m) => m[1])
      .filter((attrs) => !/\ssrc=/i.test(attrs));
    for (const attrs of scripts) {
      expect(attrs, `script inline non JSON-LD : ${attrs}`).toMatch(/type="application\/ld\+json"/i);
    }
  });
});