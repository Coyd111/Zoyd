import { describe, it, expect } from 'vitest';
import {
  severityForReason,
  recommendedSanction,
  isSanctionActive,
  computeExpiry,
  isSanctionKind,
  DEFAULT_TEMP_BAN_DAYS,
  MAX_TEMP_BAN_DAYS,
} from './moderation.mjs';

/**
 * La severite decide de la sanction recommandee. C'est le coeur de la
 * moderation : une erreur ici, soit elle laisse un harceleur en libertE, soit
 * elle banni un innocent.
 */

describe('severityForReason', () => {
  it('classe les motifs connus', () => {
    expect(severityForReason('harassment')).toBe('grave');
    expect(severityForReason('cheating')).toBe('grave');
    expect(severityForReason('toxic_behavior')).toBe('moyenne');
    expect(severityForReason('no_show')).toBe('legere');
    expect(severityForReason('other')).toBe('a_qualifier');
  });

it('ne fait confiance ni au client ni a l orthographe', () => {
    // Le motif vient du corps de la requete : un joueur peut envoyer
    // n'importe quelle chaine. Toute valeur hors table doit tomber dans
    // `a_qualifier`, qui ne declenche AUCUNE sanction automatique — jamais
    // dans une sanction severe.
    expect(severityForReason('HARCASSMENT')).toBe('a_qualifier');
    expect(severityForReason('harassment; drop table')).toBe('a_qualifier');
    expect(severityForReason('')).toBe('a_qualifier');
    expect(severityForReason(undefined)).toBe('a_qualifier');
    expect(severityForReason(null)).toBe('a_qualifier');
    expect(severityForReason({})).toBe('a_qualifier');
  });

  it('tolere les espaces parasites sans perdre la gravite', () => {
    // Une espace en trop ne doit pas faire tomber un harcellement dans
    // `a_qualifier` : ce serait une voie de contournement dans l autre
    // sens — un joueur craftant son motif pourrait alléger la sanction.
    expect(severityForReason('harassment ')).toBe('grave');
    expect(severityForReason('  cheating  ')).toBe('grave');
  });

  it('ne peut pas degager un bannissement definitif, meme sur un motif grave', () => {
    const inconnu = recommendedSanction(severityForReason('x'));
    const grave = recommendedSanction('grave');
    expect(inconnu.kind).not.toBe('permanent_ban');
    expect(grave.kind).not.toBe('permanent_ban');
  });
});

describe('recommendedSanction', () => {
  it('propose un bannissement COURT sur un motif grave, jamais un definitif', () => {
    // Un definitif se merite par la recidive, constatee par un humain.
    // L'accepter sur un seul signalement laisserait n'importe quel joueur
    // faire bannir un rival en le signalant une fois.
    const rec = recommendedSanction('grave');
    expect(rec.kind).toBe('temporary_ban');
    expect(rec.kind).not.toBe('permanent_ban');
    expect(rec.durationDays).toBe(DEFAULT_TEMP_BAN_DAYS);
  });

  it('propose un avertissement sur une gravite moyenne', () => {
    expect(recommendedSanction('moyenne').kind).toBe('warning');
  });

  it('propose un classement seul sur une gravite legere', () => {
    expect(recommendedSanction('legere').kind).toBe('dismissed');
  });

  it('ne propose rien d automatique a qualifier', () => {
    expect(recommendedSanction('a_qualifier').kind).toBe('dismissed');
  });

  it('a un libelle lisible pour chaque cas', () => {
    for (const s of ['grave', 'moyenne', 'legere', 'a_qualifier']) {
      expect(recommendedSanction(s).label).toBeTruthy();
    }
  });
});

describe('computeExpiry', () => {
  it('ne donne d expiration qu a un bannissement temporaire', () => {
    expect(computeExpiry('warning', 7)).toBeNull();
    expect(computeExpiry('permanent_ban', 7)).toBeNull();
    expect(computeExpiry('dismissed', 7)).toBeNull();
    expect(computeExpiry('temporary_ban', 7)).toBeTruthy();
  });

  it('borne la duree dans les deux sens', () => {
    // Trop long, un « temporaire » deviendrait de fait permanent sans que la
    // trace le dise ; trop court, la sanction serait experee avant d etre
    // lue.
    const tropLong = new Date(computeExpiry('temporary_ban', 9999)).getTime();
    const plafond = Date.now() + MAX_TEMP_BAN_DAYS * 86400000 + 5000;
    expect(tropLong).toBeLessThanOrEqual(plafond);

    const tropCourt = new Date(computeExpiry('temporary_ban', 0)).getTime();
    expect(tropCourt).toBeGreaterThan(Date.now());
  });

  it('utilise la duree par defaut si aucune n est fournie', () => {
    const d = new Date(computeExpiry('temporary_ban')).getTime();
    const attendu = Date.now() + DEFAULT_TEMP_BAN_DAYS * 86400000;
    expect(Math.abs(d - attendu)).toBeLessThan(5000);
  });
});

describe('isSanctionActive', () => {
  const base = { kind: 'temporary_ban', issuedAt: '2026-01-01T00:00:00.000Z' };

  it('une sanction sans echeance ni levee est active', () => {
    expect(isSanctionActive({ ...base, kind: 'permanent_ban' })).toBe(true);
  });

  it('une sanction levee n est plus active', () => {
    expect(
      isSanctionActive({ ...base, revokedAt: '2026-01-02T00:00:00.000Z' })
    ).toBe(false);
  });

  it('une sanction echue cesse DE SEULE, sans tache de fond', () => {
    // C est ce qui evite qu un joueur reste banni parce que le nettoyage n a
    // pas tourne, ou soit de nouveau libre parce qu il l a.
    const echue = { ...base, expiresAt: '2026-01-02T00:00:00.000Z' };
    expect(isSanctionActive(echue, Date.parse('2026-01-01T12:00:00.000Z'))).toBe(true);
    expect(isSanctionActive(echue, Date.parse('2026-01-03T00:00:00.000Z'))).toBe(false);
  });

  it('une levee prime sur une echeance future', () => {
    const sanction = {
      ...base,
      expiresAt: '2027-01-01T00:00:00.000Z',
      revokedAt: '2026-01-02T00:00:00.000Z',
    };
    expect(isSanctionActive(sanction, Date.parse('2026-06-01T00:00:00.000Z'))).toBe(false);
  });

  it('ne leve pas sur une entree absente', () => {
    expect(isSanctionActive(null)).toBe(false);
    expect(isSanctionActive(undefined)).toBe(false);
  });
});

describe('isSanctionKind', () => {
  it('accepte les quatre resolutions de la file', () => {
    expect(isSanctionKind('warning')).toBe(true);
    expect(isSanctionKind('temporary_ban')).toBe(true);
    expect(isSanctionKind('permanent_ban')).toBe(true);
    expect(isSanctionKind('dismissed')).toBe(true);
  });

  it('refuse tout ce qui n est pas dans la liste', () => {
    // Un `resolution` libre coming du client appliquerait une sanction
    // inexistante, ou contournerait la liste en écrivant un statut arbitraire.
    for (const invalide of ['', 'ban', 'PERMANENT_BAN', 'delete', null, undefined, 1, {}]) {
      expect(isSanctionKind(invalide)).toBe(false);
    }
  });
});