// supabase/functions/availability-dispatch/index.ts
//
// DESPACHADOR DE DISPONIBILIDAD (86) · disparado por net.http_post desde las RPC
// set_product_availability / _by_token. VÍA ÚNICA: el front nunca llama aquí.
// ============================================================================
// v4 (30/07): LAST PASA A SOLO LECTURA. Decisión de dueño por integración:
//   · HubRise → lo controla Folvy (fuente de la verdad; Folvy ESCRIBE).
//   · Last    → lo controla Last. Folvy DEJA de escribir (antes hacía PUT
//     /catalogs/.../products/...). Motivo confirmado en lastapp-sync-catalog:
//     cada sincronización re-escribe external_catalog_product.is_enabled desde
//     el estado REAL de Last, así que cualquier PUT de Folvy podía quedar
//     pisado en el siguiente sync ("pegado"). Los artículos de origen Last se
//     gestionan en Last (la UI ya no ofrece un Reactivar que no puede cumplir).
//   El tramo Last se queda como bloque de solo-lectura: no llama a la API de
//   Last, no toca is_enabled, y deja un log informativo (no es fallo) para
//   trazabilidad. El camino de HubRise queda IGUAL que en v3.
//
// v3 (24/06): + LEG HUBRISE (PATCH inventario, sku_ref = matrícula, por
// conexión×local) + lee location_id/available_until + LOG HONESTO de los huecos
// (otter/desconocido) en vez de skip silencioso.
//
// Entra por net.http_post con header x-availability-dispatch-secret (sin JWT).
// Deploy CON --no-verify-jwt: la frontera la valida el SECRET (es DB-triggered).
//
// Cuerpo: { account_id, matriculas:[...], affected_menu_item_ids:[...],
//           external_location_ids:[...], location_id, available_until, enable, reason }
//
// v5 (30/07, Fase B): +affected_menu_item_ids — el leg HubRise ya NO usa la
// matrícula en crudo como sku_ref (colisionaba entre marcas). Resuelve el ref
// namespaced de cada menu_item vía _shared/hubriseSku.ts (compartido si tiene
// stock_group, si no {brandSlug}:{external_id}). Sin este campo, cae a la
// matrícula en crudo (compat transicional con callers viejos).
//
// v6 (30/07): FIX de trazabilidad — availability_push_log.external_catalog_id
// (ahora text) y .organization_product_id (ahora text[]) se rellenan de
// verdad en el tramo HubRise con el catálogo destino y los refs empujados
// (antes quedaban NULL siempre: eran uuid y el ref namespaced/catalog_id de
// HubRise no lo son — ver 20260730T1761). +location_status_log_id opcional
// en el cuerpo: si viene (lo manda set_brand_status para Cap. B), al acabar
// se hace ROLLUP del resultado agregado del tramo HubRise sobre esa fila de
// location_status_log (ok/error/resolved_at) — Cap. B reutiliza este
// despachador en vez de uno dedicado, así que el resultado no llegaba solo.
//
// Matriz por integrador:
//   - lastapp : SOLO LECTURA (30/07). No se escribe; se loguea informativo.
//   - hubrise : PATCH /catalogs/{cat}/locations/{external_location_id}/inventory
//               (X-Access-Token). REAL. La forma corta .../location/inventory (sin
//               id) da 403 "Operation not allowed for the current scope" con token
//               de cuenta (escritor) — hay que pasar el id HubRise del local explícito.
//               agotar → {sku_ref, stock:"0", expires_at?}; reactivar → {sku_ref, stock:null}.
//               Catálogos: PRIMARIO brand_hubrise_catalog (Fase 2, self-service, sin
//               bridge); FALLBACK external_integration (bridge, compat Bendito Burrito).
//   - otter   : disponibilidad de item. Hueco declarado (se LOGUEA, no se silencia).
// ============================================================================

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "@supabase/supabase-js";
import { resolveWriterToken } from "../_shared/hubriseToken.ts";
import { hubriseSkuRef } from "../_shared/hubriseSku.ts";

