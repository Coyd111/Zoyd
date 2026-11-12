import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Le contrat d'API : tout ce que le front appelle existe cote serveur.
 *
 * Pourquoi ce test existe
 * -----------------------
 * Le front et le serveur sont deux depots, deux langages, et AUCUN contrat
 * genere : rien ne dit au front que `/api/matches/X/join` existe encore, ni
 * au serveur que le front ne l appelle plus. Un chemin renomme d un cote et
 * oublie de l autre ne casse AUCUN test : les tests du front mockent le
 * reseau, et les tests du serveur ne savent pas qui l appelle. Le resultat
 * est un 404 a l execution - chez le joueur.
 *
 * Ce test lit les DEUX cotes et les compare : c est le seul endroit ou la
 *.front` et le `serveur` se parlent.
 *
 * Ce que le test garantit
 * -----------------------
 * 1. Chaque chemin appele par le front correspond a une route du serveur.
 * 2. L extraction trouve bien des routes et des appels (sinon le test ne
 *    verifierait rien).
 */
const lister = (dossier: string, filtre: (chemin: string) => boolean): string[] => {
  const sortie: string[] = [];
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name);
    if (entree.isDirectory()) {
      sortie.push(...lister(chemin, filtre));
      continue;
    }
    if (filtre(chemin)) sortie.push(chemin);
  }
  return sortie;
};

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Les motifs de routes declares par le serveur.
 *
 * Trois formes sont possibles :
 *   - `pathname === '/api/xxx'`   -> route litterale
 *   - `pathname.match(/^...$/)`   -> route a parametre (le plus courant)
 *   - `pathname.startsWith('/api/xxx')` -> prefixe
 *
 * PIEGE : le litteral de regex contient des `[^/]` (une classe de
 * caracteres qui contient un slash). Un `/` dans une classe NE termine PAS
 * le litteral en JavaScript — un scanner naif s'arreterait la et
 * decouperait les routes en morceaux.
 */
const motifsServeur = (): string[] => {
  const motifs: string[] = [];
  const fichiers = lister(resolve('server/routes'), (c) => c.endsWith('.mjs'));

  for (const fichier of fichiers) {
    const src = readFileSync(fichier, 'utf8');

    for (const m of src.matchAll(/pathname\s*===\s*'([^']+)'/g)) {
      motifs.push(`^${echapper(m[1])}$`);
    }

    for (const m of src.matchAll(/pathname\.startsWith\(\s*'([^']+)'\s*\)/g)) {
      motifs.push(`^${echapper(m[1])}`);
    }

    // Scanner de litteraux de regex : gere les classes de caracteres.
    const MARQUEUR = 'pathname.match(';
    let i = 0;
    while ((i = src.indexOf(MARQUEUR, i)) !== -1) {
      let j = i + MARQUEUR.length;
      while (j < src.length && /\s/.test(src[j])) j += 1;
      if (src[j] !== '/') { i += MARQUEUR.length; continue; }
      j += 1;
      let corps = '';
      let dansClasse = false;
      let termine = false;
      while (j < src.length) {
        const c = src[j];
        if (c === '\\') { corps += c + (src[j + 1] ?? ''); j += 2; continue; }
        if (c === '[') dansClasse = true;
        else if (c === ']') dansClasse = false;
        else if (c === '/' && !dansClasse) { j += 1; termine = true; break; }
        corps += c;
        j += 1;
      }
      if (!termine) { i += MARQUEUR.length; continue; }
      while (j < src.length && /[gimsuy]/.test(src[j])) j += 1;
      while (j < src.length && /\s/.test(src[j])) j += 1;
      if (src[j] === ')') {
        motifs.push(corps);
        i = j;
      } else {
        i += MARQUEUR.length;
      }
    }
  }
  return motifs;
};

/**
 * Les chemins appeles par le front.
 *
 * Seuls les APPELS comptent : un `/api/...` cite dans un commentaire n est
 * pas une requete. Les appels passent tous par `authorizedGet/Post/Patch/
 * Delete` (client unique) ou par `fetch`.
 */
const appelsFront = (): { fichier: string; brut: string; concret: string }[] => {
  const appels: { fichier: string; brut: string; concret: string }[] = [];
  const fichiers = lister(
    resolve('src'),
    (c) => /\.(ts|tsx)$/.test(c) && !/\.test\.(ts|tsx)$/.test(c),
  );

  const RE_APPEL = /(?:authorized(?:Get|Post|Patch|Delete)|fetch)\s*(?:<[^>]*>)?\(\s*[`'"]([^`'"]*)[`'"]/g;
  for (const fichier of fichiers) {
    const src = readFileSync(fichier, 'utf8');
    for (const m of src.matchAll(RE_APPEL)) {
      const brut = m[1];
      if (!brut.includes('/api/')) continue;
      // Le serveur route sur le pathname : la chaine de requete est
      // hors sujet.
      const concret = brut.split('?')[0].replace(/\$\{[^}]+\}/g, 'X');
      appels.push({ fichier: fichier.replace(resolve('.') + '\\', ''), brut, concret });
    }
  }
  return appels;
};

