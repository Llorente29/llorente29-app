#!/usr/bin/env bash
# scripts/e2e/por-fichero.sh — las pruebas de un trozo, FICHERO A FICHERO, cada
# uno con la barrera de staging cogida solo mientras corre (V03, respuesta 6,
# 26/10).
#
#   por-fichero.sh <lista> [trozo]
#
# <lista>: un fichero de tests/e2e por línea (lo que da trozos.mjs reparto).
#
# POR QUÉ. Hasta hoy la e2e cogía la barrera de migrar para TODO el job: una
# entera de hora y media dejaba a aplicar-staging-conta esperando 40 min y
# rindiéndose, y mientras esperaba ninguna e2e nueva podía empezar. Ahora:
#   · cada fichero coge la barrera COMPARTIDA (carril.sh barrera-entrar) antes
#     de empezar y la suelta al acabar;
#   · si alguien espera para aplicar, el fichero siguiente espera a que acabe
#     de aplicar (lo apunta) y luego sigue: la aplicación entra entre dos
#     ficheros, nunca en mitad de uno.
#
# CÓMO. El servidor de la app (vite preview) se arranca una vez y lo reusan
# todos (E2E_SERVIDOR_FUERA=1 en playwright.config.ts). Cada fichero deja:
#   · su informe para juntar en blob-report/trozo-<T>-<NNN>.zip (el job
#     «entera» los junta con los de los demás trozos);
#   · sus trazas en test-results/<NNN> (Playwright vacía su carpeta al
#     empezar: con una sola, cada fichero borraría lo del anterior).
# Al final, el informe HTML del trozo con todos (playwright-report) y, en
# $RUNNER_TEMP/por-fichero.tsv y en el resumen del run, cuánto esperó cada
# fichero a la barrera y cuánto tardó.
#
# Sale en rojo si falló algún fichero (o no pudo coger la barrera); sigue con
# los demás igualmente, como haría Playwright con la lista entera.
#
# FUERA DE LA ZONA, EL TIEMPO NO BLOQUEA (Julio, 26/10). En la e2e de un push
# (E2E_ZONA=1), un fichero que no es de la zona del PR (E2E_PROPIAS: la carpeta
# de la rama, las que cambia el PR…; las demás son el juego común y la rápida
# de pantallas) y que falla SOLO por tiempo no pone el trozo en rojo: se apunta
# como aviso en el run y en el resumen, y lo mira la entera de la noche. «Por
# tiempo» es lo que dice Playwright cuando se acaba una espera sin encontrar
# lo que busca: «Test timeout of …», «Timeout … exceeded», «TimeoutError» o
# «element(s) not found». Un fallo que ve otra cosa (un texto distinto, un
# error de la página) bloquea siempre, y en un fichero de la zona, todo bloquea.
set -uo pipefail

