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
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

function excludeHeavyPublicDirs(dirs: string[]) {
  return {
    name: 'exclude-heavy-public-dirs',
    closeBundle() {
      const distPublic = path.resolve(__dirname, 'dist', 'assets', 'codm');
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
      '@': path.resolve(__dirname, './src'),
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
      external: ['pg', 'socket.io', 'web-push', 'dotenv', 'fedapay', '@supabase/supabase-js'],
      output: {
        manualChunks(id: string) {
          if (/node_modules\/(react|react-dom|react-router)/.test(id)) {
            return 'vendor-react'
          }
          if (/node_modules\/zustand/.test(id)) {
            return 'vendor-state'
          }
          if (/node_modules\/(motion|framer)/.test(id)) {
            return 'vendor-motion'
          }
          if (/node_modules\/lucide/.test(id)) {
            return 'vendor-icons'
          }
          if (/node_modules\/recharts/.test(id)) {
            return 'vendor-charts'
          }
        },
      },
    },
    chunkSizeWarningLimit: 400,
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
