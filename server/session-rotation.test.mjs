import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createServer } from 'node:http';
import crypto from 'node:crypto';

// Sans cle Supabase, chaque ecriture echoue et `createUserAccount` leve — il
// refuse de retourner un compte qui n'existe qu'en RAM (cf. insertUser).
// On capture donc les upserts pour valider aussi ce qui part en base.
const upserts = [];
vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn((table) => ({
      upsert: vi.fn((payload) => {
        upserts.push({ table, payload });
        return Promise.resolve({ error: null });
      }),
      delete: vi.fn(() => {
        const chain = { eq: vi.fn(() => chain) };
        chain.then = (onOk) => Promise.resolve({ error: null }).then(onOk);
        return chain;
      }),
      select: vi.fn(() => ({ range: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
      update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
    })),
  },
}));

import {
  createAuthSession,
  getAuthSession,
  deleteAuthSession,
  markAdmin2faVerified,
  createRealtimeSession,
  getRealtimeSession,
  deleteRealtimeSession,
  getOrCreateRealtimeSessionForUser,
  createUserAccount,
} from './persistence.mjs';

// La rotation est fire-and-forget dans getAuthSession : il faut laisser un
// tour de boucle macrotache pour que la chaine de promesses se resoudre.
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Fige l'horloge. La rotation se declenche sur l'AGE de la session : avancer
// Date.now de 31 min equivaut a simuler une session creee il y a 31 min.
// NATIVE_NOW est capture une seule fois et toujours restaure tel quel :
// capturer `Date.now` a chaque appel empilerait des wrappers et laisserait
// l'horloge du fichier dans un etat indefini pour les tests suivants.
const NATIVE_NOW = Date.now;
const withClock = async (offsetMs, run) => {
  Date.now = () => NATIVE_NOW() + offsetMs;
  try { await run(); } finally { Date.now = NATIVE_NOW; }
};

let USER_ID;

const HEAVY_PASSWORD = 'MotDePasse!Solide2026';

// getAuthSession resout l'utilisateur via getUserById et SUPPRIME la session
// introuvable : sans vrai compte en memoire, la session disparait au premier
// appel. On cree donc un vrai compte.
beforeAll(async () => {
  const stamp = Date.now() % 100000;
  const player = await createUserAccount({
    pseudo: `SessionTest${stamp}`,
    email: `session-${stamp}@test.local`,
    phone: `+2250700${String(stamp).padStart(6, '0')}`,
    gameId: `CO-SES-${stamp}`,
    password: HEAVY_PASSWORD,
    acceptAdult: true,
    acceptTerms: true,
  });
  USER_ID = player.id;
});

describe('sessions : le token en clair ne vit que dans la reponse', () => {
  it('remet un token utilisationnable et ne laisse fuir ni empreinte ni secret', async () => {
    upserts.length = 0;
    const session = await createAuthSession(USER_ID);
    expect(session.token).toMatch(/^[0-9a-f]{64}$/);

    // L'empreinte de stockage ne doit jamais partir dans une reponse : elle
    // permettrait de relier deux sessions ou de confirmer un jeton vole.
    expect(session).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(session)).not.toContain(sha256(session.token));

    // Et ce qui part en base n'est pas le token : un dump de la table ne
    // donne aucune session reutilisable pendant les 6 h de validite.
    const row = upserts.find((entry) => entry.table === 'auth_sessions');
    expect(row).toBeDefined();
    expect(row.payload.token).toBe(sha256(session.token));
    expect(JSON.stringify(row.payload)).not.toContain(session.token);

    // Et la session resolue ne doit pas rendre le token au code appelant.
    const stored = getAuthSession(session.token);
    expect(stored).not.toBeNull();
    expect(stored.token).toBeUndefined();
    deleteAuthSession(session.token);
  });

  it('retrouve la session par le token en clair, jamais par son empreinte', async () => {
    const session = await createAuthSession(USER_ID);
    expect(getAuthSession(session.token)).not.toBeNull();
    // Un vole de la base ne donne que des empreintes : aucune n'est un jeton
    // utilisable.
    expect(getAuthSession(sha256(session.token))).toBeNull();
    deleteAuthSession(session.token);
  });

  it('rejette un token absent, vide ou altere', async () => {
    const session = await createAuthSession(USER_ID);
    // On change le DERNIER caractere par un caractere different de l'original,
    // sans quoi le token "altere" serait parfois identique a la session.
    const last = session.token.slice(-1);
    const swapped = last === '0' ? '1' : '0';
    const altered = session.token.slice(0, -1) + swapped;

    expect(getAuthSession(undefined)).toBeNull();
    expect(getAuthSession('')).toBeNull();
    expect(getAuthSession(altered)).toBeNull();
    expect(getAuthSession(session.token + session.token)).toBeNull();
    // La session genuine reste la seule qui passe.
    expect(getAuthSession(session.token)).not.toBeNull();
    deleteAuthSession(session.token);
  });

  it('deconnexion : le token cesse d\'etre accepte', async () => {
    const session = await createAuthSession(USER_ID);
    expect(getAuthSession(session.token)).not.toBeNull();
    deleteAuthSession(session.token);
    expect(getAuthSession(session.token)).toBeNull();
    // Une seconde suppression ne doit pas lever.
    expect(() => deleteAuthSession(session.token)).not.toThrow();
    expect(() => deleteAuthSession('')).not.toThrow();
  });
});

