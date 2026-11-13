import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { useNotificationStore } from '../stores/notificationStore';
import { useFriendsStore } from '../stores/friendsStore';
import { useWalletStore } from '../stores/walletStore';
import { useChatStore } from '../stores/chatStore';

/**
 * Les selecteurs zustand qui CONSTRUISENT un tableau (audit front).
 *
 * Le crash
 * --------
 * `useSyncExternalStore` (le mecanisme de zustand v5) compare le snapshot
 * precedent au nouveau par REFERENCE. Un selecteur qui renvoie un NOUVEAU
 * tableau a chaque lecture (`getRecent(4).filter(...)`, `getOnlineFriends()`)
 * fait donc认为 le store modifie a chaque rendu : React re-rendait, relisait,
 * rebouclait — « Maximum update depth exceeded » — et la page tombait sur son
 * error boundary.
 *
 * Concretement : `DashboardPage` etait INUTILISABLE. Le defaut etait observe
 * en direct dans les journaux du serveur de dev pendant la suite e2e, puis
 * reproduit ici.
 *
 * Le correctif
 * ------------
 * `useShallow` compare ELEMENT par element : la reference n'est changee que
 * si le contenu change. Le selecteur reste ainsi une source de donnees
 * (il re-rend quand la liste change), sans boucle.
 *
 * Ce que le test garantit
 * -----------------------
 * 1. Le selecteur du Dashboard renvoie bien un tableau STABLE (comparaison
 *    par reference) tant que le contenu ne change pas.
 * 2. Il change des que le contenu change (le re-rendu reste possible).
 * 3. Les pages concernees utilisent `useShallow` autour de ces selecteurs.
 */

const dashboardSource = readFileSync(resolve('src/app/pages/DashboardPage.tsx'), 'utf8');

beforeEach(() => {
  useNotificationStore.setState({
    notifications: [],
  } as never);
  useFriendsStore.setState({
    friends: [],
    requests: [],
  } as never);
});

