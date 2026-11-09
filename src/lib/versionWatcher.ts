/**
 * versionWatcher - détecte un nouveau déploiement et recharge en silence.
 *
 * Poll /version.json (no-store) toutes les 60 s + au retour de focus/onglet
 * visible. Si le buildId distant diffère du bundle en mémoire, on recharge
 * avant que l'utilisateur ne clique une route lazy dont le chunk a disparu
 * (écran « UNE MISE À JOUR EST ARRIVÉE »).
 *
 * Garde-fous :
 * - jamais pendant la saisie (input/textarea/select focusé) : le formulaire
 *   en cours est reporté au prochain tick ;
 * - jamais deux fois pour le même build (sessionStorage) ni si l'URL porte
 *   déjà __zoyd_reload = le build cible.
 */
import { CURRENT_BUILD_ID, reloadWithFreshBuild } from "./buildVersion";

const VERSION_URL = "/version.json";
const POLL_MS = 60_000;
const NOTIFIED_KEY = (buildId: string) => `zoyd_build_notified_${buildId}`;

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

async function checkForNewBuild(): Promise<void> {
  let remote: string | null = null;
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!res.ok) return;
    const json = (await res.json()) as { buildId?: unknown };
    if (typeof json.buildId === "string" && json.buildId) remote = json.buildId;
  } catch {
    return; // hors-ligne / CDN : on réessaiera au prochain tick.
  }
  if (!remote || remote === CURRENT_BUILD_ID || CURRENT_BUILD_ID === "dev") return;

  const url = new URL(window.location.href);
  if (url.searchParams.get("__zoyd_reload") === CURRENT_BUILD_ID) return;
  if (sessionStorage.getItem(NOTIFIED_KEY(remote))) return;

  // En pleine saisie (ex. formulaire /mj/creer) : on diffère, on ne casse pas.
  if (isTyping()) return;

  sessionStorage.setItem(NOTIFIED_KEY(remote), "1");
  reloadWithFreshBuild();
}

export function startVersionWatcher(): void {
  if (typeof window === "undefined") return;
  // Premier contrôle léger dès le chargement (après le premier rendu).
  window.setTimeout(() => void checkForNewBuild(), 8_000);
  window.setInterval(() => void checkForNewBuild(), POLL_MS);

  const onVisible = () => {
    if (document.visibilityState === "visible") void checkForNewBuild();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
}
