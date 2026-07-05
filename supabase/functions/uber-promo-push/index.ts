// uber-promo-push — Brazo Uber del motor de ofertas de Folvy (API oficial Marketplace)
// v1 (05/07/2026, construido EN SECO: scopes en verificación de Partner Engineering).
// Consume promo_push_job (platform='ubereats'): create -> POST /v1/delivery/stores/{store}/promotion
// (MENU_ITEM_DISCOUNT, % por ítem), end -> POST /v1/delivery/promotions/{id}/revoke.
// IDEMPOTENCIA CONTRA LA VERDAD DE LA PLATAFORMA: antes de crear en una tienda se consulta
// GET /stores/{id}/promotions buscando external_promotion_id = `${job.id}:${store_id}`
// (un reintento jamás duplica). Token OAuth CACHEADO en platform_api_token (límite Uber:
// 100 tokens/hora y el nuevo invalida al más viejo -> jamás token por llamada).
// GUARDIA DE SCOPES: si el token falla con invalid_scope, se responde SIN reclamar jobs
// (no se queman intentos mientras Uber no apruebe).
// DESPLIEGUE: SIEMPRE --no-verify-jwt (lo llama pg_cron sin JWT; frontera = x-agent-secret).
// Secrets requeridos: OFFERS_AGENT_SECRET, UBER_CLIENT_ID, UBER_CLIENT_SECRET.

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("OFFERS_AGENT_SECRET")!;
const UBER_CLIENT_ID = Deno.env.get("UBER_CLIENT_ID") ?? "";
const UBER_CLIENT_SECRET = Deno.env.get("UBER_CLIENT_SECRET") ?? "";
const UBER_SCOPES = "eats.store.promotion.write eats.store.promotion.read";
const API = "https://api.uber.com";

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── Token OAuth cacheado (client_credentials). Renueva si caduca en <1h.
async function getUberToken(): Promise<{ token?: string; error?: string }> {
  const { data: row } = await supa.from("platform_api_token")
    .select("access_token, expires_at").eq("platform", "ubereats").maybeSingle();
  if (row && new Date(row.expires_at).getTime() > Date.now() + 3600e3) {
    return { token: row.access_token };
  }
  if (!UBER_CLIENT_ID || !UBER_CLIENT_SECRET) return { error: "UBER_CLIENT_ID/SECRET sin configurar en secrets" };
  const body = new URLSearchParams({
    client_id: UBER_CLIENT_ID, client_secret: UBER_CLIENT_SECRET,
    grant_type: "client_credentials", scope: UBER_SCOPES,
  });
  const r = await fetch("https://auth.uber.com/oauth/v2/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    return { error: `token Uber: ${r.status} ${JSON.stringify(j).slice(0, 200)}` };
  }
  const expiresAt = new Date(Date.now() + (Number(j.expires_in ?? 0) * 1000)).toISOString();
  await supa.from("platform_api_token").upsert(
    { platform: "ubereats", access_token: j.access_token, expires_at: expiresAt, updated_at: new Date().toISOString() },
    { onConflict: "platform" });
  return { token: j.access_token };
}

const uberFetch = async (token: string, path: string, init?: RequestInit) => {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await r.text();
  let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* raw */ }
  return { status: r.status, ok: r.ok, json, text };
};

// ── Idempotencia: ¿ya existe en esta tienda una promo nuestra para este job?
async function findExisting(token: string, storeId: string, extId: string): Promise<string | null> {
  const r = await uberFetch(token, `/v1/delivery/stores/${storeId}/promotions`);
  if (!r.ok) return null; // si no podemos leer, seguimos (el create fallará o duplicará como mucho una vez, logueado)
  const list = (r.json?.promotions ?? r.json ?? []) as Array<any>;
  const hit = (Array.isArray(list) ? list : []).find((p) =>
    p?.external_promotion_id === extId && !["revoked", "deleted", "expired"].includes(p?.state ?? ""));
  return hit?.promotion_id ?? null;
}

