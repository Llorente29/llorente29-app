// supabase/functions/last-catalog-probe/index.ts
//
// SONDA DE CATALOGOS DE LAST — la ultima puerta: PUT /catalogs/{catalogId}
// ============================================================================
// ENCARGO 19/08/2026. Lo unico que nunca se probo de la API de Last es
// sustituir el catalogo ENTERO de una vez. No se probo por accidente, no por
// conclusion: el sondeo se hizo con pg_net, que no sabe mandar PUT.
//
// Lo que YA esta probado y no se repite aqui:
//   PUT /catalogs/{c}/products/{p} con precio -> 200 y no cambia nada (6 formas)
//   precio de producto de ORGANIZACION        -> escribe, pero es global
//   enabled por local (el 86)                 -> escribe, y si es por local
//   POST /catalogs y POST /catalogs/{id}      -> 405
//
// ACCIONES (todas requieren x-availability-dispatch-secret):
//
//   list        GET /catalogs?locationId=  -> id + NOMBRE + destino de cada
//               catalogo del local. Es lo unico que dice si un catalogo es el
//               de Glovo o el de Uber; el espejo no lo sabe (external_channel
//               se queda con el primer canal que ve y aplasta el resto).
//
//   get         GET /catalogs/{id} -> huella del catalogo (recuento por
//               categoria, md5 del cuerpo) y, si se pide crudo=true, el cuerpo
//               entero. El cuerpo crudo es el BOTON DE DESHACER.
//
//   put_precio  Lee el catalogo, cambia UN precio de UN producto, y devuelve
//               el mismo cuerpo por PUT. Nada mas: no reordena, no reformatea,
//               no quita campos. Despues vuelve a leer y compara.
//               Con dry_run=true hace todo menos el PUT.
//
//   put_crudo   PUT de un cuerpo entregado tal cual. Es la via de restauracion
//               si el PUT resulta ser un reemplazo destructivo (deuda B10).
//
// SEGURIDAD DEL ENSAYO: `catalog_id_prohibido` es obligatorio en put_precio y
// put_crudo. Si coincide con el catalogo de destino, la funcion se niega. Es
// el cinturon para no escribir jamas en el catalogo de Glovo de Alcala, que
// son 1.178 pedidos en 30 dias.
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-availability-dispatch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LASTAPP_BASE = "https://api.last.app/v2";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function md5Hex(s: string): Promise<string> {
  // md5 no esta en SubtleCrypto; sha-256 sirve igual como huella.
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// Huella de un catalogo: lo que hay que comparar antes y despues para saber si
// el PUT se llevo algo por delante (deuda B10).
async function huella(cat: any): Promise<any> {
  const cats = Array.isArray(cat?.categories) ? cat.categories : [];
  let productos = 0;
  let conModificadores = 0;
  let conDescripcion = 0;
  const porCategoria: Array<{ nombre: string; productos: number }> = [];
  for (const c of cats) {
    const ps = Array.isArray(c?.products) ? c.products : [];
    productos += ps.length;
    for (const p of ps) {
      if (Array.isArray(p?.modifierGroups) && p.modifierGroups.length > 0) conModificadores++;
      if (typeof p?.description === "string" && p.description.length > 0) conDescripcion++;
    }
    porCategoria.push({ nombre: c?.name ?? "(sin nombre)", productos: ps.length });
  }
  return {
    nombre_catalogo: cat?.name ?? null,
    categorias: cats.length,
    productos,
    productos_con_modificadores: conModificadores,
    productos_con_descripcion: conDescripcion,
    claves_de_primer_nivel: cat && typeof cat === "object" ? Object.keys(cat).sort() : [],
    sha256_12: await md5Hex(JSON.stringify(cat)),
    por_categoria: porCategoria,
  };
}

function buscarProducto(cat: any, productId: string): any | null {
  for (const c of (cat?.categories ?? [])) {
    for (const p of (c?.products ?? [])) if (p?.id === productId) return p;
  }
  return null;
}

async function lastGet(token: string, path: string, locId: string): Promise<any> {
  const res = await fetch(`${LASTAPP_BASE}${path}`, {
    // UNA sola cabecera de local: HTTP une las repetidas en "uuid, uuid" y
    // Last responde 400 ("must match format uuid"). Los nombres de cabecera
    // son insensibles a mayusculas, asi que con una basta para las tres rutas.
    headers: { "Authorization": `Bearer ${token}`, "locationID": locId },
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

async function lastPut(token: string, catalogId: string, locId: string, cuerpo: unknown) {
  const res = await fetch(`${LASTAPP_BASE}/catalogs/${catalogId}`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "locationID": locId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  // Un 405 suele traer `Allow` con los verbos que la ruta SI acepta. Es la
  // diferencia entre "PUT no se puede" y saber que se puede en su lugar.
  const cabeceras: Record<string, string> = {};
  res.headers.forEach((v, k) => { cabeceras[k] = v; });
  return {
    ok: res.ok,
    status: res.status,
    allow: res.headers.get("allow"),
    respuesta: texto.slice(0, 600),
    cabeceras,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secreto = req.headers.get("x-availability-dispatch-secret") ?? "";
  const esperado = Deno.env.get("AVAILABILITY_DISPATCH_SECRET") ?? "";
  if (!esperado || secreto !== esperado) return json({ ok: false, error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const accion: string = body.action ?? "";
  const accountId: string = body.account_id ?? "";
  const orgId: string = body.external_org_id ?? "";
  const locId: string = body.location_ext ?? "";
  if (!accountId || !orgId || !locId) {
    return json({ ok: false, error: "account_id, external_org_id y location_ext requeridos" }, 400);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: integ } = await sb.from("external_integration").select("token_secret_name")
    .eq("account_id", accountId).eq("source", "lastapp").eq("external_org_id", orgId)
    .eq("is_active", true).maybeSingle();
  if (!integ?.token_secret_name) return json({ ok: false, error: "integracion Last no encontrada" }, 404);
  const token = Deno.env.get(integ.token_secret_name) ?? "";
  if (!token) return json({ ok: false, error: `secreto ${integ.token_secret_name} no configurado` }, 500);

  try {
    // ── list: id + NOMBRE + destino de cada catalogo del local ──
    if (accion === "list") {
      const lista = await lastGet(token, `/catalogs?locationId=${locId}`, locId);
      const arr: any[] = Array.isArray(lista) ? lista : (lista?.value ?? lista?.items ?? lista?.data ?? []);
      const detalle = await lastGet(token, `/locations/${locId}`, locId);
      // brands[].catalogs -> TODOS los destinos de cada catalogo (acumulando,
      // no quedandose con el primero: eso es lo que aplasta el espejo hoy).
      const destinos: Record<string, { marca: string; destinos: string[] }> = {};
      for (const b of (detalle?.brands ?? [])) {
        const marca = b?.name ?? "";
        const walk = (v: any, canal: string) => {
          if (typeof v === "string" && v) {
            const e = destinos[v] ?? (destinos[v] = { marca, destinos: [] });
            if (!e.marca && marca) e.marca = marca;
            if (!e.destinos.includes(canal)) e.destinos.push(canal);
          } else if (v && typeof v === "object") {
            for (const vv of Object.values(v)) walk(vv, canal);
          }
        };
        for (const [canal, v] of Object.entries(b?.catalogs ?? {})) walk(v, canal);
      }
      return json({
        ok: true, accion, location_ext: locId, total: arr.length,
        catalogos: arr.map((c: any) => ({
          id: c?.id ?? null,
          nombre: c?.name ?? null,
          borrado: c?.deleted === true,
          marca: destinos[c?.id]?.marca ?? null,
          destinos: (destinos[c?.id]?.destinos ?? []).sort(),
          otras_claves: c && typeof c === "object" ? Object.keys(c).sort() : [],
        })),
      });
    }

    // ── get: huella del catalogo (y el cuerpo crudo si se pide) ──
    if (accion === "get") {
      const catalogId: string = body.catalog_id ?? "";
      if (!catalogId) return json({ ok: false, error: "catalog_id requerido" }, 400);
      const cat = await lastGet(token, `/catalogs/${catalogId}`, locId);
      const out: any = { ok: true, accion, catalog_id: catalogId, huella: await huella(cat) };
      if (body.crudo === true) out.crudo = cat;
      if (body.product_id) out.producto = buscarProducto(cat, String(body.product_id));
      return json(out);
    }

    // ── put_precio: leer, cambiar UN precio, devolver el MISMO cuerpo ──
    if (accion === "put_precio") {
      const catalogId: string = body.catalog_id ?? "";
      const productId: string = body.product_id ?? "";
      const prohibido: string = body.catalog_id_prohibido ?? "";
      const nuevoPrecio = typeof body.price_cents === "number" ? body.price_cents : null;
      const dryRun = body.dry_run === true;
      if (!catalogId || !productId || nuevoPrecio === null) {
        return json({ ok: false, error: "catalog_id, product_id y price_cents requeridos" }, 400);
      }
      // Cinturon: nunca escribir en el catalogo que se declare prohibido.
      if (!prohibido) return json({ ok: false, error: "catalog_id_prohibido es OBLIGATORIO" }, 400);
      if (prohibido === catalogId) {
        return json({ ok: false, error: `NEGADO: ${catalogId} es el catalogo declarado prohibido.` }, 400);
      }

      const antes = await lastGet(token, `/catalogs/${catalogId}`, locId);
      const pAntes = buscarProducto(antes, productId);
      if (!pAntes) return json({ ok: false, error: `producto ${productId} no esta en el catalogo` }, 404);
      const huellaAntes = await huella(antes);
      const precioAntes = typeof pAntes.price === "number" ? pAntes.price : null;

      // El MISMO cuerpo, con un solo campo distinto. Se muta sobre el objeto
      // ya parseado: no se reordena ni se reconstruye nada.
      const pMut = buscarProducto(antes, productId);
      pMut.price = nuevoPrecio;

      if (dryRun) {
        return json({
          ok: true, accion, dry_run: true, catalog_id: catalogId,
          precio_antes: precioAntes, precio_que_se_mandaria: nuevoPrecio,
          huella_antes: huellaAntes,
          nota: "DRY RUN: no se ha enviado el PUT.",
        });
      }

      const escritura = await lastPut(token, catalogId, locId, antes);

      const despues = await lastGet(token, `/catalogs/${catalogId}`, locId);
      const pDespues = buscarProducto(despues, productId);
      const huellaDespues = await huella(despues);

      return json({
        ok: true, accion, catalog_id: catalogId, product_id: productId,
        verbo: "PUT", ruta: `/catalogs/${catalogId}`,
        escritura,
        precio_antes: precioAntes,
        precio_despues: typeof pDespues?.price === "number" ? pDespues.price : null,
        tomo: typeof pDespues?.price === "number" && pDespues.price === nuevoPrecio,
        // Deuda B10: si el PUT es reemplazo total, un cuerpo incompleto BORRA.
        integridad: {
          productos_antes: huellaAntes.productos,
          productos_despues: huellaDespues.productos,
          categorias_antes: huellaAntes.categorias,
          categorias_despues: huellaDespues.categorias,
          con_modificadores_antes: huellaAntes.productos_con_modificadores,
          con_modificadores_despues: huellaDespues.productos_con_modificadores,
          con_descripcion_antes: huellaAntes.productos_con_descripcion,
          con_descripcion_despues: huellaDespues.productos_con_descripcion,
          producto_conserva_nombre: pDespues?.name === pAntes.name,
          producto_conserva_descripcion: pDespues?.description === pAntes.description,
          producto_conserva_modificadores:
            JSON.stringify(pDespues?.modifierGroups ?? null) === JSON.stringify(pAntes.modifierGroups ?? null),
          sha256_antes: huellaAntes.sha256_12,
          sha256_despues: huellaDespues.sha256_12,
        },
        huella_antes: huellaAntes,
        huella_despues: huellaDespues,
      });
    }

    // ── put_crudo: restauracion desde un cuerpo entregado ──
    if (accion === "put_crudo") {
      const catalogId: string = body.catalog_id ?? "";
      const prohibido: string = body.catalog_id_prohibido ?? "";
      if (!catalogId || !body.cuerpo) return json({ ok: false, error: "catalog_id y cuerpo requeridos" }, 400);
      if (!prohibido) return json({ ok: false, error: "catalog_id_prohibido es OBLIGATORIO" }, 400);
      if (prohibido === catalogId) {
        return json({ ok: false, error: `NEGADO: ${catalogId} es el catalogo declarado prohibido.` }, 400);
      }
      const escritura = await lastPut(token, catalogId, locId, body.cuerpo);
      const despues = await lastGet(token, `/catalogs/${catalogId}`, locId);
      return json({ ok: true, accion, escritura, huella_despues: await huella(despues) });
    }

    return json({ ok: false, error: `accion desconocida: ${accion}` }, 400);
  } catch (e) {
    return json({ ok: false, accion, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