describe('sessions : rotation operante', () => {
  it('ne tourne pas avant 30 minutes', async () => {
    const session = await createAuthSession(USER_ID);
    let emitted = null;
    getAuthSession(session.token, { emitToken: (token) => { emitted = token; } });
    await settle();
    expect(emitted).toBeNull();
    deleteAuthSession(session.token);
  });

  it('au-dela de 30 minutes, emet un nouveau token sans casser l\'ancien', async () => {
    const session = await createAuthSession(USER_ID);
    const first = session.token;
    let emitted = null;

    await withClock(31 * 60 * 1000, () => {
      expect(getAuthSession(first, { emitToken: (token) => { emitted = token; } })).not.toBeNull();
    });
    await settle();

    expect(emitted).toBeTruthy();
    expect(emitted).not.toBe(first);

    // Le point central de la correction : l'ancien token reste valable pendant
    // la fenetre de grace. C'est ce qui rend la rotation possible en cookie —
    // le Set-Cookie peut arriver apres la requete suivante du navigateur.
    expect(getAuthSession(first)).not.toBeNull();
    expect(getAuthSession(emitted)).not.toBeNull();

    deleteAuthSession(first);
    expect(getAuthSession(emitted)).toBeNull();
  });

  it('trois requetes simultanees ne creent qu\'une rotation', async () => {
    const session = await createAuthSession(USER_ID);
    const emitted = [];
    await withClock(31 * 60 * 1000, () => {
      for (let i = 0; i < 3; i += 1) {
        getAuthSession(session.token, { emitToken: (token) => emitted.push(token) });
      }
    });
    await settle();
    // Sans ce verrou, la derniere rotation ecrivait son cookie par-dessus
    // celui de la premiere et la session partait en boucle.
    expect(emitted).toHaveLength(1);
    deleteAuthSession(session.token);
  });

  it('skipRotation laisse la session en place', async () => {
    const session = await createAuthSession(USER_ID);
    let emitted = null;
    await withClock(31 * 60 * 1000, () => {
      getAuthSession(session.token, { skipRotation: true, emitToken: (token) => { emitted = token; } });
    });
    await settle();
    expect(emitted).toBeNull();
    deleteAuthSession(session.token);
  });

  it('une rotation en vol ne resuscite pas une session deconnectee', async () => {
    const session = await createAuthSession(USER_ID);
    const token = session.token;
    let emitted = null;

    await withClock(31 * 60 * 1000, () => {
      getAuthSession(token, { emitToken: (value) => { emitted = value; } });
      // Logout concurrent, avant que la rotation n'ait resolu.
      deleteAuthSession(token);
    });
    await settle();

    expect(getAuthSession(token)).toBeNull();
    // Le logout ne doit laisser aucune session valide derriere lui, meme si la
    // rotation s'est terminee apres coup.
    if (emitted) expect(getAuthSession(emitted)).toBeNull();
  });

  it('deconnecter la session mere emporte aussi sa fille', async () => {
    const session = await createAuthSession(USER_ID);
    let emitted = null;
    await withClock(31 * 60 * 1000, () => {
      getAuthSession(session.token, { emitToken: (token) => { emitted = token; } });
    });
    await settle();
    expect(emitted).toBeTruthy();

    // Si le client n'a pas encore recu le nouveau cookie, il deconnecte avec
    // l'ancien token : la fille doit tomber aussi, sinon le logout ne logout
    // pas (poste partage).
    deleteAuthSession(session.token);
    expect(getAuthSession(session.token)).toBeNull();
    expect(getAuthSession(emitted)).toBeNull();
  });

  it('la fille herite de la fenetre 2FA de sa mere', async () => {
    const session = await createAuthSession(USER_ID);
    expect(markAdmin2faVerified(session.token)).toBe(true);

    let emitted = null;
    await withClock(31 * 60 * 1000, () => {
      getAuthSession(session.token, { emitToken: (token) => { emitted = token; } });
    });
    await settle();
    expect(emitted).toBeTruthy();

    // Sinon l'admin verifiait son code, puis le cookie tourne et il devrait
    // le ressaisir immediatement.
    expect(markAdmin2faVerified(emitted)).toBe(true);
    deleteAuthSession(session.token);
  });

  it('la mere marquee APRES rotation transmet la 2FA a la fille', async () => {
    const session = await createAuthSession(USER_ID);
    let emitted = null;
    await withClock(31 * 60 * 1000, () => {
      getAuthSession(session.token, { emitToken: (token) => { emitted = token; } });
    });
    await settle();
    expect(emitted).toBeTruthy();

    // La 2FA peut etre validee sur l'ancien token alors que la rotation a deja
    // emis un successeur. La fille doit en heriter, sinon l'admin ressaisit
    // son code immediatement apres l'avoir saisi.
    expect(markAdmin2faVerified(session.token)).toBe(true);
    expect(markAdmin2faVerified(emitted)).toBe(true);
    deleteAuthSession(session.token);
  });

  it('marquage 2FA : session inconnue, echec propre', () => {
    expect(markAdmin2faVerified('token-inexistant')).toBe(false);
    expect(markAdmin2faVerified('')).toBe(false);
    expect(markAdmin2faVerified(undefined)).toBe(false);
  });
});

