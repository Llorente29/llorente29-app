#!/usr/bin/env bash
# scripts/conta/antes-de-subir.sh
#
# La cadena antes de cualquier push de la rama de contabilidad (respuesta 4
# del C00). PARA AL PRIMER FALLO: `set -euo pipefail` hace que un lint, una
# unitaria o un build en rojo corte aquí, y el push de detrás no se ejecuta.
# Se usa así, y solo así:
#
#   scripts/conta/antes-de-subir.sh && git push origin <rama>
#
# Por qué existe: el 03/10 se subió con dos unitarias en rojo porque los
# comandos iban encadenados con «;» y la cadena siguió.
#
# Las e2e no pueden correr aquí (necesitan staging-conta y sus secretos):
# corren en GitHub Actions (e2e-staging-conta.yml), cada paso con
# `set -euo pipefail`, y las capturas solo se suben si TODAS pasan
# (`if: success()`). Un push no está bien hasta que ese run sale verde.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

paso() { printf '\n── %s ──\n' "$1"; }

paso '1/5 · lint del módulo (cero problemas)'
npx eslint --max-warnings 0 src/modules/conta tests/unit/modules/conta tests/conta tests/e2e/conta scripts/conta

paso '2/5 · valores de serie idénticos a sus fuentes'
node scripts/conta/serie.mjs comprobar
node scripts/conta/codigos-postales.mjs comprobar
node scripts/conta/plan.mjs comprobar

paso '3/5 · unitarias y de cumplimiento'
npx vitest run

paso '4/5 · las e2e cargan (se ejecutan en Actions)'
npx playwright test --list > /dev/null

paso '5/5 · npm run build exacto y en limpio'
find . -name '*.tsbuildinfo' -not -path './node_modules/*' -delete
npm run build

printf '\nTodo en verde: se puede subir.\n'
