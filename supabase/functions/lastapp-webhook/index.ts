// supabase/functions/lastapp-webhook/index.ts
//
// FRONTERA de ingesta de Last.app (principio de frontera única + origen-agnóstico).
// ============================================================================
// Traduce eventos de Last a la MÁQUINA DE ESTADOS CANÓNICA de la venta (motor):
//   tab:created                        -> upsertSale: la venta NACE 'open' (sin coste/consumo)
//   tab:updated / tab_products:updated -> upsertSale: RE-SYNC de líneas (solo si 'open')
//   tab:closed                         -> upsertSale + close_sale (consolida coste+consumo)
//   tab:cancelled                      -> cancel_sale por cada bill (status='cancelled' + revierte)
//   bill:deleted / payment:deleted     -> cancel_sale (DEFENSIVO: estructura no verificada aún)
//   (resto)                            -> solo log
//
// MODELO A: la venta figura desde que entra (tab:created) y se resta si se cancela.
// El consumo de stock se escribe SOLO al cerrar (close_sale), nunca en 'open'.
// Identidad: external_ref = bill.id (una venta por bill); external_tab_ref = tab.id
// (metadato para agrupar el pedido en el KDS / futura sala).
//
// RESOLUCIÓN DE MARCA (corregido 12/06): external_brand_map por (locationId +
// locationBrandId) del TICKET (primario, estable) -> respaldo por producto/catálogo.
//
// ── ALIMENTA EL FEED DE ORDERS (19/06) ───────────────────────────────────────
// Last es ahora un adaptador de pleno derecho del feed de pedidos (igual que
// HubRise). El webhook escribe:
//   (1) order_status (ciclo de plataforma): Last NACE 'accepted' (no hay paso de
//       aceptación en el TPV; el pedido ya viene confirmado — decisión A). Cierre
//       -> 'completed'. Cancelación -> 'cancelled'.
//   (2) campos CANÓNICOS extraídos del tab (cliente/teléfono/dirección/hora/nota),
//       las MISMAS columnas que rellena HubRise. La pantalla los lee agnóstica.
// El adaptador adapt_lastapp_order NO se toca (solo arma líneas).
//
// ── FIABILIDAD DE DIRECCIÓN (21/07) ──────────────────────────────────────────
// La dirección CANÓNICA es lo que ESCRIBIÓ el cliente (address+details+CP), NO el
// geocodedAddress de la plataforma (que falla ~6%: el rider iba al sitio malo). El
// cliente es responsable de su dirección. Se calcula address_status ('ok' |
// 'needs_review') comparando la calle del cliente con la del geocoded → marca
// interna, sin bloqueo. El pin correcto para el rider (re-geocode) es F2.
//
// Idempotencia: external_ref = bill.id. Cancelación idempotente (no re-cancela).
//
// SEGURIDAD: Last NO firma; manda un `authorization` fijo -> LASTAPP_WEBHOOK_TOKEN.
// DEPLOY: SIEMPRE con --no-verify-jwt (sin la flag el gateway corta con 401 antes
// de ejecutar y la ingesta falla en silencio).

import { corsHeaders } from "../_shared/cors.ts";
import { encolarAlerta, claveDelDia } from "../_shared/alerta.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ── Normalización (idéntica al adaptador y al catálogo) ──
function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\.$/, "")
    .replace(/\s+/g, " ");
}

function channelSlug(paymentType: string | null | undefined): string | null {
  if (!paymentType) return null;
  const t = paymentType.toLowerCase();
  if (t.includes("glovo")) return "glovo";
  if (t.includes("uber")) return "uber";
  if (t.includes("justeat") || t.includes("just_eat") || t.includes("just eat")) return "justeat";
  if (t.includes("shop") || t.includes("local") || t.includes("onsite")) return "shop";
  return null;
}

function mapServiceType(pickupType: string | null | undefined): string | null {
  if (!pickupType) return null;
  const t = pickupType.toLowerCase();
  if (t === "delivery") return "platform_delivery";
  if (t === "owndelivery") return "own_delivery";
  if (t === "pickup" || t === "takeaway") return "pickup";
  return null;
}

