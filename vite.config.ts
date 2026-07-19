import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Compatibilidad con navegadores antiguos (Sunmi T2 / Android 7.1 y tablets viejas):
    // transpila la sintaxis moderna a un nivel que esos Chrome sí entienden.
    // Si el build fallara mencionando "top-level await", subir a 'es2022'.
    target: 'es2020',
  },
})
