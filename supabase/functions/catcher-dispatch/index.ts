// supabase/functions/catcher-dispatch/index.ts
//
// Despacha un pedido (sale) al broker de reparto Catcher.
// Invocación manual de prueba: POST { sale_id, dry_run? }.
//   - dry_run:true  → construye y DEVUELVE el payload SIN enviarlo a Catcher.
//   - dry_run:false → autentica, llama a /pitcher/v1/order y guarda el resultado.
//
// Lee credenciales (cifradas en Vault) vía connector_secret_read (service_role).
// Dirección del cliente: del raw_tab.delivery del pedido (lat/long/dirección).
// Recogida: del local (locations.address + lat/lng).
// Idempotente: si el sale ya tiene carrier_order_id, no re-despacha.
//
// PRODUCCIÓN: base URL api.catcher.es (cutover 2026-07-20).
//
// ── FIABILIDAD DE DIRECCIÓN (F2, 21/07) ──────────────────────────────────────
// El cliente es responsable de su dirección → al rider le mandamos:
//   TEXTO = lo que escribió el cliente (delivery.address), NUNCA el geocodedAddress
//           de la plataforma (mal en ~6%).
//   PIN   = si el geocoded de la plataforma COINCIDE con lo que escribió el cliente,
//           se usan sus coords (delivery.latitude/longitude). Si DISCREPA, se
//           re-geocodea el texto del cliente con Mapbox → coords correctas. Nunca se
//           manda el pin dudoso de Glovo en la discrepancia.
// Requiere el secreto MAPBOX_TOKEN (mismo pk.* del front). Sin él, el re-geocode se
// omite y caen las coords de Glovo (no peor que antes); con él, se corrige el ~6%.

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "@supabase/supabase-js";

// Base URLs de Catcher. Sandbox = staging. Producción = api.catcher.es.
const CATCHER_AUTH_URL = "https://api.catcher.es/auth/v1/authorize";
const CATCHER_ORDER_URL = "https://api.catcher.es/pitcher/v1/order";

const CATCHER_CONNECTOR_CODE = "catcher";

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface DeliveryInfo {
  address?: string;
  details?: string;
  latitude?: number;
  longitude?: number;
  postalCode?: string;
  geocodedAddress?: string;
}