// ── Tipos mínimos del payload ──
interface LastProduct {
  name?: string;
  quantity?: number;
  price?: number;
  catalogProductId?: string | null;
  organizationProductId?: string | null;
}
interface LastPayment { type?: string | null }
interface LastBill {
  id?: string; total?: number; deliveryFee?: number; discountTotal?: number;
  tax?: number; taxableBase?: number; creationTime?: string; finalizingTime?: string;
  deleted?: boolean; payments?: LastPayment[];
}
// ⟵ NUEVO (19/06): sub-objetos del tab con cliente/entrega (ya venían en raw_tab,
// no se tipaban). Forma verificada en BBDD: customerInfo{name,surname,phoneNumber},
// delivery{address,details,postalCode,geocodedAddress,...}.
interface LastCustomerInfo { name?: string | null; surname?: string | null; phoneNumber?: string | null }
interface LastDelivery {
  address?: string | null; details?: string | null; postalCode?: string | null;
  geocodedAddress?: string | null;
}
interface LastTab {
  id?: string; locationId?: string; locationBrandId?: string | null; // ⟵ marca del ticket
  source?: string; pickupType?: string | null;
  closeTime?: string; creationTime?: string; products?: LastProduct[]; bills?: LastBill[];
  // ⟵ NUEVO (19/06): datos canónicos del pedido
  customerInfo?: LastCustomerInfo | null;
  delivery?: LastDelivery | null;
  customerNote?: string | null;
  schedulingTime?: string | null;
  // ⟵ NUEVO (20/06): códigos de pedido. name = nº REAL de la plataforma (Glovo
  // 101688354460 / JustEat 187227548 / Uber AF5D0); code = corto interno de Last
  // (G931/U382/J076), efímero. Verificado contra raw_tab en BBDD.
  name?: string | null;
  code?: string | null;
}

