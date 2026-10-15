import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Les quatre failles d'authentification trouvees par la lecture exhaustive.
 *
 * Chacune a un test qui echouerait sur le code d avant.
 *
 * Deux pieges deja payes, documentes ici pour ne pas les repayer :
 *
 * 1. Le controle d'expiration utilise `new Date()`, qui lit l'horloge systeme.
 *    Patcher `Date.now` ne change RIEN : le test passe alors pour une mauvaise
 *    raison. Il faut `vi.useFakeTimers({ toFake: ['Date'] })`, et seulement
 *    `Date`, afin de ne pas figer les `setTimeout` du module.
 *
 * 2. `getAuthSession` SUPPRIME la session dont l'utilisateur est introuvable.
 *    Un identifiant de joueur fictif fait donc disparaitre la session au premier
 *    appel : il faut de vrais comptes.
 *
 * 3. `rotateOnce` renvoie le JETON (une chaine), pas un objet. Ecrire
 *    `b.token` vaut `undefined` : le test echoue en paraissantTimeouts
 *    demonstrate que le code est casse.
 */

// Le mock doit exposer la meme surface que le vrai client : le code enchaine
// `.select(...).eq(...)` et `.delete().in(...)`. Un mock qui renvoie une
// Promise sur `select` fait echouer silencieusement les lectures filtrees.
vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => {
      const q = {};
      q.select = vi.fn(() => q);
      q.upsert = vi.fn(() => Promise.resolve({ error: null }));
      q.delete = vi.fn(() => q);
      q.eq = vi.fn(() => Promise.resolve({ data: [], error: null }));
      q.in = vi.fn(() => Promise.resolve({ data: [], error: null }));
      return q;
    }),
  },
}));

import {
  createAuthSession,
  getAuthSession,
  deleteAuthSession,
  authenticateUserAccount,
  createUserAccount,
} from './persistence.mjs';

const PASSWORD = 'MotDePasseSolide2026!';
const NATIVE_NOW = Date.now;
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

let clockOffset = 0;

/** Avance l'horloge systeme de `ms`.Voir piege 1. */
const advanceClock = (ms) => {
  clockOffset += ms;
  vi.setSystemTime(NATIVE_NOW() + clockOffset);
};

beforeEach(() => {
  clockOffset = 0;
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NATIVE_NOW());
});

afterEach(() => {
  vi.useRealTimers();
});

