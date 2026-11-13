import { type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Mesure design partagee par les passes d audit UI.
 *
 * Pourquoi un module partage : les deux passes (ecrans authentifies, ecrans
 * publics + detail) mesurent EXACTEMENT les memes choses. Deux copies
 * divergent : la seconde cesse de couvrir un critere, et l audit affiche un
 * vert qui ne prouve plus rien. Un seul endroit, une seule definition.
 *
 * Ce que mesure la sonde (dans la page, sur le DOM reellement rendu) :
 *  1. les images sans attribut `alt` (une image decorative DOIT avoir
 *     `alt=""` ; une image porteuse de sens doit avoir une alternative) ;
 *  2. les elements interactifs sans nom accessible (bouton, lien, champ) ;
 *  3. les cibles tactiles trop petites (WCAG 2.2 AA 2.5.8 : 24x24 px mini,
 *     44x44 px confortable sur mobile).
 *
 * INVARIANT : la fonction est SERIALISEE par Playwright (page.evaluate) :
 * elle ne doit referencer AUCUNE variable du module. Toute reference
 * exterieure casserait le `toString()` execute dans la page.
 */
export const mesurerDesign = () => {
  const nomAccessible = (el: Element): string => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    if (el.getAttribute('aria-labelledby')) return 'lie';
    const titre = el.getAttribute('title');
    if (titre && titre.trim()) return titre.trim();
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      if (el.getAttribute('placeholder')) return 'placeholder';
      if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return 'label';
      if (el.closest('label')) return 'label imbrique';
      return '';
    }
    if ((el.textContent || '').trim()) return 'texte';
    // Un lien dont le seul contenu est une image porteuse de sens tire
    // son nom accessible de son `alt` (WCAG 4.1.2). Son `textContent` est
    // vide : sans cette branche, la sonde declarerait « pas de nom » un
    // lien qui est tres bien nomme (le logo ZOYD de l inscription).
    const image = el.querySelector('img[alt]:not([alt=""])');
    if (image) return 'alt image';
    return '';
  };

  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };

  const imagesSansAlt: string[] = [];
  for (const img of Array.from(document.querySelectorAll('img'))) {
    if (!visible(img)) continue;
    if (img.getAttribute('alt') === null) imagesSansAlt.push(img.getAttribute('src') || '(src inconnu)');
  }

  const sansNom: string[] = [];
  for (const el of Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"], input, select, textarea'))) {
    if (!visible(el)) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    if (!nomAccessible(el)) {
      const r = el.getBoundingClientRect();
      sansNom.push(`${el.tagName.toLowerCase()} « ${(el.textContent || '').trim().slice(0, 24)} » @${Math.round(r.left)},${Math.round(r.top)}`);
    }
  }

  const ciblesPetites: string[] = [];
  for (const el of Array.from(document.querySelectorAll('button, a[href], [role="button"], input[type="checkbox"], input[type="radio"]'))) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 24 && r.height >= 24) continue;
    const css = typeof el.className === 'string' ? el.className : '';
    // EXCEPTION 1 - le lien d evitement (« Aller au contenu principal ») :
    // il est VISUELLEMENT cache (`sr-only`) et n apparait qu AU FOCUS. Sa
    // taille reelle de 1x1 est le mecanisme du motif, pas un defaut.
    if (css.includes('sr-only')) continue;
    // EXCEPTION 2 - une case a cocher DANS UN LABEL : c est le label qui
    // est la cible (cliquer l etiquette la coche). La boite de 20x20 n est
    // pas la surface tactile.
    if (el.tagName.toLowerCase() === 'input' && el.closest('label')) continue;
    // EXCEPTION 3 (WCAG 2.5.8) - la cible est DANS un texte : le paragraphe
    // « ... Frais et conditions · Jeu responsable » contient des liens de
    // 14 px de haut. La regle les exempte explicitement (cible dans une
    // phrase) : les flaguer serait un faux positif.
    const parent = el.parentElement;
    const dansUnTexte = Boolean(
      parent && Array.from(parent.childNodes).some(
        (n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0,
      ),
    );
    if (dansUnTexte) continue;
    ciblesPetites.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)} « ${(el.textContent || '').trim().slice(0, 20)} »`);
  }

  return { imagesSansAlt, sansNom, ciblesPetites };
};

export interface OptionsAudit {
  /** Nom lisible de l ecran (rapport + nom du fichier d inventaire). */
  nom: string;
  /** Chemin URL de l ecran. */
  chemin: string;
  /**
   * Suffixe du fichier d inventaire (numero de tentative).
   *
   * PIEGE : sans lui, la TENTATIVE 2 ecrase l inventaire de la tentative
   * 1. Or c est justement la tentative 1 qui echoue : son inventaire est
   * le plus interessant, et il disparaitait. Un audit qui perd la preuve
   * de son echec ne sert a rien.
   */
  tentative?: number;
}

export interface RapportAudit {
  /** Le rapport texte, vide si aucun defaut. */
  rapport: string;
  /** L inventaire JSON complet (ecrit sur disque). */
  inventaire: string;
}

export interface Collecte {
  erreursConsole: string[];
  reponsesApiEnErreur: string[];
}

/**
 * Pose les ecouteurs de la sonde AVANT la navigation et renvoie les
 * collecteurs (a lire apres le chargement).
 *
 * PIEGE : les erreurs console « Failed to load resource » sont l ECHO
 * reseau d une reponse HTTP en erreur : les compter en plus des reponses
 * HTTP double-compte le meme defaut. On les ecarte de la liste console
 * (qui ne garde alors que les erreurs JAVASCRIPT : exceptions, warnings
 * React) et on suit les reponses HTTP a part, avec leur URL.
 *
 * `attendus` liste des FRAGMENTS d URL dont le 403 est un etat NORMAL de
 * l ecran, pas un defaut. Chaque entree doit etre justifiable dans une
 * phrase — sinon, c est un defaut qu on laisse passer.
 */
export const brancherSonde = (
  page: Page,
  options: { anonyme?: boolean; attendus403?: string[] } = {},
): Collecte => {
  const erreursConsole: string[] = [];
  const reponsesApiEnErreur: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const texte = msg.text();
    if (texte.startsWith('Failed to load resource')) return;
    erreursConsole.push(texte.slice(0, 200));
  });

  page.on('response', (rep) => {
    const status = rep.status();
    if (status < 400) return;
    const url = rep.url();
    // Seules les reponses de l API interessent l audit : les 404 de modules
    // Vite ou de sourcemaps sont du bruit de l outil de dev.
    if (!url.includes('/api/')) return;
    // Sur un ecran PUBLIC, la sonde `/api/auth/me` renvoie 401 : c est le
    // fonctionnement normal d une page anonyme, pas un defaut.
    if (options.anonyme && status === 401 && url.includes('/api/auth/me')) return;
    // Les 403 attendus (2FA admin non validee, etc.) sont un etat de
    // l ecran : le back-office affiche « N/D » et invite a revalider la 2FA.
    if (status === 403 && (options.attendus403 || []).some((f) => url.includes(f))) return;
    reponsesApiEnErreur.push(`${status} ${url.replace(/https?:\/\/[^/]+/, '')}`);
  });

  return { erreursConsole, reponsesApiEnErreur };
};

/**
 * Audite UN ecran deja charge dans la page.
 *
 * Ce que le rapport contient :
 *  - les violations axe-core bloquantes (serious / critical) ;
 *  - les images sans `alt`, les elements sans nom accessible ;
 *  - les cibles tactiles < 24 px ;
 *  - les erreurs JavaScript de la console ;
 *  - les reponses HTTP >= 400 sur l API (avec l URL : un constat sans URL
 *    n est pas un constat).
 */
export const auditerEcran = async (
  page: Page,
  options: OptionsAudit,
  collecte: Collecte,
): Promise<RapportAudit> => {
  const design = await page.evaluate(mesurerDesign);

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bloquantes = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');

  const rapport = [
    ...bloquantes.map(
      (v) => `[axe ${v.impact}] ${v.id} - ${v.help}\n` +
        v.nodes.slice(0, 3).map((n) => `      ${n.target.join(' ')}`).join('\n'),
    ),
    design.imagesSansAlt.length ? `images sans alt :\n      ${design.imagesSansAlt.join('\n      ')}` : '',
    design.sansNom.length ? `elements sans nom accessible :\n      ${design.sansNom.join('\n      ')}` : '',
    design.ciblesPetites.length ? `cibles tactiles < 24 px :\n      ${design.ciblesPetites.join('\n      ')}` : '',
    collecte.erreursConsole.length ? `erreurs console :\n      ${collecte.erreursConsole.join('\n      ')}` : '',
    collecte.reponsesApiEnErreur.length ? `reponses API en erreur :\n      ${collecte.reponsesApiEnErreur.join('\n      ')}` : '',
  ].filter(Boolean).join('\n\n');

  const inventaire = JSON.stringify(
    {
      ecran: options.nom,
      chemin: options.chemin,
      axe: bloquantes.map((v) => ({
        impact: v.impact,
        id: v.id,
        aide: v.help,
        noeuds: v.nodes.map((n) => `${n.target.join(' ')} :: ${n.html.slice(0, 220)}`),
        // Le detail du contraste (couleurs compositees, ratio mesure,
        // ratio exige) : sans lui, un constat de contraste ne dit pas
        // CE QUI est trop clair.
        details: v.nodes.map((n) => {
          const d = (n.any?.[0] as { data?: Record<string, unknown> } | undefined)?.data;
          if (!d) return null;
          const entrees = Object.entries(d)
            .filter(([cle]) => /contrast|Color|font|size|bold/i.test(cle))
            .map(([cle, valeur]) => `${cle}=${typeof valeur === 'object' ? JSON.stringify(valeur) : valeur}`);
          return entrees.length ? entrees.join(' | ') : null;
        }),
      })),
      imagesSansAlt: design.imagesSansAlt,
      sansNom: design.sansNom,
      ciblesPetites: design.ciblesPetites,
      erreursConsole: collecte.erreursConsole,
      reponsesApiEnErreur: collecte.reponsesApiEnErreur,
    },
    null,
    1,
  );

  writeFileSync(
    join(
      'test-results',
      `ui-audit-${options.chemin.replace(/[^a-z0-9]+/gi, '_')}${
        options.tentative ? `-t${options.tentative}` : ''
      }.json`,
    ),
    inventaire,
    'utf8',
  );

  return { rapport, inventaire };
};
