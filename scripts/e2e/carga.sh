#!/usr/bin/env bash
# scripts/e2e/carga.sh — cuánto aprieta la e2e a staging-conta (W02, paso 1c).
#
#   carga.sh empezar   una muestra cada 5 s, en segundo plano, a $CARGA_DIR/carga.csv
#   carga.sh acabar    para y resume (al resumen del run si hay GITHUB_STEP_SUMMARY)
#
# Una sola conexión (\watch), solo lee. Por muestra: hora, consultas activas
# (sin contar los pg_sleep de los guardianes ni esta), conexiones de clientes,
# transacciones hechas (acumulado) y milisegundos de ejecución de consultas
# (pg_stat_statements, acumulado, sin pg_sleep). De ahí sale la OCUPACIÓN: ms
# de ejecución por cada segundo de reloj. 1000 = una consulta trabajando todo
# el rato; la Micro tiene 2 núcleos compartidos y 60 conexiones.
set -euo pipefail
PSQL=${PSQL:-/usr/lib/postgresql/17/bin/psql}
CARGA_DIR=${CARGA_DIR:-${RUNNER_TEMP:-/tmp}/carga}
: "${DB_URL:?Falta DB_URL}"
mkdir -p "$CARGA_DIR"

empezar() {
  cat > "$CARGA_DIR/muestra.sql" <<'SQL'
set application_name = 'e2e-carga';
select to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS'),
       (select count(*) from pg_stat_activity where backend_type = 'client backend' and state = 'active'
          and pid <> pg_backend_pid() and query not ilike '%pg_sleep%'),
       (select count(*) from pg_stat_activity where backend_type = 'client backend'),
       (select xact_commit + xact_rollback from pg_stat_database where datname = current_database()),
       (select round(sum(total_exec_time)) from pg_stat_statements where query not ilike '%pg_sleep%')
\watch 5
SQL
  "$PSQL" "$DB_URL" -X -q -A -t -F ',' -f "$CARGA_DIR/muestra.sql" > "$CARGA_DIR/carga.csv" 2> "$CARGA_DIR/carga.err" &
  echo $! > "$CARGA_DIR/carga.pid"
  echo "Midiendo la carga de staging cada 5 s."
}

acabar() {
  [ -s "$CARGA_DIR/carga.pid" ] && kill "$(cat "$CARGA_DIR/carga.pid")" 2>/dev/null || true
  python3 - "$CARGA_DIR/carga.csv" "${1:-}" <<'PY' | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
import sys, statistics as st
from datetime import datetime as D
filas = []
for l in open(sys.argv[1]):
    p = l.strip().split(',')
    if len(p) == 5 and p[0][:2] == '20':
        filas.append((D.fromisoformat(p[0]), int(p[1]), int(p[2]), int(p[3]), float(p[4] or 0)))
desde = sys.argv[2] if len(sys.argv) > 2 else ''
if desde:
    filas = [f for f in filas if f[0].isoformat() >= desde] or filas
if len(filas) < 3:
    print('Carga: menos de tres muestras, nada que resumir.'); sys.exit(0)
ocup, tps = [], []
for a, b in zip(filas, filas[1:]):
    s = (b[0] - a[0]).total_seconds()
    if s > 0 and b[4] >= a[4] and b[3] >= a[3]:
        ocup.append((b[4] - a[4]) / s); tps.append((b[3] - a[3]) / s)
act = [f[1] for f in filas]; con = [f[2] for f in filas]
p95 = lambda xs: sorted(xs)[int(0.95 * (len(xs) - 1))]
print(f"### Carga de staging-conta ({len(filas)} muestras, {filas[0][0]:%H:%M:%S}–{filas[-1][0]:%H:%M:%S} UTC)\n")
print('| | mediana | p95 | máximo |'); print('|---|---:|---:|---:|')
print(f'| consultas trabajando a la vez | {st.median(act):.0f} | {p95(act)} | {max(act)} |')
print(f'| conexiones (de 60) | {st.median(con):.0f} | {p95(con)} | {max(con)} |')
print(f'| ocupación (ms de consulta por s) | {st.median(ocup):.0f} | {p95(ocup):.0f} | {max(ocup):.0f} |')
print(f'| transacciones por s | {st.median(tps):.0f} | {p95(tps):.0f} | {max(tps):.0f} |')
PY
}

case "${1:-}" in
  empezar) empezar ;;
  acabar) acabar "${2:-}" ;;
  *) echo "uso: carga.sh empezar|acabar [desde ISO]" >&2; exit 2 ;;
esac