LISTA=${1:?uso: por-fichero.sh <lista> [trozo]}
TROZO=${2:-${TROZO:-1}}
AQUI=$(cd "$(dirname "$0")" && pwd)
CARRIL=${CARRIL:-$AQUI/carril.sh}
PLAYWRIGHT=${PLAYWRIGHT:-npx playwright}
SERVIDOR=${E2E_SERVIDOR:-npx vite preview --port 4173 --strictPort --host 127.0.0.1}
URL=${E2E_URL:-http://127.0.0.1:4173}
TSV=${POR_FICHERO_TSV:-${RUNNER_TEMP:-/tmp}/por-fichero.tsv}
RESUMEN=${GITHUB_STEP_SUMMARY:-/dev/null}
CARRIL_DIR=${CARRIL_DIR:-${RUNNER_TEMP:-/tmp}/carril}
export CARRIL_DIR

mapfile -t FICHEROS < <(grep -v '^[[:space:]]*$' "$LISTA")
if [ "${#FICHEROS[@]}" = 0 ]; then echo "A este trozo no le toca ningún fichero."; exit 0; fi

# El servidor, una vez para todos.
SPID=
if [ -z "${E2E_SIN_SERVIDOR:-}" ]; then
  $SERVIDOR > "${RUNNER_TEMP:-/tmp}/servidor.log" 2>&1 &
  SPID=$!
  for _ in $(seq 120); do curl -fsS -o /dev/null "$URL" 2>/dev/null && break; sleep 0.5; done
  curl -fsS -o /dev/null "$URL" || { echo "::error::El servidor de la app no ha arrancado en 60 s:"; cat "${RUNNER_TEMP:-/tmp}/servidor.log"; exit 1; }
fi
# Si se corta a mitad de un fichero (cancelado), la barrera se suelta igual.
DENTRO=0
parar() {
  [ "$DENTRO" = 1 ] && { "$CARRIL" barrera-salir > /dev/null 2>&1 || true; }
  [ -n "$SPID" ] && kill "$SPID" 2>/dev/null || true
}
trap parar EXIT

mkdir -p blob-report test-results
printf 'fichero\tespera_s\tduracion_s\tresultado\n' > "$TSV"
fallos=0 i=0 avisos=0
# ¿Es de la zona del PR? Fuera del push (a mano, la noche) todo es de la zona.
propia() {
  [ "${E2E_ZONA:-0}" = 1 ] || return 0
  local p
  for p in ${E2E_PROPIAS:-}; do { [ "$1" = "$p" ] || [[ "$1" == "$p/"* ]]; } && return 0; done
  return 1
}
POR_TIEMPO='Test timeout of [0-9]+ms exceeded|Timeout [0-9]+ms exceeded|TimeoutError|element\(s\) not found'
# Lo que no es tiempo: otra cosa que se ve y no cuadra (un texto, un número) o un error de la página.
NO_TIEMPO='Expected( string| pattern| value)?: |Received string: |\[error de la página\]'
for f in "${FICHEROS[@]}"; do
  i=$((i + 1)); n=$(printf '%03d' "$i")
  echo "::group::[$i/${#FICHEROS[@]}] $f"
  rm -f "$CARRIL_DIR/barrera.espera"
  if ! BARRERA_QUE="$f" "$CARRIL" barrera-entrar; then
    printf '%s\t%s\t0\tsin barrera\n' "$f" "${CARRIL_BARRERA_MIN:-20}m" >> "$TSV"
    fallos=$((fallos + 1)); echo "::endgroup::"; continue
  fi
  DENTRO=1
  espera=$(cat "$CARRIL_DIR/barrera.espera" 2>/dev/null || echo 0)
  t0=$(date +%s)
  E2E_SERVIDOR_FUERA=1 E2E_SALIDA="test-results/$n" \
    PLAYWRIGHT_BLOB_OUTPUT_FILE="blob-report/trozo-$TROZO-$n.zip" PWTEST_BLOB_DO_NOT_REMOVE=1 \
    $PLAYWRIGHT test "$f" --reporter=list,github,blob 2>&1 | tee "${RUNNER_TEMP:-/tmp}/salida-$n.txt"
  r=${PIPESTATUS[0]}
  "$CARRIL" barrera-salir; DENTRO=0
  dur=$(( $(date +%s) - t0 ))
  salida="${RUNNER_TEMP:-/tmp}/salida-$n.txt"
  if [ "$r" = 0 ]; then res=verde
  elif ! propia "$f" && grep -Eq "$POR_TIEMPO" "$salida" && ! grep -Eq "$NO_TIEMPO" "$salida"; then
    res='por tiempo, fuera de la zona: no bloquea'; avisos=$((avisos + 1))
    echo "::warning title=Fuera de la zona, por tiempo::$f falla por tiempo y no es de la zona del PR: no bloquea fusionar. Lo mira la entera de la noche."
  else res=rojo; fallos=$((fallos + 1)); fi
  printf '%s\t%s\t%s\t%s\n' "$f" "$espera" "$dur" "$res" >> "$TSV"
  echo "::endgroup::"
  echo "[$i/${#FICHEROS[@]}] $f: $res en $dur s (esperó $espera s a la barrera)."
done

# El informe HTML del trozo, con todos los ficheros.
if ls blob-report/*.zip > /dev/null 2>&1; then
  $PLAYWRIGHT merge-reports --reporter html blob-report > /dev/null 2>&1 || echo "::warning::No he podido juntar el informe HTML del trozo."
fi

python3 - "$TSV" <<'PY' | tee -a "$RESUMEN"
import sys, csv
filas = list(csv.DictReader(open(sys.argv[1]), delimiter='\t'))
num = lambda v: int(v) if v.isdigit() else 0
esperas = [num(f['espera_s']) for f in filas]
print(f"### Trozo fichero a fichero: {len(filas)} ficheros, {sum(f['resultado'] == 'verde' for f in filas)} en verde")
fuera = [f['fichero'] for f in filas if f['resultado'].startswith('por tiempo')]
if fuera:
    print()
    print(f"**Por tiempo y fuera de la zona del PR (no bloquean; los mira la entera de la noche):** {', '.join(fuera)}")
print()
print(f"Espera a la barrera (se estaba aplicando algo a staging): total {sum(esperas)} s, la mayor {max(esperas, default=0)} s.")
print()
print('| fichero | espera (s) | tarda (s) | resultado |')
print('|---|---:|---:|---|')
for f in filas:
    print(f"| {f['fichero']} | {f['espera_s']} | {f['duracion_s']} | {f['resultado']} |")
PY

if [ "$fallos" -gt 0 ]; then echo "::error::$fallos de ${#FICHEROS[@]} ficheros en rojo."; exit 1; fi
if [ "$avisos" -gt 0 ]; then echo "$avisos fuera de la zona por tiempo: apuntados, no bloquean."; fi
echo "Los ${#FICHEROS[@]} ficheros en verde."