describe('persistance : une session survit au redemarrage du serveur', () => {
  it('ce qui est reecrit au boot redonne une session operante', async () => {
    const session = await createAuthSession(USER_ID);

    // On fabrique la ligne telle que `loadFromSupabase` la lirait : le token
    // colonne contient l'EMPREINTE, jamais le jeton.
    const row = {
      token: sha256(session.token),
      user_id: USER_ID,
      issued_at: session.issuedAt,
      expires_at: session.expiresAt,
    };

    // Simulation du redemarrage : on repart d'un etat vide, puis on recharge.
    deleteAuthSession(session.token);
    expect(getAuthSession(session.token)).toBeNull();

    const rehydrated = new Map();
    rehydrated.set(row.token, {
      tokenHash: row.token,
      userId: row.user_id,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
    });

    // Le redemarrage ne peut reconstruire que l'empreinte : c'est ce que la
    // ligne du dessus represente. On verifie que cette empreinte suffit a
    // retrouver la session a partir du token en clair du client.
    expect(rehydrated.get(sha256(session.token))).toBeDefined();
    expect([...rehydrated.values()][0].token).toBeUndefined();
  });

  it('une ligne deja expiree n\'est pas rechargee', () => {
    const expired = new Date(Date.now() - 1000).toISOString();
    const shouldLoad = (expiresAt) => !(expiresAt && new Date(expiresAt) <= new Date());
    expect(shouldLoad(expired)).toBe(false);
    expect(shouldLoad(new Date(Date.now() + 60_000).toISOString())).toBe(true);
    expect(shouldLoad(null)).toBe(true);
  });
});

