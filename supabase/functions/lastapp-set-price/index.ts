// supabase/functions/lastapp-set-price/index.ts
//
// LECTOR/ESCRITOR DE PRECIO EN LAST.APP · POR LOCAL (header locationID)
// ============================================================================
// USO REAL = LECTOR fiable. La API pública de Last NO permite escribir precio
// (el endpoint PUT /catalogs/{cat}/products/{prod} solo acepta `enable`; verificado
// contra la spec OpenAPI y en pruebas: devuelve 200 pero ignora `price`/`priceOverride`).
// El precio se cambia a mano en Last. Esta función se usa en modo dry_run/probe para
// VERIFICAR el precio real por local vía API (Alcalá vs Carabanchel, aislamiento por
// el header locationID aunque el catálogo sea compartido).
//
// Invocación: net.http_post desde el SQL Editor con header x-availability-dispatch-secret
// == AVAILABILITY_DISPATCH_SECRET (reusa el secreto existente). Deploy --no-verify-jwt.
//
// Body: { account_id, external_org_id, dry_run?, probe?, price_cents?, price_field?, extra?,
//         targets: [ { catalog_id, product_id, location_ext, label } ] }
//   dry_run=true (defecto): solo GET (before_cents por local).
//   probe=true: vuelca el nodo crudo del producto (para inspeccionar campos).
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-availability-dispatch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LASTAPP_BASE = "https://api.last.app/v2";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function findRawNode(catalog: any, productId: string): any {
  const cats = catalog?.categories ?? [];
  for (const c of cats) for (const p of (c?.products ?? [])) if (p?.id === productId) return p;
  return null;
}

async function getCatalog(token: string, catalogId: string, locId: string): Promise<any> {
  const res = await fetch(`${LASTAPP_BASE}/catalogs/${catalogId}`, { headers: { "Authorization": `Bearer ${token}`, "locationID": locId } });
  if (!res.ok) throw new Error(`GET catalog ${catalogId} @ ${locId} -> ${res.status} ${(await res.text()).slice(0,200)}`);
  return res.json();
}

async function putProduct(token: string, catalogId: string, productId: string, locId: string, payload: unknown): Promise<{ ok: boolean; status: number; reason?: string }> {
  const res = await fetch(`${LASTAPP_BASE}/catalogs/${catalogId}/products/${productId}`, {
    method: "PUT",
    headers: { "Authorization": `Bearer ${token}`, "locationID": locId, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, status: res.status, reason: (await res.text()).slice(0, 300) };
  return { ok: true, status: res.status };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = req.headers.get("x-availability-dispatch-secret") ?? "";
  const expected = Deno.env.get("AVAILABILITY_DISPATCH_SECRET") ?? "";
  if (!expected || secret !== expected) return json({ ok: false, error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const probe = body.probe === true;
  const accountId = body.account_id;
  const orgId = body.external_org_id;
  const priceCents = typeof body.price_cents === "number" ? body.price_cents : null;
  const priceField = typeof body.price_field === "string" ? body.price_field : "price";
  const extra = (body.extra && typeof body.extra === "object") ? body.extra : {};
  const dryRun = body.dry_run !== false;
  const targets: Array<{ catalog_id: string; product_id: string; location_ext: string; label?: string }> =
    Array.isArray(body.targets) ? body.targets : [];

  if (!accountId || !orgId || targets.length === 0) return json({ ok: false, error: "account_id, external_org_id y targets requeridos" }, 400);
  if (!dryRun && priceCents === null) return json({ ok: false, error: "price_cents requerido cuando dry_run=false" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: integ, error: integErr } = await sb.from("external_integration").select("token_secret_name")
    .eq("account_id", accountId).eq("source", "lastapp").eq("external_org_id", orgId).eq("is_active", true).maybeSingle();
  if (integErr || !integ?.token_secret_name) return json({ ok: false, error: "integracion Last no encontrada" }, 404);
  const token = Deno.env.get(integ.token_secret_name) ?? "";
  if (!token) return json({ ok: false, error: `secreto ${integ.token_secret_name} no configurado` }, 500);

  if (probe) {
    const probes: any[] = [];
    for (const t of targets) {
      const cat = await getCatalog(token, t.catalog_id, t.location_ext);
      probes.push({ label: t.label ?? null, node: findRawNode(cat, t.product_id) });
    }
    return json({ ok: true, probe: true, probes });
  }

  const results: any[] = [];
  for (const t of targets) {
    const out: any = { label: t.label ?? null, location_ext: t.location_ext, dry_run: dryRun, price_field: priceField };
    try {
      const catBefore = await getCatalog(token, t.catalog_id, t.location_ext);
      const node = findRawNode(catBefore, t.product_id);
      out.before_cents = typeof node?.price === "number" ? node.price : null;
      out.enabled = node?.enabled !== false;
      if (!dryRun && priceCents !== null) {
        const payload: any = { enable: node?.enabled !== false, ...extra };
        payload[priceField] = priceCents;
        const w = await putProduct(token, t.catalog_id, t.product_id, t.location_ext, payload);
        out.write_ok = w.ok; out.write_status = w.status; out.write_reason = w.reason ?? null;
        if (w.ok) {
          const catAfter = await getCatalog(token, t.catalog_id, t.location_ext);
          const n2 = findRawNode(catAfter, t.product_id);
          out.after_cents = typeof n2?.price === "number" ? n2.price : null;
        }
      }
    } catch (e) {
      out.error = e instanceof Error ? e.message : String(e);
    }
    results.push(out);
  }
  return json({ ok: true, dry_run: dryRun, price_cents: priceCents, results });
});
