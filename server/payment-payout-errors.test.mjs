import { describe, it, expect, vi, beforeEach } from 'vitest';

// On rejoue la forme EXACTE des erreurs du SDK fedapay : `ApiConnectionError`
// porte `httpStatus`, `httpResponse.data`, et surtout `errorMessage` / `errors`
// — que nous lisions tous les deux, et qui contenaient la seule information
// utile : la raison du refus de FedaPay.
vi.mock('fedapay', () => {
  class FakePayout {
    id = 0;
    status = 'pending';
    static create = vi.fn();
    sendNow = vi.fn();
  }
  return {
    FedaPay: { apiKey: '', setApiKey: vi.fn(), setEnvironment: vi.fn(), getEnvironment: () => 'sandbox' },
    Transaction: { retrieve: vi.fn() },
    Payout: FakePayout,
  };
});

vi.mock('./supabase.mjs', () => ({
  supabase: { from: vi.fn(() => ({
    select: vi.fn(() => ({ range: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
    upsert: vi.fn(() => Promise.resolve({ error: null })),
  })) },
}));

import { initiateFedaPayPayout, extraireErreurFedaPay } from './payment-engine.mjs';
import { Payout } from 'fedapay';

/** Reproduit l'erreur du SDK : message axios generique + vraie raison a part. */
const apiError = (status, body) => Object.assign(
  new Error(`Request failed with status code: ${status}`),
  {
    httpStatus: status,
    httpResponse: { status, data: body },
    errorMessage: body?.message,
    errors: body?.errors,
  },
);

beforeEach(() => {
  vi.clearAllMocks();
  // La cle est lue a chaque appel : une valeur factice suffit, et evite que
  // le test echoue en PAYMENT_NOT_CONFIGURED avant d'atteindre FedaPay.
  process.env.FEDAPAY_SECRET_KEY = 'sk_test_factice_pour_tests_unitaires';
});

describe('extraction de la raison FedaPay', () => {
  it('lit errorMessage, la que le SDK la depose', () => {
    // C'est exactement ce que nous lisions mal : `message` ne dit rien,
    // `errorMessage` contient la reponse du prestataire.
    const r = extraireErreurFedaPay(apiError(403, { message: 'Payout not authorized' }));
    expect(r.status).toBe(403);
    expect(r.raison).toBe('Payout not authorized');
  });

  it('retombe sur le corps brut si errorMessage manque', () => {
    const r = extraireErreurFedaPay({ httpStatus: 500, httpResponse: { data: { message: 'boom' } } });
    expect(r.raison).toBe('boom');
  });

  it('liste le detail par champ', () => {
    const r = extraireErreurFedaPay(apiError(400, {
      message: 'Invalid',
      errors: [{ field: 'amount', message: 'trop grand' }],
    }));
    expect(r.details).toEqual(['trop grand']);
  });

  it('ne leve pas sur une erreur sans corps', () => {
    const r = extraireErreurFedaPay(new Error('reseau coupe'));
    expect(r.raison).toBe('');
    expect(r.status).toBeNull();
  });
});

describe('refus 403 : un compte marchand non autorise aux retraits', () => {
  // 403 n'est PAS dans la liste documentee par FedaPay (400/401/404/500).
  // C'est un refus d'AUTORISATION. Comme le depot fonctionne, la cle est
  // valide : le compte n'est pas autorise a emettre des transferts. Aucun
  // correctif de code ne peut lever ce verrou.
  it('remonte un message qui nomme la cause et l\'etape', async () => {
    Payout.create.mockRejectedValue(apiError(403, { message: 'Payouts are not enabled for this account' }));

    await expect(initiateFedaPayPayout({
      amountZC: 200, method: 'Moov Money', country: 'bj',
      phone: '+2290165240654', userPseudo: 'CA', merchantReference: 'WDR-1',
    })).rejects.toMatchObject({
      code: 'PAYOUT_FAILED',
      message: expect.stringContaining('403'),
    });
  });

  it('distingue la creation de l\'envoi', async () => {
    Payout.create.mockResolvedValue({ id: 7, status: 'pending', sendNow: vi.fn().mockRejectedValue(apiError(403, { message: 'refused' })) });
    await expect(initiateFedaPayPayout({
      amountZC: 200, method: 'MTN MoMo', country: 'bj',
      phone: '+2290165240654', userPseudo: 'CA', merchantReference: 'WDR-2',
    })).rejects.toThrow(/envoi/i);
  });

  it('une 401 parle de la cle, pas du compte', async () => {
    Payout.create.mockRejectedValue(apiError(401, { message: 'Invalid API key' }));
    await expect(initiateFedaPayPayout({
      amountZC: 200, method: 'MTN MoMo', country: 'bj',
      phone: '+2290165240654', userPseudo: 'CA', merchantReference: 'WDR-3',
    })).rejects.toThrow(/Clé FedaPay/i);
  });

  it('une erreur de paiement garde le motif du prestataire', async () => {
    Payout.create.mockRejectedValue(apiError(400, { message: 'Invalid phone number', errors: [{ field: 'phone_number', message: 'invalide' }] }));
    await expect(initiateFedaPayPayout({
      amountZC: 200, method: 'MTN MoMo', country: 'bj',
      phone: '+2290165240654', userPseudo: 'CA', merchantReference: 'WDR-4',
    })).rejects.toThrow(/Invalid phone number/);
  });
});

describe('payout reussi', () => {
  it('renvoie payoutId et statut', async () => {
    Payout.create.mockResolvedValue({ id: 42, status: 'pending', sendNow: vi.fn().mockResolvedValue(undefined) });
    const r = await initiateFedaPayPayout({
      amountZC: 200, method: 'MTN MoMo', country: 'bj',
      phone: '+2290165240654', userPseudo: 'CA', merchantReference: 'WDR-5',
    });
    expect(r).toMatchObject({ success: true, payoutId: 42 });
  });

  it('refuse un numero invalide AVANT d\'appeler FedaPay', async () => {
    await expect(initiateFedaPayPayout({
      amountZC: 200, method: 'MTN MoMo', country: 'bj',
      phone: '+22901', userPseudo: 'CA',
    })).rejects.toThrow(/Num/);
    expect(Payout.create).not.toHaveBeenCalled();
  });
});