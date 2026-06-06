import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    // Core frontend plugins kept explicitly because the app relies on both.
    react(),
    tailwindcss(),
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
      '/api/realtime': {
        target: 'http://localhost:4001',
      },
      '/api/auth': {
        target: 'http://localhost:4001',
      },
      '/api/wallet': {
        target: 'http://localhost:4001',
      },
      '/api/matches': {
        target: 'http://localhost:4001',
      },
      '/api/admin': {
        target: 'http://localhost:4001',
      },
    },
  },
  build: {
    // Windows can keep copied CODM bundles locked inside dist between builds.
    // Reusing the output directory avoids EBUSY cleanup failures while still
    // refreshing the current hashed bundles referenced by index.html.
    emptyOutDir: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|react-router)/.test(id)) {
            return 'vendor-react'
          }
          if (/node_modules\/(zustand|motion|use-sync-external-store)/.test(id)) {
            return 'vendor-state'
          }
          if (/node_modules\/lucide/.test(id)) {
            return 'vendor-icons'
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