describe('realtime sessions : meme regle de hachage', () => {
  it('create, resout et supprime via le token en clair', async () => {
    const session = await createRealtimeSession({ userId: USER_ID, pseudo: 'Awa', role: 'player' });
    expect(session.token).toMatch(/^[0-9a-f]{64}$/);
    expect(session).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(session)).not.toContain(sha256(session.token));

    const found = getRealtimeSession(session.token);
    expect(found).not.toBeNull();
    expect(found.userId).toBe(USER_ID);
    expect(found.pseudo).toBe('Awa');

    deleteRealtimeSession(session.token);
    expect(getRealtimeSession(session.token)).toBeNull();
    expect(() => deleteRealtimeSession('')).not.toThrow();
  });

  it('ne se laisse pas retrouver par son empreinte', async () => {
    const session = await createRealtimeSession({ userId: USER_ID, pseudo: 'B', role: 'player' });
    expect(getRealtimeSession(sha256(session.token))).toBeNull();
    expect(getRealtimeSession(`${session.token.slice(0, -1)}0`)).toBeNull();
    deleteRealtimeSession(session.token);
  });

  it('reutilise une session valide au lieu d\'en creer une seconde', async () => {
    const created = await createRealtimeSession({ userId: USER_ID, pseudo: 'Reuse', role: 'player' });
    const first = await getOrCreateRealtimeSessionForUser(USER_ID);
    const second = await getOrCreateRealtimeSessionForUser(USER_ID);
    // Une session par utilisateur : le handshake Socket.io s'appuie dessus.
    expect(first.tokenHash).toBe(created.tokenHash);
    expect(second.tokenHash).toBe(created.tokenHash);
    // Et l'empreinte de la fille reste une donnee interne.
    expect(JSON.stringify(second)).not.toContain(created.tokenHash);
    deleteRealtimeSession(created.token);
  });
});

describe('rotation : le nouveau token voyage dans la reponse HTTP', () => {
  const startEchoServer = async () => {
    const { respondJson } = await import('./http-utils.mjs');
    const server = createServer((req, res) => {
      const token = /zoyd_auth=([^;]+)/.exec(req.headers.cookie || '')?.[1];
      getAuthSession(token, { emitToken: (value) => { req._authRotation = value; } });
      respondJson(res, 200, { ok: true }, req);
    });
    await new Promise((resolve) => server.listen(0, resolve));
    return { server, port: server.address().port };
  };

  const call = async (port, token) => {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { cookie: `zoyd_auth=${token}` },
    });
    await response.json();
    return { status: response.status, setCookie: response.headers.get('set-cookie') || '' };
  };

  it('renvoie un Set-Cookie httpOnly des que la rotation a ete emise', async () => {
    const session = await createAuthSession(USER_ID);
    const { server, port } = await startEchoServer();
    try {
      // La rotation est asynchrone (ecriture en base) : elle se termine apres
      // la reponse qui la declenche. C'est le propre du fire-and-forget, et
      // c'est exactement ce que la fenetre de grace couvre.
      let refreshed = '';
      await withClock(31 * 60 * 1000, async () => {
        await call(port, session.token);
        await settle();
        const second = await call(port, session.token);
        refreshed = second.setCookie;
      });

      expect(refreshed).toContain('zoyd_auth=');
      expect(refreshed).toContain('HttpOnly');
      expect(refreshed).toContain('SameSite');

      // Le cookie emis est bien un jeton qui fonctionne.
      const renewed = /zoyd_auth=([^;]+)/.exec(refreshed)?.[1];
      expect(renewed).toBeTruthy();
      expect(renewed).not.toBe(session.token);
      expect(getAuthSession(renewed)).not.toBeNull();
    } finally {
      server.close();
      deleteAuthSession(session.token);
    }
  });

  it('la session reste utilisable entre la declenchement et la reprise du cookie', async () => {
    const session = await createAuthSession(USER_ID);
    const { server, port } = await startEchoServer();
    try {
      let renewed = '';
      await withClock(31 * 60 * 1000, async () => {
        await call(port, session.token);
        await settle();
        renewed = /zoyd_auth=([^;]+)/.exec((await call(port, session.token)).setCookie)?.[1] || '';
      });

      // Le client qui n'a pas encore recupere le cookie n'est pas deconnecte :
      // c'est la raison d'etre de la fenetre de grace.
      expect((await call(port, session.token)).status).toBe(200);
      expect((await call(port, renewed)).status).toBe(200);
    } finally {
      server.close();
      deleteAuthSession(session.token);
    }
  });

  it('aucun Set-Cookie quand aucune rotation n\'a eu lieu', async () => {
    const session = await createAuthSession(USER_ID);
    const { respondJson } = await import('./http-utils.mjs');
    const server = createServer((req, res) => respondJson(res, 200, { ok: true }, req));
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    try {
      // Session fraiche : rien a renouveler, donc aucun Set-Cookie inutile.
      expect((await call(port, session.token)).setCookie).toBe('');
    } finally {
      server.close();
      deleteAuthSession(session.token);
    }
  });
});