describe('Contrat d API - le front n appelle que des routes qui existent', () => {
  it('l extraction trouve des routes ET des appels (sinon le test ne verifierait rien)', () => {
    expect(motifsServeur().length, 'des routes serveur doivent etre trouvees').toBeGreaterThan(40);
    expect(appelsFront().length, 'des appels front doivent etre trouves').toBeGreaterThan(30);
  });

  it('tout chemin appele par le front correspond a une route du serveur', () => {
    const motifs = motifsServeur();
    const sansRoute: string[] = [];

    for (const appel of appelsFront()) {
      const trouve = motifs.some((motif) => {
        try {
          return new RegExp(motif).test(appel.concret);
        } catch {
          return false;
        }
      });
      if (!trouve) sansRoute.push(`${appel.fichier}  ${appel.brut}`);
    }

    expect(
      sansRoute,
      `chemins appeles par le front sans route correspondante :\n${sansRoute.join('\n')}`,
    ).toEqual([]);
  });
});

/**
 * Les messages d erreur du front ne doivent pas promettre plus que le
 * serveur ne garantit.
 *
 * Le cas
 * ------
 * `PAYOUT_FAILED` signifie « le transfert a echoue ET le solde a ete
 * restaure ». Le front l'affiche au joueur. Mais quand le REMBOURSEMENT
 * echoue lui aussi, l argent est ENCORE RETENU : le serveur repond alors
 * `REFUND_FAILED`, et le front doit le dire.
 *
 * Si les deux codes avaient le meme message, le joueur lirait « ton solde
 * a ete restaure » pendant que ses ZC sont toujours bloques.
 */
describe('Contrat d API - les messages d erreur ne promettent pas plus que le serveur', () => {
  const apiClient = readFileSync(resolve('src/app/lib/apiClient.ts'), 'utf8');

  const messagePour = (code: string): string => {
    // Le message peut etre entre apostrophes ou entre guillemets (il
    // contient des apostrophes).
    const m = new RegExp(`${code}:\\s*(?:'([^']*)'|"([^"]*)")`).exec(apiClient);
    if (!m) return '';
    return m[1] ?? m[2] ?? '';
  };

  it('PAYOUT_FAILED annonce la restauration (le serveur ne l envoie que si elle a reussi)', () => {
    expect(messagePour('PAYOUT_FAILED')).toMatch(/restauré/i);
  });

  it('REFUND_FAILED ne promet PAS une restauration qui n a pas eu lieu', () => {
    const message = messagePour('REFUND_FAILED');
    expect(message, 'REFUND_FAILED doit avoir un message').toBeTruthy();
    expect(
      message,
      'le message ne doit pas affirmer une restauration qui n a pas eu lieu',
    ).not.toMatch(/a été restauré/i);
    expect(message, 'le message doit dire que la restauration est en attente').toMatch(/pas encore/i);
  });
});
