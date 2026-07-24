import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Mensaje compartido de la regla anti-footgun de formateo numérico.
const NO_TOFIXED_MSG =
  'No uses .toFixed() directo sobre datos del servidor: revienta si el valor es null ' +
  '(isFinite(null) === true no lo atrapa). Usa los helpers null-safe de src/lib/format.ts ' +
  '(fmtNum/fmtMoney/fmtQty/fmtPct). Si es un cálculo LOCAL garantizado no-null, ' +
  'añade // eslint-disable-next-line no-restricted-syntax con una nota del porqué.'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Anti-footgun: obliga a canalizar el formateo por src/lib/format.ts.
      // 'warn' durante la migración (hay usos legítimos aún sin migrar); subir a
      // 'error' cuando el barrido termine.
      'no-restricted-syntax': [
        'warn',
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message: NO_TOFIXED_MSG,
        },
      ],
    },
  },
  {
    // Formateadores sancionados: son EL sitio donde toFixed vive legítimamente.
    files: ['src/lib/format.ts', 'src/modules/kds/kdsUtils.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
])
