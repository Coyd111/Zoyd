export type FundingContext = 'match-join' | 'match-create' | 'tournament-entry';

export interface FundingPrompt {
  context: FundingContext;
  requiredAmount: number;
  neededAmount: number;
  returnTo?: string;
}

const roundAmount = (value: number) => Math.round(value * 100) / 100;

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
  const returnTo = searchParams.get('returnTo') || undefined;

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
        title: 'Ajoute des ZC pour bloquer ton pass de match',
        body: "Une fois le pass charge, tu peux revenir prendre ta place dans l'equipe choisie.",
        returnLabel: 'Retour au match',
      };
    case 'match-create':
      return {
        title: 'Ajoute des ZC avant de publier cette partie',
        body: "Le createur engage aussi son pass. Recharge ton wallet puis reviens publier ton match.",
        returnLabel: 'Retour a la creation',
      };
    case 'tournament-entry':
      return {
        title: 'Ajoute des ZC pour confirmer cette inscription',
        body: "Le pass se bloque des que ton inscription est validee. Recharge puis reviens finaliser ton entree.",
        returnLabel: 'Retour au tournoi',
      };
  }
};
