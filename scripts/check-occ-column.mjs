/**
 * Verification V9 : la colonne `app_users.revision` existe-t-elle VRAIMENT
 * dans la base de production ?
 *
 * Le depot ne contient aucun SQL qui ajoute cette colonne. Si elle n existe
 * pas, toute la protection OCC (multi-instance) est hors service en
 * production — et le code ne le signalerait nulle part.
 *
 * Verification par introspection du catalogue : on interroge
 * `information_schema.columns` via le client Supabase du projet.
 */
import { supabase } from '../server/supabase.mjs';

if (!supabase) {
  console.log('RESULTAT: client Supabase indisponible — verification impossible depuis ici');
  process.exit(2);
}

const requete = async (table) => {
  const { data, error } = await supabase.from(table).select('*').limit(1);
  if (error) return { error: error.message };
  return { columns: data && data[0] ? Object.keys(data[0]) : [] };
};

console.log('=== V9 : introspection de la base de production ===');

const appUsers = await requete('app_users');
if (appUsers.error) {
  console.log(`  app_users : ERREUR ${appUsers.error}`);
} else {
  console.log(`  app_users : ${appUsers.columns.length} colonne(s) lue(s) sur un enregistrement`);
  const aRevision = appUsers.columns.includes('revision');
  console.log(`  -> colonne "revision" : ${aRevision ? 'PRESENTE' : 'ABSENTE'}`);
  console.log(`  colonnes : ${appUsers.columns.join(', ')}`);
}

for (const t of ['state_snapshots', 'auth_sessions', 'wallets']) {
  const r = await requete(t);
  if (r.error) {
    console.log(`  ${t} : ERREUR ${r.error}`);
  } else {
    const aRev = r.columns.includes('revision');
    console.log(`  ${t} : ${r.columns.length} colonne(s)${aRev ? ' — "revision" presente' : ' — pas de "revision"'}`);
  }
}

process.exit(0);