// ── Fiabilidad de dirección (21/07) ──
// El cliente es responsable de su dirección → la canónica es lo que ESCRIBIÓ, no el
// geocodedAddress (mal en ~6%). Marcamos la discrepancia en address_status.
function normStreet(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
// Última palabra del nombre de calle (antes de la 1ª coma) = la más distintiva y
// robusta a la abreviatura "Calle"->"C." que hace el geocoder.
function streetLastWord(addr: string | null | undefined): string {
  const street = (addr ?? "").split(",")[0];
  const words = normStreet(street).split(" ").filter(Boolean);
  return words.length ? words[words.length - 1] : "";
}
// true = la calle que escribió el cliente NO aparece en el geocoded → discrepancia.
function addressMismatch(rawAddr: string | null | undefined, geo: string | null | undefined): boolean {
  if (!rawAddr || !geo) return false;   // sin ambos, nada que comparar
  const lw = streetLastWord(rawAddr);
  if (lw.length < 4) return false;      // palabra corta, poco fiable
  return normStreet(geo).indexOf(lw) === -1;
}

// ── NUEVO (19/06): compone los campos CANÓNICOS del pedido desde el tab ──
// Mismas columnas que rellena el adaptador HubRise. Agnóstico para la pantalla.
// (20/06) Añade los DOS códigos de pedido: platform_order_code = nº real de la
// plataforma (portable: cada frontera lo rellena desde su payload; el ticket lo
// pinta sin saber de Last) y pos_short_code = corto interno de Last (referencia;
// quedará null en pedidos que NO entren por Last, p.ej. HubRise — y eso es correcto).
// (21/07) delivery_address = lo que ESCRIBIÓ el cliente (address+details+CP), NO el
// geocodedAddress; + address_status para la marca interna de discrepancia.
function buildCanonicalFields(tab: LastTab): {
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  address_status: string;
  expected_time: string | null;
  customer_note: string | null;
  platform_order_code: string | null;
  pos_short_code: string | null;
} {
  const ci = tab.customerInfo ?? null;
  const d = tab.delivery ?? null;

  const name = [ci?.name, ci?.surname].filter(Boolean).join(" ").trim();

  // Dirección CANÓNICA = lo que escribió el cliente (address + details + CP). El
  // geocodedAddress de la plataforma NO manda (el cliente es responsable de su
  // dirección; el geocoder falla ~6%). Si el cliente no escribió nada, cae al geocoded.
  let addr: string | null = null;
  let addressStatus = "ok";
  if (d) {
    const typed = [d.address, d.details, d.postalCode].map(x => (x ?? "").trim()).filter(Boolean);
    const typedAddr = typed.length ? typed.join(", ") : null;
    const geo = (d.geocodedAddress ?? "").trim() || null;
    addr = typedAddr ?? geo;
    addressStatus = addressMismatch(d.address, geo) ? "needs_review" : "ok";
  }

  return {
    customer_name: name || null,
    customer_phone: (ci?.phoneNumber ?? "").trim() || null,
    delivery_address: addr,
    address_status: addressStatus,
    expected_time: (tab.schedulingTime ?? "").trim() || null,  // ISO de Last (programado); null = ASAP
    customer_note: (tab.customerNote ?? "").trim() || null,
    platform_order_code: (tab.name ?? "").trim() || null,      // ⟵ nº real de plataforma
    pos_short_code: (tab.code ?? "").trim() || null,           // ⟵ corto de Last (efímero)
  };
}

// ── Caché mínima: SOLO lo que la frontera necesita para la CABECERA de la venta ──
interface HeaderCaches {
  catalogByCatProd: Map<string, { external_brand_name: string | null }>;
  brandByName: Map<string, string>;
  brandByExternalId: Map<string, string>;   // ⟵ mapa estable "locId|brandId" -> brand_id
  channelBySlug: Map<string, string>;
  folvyLocationId: string | null;
}

async function loadAllPaged(
  sb: SupabaseClient, table: string, select: string, eqColumn: string, eqValue: string,
): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const out: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb.from(table).select(select)
      .eq(eqColumn, eqValue).range(offset, offset + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as Record<string, unknown>[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function loadHeaderCaches(sb: SupabaseClient, accountId: string, lastLocationId: string): Promise<HeaderCaches> {
  const catalog = await loadAllPaged(sb, "external_catalog_product",
    "catalog_product_id, external_brand_name", "account_id", accountId);
  const catalogByCatProd = new Map<string, { external_brand_name: string | null }>();
  for (const r of catalog) {
    if (r.catalog_product_id) {
      catalogByCatProd.set(r.catalog_product_id as string, {
        external_brand_name: (r.external_brand_name as string | null) ?? null,
      });
    }
  }

  const brands = await loadAllPaged(sb, "brand", "id, name, is_active", "account_id", accountId);
  const brandByName = new Map<string, string>();
  for (const b of brands) {
    if (b.is_active === false) continue;
    if (b.name && (b.name as string).trim().toUpperCase() === "FOODINT") continue;
    const k = normalize(b.name as string);
    if (k && !brandByName.has(k)) brandByName.set(k, b.id as string);
  }
  const dirtyBurgerId = brandByName.get(normalize("Dirty Burger"));
  if (dirtyBurgerId) brandByName.set(normalize("Dirty Burgers"), dirtyBurgerId);

  // external_brand_map = FUENTE PRIMARIA de marca.
  // Clave compuesta "external_location_id|external_brand_id" -> brand_id.
  const brandMap = await loadAllPaged(sb, "external_brand_map",
    "external_location_id, external_brand_id, brand_id, is_ignored, source", "account_id", accountId);
  const brandByExternalId = new Map<string, string>();
  for (const m of brandMap) {
    if (m.source !== "lastapp") continue;
    if (m.is_ignored === true) continue;
    if (!m.brand_id) continue;
    const key = `${m.external_location_id}|${m.external_brand_id}`;
    brandByExternalId.set(key, m.brand_id as string);
  }

  const channels = await loadAllPaged(sb, "sales_channel", "id, slug, is_active", "account_id", accountId);
  const channelBySlug = new Map<string, string>();
  for (const c of channels) {
    if (c.is_active === false) continue;
    if (c.slug) channelBySlug.set((c.slug as string).toLowerCase(), c.id as string);
  }

  const { data: locMap, error: locErr } = await sb.from("external_location_map")
    .select("location_id").eq("account_id", accountId).eq("source", "lastapp")
    .eq("external_location_id", lastLocationId).maybeSingle();
  if (locErr) throw new Error(`external_location_map: ${locErr.message}`);
  const folvyLocationId = (locMap?.location_id as string | undefined) ?? null;

  return { catalogByCatProd, brandByName, brandByExternalId, channelBySlug, folvyLocationId };
}

// Resolución de marca en DOS PASOS.
//   1) PRIMARIO: por locationId+locationBrandId del TICKET vía external_brand_map.
//   2) RESPALDO: por producto -> catálogo -> nombre (solo si falla 1).
function resolveSaleBrand(
  tab: LastTab, products: LastProduct[], caches: HeaderCaches,
): string | null {
  const extLoc = tab.locationId ?? null;
  const extBrand = tab.locationBrandId ?? null;
  if (extLoc && extBrand) {
    const fromMap = caches.brandByExternalId.get(`${extLoc}|${extBrand}`);
    if (fromMap) return fromMap;
  }
  for (const p of products) {
    if (!p.catalogProductId) continue;
    const cat = caches.catalogByCatProd.get(p.catalogProductId);
    if (!cat) continue;
    const brandId = caches.brandByName.get(normalize(cat.external_brand_name));
    if (brandId) return brandId;
  }
  return null;
}

// ── upsertSale: crea o REFRESCA la venta desde (bill, tab). NO la cierra. ──
// Idempotente por external_ref = bill.id. Reutilizable por tab:created (nace),
// tab:updated/tab_products:updated (re-sync) y tab:closed (que además cierra).
// GUARD DE ESTADO: una venta ya 'closed'/'cancelled' NO se re-adapta (un evento
// tardío no puede corromper una venta consolidada, ni revertir su order_status).
// ── EL PEDIDO ES LA COMANDA, NO LA FACTURA (13/09) ─────────────────────────
//
// QUE PASABA. Cerrar una comanda A MANO en Last emite una FACTURA NUEVA para
// esa misma comanda. La identidad de la venta es `external_ref = bill.id`, asi
// que la factura nueva no casaba con nada y nacia una segunda venta, que
// ademas se cerraba y volvia a escribir consumo. El `tab.id` viajaba como
// `external_tab_ref` pero era metadato: no lo miraba nadie.
//
// MEDIDO el 12/09, desde el 12/06: 25 comandas con una venta de mas, 649,17 EUR
// contados dos veces y ~139 movimientos de almacen duplicados. Las tres de ese
// dia se vieron porque la impresora de cocina saco tickets de pedidos ya
// servidos. La rafaga del 02/07 20:01-20:03 —catorce— es el mismo mecanismo:
// catorce comandas cerradas a mano seguidas, no un reproceso.
//
// LO QUE DISTINGUE UNA COSA DE LA OTRA (decision de Julio, 13/09):
//   · FACTURA REPETIDA: mismo importe que una venta que ya existe para esa
//     comanda -> NO se crea nada. Se apunta y se cuenta.
//   · FACTURA ANADIDA: importe distinto, y entre todas suman la comanda -> es
//     una CUENTA PARTIDA. Se crea, colgando de la misma comanda.
//
// POR QUE EL IMPORTE Y NO LAS LINEAS, que es lo que pedia la decision: medido,
// `LastBill` NO trae lineas — solo totales (id, total, deliveryFee,
// discountTotal, tax, taxableBase, payments). Las lineas que se guardan son
// las del TAB, y son las mismas para las dos facturas. El importe es el unico
// discriminador que Last da.
//
// Y HOY NO HAY NI UNA CUENTA PARTIDA que proteger: de los 25 pares, los 25
// tienen el MISMO importe y ninguno nacio a la vez (94 minutos el mas rapido,
// 10 dias el mas lento). Cuando entre sala con el cliente 2, las partidas
// tendran importes distintos y pasaran por la otra rama.
//
// EL LIMITE, dicho: dos comensales que paguen EXACTAMENTE la mitad cada uno
// darian dos facturas del mismo importe, y la segunda se leeria como repetida.
// Por eso esto NUNCA es silencioso: cada vez que frena, lo cuenta en el
// informe y lo encola como aviso con el id de la factura. Si alguna vez se
// equivoca, se ve el mismo dia — que es lo contrario de lo que ha pasado
// durante tres meses.
async function ventaDeLaComanda(
  sb: SupabaseClient, accountId: string, tabId: string | null, totalBill: number,
): Promise<{ id: string; status: string; total: number } | null> {
  if (!tabId) return null;
  const { data, error } = await sb.from("sale")
    .select("id, status, total, external_ref")
    .eq("account_id", accountId).eq("source", "lastapp")
    .eq("external_tab_ref", tabId).neq("status", "cancelled");
  // Un buscador que no puede buscar NO deja pasar como si no hubiera nada: eso
  // es justo como se crea el duplicado. Se lanza y el evento queda sin
  // procesar, que se ve en `lastapp_webhook_log`.
  if (error) throw new Error(`busqueda por comanda ${tabId}: ${error.message}`);
  for (const v of data ?? []) {
    // Redondeo a centimos: el total viaja como numeric y vuelve como cadena.
    if (Math.abs(Number(v.total ?? 0) - totalBill) < 0.005) {
      return { id: v.id as string, status: (v.status as string) ?? "open", total: Number(v.total ?? 0) };
    }
  }
  return null;
}

/**
 * Lo que el informe del receptor cuenta de este arreglo. Va SIEMPRE.
 *
 * SE PONE A CERO EN CADA PETICION, y no es un detalle: una edge function
 * reutiliza el mismo isolate entre llamadas, asi que un contador de modulo
 * sin reiniciar sumaria el de la peticion anterior y el informe diria «3
 * facturas repetidas» en un aviso que no freno ninguna. Un contador que
 * arrastra es peor que no tenerlo: parece medido.
 */
let elContadorDeComandas = contadorDeComandasNuevo();

function contadorDeComandasNuevo() {
  return {
    facturas_repetidas: 0,
    cuentas_partidas: 0,
    detalle: [] as Array<Record<string, unknown>>,
  };
}

async function upsertSale(
  sb: SupabaseClient, accountId: string, bill: LastBill, tab: LastTab, caches: HeaderCaches,
): Promise<{ id: string; status: string; isNew: boolean; repetida?: boolean } | null> {
  const billId = bill.id;
  if (!billId) return null;
  if (bill.deleted === true) return null;

  const payType = bill.payments?.[0]?.type ?? tab.source ?? null;
  const slug = channelSlug(payType);
  const channelId = slug ? (caches.channelBySlug.get(slug) ?? null) : null;
  const products = Array.isArray(tab.products) ? tab.products : [];
  const saleBrandId = resolveSaleBrand(tab, products, caches);

  // Campos de cabecera/economía comunes a insert y update.
  // ⟵ NUEVO: order_status='accepted' (Last nace aceptado) + campos canónicos.
  const common = {
    external_channel_text: payType,
    channel_id: channelId,
    brand_id: saleBrandId,
    location_id: caches.folvyLocationId,
    external_brand_text: tab.locationBrandId ?? null,
    external_location_text: tab.locationId ?? null,
    external_tab_ref: tab.id ?? null,
    sold_at: bill.creationTime ?? bill.finalizingTime ?? tab.closeTime ?? new Date().toISOString(),
    total: typeof bill.total === "number" ? bill.total / 100 : 0,
    delivery_cost: typeof bill.deliveryFee === "number" ? bill.deliveryFee / 100 : null,
    discount_amount: typeof bill.discountTotal === "number" ? bill.discountTotal / 100 : null,
    tax: typeof bill.tax === "number" ? bill.tax / 100 : null,
    taxable_base: typeof bill.taxableBase === "number" ? bill.taxableBase / 100 : null,
    service_type: mapServiceType(tab.pickupType),
    order_status: "accepted",                 // ⟵ Last entra ya aceptado (decisión A)
    ...buildCanonicalFields(tab),             // ⟵ cliente/teléfono/dirección/address_status/hora/nota
    raw_products: JSON.stringify(products),
    raw_tab: JSON.stringify(tab),
  };

  // ¿existe ya?
  const { data: existing, error: exErr } = await sb.from("sale")
    .select("id, status")
    .eq("account_id", accountId).eq("source", "lastapp")
    .eq("external_ref", String(billId)).limit(1).maybeSingle();
  if (exErr) throw new Error(`exists check ${billId}: ${exErr.message}`);

  if (existing) {
    const status = (existing as { status?: string }).status ?? "open";
    // GUARD: no re-adaptar (ni re-tocar order_status) ventas ya consolidadas/canceladas.
    if (status !== "open") return { id: (existing as { id: string }).id, status, isNew: false };

    await sb.from("sale").update({ ...common, updated_at: new Date().toISOString() })
      .eq("id", (existing as { id: string }).id);
    const { error: adaptErr } = await sb.rpc("adapt_lastapp_order", { p_sale_id: (existing as { id: string }).id });
    if (adaptErr) console.error(`re-adapt ${billId}: ${adaptErr.message}`);
    return { id: (existing as { id: string }).id, status: "open", isNew: false };
  }

  // ── LA GUARDA POR COMANDA ────────────────────────────────────────────────
  // Esta factura no existe. Antes de crear una venta, se mira si la COMANDA ya
  // tiene una con este mismo importe.
  const yaEstaba = await ventaDeLaComanda(sb, accountId, tab.id ?? null, Number(common.total));
  if (yaEstaba) {
    elContadorDeComandas.facturas_repetidas++;
    if (elContadorDeComandas.detalle.length < 20) {
      elContadorDeComandas.detalle.push({
        tipo: "factura repetida",
        comanda: tab.id ?? null,
        factura_nueva: String(billId),
        venta_que_ya_existia: yaEstaba.id,
        estado_de_esa_venta: yaEstaba.status,
        importe: yaEstaba.total,
        que_se_ha_hecho: yaEstaba.status === "open"
          ? "no se crea otra; se refresca la que hay"
          : "no se crea otra; la que hay ya estaba consolidada y no se toca",
      });
    }
    console.error("COMANDA_CON_FACTURA_REPETIDA", tab.id, billId, yaEstaba.id);

    // Si la que hay sigue abierta, se REFRESCA (es lo que pedia la decision:
    // «como mucho se actualiza la que hay»). Si ya esta consolidada, no se
    // toca: un evento tardio no corrompe una venta cerrada.
    if (yaEstaba.status === "open") {
      await sb.from("sale").update({ ...common, updated_at: new Date().toISOString() })
        .eq("id", yaEstaba.id);
      const { error: adaptErr } = await sb.rpc("adapt_lastapp_order", { p_sale_id: yaEstaba.id });
      if (adaptErr) console.error(`re-adapt comanda ${tab.id}: ${adaptErr.message}`);
    }
    return { id: yaEstaba.id, status: yaEstaba.status, isNew: false, repetida: true };
  }

  // Importe distinto y la comanda ya tiene venta: es una CUENTA PARTIDA. Se
  // crea, colgando de la misma comanda por `external_tab_ref`, y se cuenta
  // para que se vea el dia que empiece a pasar.
  if (tab.id) {
    const { count, error: cErr } = await sb.from("sale")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("source", "lastapp")
      .eq("external_tab_ref", tab.id).neq("status", "cancelled");
    if (cErr) throw new Error(`conteo de la comanda ${tab.id}: ${cErr.message}`);
    if ((count ?? 0) > 0) {
      elContadorDeComandas.cuentas_partidas++;
      if (elContadorDeComandas.detalle.length < 20) {
        elContadorDeComandas.detalle.push({
          tipo: "cuenta partida",
          comanda: tab.id,
          factura_nueva: String(billId),
          importe: Number(common.total),
          ventas_que_ya_tenia: count,
          que_se_ha_hecho: "se crea, colgando de la misma comanda",
        });
      }
      console.error("COMANDA_CON_CUENTA_PARTIDA", tab.id, billId, count);
    }
  }

  // No existe -> nace 'open'.
  const { data: saleRow, error: saleErr } = await sb.from("sale").insert({
    account_id: accountId,
    source: "lastapp",
    external_ref: String(billId),
    status: "open",
    opened_at: bill.creationTime ?? bill.finalizingTime ?? new Date().toISOString(),
    is_active: true,
    ...common,
  }).select("id").single();
  if (saleErr || !saleRow) throw new Error(`sale insert ${billId}: ${saleErr?.message ?? "unknown"}`);

  const { error: adaptErr } = await sb.rpc("adapt_lastapp_order", { p_sale_id: saleRow.id });
  if (adaptErr) {
    // No dejamos una venta huérfana sin líneas.
    await sb.from("sale").delete().eq("id", saleRow.id);
    throw new Error(`adapt_lastapp_order ${billId}: ${adaptErr.message}`);
  }
  return { id: saleRow.id, status: "open", isNew: true };
}

// ── ingestBill: upsert + CIERRE (tab:closed). El consumo de stock se escribe AQUÍ. ──
async function ingestBill(
  sb: SupabaseClient, accountId: string, bill: LastBill, tab: LastTab, caches: HeaderCaches,
): Promise<{ written: boolean; reason?: string }> {
  const r = await upsertSale(sb, accountId, bill, tab, caches);
  if (!r) return { written: false, reason: "no bill id / deleted" };
  if (r.status === "cancelled") return { written: false, reason: "cancelled, no close" };
  // FACTURA REPETIDA: la venta de esta comanda ya existe y ya se cerro en su
  // dia. Volver a cerrarla escribiria consumo por segunda vez, que es
  // exactamente el dano que este arreglo viene a impedir.
  if (r.repetida) {
    return { written: false, reason: `factura repetida de la comanda ${tab.id ?? "?"}: no se cierra otra vez` };
  }

  // close_sale: status='closed' + consolida COSTE + CONSUMO (motor canónico).
  const { error: closeErr } = await sb.rpc("close_sale", { p_sale_id: r.id });
  if (closeErr) {
    console.error(`close_sale ${bill.id}: ${closeErr.message}`);
  } else {
    // ⟵ NUEVO: el pedido completó su ciclo de plataforma.
    const { error: osErr } = await sb.from("sale").update({ order_status: "completed" }).eq("id", r.id);
    if (osErr) console.error(`order_status completed ${bill.id}: ${osErr.message}`);
  }
  return { written: true };
}

// ── Cancelación: marca la(s) venta(s) por bill.id y revierte consumo ──
// Reutilizable por tab:cancelled (varios bills), bill:deleted y payment:deleted.
// Idempotente: si la venta no existe o ya está cancelled, no hace daño.
async function cancelByBillId(
  sb: SupabaseClient, accountId: string, billId: string, reason: string,
): Promise<boolean> {
  const { data: sale, error } = await sb.from("sale").select("id, status")
    .eq("account_id", accountId).eq("source", "lastapp")
    .eq("external_ref", String(billId)).limit(1).maybeSingle();
  if (error) { console.error(`cancel lookup ${billId}: ${error.message}`); return false; }
  if (!sale) return false;                       // no la teníamos: nada que cancelar
  if ((sale as { status?: string }).status === "cancelled") return true; // ya estaba

  const { error: cErr } = await sb.rpc("cancel_sale", {
    p_sale_id: (sale as { id: string }).id, p_reason: reason,
  });
  if (cErr) { console.error(`cancel_sale ${billId}: ${cErr.message}`); return false; }

  // ⟵ NUEVO: el pedido se canceló en el ciclo de plataforma.
  const { error: osErr } = await sb.from("sale").update({ order_status: "cancelled" })
    .eq("id", (sale as { id: string }).id);
  if (osErr) console.error(`order_status cancelled ${billId}: ${osErr.message}`);
  return true;
}

// Resuelve la cuenta a partir del locationId de Last (igual que tab:closed).
async function resolveAccountId(sb: SupabaseClient, lastLocationId: string): Promise<string | null> {
  const { data, error } = await sb.from("external_location_map")
    .select("account_id").eq("source", "lastapp")
    .eq("external_location_id", lastLocationId).maybeSingle();
  if (error) throw new Error(`external_location_map: ${error.message}`);
  return (data?.account_id as string | undefined) ?? null;
}

// ── Entrada HTTP (la frontera) ──
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const headers: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) headers[k] = v;

  // AUTORIZACIÓN EN LA FRONTERA: token fijo de Last.app.
  const expected = Deno.env.get("LASTAPP_WEBHOOK_TOKEN") ?? "";
  const got = headers["authorization"] ?? "";
  if (expected && got !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: Record<string, unknown> | null = null;
  let rawText = "";
  try {
    rawText = await req.text();
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = { _unparsed: rawText };
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // A cero en cada peticion: ver la nota de `elContadorDeComandas`.
  elContadorDeComandas = contadorDeComandasNuevo();

  const eventType = (payload?.type as string | undefined) ?? null;
  let note = "fase1-receptor";
  let processedOk = false;
  let processError: string | null = null;

  if (eventType === "tab:closed") {
    note = "frontera-tab-closed";
    try {
      const tab = (payload?.data ?? {}) as LastTab;
      const lastLocationId = tab.locationId ?? null;
      if (!lastLocationId) throw new Error("tab:closed sin locationId");

      const accountId = await resolveAccountId(sb, lastLocationId);
      if (!accountId) throw new Error(`location ${lastLocationId} no mapeada a ninguna cuenta`);

      const caches = await loadHeaderCaches(sb, accountId, lastLocationId);
      const bills = Array.isArray(tab.bills) ? tab.bills : [];
      for (const bill of bills) {
        await ingestBill(sb, accountId, bill, tab, caches);
      }
      processedOk = true;
    } catch (e) {
      processError = e instanceof Error ? e.message : String(e);
      console.error("tab:closed ingest error", processError);
    }

  } else if (eventType === "tab:created") {
    // El pedido NACE en vivo (modelo A): venta 'open', sin coste/consumo todavía.
    // En delivery el bill ya viene; en sala (sin bills) no nace hasta cerrar.
    note = "frontera-tab-created";
    try {
      const tab = (payload?.data ?? {}) as LastTab;
      const lastLocationId = tab.locationId ?? null;
      if (!lastLocationId) throw new Error("tab:created sin locationId");

      const accountId = await resolveAccountId(sb, lastLocationId);
      if (!accountId) throw new Error(`location ${lastLocationId} no mapeada a ninguna cuenta`);

      const caches = await loadHeaderCaches(sb, accountId, lastLocationId);
      const bills = Array.isArray(tab.bills) ? tab.bills : [];
      for (const bill of bills) {
        await upsertSale(sb, accountId, bill, tab, caches);   // nace 'open' + accepted
      }
      processedOk = true;
    } catch (e) {
      processError = e instanceof Error ? e.message : String(e);
      console.error("tab:created error", processError);
    }

  } else if (eventType === "tab:updated" || eventType === "tab_products:updated") {
    // El pedido vivo cambió (líneas/total). RE-SYNC: upsertSale re-adapta las
    // líneas SOLO si la venta sigue 'open' (guard de estado en upsertSale).
    // Sigue sin tocar stock (eso es del cierre).
    note = `frontera-${eventType}`;
    try {
      const tab = (payload?.data ?? {}) as LastTab;
      const lastLocationId = tab.locationId ?? null;
      if (!lastLocationId) throw new Error(`${eventType} sin locationId`);

      const accountId = await resolveAccountId(sb, lastLocationId);
      if (!accountId) throw new Error(`location ${lastLocationId} no mapeada a ninguna cuenta`);

      const caches = await loadHeaderCaches(sb, accountId, lastLocationId);
      const bills = Array.isArray(tab.bills) ? tab.bills : [];
      for (const bill of bills) {
        await upsertSale(sb, accountId, bill, tab, caches);   // re-sync (si 'open')
      }
      processedOk = true;
    } catch (e) {
      processError = e instanceof Error ? e.message : String(e);
      console.error(`${eventType} error`, processError);
    }

  } else if (eventType === "tab:cancelled") {
    // Cancelación del pedido completo. Mismo payload que tab:closed (trae bills[]).
    // Marca cada venta del tab como 'cancelled' y revierte su consumo.
    note = "frontera-tab-cancelled";
    try {
      const tab = (payload?.data ?? {}) as LastTab;
      const lastLocationId = tab.locationId ?? null;
      if (!lastLocationId) throw new Error("tab:cancelled sin locationId");

      const accountId = await resolveAccountId(sb, lastLocationId);
      if (!accountId) throw new Error(`location ${lastLocationId} no mapeada a ninguna cuenta`);

      const bills = Array.isArray(tab.bills) ? tab.bills : [];
      for (const bill of bills) {
        if (bill.id) await cancelByBillId(sb, accountId, String(bill.id), "tab:cancelled");
      }
      processedOk = true;
    } catch (e) {
      processError = e instanceof Error ? e.message : String(e);
      console.error("tab:cancelled error", processError);
    }

  } else if (eventType === "bill:deleted" || eventType === "payment:deleted") {
    // DEFENSIVO (estructura aún no verificada con payload real). Intenta resolver
    // el bill.id desde varias formas posibles del payload y, si está, cancela esa
    // venta. Si no encuentra bill id o cuenta, NO falla: loguea para inspección.
    note = `frontera-${eventType}`;
    try {
      const data = (payload?.data ?? {}) as Record<string, unknown>;
      const billId =
        (data.billId as string | undefined) ??
        (data.id as string | undefined) ??
        ((data.bill as { id?: string } | undefined)?.id) ?? null;
      const lastLocationId =
        (data.locationId as string | undefined) ??
        ((data.tab as { locationId?: string } | undefined)?.locationId) ?? null;

      if (billId && lastLocationId) {
        const accountId = await resolveAccountId(sb, lastLocationId);
        if (accountId) {
          await cancelByBillId(sb, accountId, String(billId), eventType);
          processedOk = true;
        } else {
          processError = `location ${lastLocationId} no mapeada`;
        }
      } else {
        processError = `payload sin billId/locationId resolubles (revisar log)`;
      }
    } catch (e) {
      processError = e instanceof Error ? e.message : String(e);
      console.error(`${eventType} error`, processError);
    }
  }

  // ── EL RASTRO DE LA GUARDA POR COMANDA ─────────────────────────────────
  // Hoy no se enteraba nadie: los tres duplicados del 12/09 los vio Julio en
  // la impresora de cocina, no en una pantalla. Va SIEMPRE en la respuesta,
  // tambien cuando da cero: un contador que solo aparece cuando frena no se
  // puede comparar con el de ayer (regla 8).
  const comandas = { ...elContadorDeComandas };
  if (comandas.facturas_repetidas > 0) {
    const lineas = comandas.detalle
      .filter((d) => d.tipo === "factura repetida")
      .slice(0, 10)
      .map((d) => `· comanda ${d.comanda} · factura nueva ${d.factura_nueva} · ${d.importe} EUR\n`
                + `  la venta ${d.venta_que_ya_existia} ya existia (${d.estado_de_esa_venta}); ${d.que_se_ha_hecho}`)
      .join("\n");
    await encolarAlerta(sb, {
      kind: "lastapp-webhook",
      severity: "aviso",
      subject: `Last ha mandado ${comandas.facturas_repetidas} factura(s) repetida(s) de comandas que ya tenian venta`,
      message:
        `Alguien ha cerrado a mano en Last una comanda que ya estaba servida, y Last ha emitido una `
        + `factura nueva para ella. ANTES esto creaba una segunda venta y volvia a descontar del `
        + `almacen; desde el 13/09 se frena aqui y no se crea nada.\n\n`
        + `No hay nada que arreglar: es informativo. Sirve para saber cuantas veces pasa y en que `
        + `comandas.\n\n${lineas}`,
      debounceKind: claveDelDia("comanda_factura_repetida"),
      debounceWindow: "6 hours",
    }, {
      supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
      cronSecret: Deno.env.get("CRON_SECRET") ?? "",
    });
  }

  // Log SIEMPRE (auditoría).
  try {
    await sb.from("lastapp_webhook_log").insert({ headers, payload, note, processed: processedOk });
  } catch (e) {
    console.error("log insert error", e);
  }

  // 200 SIEMPRE (Last considera entregado; reprocesamos desde el log si algo falló).
  return new Response(JSON.stringify({
    ok: true, event: eventType, processed: processedOk, error: processError,
    comandas,
  }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
