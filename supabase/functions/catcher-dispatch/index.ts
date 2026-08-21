// supabase/functions/catcher-dispatch/index.ts
//
// Despacha un pedido (sale) al broker de reparto Catcher.
// Invocación manual de prueba: POST { sale_id, dry_run? }.
//   - dry_run:true  → construye y DEVUELVE el payload SIN enviarlo a Catcher.
//   - dry_run:false → autentica, llama a /pitcher/v1/order y guarda el resultado.
//
// Lee credenciales (cifradas en Vault) vía connector_secret_read (service_role).
// Recogida: del local (locations.address + lat/lng).
// Idempotente: si el sale ya tiene carrier_order_id, no re-despacha.
//
// ── DÓNDE VIVE LA DIRECCIÓN DEL CLIENTE, POR ORIGEN (21/08/2026) ─────────────
// No hay un sitio: hay tres, y confundirlos costó un mes de pedidos sin rider.
//
//   lastapp     -> raw_tab.delivery       (camino histórico)
//   folvy_shop  -> customer_address       (lat/lng geocodificadas en el checkout)
//   hubrise     -> raw_tab.customer       ← ESTE FALTABA
//
// Medido en producción sobre los pedidos own_delivery de 30 días, y son
// COMPLEMENTARIOS AL 100 %:
//
//   origen      pedidos   coords en .customer   coords en .delivery
//   lastapp        408             0                   408
//   hubrise          4             4                     0
//
// ⚠️ EN HUBRISE, `raw_tab.delivery` NO ES LA DIRECCIÓN: es el bloque del
// REPARTIDOR DE LA PLATAFORMA (carrier, driver_name, driver_latitude...). En el
// pedido 03c5bec4 del 21/08 trae carrier="Uber Eats" y driver_name="Anthony
// David". Leerlo como dirección mandaría al rider a la posición del repartidor
// de Uber. Por eso el camino de hubrise NO cae a raw_tab.delivery: si customer
// no resuelve, se para y se dice.
//
// PRODUCCIÓN: base URL api.catcher.es (cutover 2026-07-20).
//
// ⚠️ VERSIONADO (26/07/2026): este fichero estuvo DESINCRONIZADO de la función
// viva. En Supabase corría ya el secreto interno leído de Vault (internal_secret)
// mientras el repo seguía con el secreto escrito a mano; desplegar el repo tal
// cual habría RETROCEDIDO esa mejora. Aquí quedan fusionadas la versión viva
// (v37) y el código de pase. Antes de desplegar esta función, comparar siempre
// con `supabase functions download` / MCP: el repo es la verdad sólo si se
// mantiene al día.
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
//
// ── CÓDIGO DE PASE (26/07) ───────────────────────────────────────────────────
// Al repartidor propio se le manda el código CORTO (pos_short_code, "G315"), no
// el número de 12 dígitos de la plataforma: es el que puede cantar al llegar y
// comparar con el que lleva la bolsa impresa. externalId sigue siendo sale.id
// INTACTO (identidad de reconciliación y de las alarmas de reparto).

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

