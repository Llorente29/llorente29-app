import os, sys, csv, json, urllib.request
ACCOUNT = "51ad1792-6629-4ef7-833a-b57b09a86710"
CH_GLOVO = "f98fcf5b-7ee3-4995-9a29-e755d2bd29f3"
PATH = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "glovo_orders.csv"
RUN = "--run" in sys.argv

def n(v):
    try: return float(str(v).replace(",", ".")) if v not in (None, "") else 0.0
    except: return 0.0
def d(v):
    v = (v or "").strip()
    if not v: return None
    if "-" in v: return v[:10]
    p = v.split("/")
    return f"{p[2]}-{int(p[0]):02d}-{int(p[1]):02d}" if len(p) == 3 else None

rows = []
with open(PATH, encoding="utf-8-sig") as fh:
    for r in csv.DictReader(fh, delimiter=";"):
        cod = (r.get("codigo_glovo") or "").strip()
        if not cod: continue
        rows.append({
            "account_id": ACCOUNT, "channel_id": CH_GLOVO,
            "import_key": "glovo:" + cod, "platform_order_code": cod,
            "settlement_ref": r.get("settlement_ref"), "order_date": d(r.get("fecha_entrega")),
            "service_type": r.get("tipo_servicio"), "payment_method": r.get("forma_pago"),
            "external_brand_text": r.get("marca"), "external_street_text": r.get("calle"),
            "products": abs(n(r.get("productos"))), "commission": n(r.get("total_comision")),
            "commission_pct": n(r.get("comision_pct")), "access_fee": n(r.get("tasa_acceso")),
            "prime_fee": n(r.get("prime")), "delivery": n(r.get("servicio_entrega")),
            "promo_product": n(r.get("promo_producto")),
            "promo_flash": n(r.get("promo_oferta_flash")) + n(r.get("tarifas_oferta_flash")) + n(r.get("promo_df")),
            "incidents_cost": n(r.get("coste_incidencias")), "incidents_refund": n(r.get("devol_incidencias")),
            "other": {"tasa_espera": n(r.get("tasa_espera")), "glovos_remunerados": n(r.get("glovos_remunerados")),
                      "tasa_efectivo": n(r.get("tasa_efectivo")), "recargo_minimo": n(r.get("recargo_minimo")),
                      "id_tienda": r.get("id_tienda")},
            "source": "import_xlsx_glovo", "flow_type": "own",
        })
seen = {}
for x in rows: seen[x["import_key"]] = x
rows = list(seen.values())
print(f"{len(rows)} pedidos mapeados desde {PATH}")
if not RUN:
    print("DRY RUN. Anade --run para subir."); sys.exit(0)
URL = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/channel_settlement_order?on_conflict=account_id,import_key"
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json",
     "Prefer": "resolution=merge-duplicates,return=minimal"}
ok = 0
for i in range(0, len(rows), 500):
    batch = rows[i:i+500]
    req = urllib.request.Request(URL, data=json.dumps(batch).encode(), headers=H, method="POST")
    try:
        urllib.request.urlopen(req); ok += len(batch); print(f"  subidos {ok}/{len(rows)}")
    except urllib.error.HTTPError as e:
        print("  ERROR", e.code, e.read().decode()[:300]); break
print(f"Hecho: {ok} pedidos upserted.")
