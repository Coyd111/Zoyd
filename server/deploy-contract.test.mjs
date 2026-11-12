import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Le contrat d exploitation : blueprint <-> code <-> CI.
 *
 * Pourquoi ce test
 * ----------------
 * La configuration de production vit dans `render.yaml`, le code lit des
 * variables d environnement, et la CI rejoue les gates. Ces trois mondes
 * sont lies par des NOM DE CHAINE : rien ne verifie qu une variable
 * declaree est lue, qu une variable lue est declaree, ou que la CI
 * controle reellement ce que le developpeur controle en local.
 *
 * Ce qu il est deja arrive
 * -----------------------
 * - `ZOYD_2FA_ENC_KEY` etait declaree dans le blueprint et lue par le
 *   code — mais un scan statique (`process.env.X`) ne la voyait pas
 *   (elle est lue via `readKey('...')`). Un scan trop naif aurait
 *   concluded a une variable morte.
 * - Le telephone du compte admin (`ZOYD_ADMIN_PHONE`) n etait ni declare
 *   ni documente : le compte etait cree avec un numero de DEMONSTRATION,
 *   public dans le depot public.
 *
 * Ce que le test garantit
 * -----------------------
 * 1. Toute variable declaree dans le blueprint est lue par le serveur
 *    (une variable morte est soit un secret pose pour rien, soit un
 *    reglage qui n existe pas).
 * 2. Toute variable lue par le serveur est soit declaree en production,
 *    soit explicitement listee comme optionale (avec sa raison).
 * 3. La CI controle les memes repertoires que le lint local.
 */
const lister = (dossier, filtre) => {
  const sortie = [];
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

/** Les variables d'environnement reellement lues par le serveur. */
const variablesLues = () => {
  const lues = new Set();
  const fichiers = lister(
    resolve('server'),
    (c) => /\.(mjs|js)$/.test(c) && !c.includes('.test.'),
  );
  for (const fichier of fichiers) {
    const src = readFileSync(fichier, 'utf8');
    // Acces direct : `process.env.NOM`
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) lues.add(m[1]);
    // Acces INDIRECT : `readKey('NOM')` -> `process.env[nom]`.
    // Sans ce passage, une variable lue dynamiquement parait morte.
    for (const m of src.matchAll(/readKey\(\s*'([A-Z0-9_]+)'\s*\)/g)) lues.add(m[1]);
  }
  return lues;
};

const blueprint = readFileSync(resolve('render.yaml'), 'utf8');
const variablesBlueprint = new Set();
for (const m of blueprint.matchAll(/- key:\s*([A-Z0-9_]+)/g)) variablesBlueprint.add(m[1]);

/**
 * Variables lues mais NON declarees en production, avec la raison.
 *
 * Une variable absente de cette liste fait echouer le test : on ne peut
 * pas ajouter une variable lue par le code sans dire pourquoi elle est
 * facultative en production.
 */
const OPTIONNELLES_EN_PRODUCTION = {
  // Injectedes par la plateforme.
  HOSTNAME: 'injectee par le systeme (fallback du nom d instance)',
  RENDER_GIT_COMMIT: 'injectee par Render',
  RENDER_GIT_BRANCH: 'injectee par Render',
  RENDER_INSTANCE_ID: 'injectee par Render',
  // strictly reservees aux tests : les poser en production serait un
  // incident (elles detournent les garde-fous).
  ALLOW_DEBUG_CODES: 'tests uniquement - la poser en production detourneraient les garde-fous',
  ZOYD_DISABLE_SUPABASE: 'tests uniquement - le serveur demarrerait en mode memoire',
  // Reglages avec une valeur par defaut : le code fonctionne sans.
  ZOYD_RATE_LIMIT_MAX: 'reglage avec valeur par defaut (quotas des tests E2E)',
  ZOYD_RATE_LIMIT_PEER_MULTIPLIER: 'reglage avec valeur par defaut (multiplicateur du seau de pair)',
  ZOYD_API_KEY_ROTATION_DAYS: 'reglage avec valeur par defaut',
  ZOYD_BR_START_EARLY_MS: 'reglage avec valeur par defaut (BR : demarrage anticipe)',
  ZOYD_REALTIME_PORT: 'reglage avec valeur par defaut',
  // Canaux de livraison d e-mail OPTIONNELS : Resend puis Brevo sont
  // configures en production, le SMTP n est qu un repli.
  SMTP_HOST: 'repli optionnel (Resend et Brevo sont configures en production)',
  SMTP_PORT: 'repli optionnel',
  SMTP_USER: 'repli optionnel',
  SMTP_PASS: 'repli optionnel',
  SMTP_FROM: 'repli optionnel',
  SMTP_SECURE: 'repli optionnel',
  CODE_DELIVERY_WEBHOOK: 'canal optionnel, apres Resend, Brevo et SMTP',
  // Alias du meme secret : le dashboard Supabase utilise ce nom-la.
  SUPABASE_SERVICE_ROLE_KEY: 'alias de SUPABASE_SERVICE_KEY (nom du dashboard Supabase)',
  // Cle de ROTATION : absente en temps normal.
  ZOYD_2FA_ENC_KEY_NEXT: 'cle de rotation, absente hors rotation',
};