// ── Dirección de un pedido del SHOP PROPIO (source='folvy_shop') ────────────
// Los pedidos de Last.app traen la dirección dentro de raw_tab.delivery. Los del
// Shop NO: la guardan en sale.delivery_address (texto) y las coordenadas en
// customer_address (lat/lng geocodificadas con Mapbox por place_shop_order, que
// además separa el piso/puerta en `detail`).
// Se prefiere la dirección predeterminada del cliente y, si hay varias, la más
// reciente — que es la que el checkout acaba de sembrar/refrescar para el pedido.
async function deliveryFromShop(
  sb: ReturnType<typeof createClient>,
  sale: { customer_id?: string | null; delivery_address?: string | null; customer_note?: string | null },
): Promise<DeliveryInfo | null> {
  if (!sale.customer_id) return null;
  const { data, error } = await sb
    .from("customer_address")
    .select("address, detail, lat, lng")
    .eq("customer_id", sale.customer_id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const a = data[0] as { address?: string | null; detail?: string | null; lat?: number | null; lng?: number | null };
  if (a.lat == null || a.lng == null) return null;
  return {
    // TEXTO: manda lo que quedó en la venta; si faltara, la dirección guardada.
    address: (sale.delivery_address ?? a.address ?? "").trim() || undefined,
    details: (a.detail ?? sale.customer_note ?? "").trim() || undefined,
    latitude: Number(a.lat),
    longitude: Number(a.lng),
    // Sin geocodedAddress: estas coords YA vienen de geocodificar ese mismo
    // texto en el checkout, así que no hay discrepancia que detectar.
  };
}

// ── Dirección de un pedido de HUBRISE (source='hubrise') ────────────────────
// HubRise la manda en raw_tab.customer, con las coordenadas ya puestas: no hay
// que geocodificar nada ni pedirle nada a HubRise. Verificado en el pedido de
// Milanesa House del 21/08 (Claudio Coello 101).
//
// SOBRE geocodedAddress, QUE ES LA PARTE DELICADA: HubRise NO manda ese campo.
// Se deja SIN PONER a propósito — no es un olvido. La lógica F2 compara el texto
// del cliente con el geocodificado de la plataforma y re-geocodea con Mapbox si
// discrepan; sin geocoded, addressMismatch() devuelve false y se usan las
// coordenadas de HubRise tal cual. Es el comportamiento correcto: no se puede
// detectar una discrepancia contra un dato que no existe, y inventarse una
// re-geocodificación sería cambiar un pin bueno por uno adivinado.
function deliveryFromHubrise(
  rawTab: string | null,
  sale: { delivery_address?: string | null },
): DeliveryInfo | null {
  if (!rawTab) return null;
  let c: Record<string, unknown> | null = null;
  try {
    const tab = JSON.parse(rawTab);
    if (tab?.customer && typeof tab.customer === "object") c = tab.customer;
  } catch {
    return null;
  }
  if (!c) return null;

  const txt = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  // LAT/LONG VIENEN COMO TEXTO ("40.431534"). Hay que convertirlas: si se
  // pasaran tal cual, String(dLat) daría lo mismo pero la comprobación
  // `delivery.latitude == null` de más abajo dejaría pasar un "" o un "abc".
  const num = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const lat = num(c.latitude);
  const lng = num(c.longitude);
  if (lat === undefined || lng === undefined) return null;

  // TEXTO: manda sale.delivery_address, que ya viene compuesto y verificado
  // desde el arreglo del 18/08 — un dato se calcula en un sitio y el resto lo
  // lee. Sólo si faltara se recompone aquí desde las piezas.
  const ciudad = txt(c.city);
  const a2 = txt(c.address_2);
  const compuesta = [txt(c.address_1), a2 && a2 !== ciudad ? a2 : "", txt(c.postal_code)]
    .filter(Boolean).join(", ");
  const address = txt(sale.delivery_address) || compuesta;
  if (!address) return null;

  return {
    address,
    details: txt(c.delivery_notes) || undefined,
    latitude: lat,
    longitude: lng,
    postalCode: txt(c.postal_code) || undefined,
    // geocodedAddress: A PROPÓSITO SIN PONER. Ver el comentario de arriba.
  };
}

// ── Fiabilidad de dirección: detección de discrepancia address vs geocoded ──
//
// ⚠️ DERIVA CONOCIDA (21/08/2026), sólo de forma, no de comportamiento: la
// línea de abajo lleva aquí el escape `\u0300-\u036f`, pero en PRODUCCIÓN
// (v49-v51) vive con esos dos caracteres ya decodificados, porque el transporte
// JSON del MCP de despliegue decodifica los escapes al subir el fichero. Es la
// misma trampa que costó tres intentos en hubriseSku.ts el 19/08.
//
// La clase de caracteres es LA MISMA y el comportamiento también — comprobado
// el 21/08 con un dry_run sobre un pedido de "Calle de Federico Gutiérrez":
// addressMismatch=false y sin llamar a Mapbox, que es lo correcto.
//
// NO es la deriva peligrosa de 2026-07-26 (allí producción tenía una mejora que
// el repo no, y desplegar habría RETROCEDIDO). Aquí es al revés: el repo está
// mejor escrito, y desplegarlo desde el CLI de Supabase —o con el escape doble
// en el JSON— lo normaliza sin riesgo en ninguna dirección.
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

// ── B36 · NINGUNA SALIDA MUDA (21/08) ───────────────────────────────────────
// Cuando esta función se cortaba antes de llamar a Catcher hacía `return
// json(400, ...)` y NO escribía nada en el pedido: dispatch_error se quedaba a
// null. Lo único que veía luego la oficina era el vigía de los 8 minutos:
//
//   «Auto-despacho SIN CONFIRMAR: sin rider tras 8 min. Revisar/despachar a mano.»
//
// Ese texto describe un síntoma y esconde DOS causas opuestas:
//   · Glovo por Last  -> Catcher SÍ recibió el pedido y ningún rider lo cogió.
//   · Just Eat por HubRise -> Catcher NUNCA recibió el pedido.
// Por eso llevaba desde el 13/08 sin diagnosticarse.
//
// A partir de aquí, todo camino que NO llegue a crear el pedido en Catcher
// escribe su motivo antes de devolver. El vigía ya hace
// `coalesce(s.dispatch_error, ...)`, así que el motivo concreto sobrevive.
//
// NO se escribe carrier_code: no se ha usado Catcher todavía. Y el fallo al
// escribir NUNCA tapa el error original — se registra y se devuelve el de
// verdad, que es lo que hay que arreglar.
//
// UN ENSAYO NO ESCRIBE. `dryRun` no toca el pedido: un dry_run es una prueba y
// una prueba que deja rastro en producción deja de ser una prueba. Se detectó
// probando este mismo arreglo el 21/08 — el ensayo sobre un pedido de Uber
// Eats le escribió un dispatch_error que no correspondía a ningún intento real
// de despacho. El motivo se devuelve igual en la respuesta.
async function sinLlegarACatcher(
  // deno-lint-ignore no-explicit-any
  sb: any,
  saleId: string,
  status: number,
  motivo: string,
  dryRun: boolean,
  extra?: Record<string, unknown>,
): Promise<Response> {
  if (!dryRun) {
    try {
      await sb.from("sale").update({ dispatch_error: motivo }).eq("id", saleId);
    } catch (e) {
      console.log("CATCHER_DISPATCH_ERROR_WRITE_FAIL", { saleId, motivo, e: String(e) });
    }
  }
  return json(status, { ok: false, error: motivo, ...(extra ?? {}) });
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
  // Secreto leído de Vault (fuente única) vía RPC service-role; nunca hardcodeado.
  const isInternal = body.internal === true;
  if (isInternal) {
    const gotSecret = req.headers.get("x-catcher-dispatch-secret");
    const { data: expectedSecret, error: intSecErr } = await sb.rpc("internal_secret", { p_name: "catcher_dispatch_secret" });
    if (intSecErr || !expectedSecret || gotSecret !== expectedSecret) {
      // A PROPÓSITO no escribe dispatch_error, aunque sea una salida sin llegar
      // a Catcher: es la frontera de autenticación y aún no se ha comprobado
      // quién llama. Dejar que un no autenticado escriba texto en cualquier
      // pedido por su id sería abrir una puerta para cerrar una ventana. Queda
      // en el log, que es donde se mira un fallo de secreto.
      console.log("CATCHER_DISPATCH_BAD_SECRET", { saleId: body.sale_id ?? null });
      return json(401, { ok: false, error: "secreto interno inválido" });
    }
  }

  if (!saleId) return json(400, { ok: false, error: "missing sale_id" });

  // 1. Leer el pedido.
  const { data: sale, error: saleErr } = await sb
    .from("sale")
    .select("id, account_id, location_id, raw_tab, total, customer_name, customer_phone, pos_short_code, platform_order_code, external_ref, carrier_order_id, customer_note, source, customer_id, delivery_address")
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
  if (locErr || !loc) {
    return await sinLlegarACatcher(sb, saleId, 404, "el local del pedido no existe (location not found)", dryRun);
  }
  if (loc.lat == null || loc.lng == null) {
    return await sinLlegarACatcher(sb, saleId, 400, "el local no tiene coordenadas (recogida)", dryRun);
  }

  // 3. Conexión Catcher activa del local.
  const { data: conn, error: connErr } = await sb
    .from("account_connector")
    .select("id, config, is_active, status, connector:connector_id(code)")
    .eq("location_id", sale.location_id)
    .eq("is_active", true)
    .maybeSingle();
  // Nota: filtramos por código del conector abajo (el join no filtra en supabase-js directo).
  if (connErr) return await sinLlegarACatcher(sb, saleId, 500, `no se pudo leer la conexión de Catcher: ${connErr.message}`, dryRun);
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
    return await sinLlegarACatcher(sb, saleId, 400, "Catcher no está conectado en este local", dryRun);
  }

  // 4. Credenciales (Vault) + Location ID (config).
  const { data: secretData, error: secErr } = await sb.rpc("connector_secret_read", {
    p_account_connector_id: catcherConn.id,
  });
  if (secErr) return await sinLlegarACatcher(sb, saleId, 500, `no se pudieron leer las credenciales de Catcher: ${secErr.message}`, dryRun);
  if (!secretData) return await sinLlegarACatcher(sb, saleId, 400, "Catcher sin credenciales guardadas", dryRun);

  const secrets = (secretData.secrets ?? {}) as Record<string, string>;
  const config = (secretData.config ?? {}) as Record<string, string>;
  const appId = secrets.app_id;
  const appSecret = secrets.app_secret;
  const locationIdCatcher = config.location_id ?? secrets.location_id;
  if (!appId || !appSecret || !locationIdCatcher) {
    return await sinLlegarACatcher(sb, saleId, 400, "credenciales de Catcher incompletas (app_id/app_secret/location_id)", dryRun);
  }

  // 5. Dirección del cliente, RESUELTA POR ORIGEN (los tres caminos).
  //    · folvy_shop -> customer_address (lat/lng, detail) + sale.delivery_address
  //    · hubrise    -> raw_tab.customer (dirección + coords, ya en el pedido)
  //    · lastapp y demás -> raw_tab.delivery (camino histórico, INTACTO)
  let delivery: DeliveryInfo | null = null;
  if (sale.source === "folvy_shop") {
    delivery = await deliveryFromShop(sb, sale);
    // El Shop SÍ puede caer a raw_tab por si ese pedido lo trajera igualmente.
    if (!delivery) delivery = extractDelivery(sale.raw_tab);
  } else if (sale.source === "hubrise") {
    // SIN CAÍDA a raw_tab.delivery: en HubRise ese bloque es el REPARTIDOR de
    // la plataforma, no la dirección del cliente (ver cabecera). Caer ahí
    // mandaría al rider a donde está el repartidor de Uber.
    delivery = deliveryFromHubrise(sale.raw_tab, sale);
  } else {
    delivery = extractDelivery(sale.raw_tab);
  }
  if (!delivery || delivery.latitude == null || delivery.longitude == null) {
    const motivo =
      sale.source === "folvy_shop"
        ? "el pedido del Shop no tiene dirección con coordenadas (customer_address.lat/lng)"
        : sale.source === "hubrise"
          ? "el pedido de HubRise no tiene dirección con coordenadas (raw_tab.customer.latitude/longitude)"
          : "el pedido no tiene dirección de cliente (raw_tab.delivery)";
    return await sinLlegarACatcher(sb, saleId, 400, motivo, dryRun);
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
    // CÓDIGO DE PASE: al repartidor propio le mandamos el CORTO (pos_short_code), no
    // el nº de 12 dígitos de plataforma — es el que puede cantar y comparar. Fallbacks:
    // nº de plataforma, external_ref, y en último caso los primeros 8 del id.
    orderCode: sale.pos_short_code ?? sale.platform_order_code ?? sale.external_ref ?? sale.id.slice(0, 8),
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
      return await sinLlegarACatcher(sb, saleId, 502,
        "fallo de red al contactar con Catcher (auth)", dryRun, { detail: String(netErr) });
    }
    if (!authRes.ok) {
      const t = await authRes.text();
      return await sinLlegarACatcher(sb, saleId, 502,
        `Catcher rechazó la autenticación (${authRes.status})`, dryRun, { detail: t.slice(0, 300) });
    }
    const authJson = await authRes.json();
    token = authJson.token ?? authJson.access_token ?? authJson.jwt ?? authJson?.data?.token ?? authJson?.data?.access_token ?? authJson?.result?.token ?? "";
    if (!token) return await sinLlegarACatcher(sb, saleId, 502, "Catcher no devolvió token de autenticación", dryRun);
  } catch (e) {
    return await sinLlegarACatcher(sb, saleId, 502,
      `error autenticando con Catcher: ${e instanceof Error ? e.message : String(e)}`, dryRun);
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
    // El POST del pedido se cayó por red: Catcher NO lo tiene.
    return await sinLlegarACatcher(sb, saleId, 502,
      `fallo de red creando el pedido en Catcher: ${e instanceof Error ? e.message : String(e)}`, dryRun);
  }
});
