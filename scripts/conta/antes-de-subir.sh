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

paso '1/9 · lint del módulo (cero problemas)'
npx eslint --max-warnings 0 src/modules/conta tests/unit/modules/conta tests/conta tests/e2e/conta scripts/conta

paso '2/9 · valores de serie idénticos a sus fuentes'
node scripts/conta/serie.mjs comprobar
node scripts/conta/codigos-postales.mjs comprobar
node scripts/conta/plan.mjs comprobar
node scripts/conta/cuentas-anuales.mjs comprobar

paso '3/9 · unitarias y de cumplimiento'
npx vitest run

paso '4/9 · front compatible con lo que borra la tanda de producción (W01)'
# Lo que supabase/produccion/aplicar.txt borra o renombra no puede leerlo ni el
# front publicado (origin/main) ni el de este commit: primero se deja de leer,
# después se borra.
git rev-parse --verify -q origin/main > /dev/null || { echo 'Falta origin/main: git fetch origin main'; exit 1; }
node scripts/conta/produccion/analizar.mjs front-compatible

paso '5/9 · las e2e cargan (se ejecutan en Actions)'
npx playwright test --list > /dev/null

paso '6/9 · npm run build exacto y en limpio'
find . -name '*.tsbuildinfo' -not -path './node_modules/*' -delete
npm run build

paso '7/9 · SQL: el fichero entero y como usuario (C04b R7); la tanda cuenta y no deja huecos (R9)'
node scripts/conta/antes-de-subir-sql.mjs

paso '8/9 · la tanda de producción, analizada contra el contexto REAL de producción (R11)'
# Antes de dar datos de lanzamiento a Julio: el analizador con el contexto real,
# medido para ESTOS ficheros. Si uno cambió desde la medida, para: se vuelve a
# medir. La salida (con --informe, entera) va debajo de los datos de Julio.
node scripts/conta/produccion/analisis-tanda-viva.mjs

paso '9/9 · los workflows que leen producción o Diez solo sacan números y huellas (D01 R2)'
# El 13/10 el run 60 sacó en su resumen —público— nombres de proveedores y de
# personas. Un workflow nuevo o tocado que lee producción o Diez pasa toda su
# salida por scripts/conta/salida-segura.mjs o la manda a un fichero.
node scripts/conta/workflows-salida.mjs

printf '\nTodo en verde: se puede subir.\n'
