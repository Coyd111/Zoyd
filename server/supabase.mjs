/**
 * server/supabase.mjs - Fabrique l'unique client Supabase du serveur (role
 * service_role), utilise par la couche de persistance.
 *
 * Charge `.env.server`, choisit la cle de service, et expose `supabase` -
 * soit le client, soit `null` en mode degrade / mode memoire.
 *
 * INVARIANT : seule une cle `service_role` est acceptee
 *   (SUPABASE_SERVICE_KEY ou SUPABASE_SERVICE_ROLE_KEY). Le code ecrit en
 *   contournant les RLS : avec une cle anon, chaque ecriture echouerait
 *   derriere un client qui se dit pourtant actif, et l'argent cesserait d'etre
 *   persiste sans la moindre alerte.
 * INVARIANT : `supabase` vaut `null` - et ne leve jamais - quand la base est
 *   indisponible : `persistence.mjs` bascule alors en mode memoire.
 * INVARIANT : `ZOYD_DISABLE_SUPABASE=true` l'emporte sur la presence des
 *   variables : `.env.server` est charge meme en mode memoire, donc l'absence
 *   d'URL ne prouve rien et la suite E2E tournerait contre le reseau.
 * INVARIANT : le client est cree sans session persistee ni rafraichissement
 *   automatique : c'est un client de service, pas un client utilisateur.
 * PIEGE : `dotenv.config()` REECRIT les variables du process avec le contenu
 *   de `.env.server` : vider SUPABASE_URL dans le process ne suffit pas a
 *   isoler les tests, d'ou ZOYD_DISABLE_SUPABASE.
 * PIEGE : une table manquante n'echoue pas ici : elle ressort plus tard
 *   "relation does not exist" dans les journaux (ex. `user_reports`).
 * PIEGE : l'import a des effets de bord (lecture du .env, ouverture d'une
 *   connexion) : ce module ne doit pas etre importe par un script de test
 *   qui veut rester hors ligne.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

// Supabase client — Primary database
// Uses service_role key for server-side operations (bypasses RLS)

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './logger.mjs';

const log = createLogger('supabase');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.server') });

const supabaseUrl = process.env.SUPABASE_URL;
// SUPABASE_SERVICE_ROLE_KEY est le nom documente dans DEPLOYMENT.md et celui
// utilise par le dashboard Supabase. SUPABASE_SERVICE_KEY est aussi accepte
// (c-est le nom dans render.yaml) pour retro-compatibilite : sans cela, un
// deploiement configure selon la doc se retrouvait en mode degrade
// (supabase = null) et perdait toute persistance.
//
// PAS de repli sur SUPABASE_ANON_KEY : ce code est concu pour ecrire avec le
// role service_role, qui contourne les RLS. Avec une cle anon, chaque
// ecriture echoue derriere un client qui se dit pourtant actif, et
// l argent cesse d etre persiste sans la moindre alerte.
//
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

// Opt-out explicite : la suite E2E doit démarrer en mode MÉMOIRE, sinon elle
// dépend du réseau et des données de Supabase. `dotenv.config()` recharge
// .env.server et écrase les variables vides du process, donc vider
// SUPABASE_URL ne suffisait pas à isoler les tests.
const supabaseDisabled = process.env.ZOYD_DISABLE_SUPABASE === 'true';

let supabase = null;

if (supabaseDisabled) {
  log.warn('ZOYD_DISABLE_SUPABASE=true — mode memoire (tests E2E)');
} else if (supabaseUrl && supabaseKey) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    log.info('Client actif');
  } catch (err) {
    log.error('Erreur creation client', err);
    supabase = null;
  }
} else {
  log.warn('Variables SUPABASE_URL/SUPABASE_SERVICE_KEY absentes — mode degrade');
}

export { supabase };
