import { call, type Actor } from '../../api/support/harness';

/**
 * Les DONNEES dont l audit UI a besoin.
 *
 * Pourquoi un module partage
 * --------------------------
 * L audit mesure un ECREEN rendu. Or plusieurs ecrans n ont de contenu que
 * si des donnees existent : la liste des salons BR est vide sur un serveur
 * neuf, le detail d un match affiche « introuvable », le detail d un
 * tournoi affiche « introuvable ».
 *
 * On pourrait s en remettre aux autres specs (un salon cree par une autre
 * serie...). C est exactement ce qui est arrive : l audit de `/br` ne
 * signalait un contraste fautif QUE si une autre serie avait cree un
 * salon AVANT, dans le meme processus. La couverture dependait donc de
 * l ORDRE d execution - un audit qui depend de l ordre n est pas un audit.
 *
 * Chaque fixture cree donc ses donnees, et l audit mesure TOUJOURS le meme
 * etat.
 */

const DANS_24H = () => new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString();

const BR_PAYOUT = {
  first: 0.4,
  second: 0.22,
  third: 0.15,
  fourth: 0.12,
  fifth: 0.08,
  arbiterRate: 0.03,
};

const MATCH_RULES = { mode: 'battle_royale', map: 'Nuketown', scoreTarget: 10, bestOf: 3 };
const TOURNAMENT_RULES = { mode: 'S&D', mapPool: ['Raid', 'Standoff'], scoreTarget: 7, bestOf: 1 };

const echec = (quoi: string, res: { status: number; body: unknown }) => {
  throw new Error(`${quoi} -> ${res.status} ${JSON.stringify(res.body)}`);
};

/** Un salon BR (l createur est l arbitre : il ne paie aucun pass). */
export const creerSalonBr = async (acteur: Actor, nom = 'Salon audit UI'): Promise<string> => {
  const res = await call(acteur, 'POST', '/api/br/lobbies', {
    name: nom,
    mode: 'solo',
    map: 'isolated',
    entryFee: 50,
    scheduledAt: DANS_24H(),
    payout: BR_PAYOUT,
  });
  if (res.status !== 201) echec('creation du salon BR', res);
  return String(res.body.lobby.id);
};

/** Un match 1VS1 en recrutement. */
export const creerMatch = async (acteur: Actor): Promise<string> => {
  const res = await call(acteur, 'POST', '/api/matches', {
    format: '1VS1',
    entryFee: 100,
    rules: MATCH_RULES,
    visibility: 'public',
  });
  if (res.status !== 201) echec('creation du match', res);
  return String(res.body.match.id);
};

/** Un tournoi 2VS2 en recrutement. */
export const creerTournoi = async (acteur: Actor): Promise<string> => {
  const res = await call(acteur, 'POST', '/api/tournaments', {
    name: 'Tournoi audit UI',
    format: '2VS2',
    entryFee: 100,
    maxEntries: 2,
    rules: TOURNAMENT_RULES,
    reserveCreatorAsArbiter: true,
  });
  if (res.status !== 201) echec('creation du tournoi', res);
  return String(res.body.tournament.id);
};

/** Une saison de ligue BR (creation reservee a l admin). */
export const creerSaisonLigue = async (admin: Actor): Promise<string> => {
  const res = await call(admin, 'POST', '/api/leagues', {});
  if (res.status !== 201) echec('creation de la saison', res);
  return String(res.body.season.id);
};