describe('Exploitabilite - le blueprint et le code sont d accord', () => {
  it('toute variable declaree dans le blueprint est lue par le serveur', () => {
    const lues = variablesLues();
    const mortes = [...variablesBlueprint].filter((v) => !lues.has(v)).sort();
    expect(
      mortes,
      `variables declarees mais jamais lues : ${mortes.join(', ')}\n`
      + `Une variable morte est soit un secret pose pour rien, soit un reglage qui n existe pas.`,
    ).toEqual([]);
  });

  it('toute variable lue par le serveur est declaree ou explicitement facultative', () => {
    const lues = variablesLues();
    const nonDeclarees = [...lues]
      .filter((v) => !variablesBlueprint.has(v))
      .filter((v) => !(v in OPTIONNELLES_EN_PRODUCTION))
      .sort();
    expect(
      nonDeclarees,
      `variables lues mais non declarees en production (et non documentees comme facultatives) :\n`
      + nonDeclarees.join('\n'),
    ).toEqual([]);
  });

  it('chaque variable facultative a une raison ecrite', () => {
    for (const [nom, raison] of Object.entries(OPTIONNELLES_EN_PRODUCTION)) {
      expect(raison, `la variable ${nom} doit avoir une raison`).toBeTruthy();
      expect(raison.length, `la raison de ${nom} doit etre explicite`).toBeGreaterThan(12);
    }
  });

  it('le telephone du compte admin est declare ET documente', () => {
    // Le defaut du code est un numero de demonstration PUBLIC : sans cette
    // variable, le compte admin est cree avec, et l argent ne peut pas y
    // etre envoye (le serveur refuse, code PLACEHOLDER_PHONE).
    expect(variablesBlueprint.has('ZOYD_ADMIN_PHONE')).toBe(true);
    const gabarit = readFileSync(resolve('.env.server.example'), 'utf8');
    expect(gabarit, 'le gabarit local doit documenter ZOYD_ADMIN_PHONE').toContain('ZOYD_ADMIN_PHONE');
  });
});

describe('Exploitabilite - la CI controle ce que le developpeur controle', () => {
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  const ci = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');

  it('le lint de la CI couvre les MEME repertoires que le lint local', () => {
    // Le lint local couvrait `scripts` ; celui de la CI, non : l outil
    // d exploitation (prod-inspect) n etait donc pas controle.
    expect(packageJson.scripts.lint).toContain('scripts');
    expect(ci, 'la CI doit executer le script lint du depot').toMatch(/run:\s*pnpm lint/);
  });

  it('la CI rejoue les gates essentials', () => {
    for (const commande of ['pnpm lint', 'npm run typecheck', 'pnpm build', 'pnpm test:run', 'pnpm test:e2e:api', 'pnpm test:e2e:ui']) {
      expect(ci, `la CI doit executer ${commande}`).toContain(commande);
    }
  });

  it('la CI ne rejoue PAS les tests qui touchent la production', () => {
    // Les projets `live` inscrivent un vrai compte sur zoyd.onrender.com :
    // les lancer a chaque push polluerait la production.
    expect(ci, 'les tests live ne doivent pas tourner dans la CI').not.toContain('test:e2e:live');
  });
});

/**
 * Le keep-alive : le service Render doit rester eveille.
 *
 * Le plan gratuit dort apres ~15 min sans trafic, et les travaux de fond
 * (reglements, liberations de fenetres, reconciliation des retraits) ne
 * tournent QUE service eveille. Un joueur qui gagne un match pendant que
 * le dernier visiteur a ferme l application attendrait le prochain
 * visiteur pour etre paye.
 *
 * Le workflow est versionne dans le depot : il est donc relu, modifie et
 * audite comme le reste du code. Le second mecanisme (pg_cron cote
 * Supabase) n est PAS dans le depot - il vit dans la base, et son
 * existence est verifiee par la sonde elle-meme (le service reste
 * eveille).
 */
describe('Exploitabilite - le keep-alive est en place', () => {
  const workflowPath = resolve('.github/workflows/keepalive.yml');
  const workflow = readFileSync(workflowPath, 'utf8');

  it('le workflow de keep-alive existe et pinge la sonde publique', () => {
    expect(workflow).toContain('https://zoyd.onrender.com/api/health');
  });

  it('il est planifie au moins toutes les 5 minutes', () => {
    // Au-dela de 5 minutes, le service peut dormir entre deux pings
    // (le seuil de Render est de 15 min, mais la marge doit rester large).
    const crons = [...workflow.matchAll(/cron:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(crons.length, 'le workflow doit avoir une planification').toBeGreaterThan(0);

    // Champ « minutes » d une expression cron : on en deduit l intervalle
    // maximal entre deux declenchements.
    const intervalleMinutes = (cron) => {
      const champ = cron.trim().split(/\s+/)[0];
      if (champ === '*') return 1;
      const etoile = /^\*\/(\d+)$/.exec(champ);
      if (etoile) return Number(etoile[1]);
      const intervalle = /^(\d+)\/(\d+)$/.exec(champ);
      if (intervalle) return Number(intervalle[2]);
      const plage = /^(\d+)-(\d+)$/.exec(champ);
      if (plage) return Number(plage[2]);
      const unique = /^(\d+)$/.exec(champ);
      if (unique) return Number(unique[1]);
      return Infinity;
    };

    for (const cron of crons) {
      expect(
        intervalleMinutes(cron),
        `le keep-alive doit passer toutes les 5 minutes au maximum (cron : ${cron})`,
      ).toBeLessThanOrEqual(5);
    }
  });

  it('un ping en erreur fait ECHOUER la tache (le keep-alive ne masque pas une panne)', () => {
    // `--fail` : un HTTP >= 400 doit etre visible dans l onglet Actions.
    expect(workflow).toContain('--fail');
  });

  it('il est declenchable a la main (diagnostic sans attendre le crontab)', () => {
    expect(workflow).toContain('workflow_dispatch');
  });
});
