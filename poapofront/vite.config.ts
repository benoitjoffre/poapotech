import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@poapo/types": fileURLToPath(new URL("../poapo-types/src/index.ts", import.meta.url)) },
  },
  server: {
    proxy: {
      '/api': process.env.POAPO_API_PROXY ?? 'http://localhost:5050',
    },
  },
})
