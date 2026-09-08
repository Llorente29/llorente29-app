// supabase/functions/_shared/lastapp.ts
//
// LO QUE TODAS LAS FUNCIONES DE LAST NECESITAN Y CADA UNA TENÍA POR SU CUENTA:
// hablar con la API y descubrir qué catálogos tiene un local.
//
// ══ POR QUÉ EXISTE ESTE FICHERO (08/09/2026) ══════════════════════════════
//
// El 08/09 el `dry_run` de `lastapp-catalog-import` devolvió CERO de todo —
// 0 categorías, 0 productos, 0 grupos, y las 20 marcas en `brands_skipped_empty`
// — mientras `last-catalog-sync` traía, esa misma madrugada, 41 catálogos y
// 4.444 filas de producto de las MISMAS marcas y el MISMO local.
//
// La diferencia no era el token ni los permisos: era el endpoint.
//
//   `lastapp-catalog-import`  →  GET /locations/{id}  →  brands[].catalogs.default
//   `last-catalog-sync`       →  GET /catalogs?locationId={id}
//
// Y esto ya se sabía. `last-catalog-sync` lo dejó escrito el 12/08, verificado
// en vivo contra Foodint Carabanchel: el recorrido de `brands[].catalogs` NO es
// exhaustivo — encontraba 8 catálogos y 208 productos donde
// `/catalogs?locationId=` da la carta entera. La hermana se arregló; el
// importador se quedó con el camino viejo 27 días.
//
// **Dos implementaciones del mismo descubrimiento, una buena y una rota,
// conviviendo sin que nadie las comparara.** Por eso esto vive aquí ahora: para
// que no haya una segunda vez. Quien arregle el descubrimiento lo arregla para
// todos, y quien lo rompa lo rompe a la vista.
//
// ══ POR QUÉ CÓDIGO Y NO DATO ══════════════════════════════════════════════
//
// La alternativa era que el importador leyera de `external_catalog_product` (el
// espejo que llena `last-catalog-sync`). No, por dos razones:
//
//   1. El espejo guarda PRODUCTOS y nada más. Ni categorías, ni grupos de
//      modificadores, ni opciones, ni slots de combo — que es justo el trabajo
//      del importador. Tendría que llamar a Last igualmente.
//   2. Una función es determinista y se prueba; una tabla tiene su propia
//      frescura. Si el importador leyera del espejo, el día que el espejo
//      fallara una pasada traería una carta vieja SIN ENTERARSE. Un tercer
//      camino de fallo silencioso, que es la familia del bug que arregla esto.
//
// ══ QUÉ SE HA COPIADO Y QUÉ NO ═══════════════════════════════════════════
//
// El cuerpo viene de `last-catalog-sync/index.ts` (líneas 43-58, 82-146,
// 185-242) **tal cual**, con sus comentarios. No se ha «mejorado» nada al
// mover: si algo cambia de comportamiento, es un fallo de la extracción, no una
// mejora — el mismo contrato que el `PatronDeKitchen`.
//
// ══ QUIÉN LO USA HOY, Y QUÉ QUEDA PENDIENTE ══════════════════════════════
//
// Lo usa `lastapp-catalog-import`. **`last-catalog-sync` sigue con su copia**,
// y eso es deuda declarada, no despiste: es la función que FUNCIONA y corre
// cada noche, y para cambiarla me puse una condición —probar que lo extraído es
// literalmente lo mismo— que no he podido cumplir. Mi comparador no distingue
// un salto de línea de un cambio de verdad, y sin esa prueba, tocar lo único
// que hoy trae el catálogo sería cambiar por cambiar.
//
// Se cierra cuando el importador esté verificado en producción con este módulo:
// entonces el intercambio en la hermana es limpieza sin riesgo. Mientras tanto
// hay dos copias, sí — pero una de ellas ya no es la rota, que era el problema.
//
// Lo que el IMPORTADOR gana de regalo, porque su copia no lo tenía: el ritmo
// (80 ms entre llamadas, ~12,5 req/s contra el límite de 15) y el reintento
// ante un 429. Su `lastGet` llamaba a pelo, sin freno ni reintento; con 41
// catálogos por delante eso era una tanda de 429 esperando a pasar.

const LASTAPP_BASE = "https://api.last.app/v2";

// ── Ritmo (límite Last: 15 req/s) ──
const MIN_INTERVAL_MS = 80; // ~12.5 req/s
const MAX_RETRIES_429 = 5;
let lastCallAt = 0;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

export async function lastFetchRaw(
  path: string,
  token: string,
  headers: Record<string, string>,
): Promise<{ status: number; ok: boolean; body: any; bodyText: string | null }> {
  let attempt = 0;
  while (true) {
    await throttle();
    try {
      const res = await fetch(`${LASTAPP_BASE}${path}`, {
        headers: { "Authorization": `Bearer ${token}`, ...headers },
      });
      if (res.status === 429 && attempt < MAX_RETRIES_429) {
        attempt++;
        await res.text().catch(() => {});
        await sleep(300 * attempt);
        continue;
      }
      const text = await res.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // no era JSON
      }
      return { status: res.status, ok: res.ok, body, bodyText: body === null ? text.slice(0, 300) : null };
    } catch (e) {
      return { status: 0, ok: false, body: null, bodyText: String(e) };
    }
  }
}

export async function lastGet(
  path: string,
  token: string,
  headers: Record<string, string>,
): Promise<any> {
  const r = await lastFetchRaw(path, token, headers);
  if (!r.ok) throw new Error(`Last.app ${path} -> ${r.status} ${r.bodyText ?? ""}`);
  return r.body;
}

