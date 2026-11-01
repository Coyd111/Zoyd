import { defineConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id: string) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(import.meta.dirname, 'src/assets', filename)
      }
    },
  }
}

function excludeHeavyPublicDirs(dirs: string[]) {
  return {
    name: 'exclude-heavy-public-dirs',
    closeBundle() {
      const distPublic = path.resolve(import.meta.dirname, 'dist', 'assets', 'codm');
      for (const dir of dirs) {
        const target = path.join(distPublic, dir);
        if (fs.existsSync(target)) {
          fs.rmSync(target, { recursive: true, force: true });
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    react(),
    tailwindcss(),
    excludeHeavyPublicDirs(['raw_unity']),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://localhost:4001',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:4001',
      },
    },
  },
  optimizeDeps: {
    exclude: ['zustand/middleware'],
  },
  build: {
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      // `pg` a été retiré : il n'est importe nulle part dans le projet.
      external: ['socket.io', 'web-push', 'dotenv', 'fedapay', '@supabase/supabase-js'],
      output: {
        // Decoupe NATIVE rolldown 1.2.x — `manualChunks` (fonction) et
        // `advancedChunks` sont depriques, et l'experience S-4 (audit prod
        // 2026-11-01) a montre que la variante fonctionnelle etait PARTIELLEMENT
        // ignoree pour les modules partages : le coeur de React
        // (react/index.js, core react-dom, jsx-runtime), react-is, le shim
        // use-sync-external-store et clsx restaient condenses DANS
        // vendor-charts par le chunking automatique, donc l'entree, apiClient
        // et ~38 chunks importaient statiquement ~380 modules de graphiques
        // rien que pour disposer des hooks React.
        //
        // Semantique `codeSplitting.groups` : les groupes sont traites DANS
        // L'ORDRE, et `includeDependenciesRecursively` (defaut vrai) fait
        // qu'un groupe AVALISE AUSSI les dependances de ses modules captures.
        // Ordonnancement critique : le micro-groupe vendor-utils DOIT
        // preceder vendor-charts, sinon rolldown, en absorbant la cour de
        // recharts, vole clsx (dependance de recharts) au groupe
        // vendor-utils. Regex sans ancre (match de sous-chaine) pour
        // survivre aux chemins .pnpm de l'install Vercel.
        // VERIFICATION apres chaque montee de recharts/react :
        //   node node_modules/vite/bin/vite.js build --sourcemap
        //   puis grep 'from"./vendor-charts' dans dist/assets/*.js
        //   (attendu : chunks EarningsCharts/EarningsDashboard uniquement).
        codeSplitting: {
          groups: [
            {
              // PREMIER groupe : `clsx` est aussi une dependance de recharts ;
              // si ce groupe n'est pas evalue avant vendor-charts,
              // includeDependenciesRecursively fait capter clsx par
              // vendor-charts et l'entree redevient statiquement dependante
              // du paquet de graphiques (regression S-4 observee).
              name: 'vendor-utils',
              test: /node_modules\/(clsx\/|tailwind-merge\/)/,
            },
            {
              // react CORE + jsx-runtime + react-dom (core ET /client) +
              // scheduler + l'ecosysteme router/formulaire/helmet qui vit avec.
              name: 'vendor-react',
              test: /node_modules\/(react\/|react-dom\/|react-router\/|react-helmet-async\/|react-hook-form\/|react-fast-compare\/|shallowequal\/|invariant\/|scheduler\/)/,
            },
            {
              // zustand et le shim use-sync-external-store reclame par
              // react-redux : reste hors du chemin statique de l'entree.
              name: 'vendor-state',
              test: /node_modules\/(zustand\/|use-sync-external-store\/)/,
            },
            {
              // recharts et TOUTE sa cour : d3-*, redux, immer, es-toolkit...
              // SANS react ni react-is (isoles dans vendor-react/vendor-charts
              // ci-dessus). Ne doit etre atteignable QUE depuis le lazy
              // EarningsCharts.
              name: 'vendor-charts',
              test: /node_modules\/(recharts\/|@reduxjs\/|redux\/|redux-thunk\/|reselect\/|immer\/|eventemitter3\/|internmap\/|decimal\.js-light\/|tiny-invariant\/|victory-vendor\/|es-toolkit\/|react-redux\/|react-is\/|d3-[a-z-]+\/)/,
            },
            {
              name: 'vendor-motion',
              test: /node_modules\/(motion\/|framer\/)/,
            },
            {
              name: 'vendor-icons',
              test: /node_modules\/lucide(-[a-z]+)?\//,
            },
          ],
        },
      },
    },
    chunkSizeWarningLimit: 400,
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
