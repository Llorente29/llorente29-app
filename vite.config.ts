import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { folvyVersion } from './build/folvyVersionPlugin'
import { guardaVistaPrevia } from './build/guardaVistaPrevia'

export default defineConfig({
  // folvyVersion sella la build: escribe dist/version.json y estampa el id en
  // dist/sw.js. Con eso el service worker cambia de bytes en cada despliegue
  // sin que nadie tenga que acordarse de subir una constante a mano.
  // guardaVistaPrevia para el build de una vista previa conta/** o reparto-**
  // que no vaya contra staging-conta (05/10, la del C02 iba contra producción).
  plugins: [react(), folvyVersion(), guardaVistaPrevia()],
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
