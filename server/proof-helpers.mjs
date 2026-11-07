/**
 * server/proof-helpers.mjs - Validation des preuves de résultat (anti-XSS).
 *
 * Module FEUILLE : aucun import métier (juste crypto pour le hash).
 * `match-engine.mjs` et `league-engine.mjs` y importent le même filtre :
 * une preuve valide en match MJ doit l'être en ligue BR.
 *
 * INVARIANT : aucune référence ne porte `javascript:`, `vbscript:`,
 *   `data:` non-image, chevrons, ni gestionnaire `on...=`. Le front
 *   accepte « liens ou refs » en texte libre : on coupe court au XSS
 *   stocké, pas à la légitimité de la preuve.
 * INVARIANT : une URL (`://` ou `www.`) doit être en `https`, sans
 *   identifiants (`user:pass@`), sans hôte `localhost`/IP privée/
 *   `*.local`/`*.internal` — sinon le serveur validait un lien de
 *   capture vers l'infrastructure interne (SSRF déguisée si un futur
 *   vérificateur fetch l'URL).
 * INVARIANT : un `data:` URI doit être une image (`png|jpeg|jpg|webp`)
 *   et tient dans la plafond de référence (2000 chars, soit ~1,5 Ko
 *   décodés — un screenshot réel est une URL, pas un data URI).
 * INVARIANT : `normalizeProofRefs` déduplique (ordre préservé) et borne
 *   à 10 : une même référence répétée ne sert pas deux fois.
 * PIEGE : les référeces legacy non-URL (ex. `ref-scoreboard`) restent
 *   acceptées (données historiques). Les durcir casserait les matchs
 *   déjà joués. Seule la forme URL est durcie.
 * PIEGE : `buildProofHash` lie les refs au match (anti-rejeu intra-
 *   match), `buildProofContentHash` lie le contenu seul (rejeu entre
 *   matchs) : ne pas confondre.
 *
 * Invariants détaillés : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

import crypto from 'node:crypto';

export const MAX_PROOF_REF_LENGTH = 2000;
export const MAX_PROOF_REFS = 10;

/** Hôtes jamais légitimes pour une capture d'écran. */
const HOST_DENYLIST = new Set(['localhost', '::1']);

const isPrivateOrLocalHost = (hostname) => {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (HOST_DENYLIST.has(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^(127|10|0)\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  return false;
};

/** Une référence ressemble-t-elle à une URL réseau ? */
const looksLikeUrl = (value) => /:\/\//.test(value) || /^www\./i.test(value);

const isSafeUrl = (trimmed) => {
  const withScheme = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
  if (!/^https:\/\//i.test(withScheme)) return false;
  // Identifiants dans l'URL interdits (`https://user:pass@host/...`).
  if (/@/.test(withScheme.split('/')[2] || '')) return false;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (isPrivateOrLocalHost(url.hostname)) return false;
  return true;
};

const isSafeDataImage = (trimmed) => {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.*)$/i.exec(trimmed);
  if (!m) return false;
  const payload = m[2] || '';
  // Base64 valide et borné par la longueur de la référence (déjà ≤ 2000).
  if (!/^[A-Za-z0-9+/=\s]*$/.test(payload)) return false;
  return true;
};

/**
 * Une référence est-elle sûre à diffuser ?
 * @param {unknown} ref
 * @returns {boolean}
 */
export const isSafeProofRef = (ref) => {
  if (typeof ref !== 'string') return false;
  const trimmed = ref.trim();
  if (!trimmed || trimmed.length > MAX_PROOF_REF_LENGTH) return false;
  if (/^\s*javascript:/i.test(trimmed)) return false;
  if (/^\s*vbscript:/i.test(trimmed)) return false;
  if (/^\s*data:/i.test(trimmed)) return isSafeDataImage(trimmed);
  if (/[<>]/.test(trimmed)) return false;
  if (/\bon\w+\s*=/i.test(trimmed)) return false;
  if (looksLikeUrl(trimmed)) return isSafeUrl(trimmed);
  // Forme legacy (texte libre historique) : acceptée dès qu'elle passe
  // le filtre XSS ci-dessus. La durcir casserait les preuves existantes.
  return true;
};

/**
 * Normalise une liste de refs : trim, filtre XSS, dédup, borne 10.
 * @param {unknown} refs
 * @returns {string[]}
 */
export const normalizeProofRefs = (refs = []) => {
  const arr = Array.isArray(refs) ? refs : [refs];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const value = `${raw ?? ''}`.trim();
    if (!value) continue;
    if (!isSafeProofRef(value)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_PROOF_REFS) break;
  }
  return out;
};

/**
 * Scoreboard et écran final doivent être distincts : une seule image
 * ne peut pas servir les deux preuves.
 * @param {{scoreboard?: string[], finalResult?: string[]}|null|undefined} proofs
 * @returns {boolean}
 */
export const hasDistinctProofs = (proofs) => {
  const sb = Array.isArray(proofs?.scoreboard) ? proofs.scoreboard : [];
  const fr = Array.isArray(proofs?.finalResult) ? proofs.finalResult : [];
  if (sb.length === 0 || fr.length === 0) return false;
  const sbSet = new Set(sb.map((r) => String(r).trim().toLowerCase()));
  return fr.some((r) => !sbSet.has(String(r).trim().toLowerCase()));
};

/**
 * Hash anti-rejeu intra-match (lie match + résultat + refs).
 */
export const buildProofHash = (matchId, winnerTeam, scores, refs) =>
  [String(matchId).toLowerCase(), winnerTeam, scores?.team0 ?? 0, scores?.team1 ?? 0, ...refs.map((ref) => ref.toLowerCase())].join('|');

/**
 * Hash de contenu seul (rejeu entre matchs : même capture réutilisée).
 * @param {string[]} refs
 * @returns {string} hex sha256
 */
export const buildProofContentHash = (refs) => {
  const sorted = [...(Array.isArray(refs) ? refs : [])]
    .map((r) => String(r).trim().toLowerCase())
    .filter(Boolean)
    .sort();
  return crypto.createHash('sha256').update(sorted.join('\n'), 'utf8').digest('hex');
};