const creerJoueur = async (prefixe) => {
  // Format de telephone repris tel quel du test de rotation existant : 10
  // chiffres apres +225. Un format invente ici rendrait le test invalide pour
  // une raison qui n a rien a voir avec le verrouillage.
  const stamp = String(NATIVE_NOW() % 100000).padStart(6, '0');
  const joueur = await createUserAccount({
    pseudo: `${prefixe}${NATIVE_NOW()}`,
    email: `${prefixe.toLowerCase()}-${NATIVE_NOW()}@test.local`,
    phone: `+2250700${stamp}`,
    gameId: `CO-${prefixe.toUpperCase()}-${NATIVE_NOW()}`,
    password: PASSWORD,
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  return joueur;
};

/**
 * Force une rotation en presentant le jeton apres `ms`.
 * Renvoie le NOUVEAU JETON, qui est une chaine.
 */
const rotateOnce = async (token, ms = 31 * 60 * 1000) => {
  advanceClock(ms);
  let emitted = null;
  getAuthSession(token, { emitToken: (value) => { emitted = value; } });
  await settle();
  expect(emitted, 'la rotation doit avoir emis un nouveau jeton').toBeTruthy();
  expect(emitted, 'la rotation doit produire un jeton distinct').not.toBe(token);
  return emitted;
};

describe('Faille 1 — le verrouillage ne depend plus du format saisi', () => {
  it('les facons d ecrire le meme telephone partagent UN compteur', async () => {
    const joueur = await creerJoueur('Format');
    const numero = joueur.phone;

    // Ces trois saisies designent le MEME compte, donc doivent partager le
    // meme compteur. La variante sans indicatif (`22507...`) est volontairement
    // absente : sans pays elle ne resout aucun compte, et ne prouve rien.
    const variantes = [
      numero,
      `${numero.slice(0, 5)} ${numero.slice(5)}`,
      `${numero.slice(0, 5)}-${numero.slice(5)}`,
    ];

    // On depasse le seuil de 5 tentatives en alternant les formats. Avant le
    // correctif, chaque format repartait de zero : le verrou ne s installait
    // jamais, et le compte restait attaquable indefiniment.
    for (let i = 0; i < 8; i += 1) {
      await authenticateUserAccount({
        identifier: variantes[i % variantes.length],
        password: 'Mauvais',
      }).catch(() => {});
    }

    // Le verrou doit etre installe, et l'etre pour TOUTES les facons d ecrire
    // le numero : c est exactement ce que l ancien code ne faisait pas.
    for (const variante of variantes) {
      await expect(
        authenticateUserAccount({ identifier: variante, password: 'Mauvais' })
      ).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    }
  });

  it('le verrou bloque aussi le bon mot de passe, sur toute ecriture', async () => {
    const joueur = await creerJoueur('Verif');
    const numero = joueur.phone;

    for (let i = 0; i < 5; i += 1) {
      await authenticateUserAccount({ identifier: joueur.pseudo, password: 'Mauvais' })
        .catch(() => {});
    }

    for (const variante of [joueur.pseudo, joueur.email, numero]) {
      await expect(
        authenticateUserAccount({ identifier: variante, password: PASSWORD })
      ).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    }
  });
});

describe('Faille 2 — la session a un plafond ABSOLU', () => {
  it('une session renouvelee cesse malgre des rotations repetees', async () => {
    const session = await createAuthSession((await creerJoueur('Abs')).id);

    // Chaque rotation repart de +6 h : sans plafond absolu, la session ne meurt
    // JAMAIS. On avance de 5 h par tour, car sauter plus que le TTL de 6 h
    // expirerait la session AVANT qu elle ait pu tourner.
    let token = session.token;
    let rotations = 0;
    let morte = false;

    for (let i = 0; i < 200 && !morte; i += 1) {
      advanceClock(5 * 60 * 60 * 1000);
      let nouveau = null;
      const vivant = getAuthSession(token, { emitToken: (value) => { nouveau = value; } });
      if (!vivant) { morte = true; break; }
      await settle();
      if (nouveau && nouveau !== token) token = nouveau;
      rotations += 1;
    }

    expect(morte, 'une session renouvelee indefiniment doit finir par expirer').toBe(true);

    // Le plafond est de 30 jours, soit ~144 rotations de 5 h. Sans lui, la
    // boucle irait jusqu a 200 et `morte` resterait faux.
    expect(rotations, 'la session doit vivre une trentaine de jours').toBeGreaterThan(135);
    expect(rotations, 'le plafond absolu doit bloquer bien avant 200 tours').toBeLessThanOrEqual(150);
  });

  it('la rotation reste possible avant le plafond', async () => {
    const session = await createAuthSession((await creerJoueur('Ok')).id);
    const nouveau = await rotateOnce(session.token);
    expect(getAuthSession(nouveau)).toBeTruthy();
    // L'ancien reste valable pendant la fenetre de grace.
    expect(getAuthSession(session.token)).toBeTruthy();
  });
});

describe('Faille 3 — la deconnexion supprime toute la chaine', () => {
  it('se deconnecter avec le jeton fils tue aussi la mere', async () => {
    const a = await createAuthSession((await creerJoueur('Chain')).id);
    const b = await rotateOnce(a.token);

    expect(getAuthSession(a.token)).toBeTruthy();
    expect(getAuthSession(b)).toBeTruthy();

    // Cas NORMAL : le navigateur deconnecte avec le cookie COURANT, donc le
    // jeton fils. Avant le correctif, seule la Mere survivait.
    deleteAuthSession(b);
    await settle();

    expect(getAuthSession(b), 'le jeton present doit mourir').toBeNull();
    expect(
      getAuthSession(a.token),
      'la mere doit mourir aussi : sinon un cookie vole survit au logout'
    ).toBeNull();
  });

  it('plusieurs rotations : la deconnexion tue toute la filiation', async () => {
    const a = await createAuthSession((await creerJoueur('Deep')).id);
    const b = await rotateOnce(a.token);
    const c = await rotateOnce(b);

    deleteAuthSession(c);
    await settle();

    expect(getAuthSession(c)).toBeNull();
    expect(getAuthSession(b)).toBeNull();
    expect(getAuthSession(a.token)).toBeNull();
  });
});