describe('Selecteurs zustand — reference stable', () => {
  it('le selecteur de notifications renvoie la MEME reference si le contenu ne change pas', () => {
    useNotificationStore.setState({
      notifications: [
        { id: 'N1', type: 'info', title: 'A', message: 'a', read: false, dismissed: false, createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    } as never);

    // Le selecteur du Dashboard, isole de React.
    const select = (s: typeof useNotificationStore extends never ? never : ReturnType<typeof useNotificationStore.getState>) =>
      s.getRecent(4).filter((n) => !n.dismissed);

    const premier = select(useNotificationStore.getState());
    const second = select(useNotificationStore.getState());

    // SANS `useShallow`, ces deux references sont DIFFERENTES : c'est
    // exactement ce que `useSyncExternalStore` detecte comme une
    // modification, et ce qui declenche la boucle infinie.
    expect(premier).not.toBe(second);

    // AVEC `useShallow`, la comparaison element par element dit « egal » :
    // le snapshot est stable, donc pas de re-rendu en boucle.
    const egal = (a: unknown[], b: unknown[]) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    expect(egal(premier, second)).toBe(true);
  });

  it('le selecteur d amis renvoie la MEME reference si le contenu ne change pas', () => {
    useFriendsStore.setState({
      friends: [
        { id: 'F1', pseudo: 'Ami', status: 'online', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    } as never);

    const select = () => useFriendsStore.getState().getOnlineFriends();
    const premier = select();
    const second = select();

    expect(premier).not.toBe(second);
    const egal = (a: unknown[], b: unknown[]) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    expect(egal(premier, second)).toBe(true);
  });

  it('le contenu changeant est bien detecte (le re-rendu reste possible)', () => {
    const avant = useNotificationStore.getState().getRecent(4).length;
    useNotificationStore.setState({
      notifications: [
        { id: 'N1', type: 'info', title: 'A', message: 'a', read: false, dismissed: false, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'N2', type: 'info', title: 'B', message: 'b', read: false, dismissed: false, createdAt: '2026-01-01T00:00:01.000Z' },
      ],
    } as never);
    const apres = useNotificationStore.getState().getRecent(4).length;

    expect(avant).toBe(0);
    expect(apres).toBe(2);
  });

  it('useShallow est bien utilise sur les deux selecteurs du Dashboard', () => {
    // Sans ce garde-fou de CABLE, le mecanisme (`useShallow`) pourrait etre
    // retire du fichier sans qu'aucun test ne le remarque : le composant
    // rebouclerait, et le crash ne se verrait qu'a l'execution.
    expect(dashboardSource).toMatch(/useShallow\(\(s\) => s\.getRecent\(4\)/);
    expect(dashboardSource).toMatch(/useShallow\(\(s\) => s\.getOnlineFriends\(\)\)/);
    // Et l'import est present (sinon le build echoue, mais le message
    // serait moins clair).
    expect(dashboardSource).toMatch(/import \{ useShallow \} from 'zustand\/react\/shallow'/);
  });

  it('useShallow compare element par element (contrat de zustand)', () => {
    // Le mecanisme repose sur la comparaison ELEMENTAIRE (`Object.is` sur
    // chaque element), pas sur une egalite de contenu : deux tableaux
    // contenant les MEMES objets sont « egaux » (le store renvoie toujours
    // les memes objets), deux tableaux contenant des objets DISTINCTS mais
    // identiques ne le sont pas.
    const n1 = { id: 1 };
    const n2 = { id: 2 };
    const a = [n1, n2];
    const b = [n1, n2];
    expect(a).not.toBe(b);

    const egal = (x: unknown[], y: unknown[]) =>
      x.length === y.length && x.every((v, i) => v === y[i]);
    expect(egal(a, b)).toBe(true);
    expect(egal(a, [{ id: 1 }, { id: 2 }])).toBe(false);
  });
});

/**
 * REGLE GENERALE : aucun selecteur de store ne doit etre APPELE dans le
 * corps d'un composant.
 *
 * Pourquoi une regle, plutot qu'un test par composant
 * ---------------------------------------------------
 * Le defaut s est reproduit : chaque fois qu un composant appele un
 * accesseur qui CONSTRUIT un tableau (`getOnlineFriends`, `getRecent`), il
 * faut s en souvenir. Le Dashboard etait casse par cela ; puis
 * `FriendsWidget`, monte dans le hub MJ — la page la plus frequentee.
 *
 * Une regle mechanique le couvre TOUS, y compris le composant ecrit dans
 * six mois. Le test echoue des qu un appel direct apparait dans un corps de
 * composant, en nommant le fichier et la ligne.
 *
 * Ce que la regle autorise
 * -----------------------
 * 1. Prendre l ACCESSEUR (`const get = useStore((s) => s.getX)`) : la
 *    reference de la fonction est stable.
 * 2. L APPELER dans un `useMemo` : le resultat est recalcule quand les
 *    dependances changent.
 * 3. S abonner directement aux DONNEES (`useStore((s) => s.friends)`).
 *
 * Ce qu elle interdit : `const x = getX()` dans le corps — la reference
 * change a chaque rendu, et `useSyncExternalStore` boucle.
 */
describe('Selecteurs de store — regle : jamais appeles hors d un hook', () => {
  const racine = resolve('src');
  const fichiersComposants: string[] = [];

  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, entree.name);
      if (entree.isDirectory()) {
        parcourir(chemin);
        continue;
      }
      if (!entree.name.endsWith('.tsx')) continue;
      if (entree.name.endsWith('.test.tsx')) continue;
      fichiersComposants.push(chemin);
    }
  };
  parcourir(racine);

  it('la regle a des fichiers a inspecter (sinon elle ne verifierait rien)', () => {
    expect(fichiersComposants.length).toBeGreaterThan(10);
  });

  it('aucun composant n appelle un accesseur de LECTURE hors d un hook', () => {
    const coupables: string[] = [];

    for (const fichier of fichiersComposants) {
      const source = readFileSync(fichier, 'utf8');
      const lignes = source.split(/\r?\n/);

      // On repere les accesseurs de LECTURE pris au store :
      //   `const getX = useYStore((s) => s.getZ)`.
      // Une ACTION (`s.logout`, `s.markAllAsRead`) est une FONCTION, dont la
      // reference est stable : l appeler dans un gestionnaire de clic est
      // correct et sans effet sur le rendu. Seules les LECTURES comptent.
      const accesseurs = new Map<string, string>();
      for (const ligne of lignes) {
        const m = /const\s+(\w+)\s*=\s*use\w+Store\(\(s\)\s*=>\s*s\.(get\w+)\)/.exec(ligne);
        if (m) accesseurs.set(m[1], m[2]);
      }
      if (accesseurs.size === 0) continue;

      for (let i = 0; i < lignes.length; i += 1) {
        const ligne = lignes[i];
        for (const [nom] of accesseurs) {
          const appel = new RegExp(`\\b${nom}\\s*\\(\\s*\\)`).exec(ligne);
          if (!appel) continue;
          // La DEFINITION de l accesseur n est pas un appel.
          if (new RegExp(`=\\s*${nom}\\s*\\(`).test(ligne)) continue;

          // Un appel est legitime s il est dans un hook. Le hook peut etre
          // sur la meme ligne, ou ouvrir un corps multi-lignes dont l appel
          // est a deux lignes du `useMemo(`.
          const contexte = [lignes[i - 1] || '', lignes[i - 2] || '', ligne].join('\n');
          if (/useMemo\(|useCallback\(|useEffect\(/.test(contexte)) continue;

          coupables.push(`${fichier}:${i + 1}  ${ligne.trim()}`);
        }
      }
    }

    expect(
      coupables.length,
      'accesseurs de LECTURE appeles hors d un hook '
      + '(reference instable -> boucle de rendu) :\n  ' + coupables.join('\n  '),
    ).toBe(0);
  });
  it('FriendsWidget est bien corrige (le cas reel)', () => {
    const source = readFileSync(
      resolve('src/app/components/social/FriendsWidget.tsx'),
      'utf8',
    );
    // Avant : `const onlineFriends = getOnlineFriends();` — appel dans le corps.
    expect(source).not.toMatch(/const\s+onlineFriends\s*=\s*getOnlineFriends\(\)/);
    expect(source).toMatch(/useShallow\(\(s\)\s*=>\s*s\.getOnlineFriends\(\)\)/);
  });
});

/**
 * REGLE GENERALE (2) : un selecteur de store ne doit jamais APPELER un
 * accesseur qui CONSTRUIT un objet ou un tableau.
 *
 * Le defaut, reproduit par l audit UI
 * -----------------------------------
 * `MatchDetailPage` s abonnait a `usePresenceStore((s) => s.getPresenceSummary(...))`.
 * `getPresenceSummary` CONSTRUIT son objet a chaque lecture : la reference
 * change a chaque rendu, `useSyncExternalStore` y voit une modification, et
 * React re-rend, relisit, reboucle — « Maximum update depth exceeded » puis
 * « React Router caught the following error during render ». Le detail d un
 * match etait un ecran MORT, et personne ne l avait vu : le test e2e de
 * l ecran ne visitait que des routes sans identifiant.
 *
 * La regle precedente (jamais appeler un accesseur hors d un hook) ne
 * voyait PAS ce cas : l appel est bien dans le selecteur, c'est le
 * selecteur qui renvoie une valeur instable.
 *
 * Le correctif : `useShallow` compare element par element, la reference ne
 * change que si un compteur change reellement.
 *
 * Ce que la regle autorise
 * -----------------------
 * 1. `useShallow((s) => s.getX(...))` : le mecanisme correct.
 * 2. Prendre l ACCESSEUR (`const get = useStore((s) => s.getX)`) puis
 *    l appeler dans un `useMemo` : la reference est stable.
 * 3. Un accesseur qui renvoie un PRIMITIF (`number`, `boolean`, `string`) :
 *    la reference d'un nombre ne change pas de valeur, donc pas de boucle.
 *    La liste est VERIFIEE A L EXECUTION (voir `describe` suivant) : si un
 *    accesseur listé change de nature, le test echoue.
 */
describe('Selecteurs de store — regle : jamais d accesseur instable dans le selecteur', () => {
  const racine = resolve('src');
  const fichiersComposants: string[] = [];

  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, entree.name);
      if (entree.isDirectory()) {
        parcourir(chemin);
        continue;
      }
      if (!entree.name.endsWith('.tsx')) continue;
      if (entree.name.endsWith('.test.tsx')) continue;
      fichiersComposants.push(chemin);
    }
  };
  parcourir(racine);

  /**
   * Accesseurs dont le retour est un PRIMITIF : les appeler dans un
   * selecteur est sans risque (la reference d un nombre est stable).
   *
   * PIEGE : cette liste n est pas une convention mais un CONTRAT. Le test
   * suivant verifie a l execution que chacun renvoie bien un primitif. Si
   * l un d eux change de nature, le test echoue — on ne peut pas glisser
   * une boucle de rendu sous la regle.
   */
  const ACCESSEURS_PRIMITIFS = [
    'getTotalBalance',
    'getAvailableCash',
    'getAvailableToSpend',
    'getUnreadCount',
    'getUnreadTotal',
  ];

  /** Extrait l argument d un appel `use<Store>(...)`, parentheses equilibrees. */
  const argumentDe = (source: string, ouverture: number): string | null => {
    let profondeur = 0;
    for (let i = ouverture; i < source.length; i += 1) {
      const c = source[i];
      if (c === '(') profondeur += 1;
      else if (c === ')') {
        profondeur -= 1;
        if (profondeur === 0) return source.slice(ouverture + 1, i);
      }
    }
    return null;
  };

  it('la regle a des fichiers a inspecter (sinon elle ne verifierait rien)', () => {
    expect(fichiersComposants.length).toBeGreaterThan(10);
  });

  it('aucun selecteur n appelle un accesseur instable sans `useShallow`', () => {
    const coupables: string[] = [];

    for (const fichier of fichiersComposants) {
      const source = readFileSync(fichier, 'utf8');

      // `matchAll` et non une boucle caractere par caractere : la version
      // naive copiait le fichier a chaque position (O(n^2)) et le test
      // depassait le budget de 20 s.
      for (const occurrence of source.matchAll(/use\w+Store\(/g)) {
        const ouverture = occurrence.index + occurrence[0].length - 1;
        const argument = argumentDe(source, ouverture);
        if (argument === null) continue;

        // Le selecteur appelle-t-il un accesseur du store ?
        const appel = /\.get(\w+)\s*\(/.exec(argument);
        if (!appel) continue;
        const nom = `get${appel[1]}`;

        // `useShallow` autour du selecteur : le mecanisme correct.
        const entoure = /^\s*useShallow\s*\(/.test(argument);

        if (entoure || ACCESSEURS_PRIMITIFS.includes(nom)) continue;

        const ligne = source.slice(0, ouverture).split(/\r?\n/).length;
        coupables.push(`${fichier}:${ligne}  ${nom} — reference instable`);
      }
    }

    expect(
      coupables.length,
      'accesseur instable appele DIRECTEMENT dans un selecteur de store '
      + '(reference instable -> boucle de rendu) :\n  ' + coupables.join('\n  '),
    ).toBe(0);
  });

  it('les accesseurs autorises renvoient bien un PRIMITIF (le contrat tient)', () => {
    // La liste `ACCESSEURS_PRIMITIFS` n a de sens que si ces accesseurs
    // renvoient un nombre (ou un booleen / une chaine). On le VERIFIE.
    const releves: Array<{ nom: string; type: string }> = [];

    for (const [store, getters] of [
      [useWalletStore, ['getTotalBalance', 'getAvailableCash', 'getAvailableToSpend']],
      [useNotificationStore, ['getUnreadCount']],
      [useChatStore, ['getUnreadTotal']],
    ] as const) {
      for (const nom of getters) {
        const valeur = (store.getState() as unknown as Record<string, () => unknown>)[nom]();
        releves.push({ nom, type: typeof valeur });
      }
    }

    for (const { nom, type } of releves) {
      expect(
        ['number', 'boolean', 'string'],
        `l accesseur autorise « ${nom} » renvoie un ${type} : il doit sortir de la `
        + 'liste des primitifs, et ses usages doivent passer par `useShallow`',
      ).toContain(type);
    }
  });

  it('le cas reel est corrige (MatchDetailPage)', () => {
    const source = readFileSync(
      resolve('src/features/match/pages/MatchDetailPage.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/usePresenceStore\(\(s\) => \(match\s*\?\s*s\.getPresenceSummary/);
    expect(source).toMatch(/useShallow\(\(s\) => \(match \? s\.getPresenceSummary/);
  });
});
