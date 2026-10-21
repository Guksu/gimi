import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // 개발 서버 — /api를 server(4000)로 넘긴다
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:4000', rewrite: (path) => path.replace(/^\/api/, '') } } },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    env: { VITE_API_BASE: 'http://api.test' },
  },
})
