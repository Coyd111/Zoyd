/**
 * walletFunding.ts - demande de recharge liee a une action bloquee.
 *
 * Calcule le montant manquant, construit le lien vers le portefeuille avec
 * le contexte (inscription a un match, creation, entree de tournoi) et
 * relit l'invite au retour.
 *
 * INVARIANT : le `returnTo` est ASSAINI : seul un chemin interne commencant
 * par un seul `/` et commencant par une liste blanche (/mj, /br-league) est
 * accepte. Un `//` ou une URL absolue serait une redirection ouverte.
 * INVARIANT : le montant manquant est `max(0, requis - disponible)`, arrondi
 * a deux decimales. Un negatif proposerait de "deposer" de l'argent.
 * PIEGE : les montants passes dans l'URL sont des INDICATIONS pour
 * l'affichage. Le debit reel est toujours recalcule par le serveur : ne
 * pas faire confiance aux parametres de la query string.
 * PIEGE : `parseFundingPrompt` doit retourner null sur un contexte inconnu
 * ou un montant non fini, et non une invite a moitie vide.
 *
 * Voir aussi : docs/08-frontend.md - section 6 (Les stores Zustand)
 */
export type FundingContext = 'match-join' | 'match-create' | 'tournament-entry';

export interface FundingPrompt {
  context: FundingContext;
  requiredAmount: number;
  neededAmount: number;
  returnTo?: string;
}

const roundAmount = (value: number) => Math.round(value * 100) / 100;

const ALLOWED_RETURN_TO_PREFIXES = ['/mj', '/br-league'];

const sanitizeReturnTo = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  if (!value.startsWith('/') || value.startsWith('//')) return undefined;
  if (!ALLOWED_RETURN_TO_PREFIXES.some((prefix) => value === prefix || value.startsWith(prefix + '/'))) return undefined;
  return value;
};

export const getRequiredTopUp = (requiredAmount: number, availableAmount: number) =>
  roundAmount(Math.max(0, requiredAmount - availableAmount));

export const buildFundingPath = ({
  context,
  requiredAmount,
  availableAmount,
  returnTo,
}: {
  context: FundingContext;
  requiredAmount: number;
  availableAmount: number;
  returnTo?: string;
}) => {
  const params = new URLSearchParams({
    deposit: '1',
    context,
    required: roundAmount(requiredAmount).toString(),
    needed: getRequiredTopUp(requiredAmount, availableAmount).toString(),
  });

  if (returnTo) {
    params.set('returnTo', returnTo);
  }

  return `/wallet?${params.toString()}`;
};

export const parseFundingPrompt = (searchParams: URLSearchParams): FundingPrompt | null => {
  if (searchParams.get('deposit') !== '1') return null;

  const context = searchParams.get('context');
  const requiredAmount = Number(searchParams.get('required'));
  const neededAmount = Number(searchParams.get('needed'));
  const returnTo = sanitizeReturnTo(searchParams.get('returnTo') || undefined);

  if (
    (context !== 'match-join' && context !== 'match-create' && context !== 'tournament-entry') ||
    !Number.isFinite(requiredAmount) ||
    !Number.isFinite(neededAmount)
  ) {
    return null;
  }

  return {
    context,
    requiredAmount: roundAmount(requiredAmount),
    neededAmount: roundAmount(neededAmount),
    returnTo,
  };
};

export const getFundingPromptCopy = (context: FundingContext) => {
  switch (context) {
    case 'match-join':
      return {
        title: 'Ajouter des ZC pour bloquer ton pass de match',
        body: "Une fois le pass chargé, tu peux revenir prendre ta place dans l'équipe choisie.",
        returnLabel: 'Retour au match',
      };
    case 'match-create':
      return {
        title: 'Ajouter des ZC avant de publier cette partie',
        body: "Le créateur engage aussi son pass. Recharge ton portefeuille puis reviens publier ton match.",
        returnLabel: 'Retour à la création',
      };
    case 'tournament-entry':
      return {
        title: 'Ajouter des ZC pour confirmer cette inscription',
        body: "Le pass se bloque dès que ton inscription est validée. Recharge puis reviens finaliser ton entrée.",
        returnLabel: 'Retour au tournoi',
      };
  }
};
