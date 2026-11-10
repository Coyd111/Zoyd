/**
 * Prechauffage du serveur de developpement Vite.
 *
 * Playwright attend seulement que le PORT réponde. Or Vite ne fait le gros du
 * travail qu'a la PREMIERE requete : esbuild pre-bundle les dependances, puis
 * transforme les modules un par un. Sur un disque lent, tout ce temps etait paye
 * par le premier `page.goto` de la suite, qui echouait en "Timeout" sans qu'une
 * seule assertion n'ait ete evaluee : un test rouge pour une raison etrangere a
 * ce qu'il teste.
 *
 * On demande donc l'entry point AVANT que les tests ne demarrent : le
 * pre-bundling se fait ici, une fois, et chaque test recoit un serveur chaud.
 *
 * Echec tolere : si Vite ne repond pas, on ne bloque pas la suite. Le serveur
 * demarre quand meme, et les tests attendront simplement plus longtemps.
 */

const DEV_URL = process.env.ZOYD_DEV_URL || 'http://localhost:5173';

// L'entry point est ce que charge index.html : c'est cette requete qui
// declenche le pre-bundling. `/` sert seulement d'attente serveur.
const WARMUP_PATHS = [
  { path: '/', attempts: 90 },
  { path: '/src/main.tsx', attempts: 20 },
];

const warm = async (url, attempts, delayMs) => {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await response.arrayBuffer();
        return true;
      }
    } catch {
      // Serveur pas encore pret : on retente.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
};

export default async function globalSetup() {
  for (const { path, attempts } of WARMUP_PATHS) {
    await warm(`${DEV_URL}${path}`, attempts, 1000);
  }
}