const HUBRISE_BASE = "https://api.hubrise.com/v1";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = req.headers.get("x-availability-dispatch-secret") ?? "";
  const expected = Deno.env.get("AVAILABILITY_DISPATCH_SECRET") ?? "";
  if (!expected || secret !== expected) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: {
    account_id?: string;
    matriculas?: string[];
    affected_menu_item_ids?: string[];
    external_location_ids?: string[];
    location_id?: string | null;
    available_until?: string | null;
    enable?: boolean;
    reason?: string;
    location_status_log_id?: string | null;
  } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const accountId = body.account_id;
  const matriculas = Array.isArray(body.matriculas) ? body.matriculas.filter(Boolean) : [];
  const affectedMenuItemIds = Array.isArray(body.affected_menu_item_ids)
    ? body.affected_menu_item_ids.filter(Boolean)
    : [];
  const externalLocationIds = Array.isArray(body.external_location_ids)
    ? body.external_location_ids.filter(Boolean)
    : [];
  const locationId = body.location_id ?? null;
  const availableUntil = body.available_until ?? null;
  const enable = body.enable === true;
  const locationStatusLogId = body.location_status_log_id ?? null;
  if (!accountId || matriculas.length === 0) {
    return json({ ok: false, error: "account_id y matriculas requeridos" }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const results = { last: { pushed: 0, ok: 0, failed: 0, skipped: 0 },
                    hubrise: { pushed: 0, ok: 0, failed: 0, skipped: 0 } };

  // ========================= LEG LASTAPP (SOLO LECTURA) =====================
  // No se llama a la API de Last ni se toca is_enabled: Last es dueño de su
  // catálogo. Un solo log informativo por llamada (no es fallo), para no
  // inundar availability_push_log con una fila por producto×local.
  {
    let query = sb
      .from("external_catalog_product")
      .select("organization_product_id")
      .eq("account_id", accountId)
      .eq("source", "lastapp")
      .in("organization_product_id", matriculas);
    if (externalLocationIds.length > 0) {
      query = query.in("external_location_id", externalLocationIds);
    }
    const { data: targets } = await query;
    const n = targets?.length ?? 0;
    results.last.skipped = n;
    if (n > 0) {
      await logPush(sb, accountId, {
        source: "lastapp",
        enable,
        ok: true,
        error: `Last es de solo lectura (Folvy no escribe) · ${n} fila(s) sin tocar, gestionar en Last`,
      });
    }
  }

  // ========================= LEG HUBRISE (REAL) ============================
  // sku_ref = ref de HubRise (Fase B, namespaced) — NO la matrícula en crudo.
  // Un ref por-marca ({brandSlug}:{external_id}) solo existe en el catálogo de
  // SU marca; un ref compartido (stock_group.hubrise_ref) existe en todos los
  // catálogos del grupo. PATCH solo afecta a refs que existen en cada catálogo
  // → se auto-filtra por marca SIEMPRE QUE el ref esté namespaced (por eso hay
  // que resolverlo aquí, no reenviar la matrícula tal cual).
  {
    // Resolver refs de HubRise para los menu_item afectados (Fase B). Si el
    // caller es viejo y no manda affected_menu_item_ids, cae a la matrícula en
    // crudo (compat transicional — mismo comportamiento que antes de Fase B).
    let hubriseRefs: string[] = matriculas;
    if (affectedMenuItemIds.length > 0) {
      const { data: miRows } = await sb.from("menu_item")
        .select("id, brand_id, external_id, stock_group_id")
        .eq("account_id", accountId)
        .in("id", affectedMenuItemIds);

      const brandIds = Array.from(new Set((miRows ?? []).map((r) => r.brand_id as string).filter(Boolean)));
      const { data: brandRows } = brandIds.length > 0
        ? await sb.from("brand").select("id, slug").in("id", brandIds)
        : { data: [] as Array<{ id: string; slug: string }> };
      const slugByBrand = new Map((brandRows ?? []).map((b) => [b.id as string, b.slug as string]));

      const groupIds = Array.from(new Set(
        (miRows ?? []).map((r) => r.stock_group_id as string | null).filter((x): x is string => !!x),
      ));
      const { data: groupRows } = groupIds.length > 0
        ? await sb.from("stock_group").select("id, hubrise_ref").in("id", groupIds)
        : { data: [] as Array<{ id: string; hubrise_ref: string }> };
      const groupRefById = new Map((groupRows ?? []).map((g) => [g.id as string, g.hubrise_ref as string]));

      const refSet = new Set<string>();
      for (const r of miRows ?? []) {
        const brandSlug = slugByBrand.get(r.brand_id as string);
        if (!brandSlug) continue;
        const groupRef = r.stock_group_id ? (groupRefById.get(r.stock_group_id as string) ?? null) : null;
        const ref = hubriseSkuRef({ externalId: r.external_id as string | null, brandSlug, stockGroupHubriseRef: groupRef });
        if (ref) refSet.add(ref);
      }
      if (refSet.size > 0) hubriseRefs = Array.from(refSet);
    }

    // Token ESCRITOR (Fase 1): 1 por cuenta, en Vault. PRIMARIO para resolver
    // catálogos self-service (Fase 2, ver abajo) y para publicar/86. Sin
    // fallo mudo: si no hay, se avisa y se cae al bucle de bridge de siempre.
    const writerToken = await resolveWriterToken(sb, accountId);
    if (!writerToken) {
      console.warn(`availability-dispatch: sin token escritor para cuenta ${accountId}, fallback a token de bridge (transicional)`);
    }

    // 1) locales HubRise activos de la cuenta, acotados al local si viene
    let hrExtLocs: string[] | null = null; // null = todos los locales (descatalogar)
    if (locationId) {
      const { data: maps } = await sb.from("external_location_map")
        .select("external_location_id")
        .eq("account_id", accountId).eq("source", "hubrise").eq("is_active", true)
        .eq("location_id", locationId);
      hrExtLocs = (maps ?? []).map((m) => m.external_location_id as string).filter(Boolean);
    }

    type ConnRow = {
      id: string; access_token: string | null; external_catalog_id: string | null;
      external_location_id: string | null; connection_name: string | null; push_status_enabled: boolean | null;
    };
    const conns: ConnRow[] = [];
    const primaryCatalogLocations = new Set<string>();

    // PRIMARIO (Fase 2): catálogos del asistente self-service
    // (brand_hubrise_catalog), sin bridge. Solo tiene sentido con token
    // escritor (es el único que puede escribir en estos catálogos).
    if (writerToken) {
      let bhcQ = sb.from("brand_hubrise_catalog")
        .select("id, external_catalog_id, external_location_id, hubrise_catalog_name")
        .eq("account_id", accountId);
      if (hrExtLocs !== null) {
        if (hrExtLocs.length === 0) bhcQ = null as never; // local sin conexión HubRise → nada
        else bhcQ = bhcQ.in("external_location_id", hrExtLocs);
      }
      const bhcRows = bhcQ ? (await bhcQ).data ?? [] : [];
      for (const r of bhcRows) {
        if (!r.external_catalog_id || !r.external_location_id) continue;
        conns.push({
          id: r.id as string,
          access_token: writerToken,
          external_catalog_id: r.external_catalog_id as string,
          external_location_id: r.external_location_id as string,
          connection_name: (r.hubrise_catalog_name as string) ?? "Folvy (autoservicio)",
          push_status_enabled: true,
        });
        primaryCatalogLocations.add(`${r.external_catalog_id}::${r.external_location_id}`);
      }
    }

    // FALLBACK (compat): conexiones de bridge (external_integration), salvo
    // las ya cubiertas por brand_hubrise_catalog (mismo catálogo+local).
    let connQ = sb.from("external_integration")
      .select("id, access_token, external_catalog_id, external_location_id, connection_name, push_status_enabled")
      .eq("account_id", accountId).eq("source", "hubrise").eq("is_active", true);
    if (hrExtLocs !== null) {
      if (hrExtLocs.length === 0) connQ = null as never; // local sin conexión HubRise → nada
      else connQ = connQ.in("external_location_id", hrExtLocs);
    }
    const bridgeRows = connQ ? (await connQ).data ?? [] : [];
    for (const c of bridgeRows) {
      if (c.external_catalog_id && c.external_location_id
          && primaryCatalogLocations.has(`${c.external_catalog_id}::${c.external_location_id}`)) continue;
      conns.push(c as ConnRow);
    }

    // entradas de inventario: agotar = stock "0" (+expires_at); reactivar = stock null
    const entries = hubriseRefs.map((m) =>
      enable
        ? { sku_ref: m, stock: null }
        : { sku_ref: m, stock: "0", ...(availableUntil ? { expires_at: availableUntil } : {}) }
    );

    if (writerToken) {
      // Dedup por (catálogo, local) DISTINTO: el inventario en HubRise es por
      // catálogo × local, no solo por catálogo — 2 locales que comparten
      // catálogo necesitan 2 PATCH distintos (antes se colapsaban en 1 y el
      // segundo local se quedaba sin empujar).
      const byCatalogLocation = new Map<string, { catalogId: string; extLocId: string; group: ConnRow[] }>();
      for (const c of conns) {
        if (!c.external_catalog_id) {
          results.hubrise.skipped++;
          await logPush(sb, accountId, {
            source: "hubrise", external_org_id: c.id, enable, ok: false,
            organization_product_id: hubriseRefs,
            error: hubriseDetail(c, "sin catalog"),
          });
          continue;
        }
        if (!c.external_location_id) {
          results.hubrise.skipped++;
          await logPush(sb, accountId, {
            source: "hubrise", external_org_id: c.id, enable, ok: false,
            external_catalog_id: c.external_catalog_id, organization_product_id: hubriseRefs,
            error: hubriseDetail(c, "sin external_location_id"),
          });
          continue;
        }
        const catalogId = c.external_catalog_id as string;
        const extLocId = c.external_location_id as string;
        const key = `${catalogId}::${extLocId}`;
        const entry = byCatalogLocation.get(key);
        if (entry) entry.group.push(c); else byCatalogLocation.set(key, { catalogId, extLocId, group: [c] });
      }
      for (const { catalogId, extLocId, group } of byCatalogLocation.values()) {
        const enabledConns = group.filter((c) => c.push_status_enabled !== false);
        const label = {
          id: (enabledConns[0] ?? group[0]).id,
          connection_name: Array.from(new Set(group.map((c) => c.connection_name))).filter(Boolean).join(" + "),
          external_catalog_id: catalogId,
          external_location_id: extLocId,
        };
        if (enabledConns.length === 0) {
          results.hubrise.skipped++;
          await logPush(sb, accountId, {
            source: "hubrise", external_org_id: label.id, enable, ok: false,
            external_catalog_id: label.external_catalog_id, organization_product_id: hubriseRefs,
            error: hubriseDetail(label, "push_status_enabled=false (todas las conexiones del catálogo+local)"),
          });
          continue;
        }
        results.hubrise.pushed++;
        const r = await patchHubriseInventory(writerToken, catalogId, extLocId, entries);
        if (r.ok) results.hubrise.ok++; else results.hubrise.failed++;
        await logPush(sb, accountId, {
          source: "hubrise", external_org_id: label.id, enable, ok: r.ok, http_status: r.status ?? null,
          external_catalog_id: label.external_catalog_id, organization_product_id: hubriseRefs,
          error: hubriseDetail(label, r.ok ? `ok · ${hubriseRefs.length} sku` : (r.reason ?? null)),
        });
      }
    } else {
      for (const c of conns) {
        if (c.push_status_enabled === false) {
          results.hubrise.skipped++;
          await logPush(sb, accountId, {
            source: "hubrise", external_org_id: c.id, enable, ok: false,
            external_catalog_id: c.external_catalog_id, organization_product_id: hubriseRefs,
            error: hubriseDetail(c, "push_status_enabled=false"),
          });
          continue;
        }
        if (!c.access_token || !c.external_catalog_id || !c.external_location_id) {
          results.hubrise.skipped++;
          await logPush(sb, accountId, {
            source: "hubrise", external_org_id: c.id, enable, ok: false,
            external_catalog_id: c.external_catalog_id, organization_product_id: hubriseRefs,
            error: hubriseDetail(c, "sin access_token/catalog/location"),
          });
          continue;
        }
        results.hubrise.pushed++;
        const r = await patchHubriseInventory(
          c.access_token as string, c.external_catalog_id as string, c.external_location_id as string, entries,
        );
        if (r.ok) results.hubrise.ok++; else results.hubrise.failed++;
        await logPush(sb, accountId, {
          source: "hubrise", external_org_id: c.id, enable, ok: r.ok, http_status: r.status ?? null,
          external_catalog_id: c.external_catalog_id, organization_product_id: hubriseRefs,
          error: hubriseDetail(c, r.ok ? `ok · ${hubriseRefs.length} sku` : (r.reason ?? null)),
        });
      }
    }
  }

  // ===================== huecos declarados (otter/otros) ===================
  // No empujamos, pero LO REGISTRAMOS (antes era skip silencioso).
  // (Se detecta si hubo filas espejo de otros integradores para estas matrículas.)
  {
    const { data: others } = await sb.from("external_catalog_product")
      .select("source, external_org_id, external_catalog_id, organization_product_id")
      .eq("account_id", accountId)
      .neq("source", "lastapp")
      .neq("source", "hubrise")
      .in("organization_product_id", matriculas)
      .limit(50);
    for (const o of others ?? []) {
      const orgProductId = o.organization_product_id ? [o.organization_product_id as string] : null;
      await logPush(sb, accountId, {
        source: "other",
        external_org_id: o.external_org_id as string | null,
        external_catalog_id: o.external_catalog_id as string | null,
        organization_product_id: orgProductId,
        enable, ok: false,
        error: `no empujado: integrador '${o.source}' sin leg`,
      });
    }
  }

  // ===================== ROLLUP a location_status_log (Cap. B) =============
  // Cap. B (set_brand_status) reutiliza ESTE despachador en vez de uno
  // dedicado; su fila de location_status_log no se actualiza sola, así que si
  // llega location_status_log_id se hace el rollup del resultado agregado del
  // tramo HubRise (el único real) sobre esa fila.
  if (locationStatusLogId) {
    const hubriseOk = results.hubrise.failed === 0;
    const summary = `HubRise: ${results.hubrise.pushed} empujado(s) · ${results.hubrise.ok} ok · `
      + `${results.hubrise.failed} fallido(s) · ${results.hubrise.skipped} omitido(s)`;
    try {
      await sb.from("location_status_log").update({
        ok: hubriseOk,
        error: summary,
        resolved_at: new Date().toISOString(),
      }).eq("id", locationStatusLogId);
    } catch { /* best-effort */ }
  }

  return json({ ok: true, enable, location_id: locationId, ...results }, 200);
});

