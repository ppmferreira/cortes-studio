import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Em desenvolvimento (npm run dev) as chamadas vão para o FastAPI na porta 8765.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8765',
      '/media': 'http://127.0.0.1:8765',
    },
  },
})
