// vitest.config.ts
//
// Configuración Vitest para Foodint.
//
// Decisiones:
//   - environment: 'node' por defecto (tests unitarios puros, más rápido).
//     Para tests que necesiten DOM (componentes React, Fase 1+), añadir
//     `// @vitest-environment jsdom` en la primera línea del archivo.
//   - globals: true → permite usar describe/it/expect sin import.
//   - alias `@/` apunta a src/ (coherente con el resto del proyecto).
//   - coverage v8 (más rápido que istanbul, instalado aparte como devDep).
//   - include: solo tests bajo tests/. No buscar en src/.
//
// Nota sobre Vite 8: si vitest da warning de peer-dep, no es bloqueante;
// los tests deberían correr igual mientras vitest no use APIs de Vite
// removidas. Si peta de verdad, mira CHANGELOG de vitest para la versión
// compatible con Vite 8.

import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules', 'dist', '.git'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.d.ts',
        'src/types/database.ts', // autogenerado, no testeamos
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
})