// ── HUBRISE: PATCH inventory ─────────────────────────────────────────────────
// Forma EXPLÍCITA con el id HubRise del local (p.ej. "1b6p8-0"). La forma
// corta .../location/inventory (sin id) da 403 "Operation not allowed for
// the current scope" con el token de cuenta (escritor).
async function patchHubriseInventory(
  accessToken: string, catalogId: string, externalLocationId: string, entries: unknown[],
): Promise<{ ok: boolean; status?: number; reason?: string }> {
  try {
    const res = await fetch(`${HUBRISE_BASE}/catalogs/${catalogId}/locations/${externalLocationId}/inventory`, {
      method: "PATCH",
      headers: { "X-Access-Token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify(entries),
    });
    if (!res.ok) return { ok: false, status: res.status, reason: (await res.text()).slice(0, 200) };
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// HubRise loguea por CONEXIÓN (no por fila espejo, que no existe): el catálogo
// y el local van en el texto del detalle.
function hubriseDetail(c: Record<string, unknown>, detail: string | null): string {
  return `hubrise · ${c.connection_name ?? "?"} · cat ${c.external_catalog_id ?? "?"} · loc ${c.external_location_id ?? "?"}${detail ? " · " + detail : ""}`;
}

// ── log (best-effort) ───────────────────────────────────────────────────────
async function logPush(
  sb: ReturnType<typeof createClient>, accountId: string,
  fields: {
    source: "lastapp" | "hubrise" | "other";
    external_org_id?: string | null;
    external_catalog_id?: string | null;
    catalog_product_id?: string | null;
    /** Refs namespaced (Fase B) empujados en este PATCH, o refs que se iban a empujar en un skip/fallo. */
    organization_product_id?: string[] | null;
    enable: boolean;
    ok: boolean;
    http_status?: number | null;
    error?: string | null;
  },
): Promise<void> {
  try {
    await sb.from("availability_push_log").insert({
      account_id: accountId,
      source: fields.source,
      external_org_id: fields.external_org_id ?? null,
      external_catalog_id: fields.external_catalog_id ?? null,
      catalog_product_id: fields.catalog_product_id ?? null,
      organization_product_id: fields.organization_product_id ?? null,
      enable: fields.enable,
      ok: fields.ok,
      http_status: fields.http_status ?? null,
      error: fields.error ?? null,
    });
  } catch { /* best-effort */ }
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
