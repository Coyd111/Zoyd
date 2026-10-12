import { describe, it, expect, beforeEach, vi } from 'vitest';
import { purgeSessionStores, setSessionPurgeHandler } from './sessionPurge';

/**
 * Le registre de purge remplace l'import dynamique de `sessionReset`.
 *
 * Risque ACCEPTÉ quand on a retiré l'import dynamique : si l'enregistrement
 * n'a pas lieu, `purgeSessionStores()` ne fait RIEN, et le solde, les matchs,
 * le chat et les amis du compte précédent restent visibles pour le joueur qui
 * se connecte ensuite. Un test qui vérifie seulement « ça ne jette pas » ne
 * prouverait rien : il faut prouver que la purge appelle EFFECTIVEMENT le
 * gestionnaire, et qu'elle reste synchrone.
 */
describe('registre de purge de session', () => {
  let calls: number;

  beforeEach(() => {
    calls = 0;
    setSessionPurgeHandler(() => {
      calls += 1;
    });
  });

  it('appelle bien le gestionnaire enregistre', () => {
    purgeSessionStores();
    expect(calls).toBe(1);
  });

  it('est synchrone : la purge a eu lieu AVANT le retour', () => {
    // Une purge asynchrone ouvrirait une fenêtre où une reconnexion
    // rapide ecrirait ses propres donnees avant que l'ancienne session soit
    // effacee.
    purgeSessionStores();
    expect(calls).toBe(1);
  });

  it('ne jette pas quand aucun gestionnaire n est branche', () => {
    setSessionPurgeHandler(null);
    expect(() => purgeSessionStores()).not.toThrow();
  });

  it('absorbe une purge ratee sans masquer l erreur d origine', () => {
    // Le declencheur est un 401 : une exception ici remonterait dans le
    // `catch` de la requete et masquerait la vraie cause.
    setSessionPurgeHandler(() => {
      throw new Error('store indisponible');
    });
    expect(() => purgeSessionStores()).not.toThrow();
  });

  it('accepte de desenregistrer', () => {
    setSessionPurgeHandler(null);
    purgeSessionStores();
    expect(calls).toBe(0);
  });
});

describe('branche applicative de la purge', () => {
  it('useAuthSessionBootstrap enregistre la vraie purge', async () => {
    // `resetModules` donne un graphe de modules neuf : il faut importer le
    // registre ET le hook DANS ce graphe. Importer le registre en haut de
    // fichier donnerait une autre instance que celle dans laquelle le hook
    // s'enregistre — le test passerait ou échouerait pour la mauvaise
    // raison.
    vi.resetModules();
    const purge = await import('./sessionPurge');
    purge.setSessionPurgeHandler(null);

    await import('../hooks/useAuthSessionBootstrap');
    const { useWalletStore } = await import('../stores/walletStore');

    // Le solde du compte précédent : c'est LA donnée qui ne doit jamais
    // survivre à un changement de compte. (`resetAllSessionStores` ne touche
    // pas l'auth — c'est le rôle de `logout()`.)
    useWalletStore.setState({ cashBalance: 999, bonusBalance: 42, lockedBalance: 7 });
    expect(useWalletStore.getState().cashBalance).toBe(999);

    // Si l'enregistrement n'avait pas eu lieu, ce purgeSessionStores() ne
    // ferait RIEN et le solde fantome resterait visible.
    purge.purgeSessionStores();

    const apres = useWalletStore.getState();
    expect(apres.cashBalance).toBe(0);
    expect(apres.bonusBalance).toBe(0);
    expect(apres.lockedBalance).toBe(0);
  });
});