export function extractList(json: any): any[] {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];
  for (const key of ["value", "items", "data", "products", "results"]) {
    if (Array.isArray(json[key])) return json[key];
  }
  return [];
}

// ── Recorre brands[].catalogs (puede anidar por canal) y devuelve un mapa
//    catalogId -> {brand, channel} de MEJOR ESFUERZO (no autoritativo: ver
//    nota en resolveLocationCatalogs). "todos los catálogos, no solo
//    default" — una marca puede tener varios (carta base + canal). ──
export function collectBrandChannelByCatalog(
  brands: any[],
): Map<string, { brand: string; channels: Set<string> }> {
  const out = new Map<string, { brand: string; channels: Set<string> }>();
  for (const b of brands ?? []) {
    const brandName: string = b?.name ?? "";
    const cats = b?.catalogs ?? {};
    const walk = (v: any, channel: string) => {
      if (typeof v === "string" && v) {
        // ACUMULA (19/08). Antes: `if (!out.has(v))`, o sea ganaba el primer
        // destino que Last mencionara. Pero un mismo catálogo se asigna a
        // VARIOS a la vez -- el panel de Alcalá muestra "SMASH BROTHERS
        // BURGER -> A domicilio, Glovo, Para llevar, Local". Con el primero
        // ganando, el rótulo no decía de qué canal era el catálogo sino cuál
        // salió antes, y BAILABA entre pasadas sin que nadie tocara nada.
        const entry = out.get(v) ?? { brand: brandName, channels: new Set<string>() };
        if (!entry.brand && brandName) entry.brand = brandName;
        entry.channels.add(channel);
        out.set(v, entry);
      } else if (v && typeof v === "object") {
        for (const vv of Object.values(v)) walk(vv, channel);
      }
    };
    for (const [chKey, v] of Object.entries(cats)) walk(v, chKey);
  }
  return out;
}

// Infiere el canal a partir del nombre del catálogo (fallback cuando el walk
// de brands[] no lo mapea — mismo heurístico que lastapp-sync-catalog).
export function channelFromName(name: string | null | undefined): string {
  const n = (name ?? "").toLowerCase();
  if (n.includes("glovo")) return "glovo";
  if (n.includes("uber")) return "uber";
  if (n.includes("just")) return "justeat";
  if (n.includes("deliveroo")) return "deliveroo";
  return "unknown";
}

export interface CatalogInfo {
  brand: string;
  /** TODOS los destinos del catálogo, ordenados. */
  channels: string[];
  /** Nombre del catálogo en Last. */
  name: string | null;
}

// ── Lista AUTORITATIVA de catálogos de un local: GET /catalogs?locationId=.
//    El walk de brands[].catalogs (vía /locations/{id}) NO es exhaustivo por
//    sí solo — verificado en vivo el 12/08 contra Foodint Carabanchel: el
//    walk encontró 8 catálogos (208 productos) cuando la medición a mano
//    (y /catalogs?locationId=) dan la carta completa. Mismo patrón que
//    lastapp-sync-catalog: /catalogs?locationId= manda; brands[].catalogs
//    solo aporta la etiqueta de marca/canal cuando la tiene. ──
export async function resolveLocationCatalogs(
  token: string,
  locationExtId: string,
): Promise<{ catalogMap: Map<string, CatalogInfo>; debug: any }> {
  const [catsResp, detail] = await Promise.all([
    lastGet(`/catalogs?locationId=${locationExtId}`, token, { "LocationID": locationExtId }),
    lastGet(`/locations/${locationExtId}`, token, { "LocationID": locationExtId }),
  ]);
  const brandChannelByCatalog = collectBrandChannelByCatalog(
    Array.isArray(detail?.brands) ? detail.brands : [],
  );

  const rawList = extractList(catsResp);
  const catalogMap = new Map<string, CatalogInfo>();
  const deletedCount = rawList.filter((c) => c?.deleted === true).length;
  for (const c of rawList) {
    if (!c?.id || c?.deleted === true) continue;
    const mapped = brandChannelByCatalog.get(c.id);
    // Orden alfabético = rótulo estable entre pasadas.
    const channels = mapped && mapped.channels.size > 0
      ? Array.from(mapped.channels).sort()
      : [channelFromName(c.name)];
    catalogMap.set(String(c.id), {
      brand: mapped?.brand || (c.name ?? ""),
      // El NOMBRE del catálogo ("SMASH BROTHERS BURGER 20"). Sin esto no hay
      // forma de casar una fila del espejo con lo que se ve en el panel.
      channels,
      name: typeof c.name === "string" ? c.name : null,
    });
  }
  // Diagnóstico temporal (12/08): comprobar si /catalogs?locationId= viene
  // paginado (metadatos de totalCount/total/count por encima del array
  // devuelto) o si el array crudo ya trae menos de lo esperado.
  const debug = {
    catsResp_is_array: Array.isArray(catsResp),
    catsResp_keys: catsResp && typeof catsResp === "object" && !Array.isArray(catsResp)
      ? Object.keys(catsResp)
      : null,
    raw_list_length: rawList.length,
    deleted_count: deletedCount,
    total_hint: (catsResp && typeof catsResp === "object" && !Array.isArray(catsResp))
      ? (catsResp.totalCount ?? catsResp.total ?? catsResp.count ?? null)
      : null,
    brands_count: Array.isArray(detail?.brands) ? detail.brands.length : 0,
  };
  return { catalogMap, debug };
}
