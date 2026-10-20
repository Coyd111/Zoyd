import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

/**
 * Le schema SQL declare-t-il TOUT ce que le code utilise ?
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * `app_users.revision` — la colonne qui porte l'OCC — avait un commentaire
 * 상세 dans `supabase/schema.sql` qui expliquait la colonne, son type, son
 * `NOT NULL DEFAULT 0`, et meme le mecanisme de detection. Mais pas le
 * `ALTER TABLE` qui la cree.
 *
 * Consequence : une base recreee depuis le depot n'avait aucune protection
 * multi-instance. `occSupporte()` aurait renvoie `false`, le serveur serait
 * tombe sur l'ecriture inconditionnelle, et TOUT aurait fonctionne : les
 * tests passaient (ils verifient le CODE, pas le schema), le health etait
 * vert, et la perte d'argent en multi-instance aurait ete invisible.
 *
 * C'est le meme piege que V1 et V6 : un mecanisme ecrit, teste, jamais
 * branche. Ici, jamais relie au schema.
 *
 * Ce test ferme l'ecart : il compare ce que le CODE lit dans la base a ce que
 * le SCHEMA declare. Un ecart ne peut plus se rouvrir en silence.
 *
 * Il ne remplace PAS la verification en production : il garantit que le
 * schema du depot est complet, pas que la base de production l'est. Pour la
 * production, c'est `/api/health` qui repond (cf. `occRevisionColumn`).
 */

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '..');
const lire = (p) => fs.readFileSync(path.join(racine, p), 'utf8');

const schemaSql = lire('supabase/schema.sql');
const persistence = lire('server/persistence.mjs');

/**
 * Colonnes declarees par le schema : CREATE TABLE ... ( ... ) et
 * ALTER TABLE ... ADD COLUMN ... .
 * @returns {Map<string, Set<string>>}
 */
const colonnesDeclarees = () => {
  const tables = new Map();
  const ajouter = (table, colonne) => {
    if (!tables.has(table)) tables.set(table, new Set());
    tables.get(table).add(colonne);
  };

  // CREATE TABLE IF NOT EXISTS <table> ( ... );
  const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\);/gi;
  for (const m of schemaSql.matchAll(create)) {
    const [, table, corps] = m;
    for (const ligne of corps.split('\n')) {
      const colonne = /^\s*(\w+)\s+(TEXT|INTEGER|BIGINT|BOOLEAN|TIMESTAMPTZ|JSONB|NUMERIC|SERIAL)/i.exec(ligne);
      if (colonne) ajouter(table, colonne[1].toLowerCase());
    }
  }

  // ALTER TABLE <table> ADD COLUMN [IF NOT EXISTS] <colonne> <type>;
  const alter = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
  for (const m of schemaSql.matchAll(alter)) ajouter(m[1], m[2].toLowerCase());

  return tables;
};

/**
 * Colonnes que le CODE interroge : `.from('table')` suivi d'un
 * `.select('a,b')` sur la meme chaine.
 * @returns {Map<string, Set<string>>}
 */
const colonnesUtilisees = () => {
  const tables = new Map();
  const ajouter = (table, colonne) => {
    if (!tables.has(table)) tables.set(table, new Set());
    tables.get(table).add(colonne);
  };

  const chaine = /\.from\('(\w+)'\)\s*\n?\s*\.select\('([^']*)'\)/g;
  for (const m of persistence.matchAll(chaine)) {
    const [, table, liste] = m;
    for (const colonne of liste.split(',')) {
      const nom = colonne.trim().toLowerCase();
      // '*' n'est pas une colonne ; les expressions PostgREST ne le sont pas
      // davantage, et on ne sait pas les valider.
      if (!nom || nom === '*' || nom.includes('(') || nom.includes(':')) continue;
      ajouter(table, nom);
    }
  }

  return tables;
};

const declares = colonnesDeclarees();
const utilises = colonnesUtilisees();

describe('Schema SQL — nothing the code reads may be missing', () => {
  it('le schema declare bien des tables', () => {
    expect(declares.size).toBeGreaterThan(10);
  });

  it('chaque table interrogee par le code existe dans le schema', () => {
    const manquantes = [...utilises.keys()].filter((t) => !declares.has(t));
    expect(manquantes, 'tables utilisees par le code mais absentes du schema').toEqual([]);
  });

  it('chaque colonne interrogee par le code existe dans le schema', () => {
    const ecarts = [];
    for (const [table, colonnes] of utilises) {
      const connues = declares.get(table);
      if (!connues) continue;
      for (const colonne of colonnes) {
        if (!connues.has(colonne)) ecarts.push(`${table}.${colonne}`);
      }
    }
    expect(ecarts, 'colonnes lues par le code mais absentes du schema').toEqual([]);
  });

  it("la colonne OCC de app_users est declaree — sans elle, la protection multi-instance est hors service", () => {
    // L'invariant est verifie dans le CODE par `occ-revision-invariant.test.mjs`.
    // Ici on verifie l'autre moitie : que le SCHEMA peut lporter.
    const appUsers = declares.get('app_users');
    expect(appUsers, 'table app_users absente du schema').toBeDefined();
    expect(appUsers.has('revision'), 'app_users.revision absente du schema').toBe(true);
  });

  it('la colonne est NOT NULL DEFAULT 0, sinon les lignes existantes ne sont pas conditionnables', () => {
    expect(schemaSql).toMatch(/ALTER\s+TABLE\s+app_users\s+ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?revision\s+BIGINT\s+NOT\s+NULL\s+DEFAULT\s+0/i);
  });

  it('les colonnes de session que le code lit sont declarees', () => {
    const authSessions = declares.get('auth_sessions');
    expect(authSessions, 'table auth_sessions absente du schema').toBeDefined();
    // `absolute_expires_at` et `supersedes` sont lus par le code de session.
    expect(authSessions.has('absolute_expires_at')).toBe(true);
    expect(authSessions.has('supersedes')).toBe(true);
  });
});