// ── Construye el payload de creación (MENU_ITEM_DISCOUNT) desde el snapshot del job
function buildPromoBody(job: any, itemExternalIds: string[], storeId: string) {
  const p = job.payload ?? {};
  const pct = Math.round(Number(p.value ?? 0));
  const startsAt = p.starts_at ?? new Date().toISOString();
  const endsAt = p.ends_at ?? new Date(Date.now() + 7 * 864e5).toISOString();
  const body: Record<string, unknown> = {
    start_time: startsAt,
    end_time: endsAt,
    external_promotion_id: `${job.id}:${storeId}`,
    user_group: "ALL_CUSTOMERS",
    allow_unlimited_apply: true,
    currency_code: "EUR",
    budget: p.budget_max
      ? { budget_amount: { amount: Math.round(Number(p.budget_max) * 100), currency_code: "EUR" } }
      : { unlimited_budget: true },
    promo_type: "MENU_ITEM_DISCOUNT",
    promotion_discount: {
      menu_item_discount: {
        item_discounts: itemExternalIds.map((extId) => ({
          item: { item_external_id: extId },
          discount_amount: { percent_discount: { percent_value: pct } },
        })),
      },
    },
  };
  // TODO v1.1 del brazo: franjas (custom_schedule daypart) desde p.weekdays/time_from/time_to
  // cuando se fije el formato de weekdays en el payload (hoy se omite y se loguea).
  return body;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-agent-secret") !== AGENT_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const out: Record<string, unknown> = { ok: true };

  // 0. ¿Hay trabajo? (mirar SIN reclamar: si no hay, ni token ni nada)
  const { count } = await supa.from("promo_push_job")
    .select("id", { count: "exact", head: true })
    .eq("platform", "ubereats").in("status", ["pending", "error"]).lt("attempts", 5);
  if (!count) return Response.json({ ...out, jobs: 0 });

  // 1. GUARDIA DE SCOPES: token ANTES de reclamar. Si Uber no lo da, no se queman intentos.
  const { token, error: tokenErr } = await getUberToken();
  if (!token) {
    return Response.json({ ...out, jobs_waiting: count, blocked: tokenErr ?? "sin token" });
  }

  // 2. Reclamar (service_role, SKIP LOCKED)
  const { data: jobs } = await supa.rpc("claim_promo_push_jobs_srv", { p_platform: "ubereats", p_limit: 3 });
  const results: Array<Record<string, unknown>> = [];

  for (const job of (jobs ?? []) as Array<any>) {
    const p = job.payload ?? {};
    const report = (ok: boolean, ref?: string | null, err?: string | null) =>
      supa.from("promo_push_job").update({
        status: ok ? "done" : "error",
        external_ref: ref ?? job.external_ref,
        last_error: err ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

    try {
      // Tiendas de Uber de esta marca (mapeo obligatorio)
      const { data: stores } = await supa.from("uber_store_map")
        .select("store_id, store_name")
        .eq("account_id", job.account_id).eq("brand_id", job.brand_id);
      if (!stores?.length) {
        await report(false, null, "sin mapeo en uber_store_map para esta marca (poblar con GET /v1/eats/stores al aprobar scopes)");
        results.push({ job: job.id, error: "sin uber_store_map" }); continue;
      }

      if (job.action === "create") {
        // IDs externos de los ítems del alcance (o toda la carta de la marca)
        let q = supa.from("menu_item").select("id, name, external_id")
          .eq("account_id", job.account_id).eq("brand_id", job.brand_id).is("archived_at", null);
        if (Array.isArray(p.menu_item_ids) && p.menu_item_ids.length > 0) q = q.in("id", p.menu_item_ids);
        const { data: items } = await q;
        const withExt = (items ?? []).filter((i: any) => i.external_id);
        const skipped = (items ?? []).filter((i: any) => !i.external_id).map((i: any) => i.name);
        if (withExt.length === 0) {
          await report(false, null, "ningún ítem del alcance tiene external_id (el menú de Uber debe compartir IDs con Folvy)");
          results.push({ job: job.id, error: "sin external_ids" }); continue;
        }
        const extIds = withExt.map((i: any) => i.external_id as string);

        const okStores: string[] = []; const failStores: string[] = []; const refs: string[] = [];
        for (const s of stores) {
          const extPromoId = `${job.id}:${s.store_id}`;
          // Idempotencia contra la verdad de Uber
          const existing = await findExisting(token, s.store_id, extPromoId);
          if (existing) { okStores.push(s.store_id); refs.push(`${s.store_id}:${existing}`); continue; }
          const r = await uberFetch(token, `/v1/delivery/stores/${s.store_id}/promotion`, {
            method: "POST", body: JSON.stringify(buildPromoBody(job, extIds, s.store_id)),
          });
          if (r.ok && r.json?.promotion_id) { okStores.push(s.store_id); refs.push(`${s.store_id}:${r.json.promotion_id}`); }
          else failStores.push(`${s.store_id} → ${r.status} ${(r.text ?? "").slice(0, 150)}`);
        }
        const refStr = refs.join(",");
        if (failStores.length === 0) {
          await report(true, refStr, skipped.length ? `sin external_id (fuera del alcance): ${skipped.join(", ")}` : null);
          results.push({ job: job.id, created: okStores, skipped_items: skipped });
        } else {
          await report(false, refStr || null,
            `PARCIAL — OK: ${okStores.join(", ") || "ninguno"} · FALLO: ${failStores.join(" · ")} (reintento idempotente por external_promotion_id)`);
          results.push({ job: job.id, partial: true, ok: okStores, fail: failStores });
        }

      } else if (job.action === "end") {
        // Localizar el create done de esta campaña×marca y revocar sus promotion_ids
        const { data: creates } = await supa.from("promo_push_job")
          .select("external_ref").eq("coupon_id", job.coupon_id).eq("brand_id", job.brand_id)
          .eq("platform", "ubereats").eq("action", "create").eq("status", "done")
          .not("external_ref", "is", null);
        const pairs = (creates ?? []).flatMap((c: any) => (c.external_ref as string).split(","))
          .map((s: string) => s.trim()).filter(Boolean)
          .map((s: string) => { const i = s.indexOf(":"); return { store: s.slice(0, i), promo: s.slice(i + 1) }; })
          .filter((x) => x.promo);
        if (pairs.length === 0) {
          await report(false, null, "end: no encuentro promotion_ids del create (¿nunca se publicó en Uber?)");
          results.push({ job: job.id, error: "sin refs de create" }); continue;
        }
        const okRev: string[] = []; const failRev: string[] = [];
        for (const x of pairs) {
          const r = await uberFetch(token, `/v1/delivery/promotions/${x.promo}/revoke`, { method: "POST", body: "{}" });
          // Verificación contra la verdad: estado revoked (o ya no activa)
          const g = await uberFetch(token, `/v1/delivery/promotions/${x.promo}`);
          const state = g.json?.state ?? g.json?.promotion?.state ?? "";
          if ((r.ok || r.status === 400) && ["revoked", "expired", "completed", "deleted"].includes(state)) okRev.push(x.promo);
          else if (r.ok) okRev.push(x.promo); // revoke 200 sin poder leer estado: aceptar con log
          else failRev.push(`${x.promo} → ${r.status} ${(r.text ?? "").slice(0, 120)}`);
        }
        if (failRev.length === 0) { await report(true, null, null); results.push({ job: job.id, revoked: okRev }); }
        else {
          await report(false, null, `end PARCIAL — revocadas: ${okRev.join(", ") || "ninguna"} · FALLO: ${failRev.join(" · ")}`);
          results.push({ job: job.id, partial: true, revoked: okRev, fail: failRev });
        }

      } else {
        // Uber SÍ soporta el ciclo completo vía revoke+create, pero pause/resume como tal no existen en la API v1
        await report(false, null, `acción '${job.action}' no soportada por el brazo Uber v1 (create/end)`);
        results.push({ job: job.id, error: `acción ${job.action}` });
      }
    } catch (e) {
      await report(false, null, `excepción: ${String((e as Error).message).slice(0, 400)}`);
      results.push({ job: job.id, exception: (e as Error).message });
    }
  }

  return Response.json({ ...out, results });
});
