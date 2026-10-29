import { describe, it, expect } from 'vitest';
import { CHAT_BOOTSTRAP_RETRY_DELAYS_MS, chatBootstrapFailurePlan } from './useChatSessionBootstrap';

/**
 * Audit-4 C2 : la file de retentatives du bootstrap chat. L'environnement
 * de test est node (jsdom non installe, voir vitest.config) : la hook
 * lui-meme n est pas rendu ; ce qui est verrouille ici, c'est POLICY — la
 * sequence de delais et le passage au signal — alignee sur le miroir
 * useWalletSessionBootstrap.
 */
describe('useChatSessionBootstrap — policy de retentatives (audit-4 C2)', () => {
  it('la liste de delais reste le miroir du bootstrap wallet', () => {
    expect(CHAT_BOOTSTRAP_RETRY_DELAYS_MS).toEqual([2000, 5000, 10000, 20000]);
  });

  it('retente apres chaque delai, dans l ordre, sans signal', () => {
    expect(chatBootstrapFailurePlan(0)).toEqual({ retry: true, delayMs: 2000, signal: false });
    expect(chatBootstrapFailurePlan(1)).toEqual({ retry: true, delayMs: 5000, signal: false });
    expect(chatBootstrapFailurePlan(2)).toEqual({ retry: true, delayMs: 10000, signal: false });
    expect(chatBootstrapFailurePlan(3)).toEqual({ retry: true, delayMs: 20000, signal: false });
  });

  it('epuisee la file : le SIGNAL remplace la purge du store', () => {
    expect(chatBootstrapFailurePlan(4)).toEqual({ retry: false, delayMs: 0, signal: true });
    expect(chatBootstrapFailurePlan(99)).toEqual({ retry: false, delayMs: 0, signal: true });
  });

  it('le repli couvre le cold-start Render (30-60 s de reveil)', () => {
    // La tentative initiale timeout a 30 s ; 2 s + 5 s + 10 s de repli
    // suffisent au serveur pour se reveiller dans la majorite des cas.
    const totalBackoff = CHAT_BOOTSTRAP_RETRY_DELAYS_MS.slice(0, -1).reduce((a, b) => a + b, 0);
    expect(totalBackoff).toBeGreaterThanOrEqual(15000);
  });
});
