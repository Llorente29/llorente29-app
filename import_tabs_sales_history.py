#!/usr/bin/env python3
# import_tabs_sales_history.py
#
# Importa el historico de ventas exportado de Tabs (tabs-report-0..11.csv,
# 12 x 5.000 pedidos brutos) a sales_history_daily via el RPC
# load_sales_history_batch. Agrega por (local, dia) ANTES de escribir -- no
# crea una fila por pedido, una por dia por local.
#
# Reglas de negocio (validadas por Julio contra los 60.000 pedidos brutos):
#   - Dedup por (Ubicacion, Codigo, Factura n., Hora de creacion).
#   - Ubicacion -> location_id. Alcala aparece con 4 nombres historicos
#     (CloudTown fue renombrando el local varias veces); todos mapean al
#     mismo location_id real.
#   - Productos: sustituir \n y \t por comas, luego extraer con
#     regex (\d+)\s*x\s*([^,]+) cada par cantidad/nombre.
#   - Clasificacion por palabras clave sobre el nombre: bebida / postre /
#     resto = plato. Sin heuristica extra -- son las reglas ya validadas
#     contra el checkpoint de abajo, no las reinventamos aqui.
#   - No se filtra nada por volumen: hay 14 pedidos tipo catering de hasta
#     189 unidades (0,02% de los pedidos) que son ventas reales.
#
# Checkpoint esperado (dado por Julio, ya validado):
#   2.345 filas agregadas * 173.590 platos * 8.552 bebidas * 1.963 postres
#   * rango 2023-02-01 -> 2026-08-08
# El script aborta si no coincide EXACTO, en vez de cargar un numero que
# nadie ha verificado.
#
# Aviso: el CSV de abril 2026 corta el dia 18 (mes incompleto en el export
# de Tabs) -- no es un bug de este script, es el propio dato de origen. No
# usar abril 2026 para calcular medias diarias o indices.
#
# Uso:
#   python import_tabs_sales_history.py               # dry-run: procesa y verifica el checkpoint, NO escribe nada
#   python import_tabs_sales_history.py --run          # + llama a load_sales_history_batch (requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY)
#
# Variable opcional TABS_CSV_DIR para apuntar a otra carpeta con los 12 CSV.

import csv
import glob
import json
import os
import re
import sys
import urllib.error
import urllib.request

CSV_DIR = os.environ.get("TABS_CSV_DIR", r"C:\Users\jgcol\OneDrive\Escritorio\kk")
RUN = "--run" in sys.argv
BATCH_SIZE = 800

# Ubicacion (texto exacto del export de Tabs) -> location_id real en Folvy.
LOCATION_MAP = {
    "CloudTown (Florencio) PD": "38158159-cd71-4056-950b-53425afac1ce",
    "CloudTown (Foodint Alcala antes Florencio) PD": "38158159-cd71-4056-950b-53425afac1ce",
    "CloudTown (Foodint Alcala antes Florencio Llorente) PD": "38158159-cd71-4056-950b-53425afac1ce",
    "CloudTown (Foodint Ensanche antes Florencio) PD": "38158159-cd71-4056-950b-53425afac1ce",
    "Cloudtown (Carabanchef-Madrid) PD": "92d7656e-082e-452a-8ebc-236b2d6ebf5f",
    "Cloudtown (Foodint - Plaza Castilla) PD": "629f9154-b888-48ed-9b8c-ffae77620615",
}
# load_sales_history_batch espera una letra por local, no el uuid completo.
LOC_CODE = {
    "38158159-cd71-4056-950b-53425afac1ce": "A",
    "92d7656e-082e-452a-8ebc-236b2d6ebf5f": "C",
    "629f9154-b888-48ed-9b8c-ffae77620615": "P",
}

PRODUCT_RE = re.compile(r"(\d+)\s*x\s*([^,]+)")
BEBIDA_RE = re.compile(
    r"coca|cola|agua|refresco|cerveza|fanta|sprite|nestea|aquarius|zumo|batido|"
    r"bebida|lata|botella|kas|7up|estrella|mahou|heineken|corona|red bull|monster|limonada",
    re.I,
)
POSTRE_RE = re.compile(
    r"postre|tarta|brownie|cheesecake|helado|cookie|galleta|donut|dona|flan|"
    r"tiramis|churro|crepe|gofre|natillas",
    re.I,
)

CHECKPOINT = {
    "filas": 2345, "dishes": 173590, "drinks": 8552, "desserts": 1963,
    "min_day": "2023-02-01", "max_day": "2026-08-08",
}


def classify(name):
    if BEBIDA_RE.search(name):
        return "drinks"
    if POSTRE_RE.search(name):
        return "desserts"
    return "dishes"


def resolve_columns(fieldnames):
    """Busca las columnas por subcadena ASCII, sin depender de tipear bien
    los acentos del propio encabezado (Ubicación, Código, Factura nº...)."""
    def find(substr):
        hits = [fn for fn in fieldnames if substr in fn.lower()]
        if len(hits) != 1:
            sys.exit(f"Columna ambigua o ausente para '{substr}' en {fieldnames}")
        return hits[0]
    return {
        "loc": find("ubicaci"),
        "code": find("digo"),
        "invoice": find("factura"),
        "created": find("creaci"),
        "products": find("productos"),
    }