// Extrae el objeto "delivery" del raw_tab (JSON crudo del ticket).
function extractDelivery(rawTab: string | null): DeliveryInfo | null {
  if (!rawTab) return null;
  try {
    const tab = JSON.parse(rawTab);
    if (tab?.delivery && typeof tab.delivery === "object") {
      return tab.delivery as DeliveryInfo;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Fiabilidad de dirección: detección de discrepancia address vs geocoded ──
function normStreet(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function streetLastWord(addr: string | null | undefined): string {
  const street = (addr ?? "").split(",")[0];
  const words = normStreet(street).split(" ").filter(Boolean);
  return words.length ? words[words.length - 1] : "";
}
// true = la calle que escribió el cliente NO aparece en el geocoded → discrepancia.
function addressMismatch(rawAddr: string | null | undefined, geo: string | null | undefined): boolean {
  if (!rawAddr || !geo) return false;
  const lw = streetLastWord(rawAddr);
  if (lw.length < 4) return false;
  return normStreet(geo).indexOf(lw) === -1;
}

// Re-geocode del texto del cliente con Mapbox (sesgo Madrid). null si no resuelve.
async function mapboxGeocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const token = Deno.env.get("MAPBOX_TOKEN") ?? "";
  if (!token || !query.trim()) return null;
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`
      + `?access_token=${token}&country=es&language=es&limit=1&proximity=-3.70,40.42`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const f = data?.features?.[0];
    if (!f || !Array.isArray(f.center)) return null;
    const [lng, lat] = f.center;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { lat, lng };
  } catch (e) {
    console.log("MAPBOX_GEOCODE_ERR", String(e));
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const sb = createClient(url, serviceKey);

  let body: { sale_id?: string; dry_run?: boolean; internal?: boolean };
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid json body" });
  }
  const saleId = body.sale_id;
  const dryRun = body.dry_run === true;

  // Frontera para invocación interna desde el trigger de BD.
  const INTERNAL_SECRET = "fv_catdisp_tnrMMcaI8gALFCitfvzPGsaHgQa3A83w";
  const gotSecret = req.headers.get("x-catcher-dispatch-secret");
  const isInternal = body.internal === true;
  if (isInternal && gotSecret !== INTERNAL_SECRET) {
    return json(401, { ok: false, error: "secreto interno inválido" });
  }

  if (!saleId) return json(400, { ok: false, error: "missing sale_id" });

  // 1. Leer el pedido.
  const { data: sale, error: saleErr } = await sb
    .from("sale")
    .select("id, account_id, location_id, raw_tab, total, customer_name, customer_phone, platform_order_code, external_ref, carrier_order_id, customer_note, source")
    .eq("id", saleId)
    .single();
  if (saleErr || !sale) return json(404, { ok: false, error: "sale not found" });

  // Idempotencia: no re-despachar (guardarraíl anti-doble-aviso).
  if (sale.carrier_order_id && !dryRun) {
    return json(200, { ok: true, alreadyDispatched: true, carrier_order_id: sale.carrier_order_id });
  }

  // 2. Local (recogida).
  const { data: loc, error: locErr } = await sb
    .from("locations")
    .select("id, name, address, lat, lng")
    .eq("id", sale.location_id)
    .single();
  if (locErr || !loc) return json(404, { ok: false, error: "location not found" });
  if (loc.lat == null || loc.lng == null) {
    return json(400, { ok: false, error: "el local no tiene coordenadas (recogida)" });
  }

  // 3. Conexión Catcher activa del local.
  const { data: conn, error: connErr } = await sb
    .from("account_connector")
    .select("id, config, is_active, status, connector:connector_id(code)")
    .eq("location_id", sale.location_id)
    .eq("is_active", true)
    .maybeSingle();
  // Nota: filtramos por código del conector abajo (el join no filtra en supabase-js directo).
  if (connErr) return json(500, { ok: false, error: connErr.message });
  // Buscar la conexión cuyo connector.code === 'catcher'
  let catcherConn = conn;
  if (!catcherConn || (catcherConn as any).connector?.code !== CATCHER_CONNECTOR_CODE) {
    const { data: conns } = await sb
      .from("account_connector")
      .select("id, config, is_active, status, connector:connector_id(code)")
      .eq("location_id", sale.location_id)
      .eq("is_active", true);
    catcherConn = (conns ?? []).find((c: any) => c.connector?.code === CATCHER_CONNECTOR_CODE) ?? null;
  }
  if (!catcherConn) {
    return json(400, { ok: false, error: "Catcher no está conectado en este local" });
  }

  // 4. Credenciales (Vault) + Location ID (config).
  const { data: secretData, error: secErr } = await sb.rpc("connector_secret_read", {
    p_account_connector_id: catcherConn.id,
  });
  if (secErr) return json(500, { ok: false, error: `read credentials: ${secErr.message}` });
  if (!secretData) return json(400, { ok: false, error: "sin credenciales guardadas" });

  const secrets = (secretData.secrets ?? {}) as Record<string, string>;
  const config = (secretData.config ?? {}) as Record<string, string>;
  const appId = secrets.app_id;
  const appSecret = secrets.app_secret;
  const locationIdCatcher = config.location_id ?? secrets.location_id;
  if (!appId || !appSecret || !locationIdCatcher) {
    return json(400, { ok: false, error: "credenciales incompletas (app_id/app_secret/location_id)" });
  }

  // 5. Dirección del cliente (raw_tab.delivery).
  const delivery = extractDelivery(sale.raw_tab);
  if (!delivery || delivery.latitude == null || delivery.longitude == null) {
    return json(400, { ok: false, error: "el pedido no tiene dirección de cliente (raw_tab.delivery)" });
  }

  // ── F2: TEXTO = lo que escribió el cliente (nunca el geocoded). PIN = si el
  // geocoded coincide, sus coords; si discrepa, re-geocode Mapbox del texto. ──
  const typedText = (delivery.address ?? "").trim() || (delivery.geocodedAddress ?? "").trim();
  const mism = addressMismatch(delivery.address, delivery.geocodedAddress);
  let dLat = delivery.latitude;
  let dLng = delivery.longitude;
  let coordsSource = "platform";
  if (mism) {
    const q = [delivery.address, delivery.postalCode, "Madrid", "España"]
      .map(x => (x ?? "").toString().trim()).filter(Boolean).join(", ");
    const mb = await mapboxGeocode(q);
    if (mb) {
      dLat = mb.lat; dLng = mb.lng; coordsSource = "mapbox";
    } else {
      coordsSource = "platform_fallback_mismatch"; // Mapbox no resolvió; último recurso.
    }
    console.log("CATCHER_ADDR_MISMATCH", { saleId, typed: delivery.address, geo: delivery.geocodedAddress, coordsSource });
  }

  // 6. Construir el payload de Catcher (/pitcher/v1/order).
  const orderPayload = {
    locationId: locationIdCatcher,
    orderPickupLocName: loc.name,
    orderPickupTime: new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 19).replace("T", " "),
    orderPaymentMethod: "card",
    orderDeliveryLocation: typedText,                 // ⟵ F2: dirección del CLIENTE, no el geocoded
    addressDetails: delivery.details ?? "",
    orderDeliveryLat: String(dLat),                   // ⟵ F2: pin re-geocodeado si discrepaba
    orderDeliveryLong: String(dLng),
    orderPickupLocation: loc.address ?? "",
    orderPickupLat: String(loc.lat),
    orderPickupLong: String(loc.lng),
    userPhone: sale.customer_phone ?? "",
    userName: sale.customer_name ?? "Cliente",
    orderSource: sale.source ?? "folvy",
    orderTotalAmount: sale.total != null ? String(Math.round(Number(sale.total) * 100)) : "0",
    orderInstructions: sale.customer_note ?? "",
    orderCode: sale.platform_order_code ?? sale.external_ref ?? sale.id.slice(0, 8),
    externalId: sale.id,
  };

  // DRY RUN: devolver el payload sin enviarlo.
  if (dryRun) {
    return json(200, { ok: true, dryRun: true, wouldSendTo: CATCHER_ORDER_URL, coordsSource, addressMismatch: mism, payload: orderPayload });
  }

  // 7. Autenticar contra Catcher.
  let token: string;
  try {
    let authRes: Response;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      authRes = await fetch(CATCHER_AUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId, appSecret, grant_type: "client_secret" }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
    } catch (netErr) {
      console.log("CATCHER_AUTH_NETERR", String(netErr));
      return json(502, { ok: false, error: "fallo de red al contactar Catcher auth", detail: String(netErr) });
    }
    if (!authRes.ok) {
      const t = await authRes.text();
      return json(502, { ok: false, error: `Catcher auth falló (${authRes.status})`, detail: t.slice(0, 300) });
    }
    const authJson = await authRes.json();
    token = authJson.token ?? authJson.access_token ?? authJson.jwt ?? authJson?.data?.token ?? authJson?.data?.access_token ?? authJson?.result?.token ?? "";
    if (!token) return json(502, { ok: false, error: "Catcher no devolvió token de autenticación" });
  } catch (e) {
    return json(502, { ok: false, error: `Catcher auth error: ${e instanceof Error ? e.message : String(e)}` });
  }

  // 8. Crear el pedido en Catcher.
  try {
    const orderRes = await fetch(CATCHER_ORDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify(orderPayload),
    });
    const orderText = await orderRes.text();
    let orderJson: any = null;
    try { orderJson = JSON.parse(orderText); } catch { /* respuesta no-JSON */ }

    if (!orderRes.ok) {
      await sb.from("sale").update({
        carrier_code: "catcher",
        dispatch_error: `Catcher order ${orderRes.status}: ${orderText.slice(0, 400)}`,
      }).eq("id", saleId);
      return json(502, { ok: false, error: `Catcher rechazó el pedido (${orderRes.status})`, detail: orderText.slice(0, 300) });
    }

    // Extraer el orderId de Catcher (la forma exacta la confirmamos con la respuesta real).
    const carrierOrderId =
      orderJson?.data?.response?.orderId ??
      orderJson?.data?.orderId ?? orderJson?.orderId ?? null;

    await sb.from("sale").update({
      carrier_code: "catcher",
      carrier_order_id: carrierOrderId ? String(carrierOrderId) : null,
      delivery_state: "pending",
      dispatch_error: null,
    }).eq("id", saleId);

    return json(200, { ok: true, carrier_order_id: carrierOrderId, coordsSource, catcherResponse: orderJson ?? orderText.slice(0, 500) });
  } catch (e) {
    return json(502, { ok: false, error: `Catcher order error: ${e instanceof Error ? e.message : String(e)}` });
  }
});
