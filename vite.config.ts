import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { folvyVersion } from './build/folvyVersionPlugin'
import { guardaVistaPrevia } from './build/guardaVistaPrevia'
import { indexDeMarcas } from './build/indexDeMarca'

export default defineConfig({
  // folvyVersion sella la build: escribe dist/version.json y estampa el id en
  // dist/sw.js. Con eso el service worker cambia de bytes en cada despliegue
  // sin que nadie tenga que acordarse de subir una constante a mano.
  // guardaVistaPrevia para el build de una vista previa conta/** o reparto-**
  // que no vaya contra staging-conta (05/10, la del C02 iba contra producción).
  // indexDeMarcas escribe dist/marcas/<id>/index.html con las metas de cada
  // marca (C06): lo que lee la vista previa de un enlace. El de Folvy no cambia.
  plugins: [react(), folvyVersion(), guardaVistaPrevia(), indexDeMarcas()],
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
    // PC01 · E3 · Dos páginas: la app (index.html) y la de firmar un mandato de
    // domiciliación sin cuenta (mandato.html), que no pasa por la app.
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        mandato: path.resolve(__dirname, 'mandato.html'),
        // PC01 · E4 · La de pagar una factura con tarjeta o Bizum, sin cuenta (pagar.html).
        pagar: path.resolve(__dirname, 'pagar.html'),
        // B01 Revolut · La vuelta de Revolut (/bancos/revolut/vuelta, por vercel.json): devuelve a Bancos.
        revolutVuelta: path.resolve(__dirname, 'revolut-vuelta.html'),
      },
    },
  },
})