def load_rows():
    files = sorted(
        glob.glob(os.path.join(CSV_DIR, "tabs-report-*.csv")),
        key=lambda p: int(re.search(r"tabs-report-(\d+)\.csv$", p).group(1)),
    )
    if len(files) != 12:
        sys.exit(f"Esperaba 12 ficheros tabs-report-*.csv en {CSV_DIR}, encontré {len(files)}")

    rows = []
    cols = None
    for fp in files:
        with open(fp, encoding="utf-8-sig", newline="") as fh:
            reader = csv.DictReader(fh)
            if cols is None:
                cols = resolve_columns(reader.fieldnames)
            elif resolve_columns(reader.fieldnames) != cols:
                sys.exit(f"Cabecera distinta en {fp}")
            rows.extend(reader)
    return rows, cols


def dedupe(rows, cols):
    seen = set()
    out = []
    for r in rows:
        key = (r[cols["loc"]], r[cols["code"]], r[cols["invoice"]], r[cols["created"]])
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def aggregate(rows, cols):
    unmapped = set()
    groups = {}  # (location_id, day) -> {orders, dishes, drinks, desserts}
    unparsed = 0

    for r in rows:
        loc_raw = (r[cols["loc"]] or "").strip()
        loc = LOCATION_MAP.get(loc_raw)
        if loc is None:
            unmapped.add(loc_raw)
            continue

        day = (r[cols["created"]] or "")[:10]
        if len(day) != 10:
            continue

        g = groups.setdefault((loc, day), {"orders": 0, "dishes": 0, "drinks": 0, "desserts": 0})
        g["orders"] += 1

        productos = (r[cols["products"]] or "").replace("\n", ",").replace("\t", ",")
        matches = PRODUCT_RE.findall(productos)
        if not matches and productos.strip():
            unparsed += 1
        for qty_s, name in matches:
            g[classify(name)] += int(qty_s)

    if unmapped:
        sys.exit("Ubicaciones sin mapear (revisa LOCATION_MAP): " + ", ".join(sorted(unmapped)))

    return groups, unparsed


def verify(groups):
    days = [d for (_, d) in groups]
    totals = {
        "filas": len(groups),
        "dishes": sum(g["dishes"] for g in groups.values()),
        "drinks": sum(g["drinks"] for g in groups.values()),
        "desserts": sum(g["desserts"] for g in groups.values()),
        "min_day": min(days),
        "max_day": max(days),
    }
    print(f"\n{totals['filas']} filas agregadas (local, día)")
    print(f"  platos:   {totals['dishes']}")
    print(f"  bebidas:  {totals['drinks']}")
    print(f"  postres:  {totals['desserts']}")
    print(f"  rango:    {totals['min_day']} -> {totals['max_day']}")

    diffs = [k for k in CHECKPOINT if totals[k] != CHECKPOINT[k]]
    if diffs:
        print("\nCHECKPOINT NO COINCIDE. Diferencias:")
        for k in diffs:
            print(f"  {k}: obtenido={totals[k]!r}  esperado={CHECKPOINT[k]!r}")
        sys.exit(1)
    print("\nCHECKPOINT OK — coincide con lo validado.")
    return totals


def push(groups):
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno.")

    endpoint = url.rstrip("/") + "/rest/v1/rpc/load_sales_history_batch"
    headers = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"}

    items = sorted(groups.items())
    total_affected = 0
    for i in range(0, len(items), BATCH_SIZE):
        chunk = items[i:i + BATCH_SIZE]
        recs = [
            f"{LOC_CODE[loc]}|{day}|{g['orders']}|{g['dishes']}|{g['drinks']}|{g['desserts']}"
            for (loc, day), g in chunk
        ]
        batch_text = ";".join(recs)
        req = urllib.request.Request(
            endpoint, data=json.dumps({"p_batch": batch_text}).encode(),
            headers=headers, method="POST",
        )
        try:
            with urllib.request.urlopen(req) as resp:
                affected = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            sys.exit(f"Lote {i // BATCH_SIZE + 1}: ERROR {e.code} {e.read().decode()[:400]}")
        total_affected += affected
        print(f"  lote {i // BATCH_SIZE + 1}: {len(chunk)} filas -> {affected} upserted")

    print(f"\nHecho: {total_affected} filas de sales_history_daily upserted.")


def main():
    raw, cols = load_rows()
    print(f"{len(raw)} filas brutas leídas de 12 CSV")

    rows = dedupe(raw, cols)
    print(f"{len(rows)} filas únicas tras dedup por (Ubicación, Código, Factura nº, Hora de creación)")
    if len(rows) != len(raw):
        print(f"  AVISO: {len(raw) - len(rows)} duplicados eliminados (el checkpoint esperaba 0)")

    groups, unparsed = aggregate(rows, cols)
    if unparsed:
        print(f"  AVISO: {unparsed} pedidos con Productos no vacío pero sin match del regex")

    verify(groups)

    if not RUN:
        print("\nDRY RUN. Nada se ha escrito en la BBDD. Añade --run para cargar "
              "(requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).")
        return

    push(groups)


if __name__ == "__main__":
    main()
