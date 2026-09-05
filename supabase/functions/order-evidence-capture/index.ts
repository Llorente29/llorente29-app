// supabase/functions/order-evidence-capture/index.ts
//
// C9 · Lote 2 §3 (04/09/2026). Recibe la foto del pase y la guarda atada al pedido.
// ============================================================================
// LA CAPTURA ES CONTABILIDAD, NO OPERACION. Es la regla de la que cuelga todo
// el lote: si esto falla, el «Listo» de la cocina sale IGUAL. La tablet encola
// la foto y reintenta; `received_at` distinto de `captured_at` deja escrito que
// se subio en diferido. Misma regla que B53. Un pedido no se queda parado
// porque una foto no suba.
//
// SIN PII: aqui no entra ni nombre, ni telefono, ni direccion. Solo ids. El
// nombre de pila del cliente ya va impreso EN la etiqueta que sale en la foto;
// no hace falta duplicarlo tambien en la base.
//
// SIN FILA NO HAY FOTO (§6). Lo escribi mal la primera vez: puse «si
// photo_retention_days es NULL». Esa columna es `integer NOT NULL DEFAULT 180`,
// asi que NUNCA es NULL y la condicion era imposible. Funcionaba de casualidad,
// porque `maybeSingle()` devuelve null cuando no hay fila -- o sea acertaba por
// el motivo equivocado, que es la peor forma de acertar.
// Lo que decide es que EXISTA LA FILA: sin fila, nadie ha decidido cuantos dias
// se guarda la foto, y se rechaza con 412 y un motivo legible. Mejor ninguna
// foto que una foto sin fecha de caducidad.
//
// Deploy: POR CI, nunca por MCP (regla 22).

import { createClient } from "@supabase/supabase-js";

const BUCKET = "order-evidence";
// Medido con el banco del lector (docs/L3a_lector_medido_20260904.md): con fotos
// de 1152x2048 solo 11 de 22 unidades leyeron en la pasada original; las otras
// 9 necesitaron ampliar por software, y ampliar NO inventa detalle. Por eso el
// objetivo es 2560-3024 px de lado mayor y NO se reescala hacia abajo.
const LADO_MINIMO_ACEPTABLE = 2000;
const LADO_RECOMENDADO = 2560;

function json(cuerpo: unknown, status: number): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Dimensiones de un JPEG sin libreria: se recorren los marcadores hasta el SOF.
// Se necesitan para poder DECIR si la tablet esta mandando fotos pequeñas, que
// es lo que se paga luego en unidades no leidas.
function medirJpeg(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    // SOF0..SOF15, saltando DHT(c4), JPG(c8) y DAC(cc), que no son SOF.
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
    }
    if (len <= 0) return null;
    i += 2 + len;
  }
  return null;
}

async function sha256Hex(b: Uint8Array): Promise<string> {
  // Se copia a un ArrayBuffer propio en vez de castear: el Uint8Array que llega
  // de formData puede ir sobre un SharedArrayBuffer, y `crypto.subtle.digest`
  // no lo acepta. Lo caza `deno check`; un `as` lo habria tapado hasta que
  // fallara en produccion con la foto ya hecha.
  const buf = new ArrayBuffer(b.byteLength);
  new Uint8Array(buf).set(b);
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function rutaDe(accountId: string, locationId: string, saleId: string, cuando: Date): string {
  const yyyy = cuando.getUTCFullYear();
  const mm = String(cuando.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(cuando.getUTCDate()).padStart(2, "0");
  return `${accountId}/${locationId}/${yyyy}/${mm}/${dd}/${saleId}/${crypto.randomUUID()}.jpg`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  let saleId = "", deviceToken = "", capturadaEn = "", kind = "pase";
  let bytes: Uint8Array | null = null;

  try {
    const form = await req.formData();
    saleId = String(form.get("sale_id") ?? "").trim();
    deviceToken = String(form.get("device_token") ?? "").trim();
    capturadaEn = String(form.get("captured_at") ?? "").trim();
    kind = String(form.get("kind") ?? "pase").trim() || "pase";
    const f = form.get("image");
    if (f instanceof File) bytes = new Uint8Array(await f.arrayBuffer());
  } catch {
    return json({ ok: false, error: "cuerpo_ilegible" }, 400);
  }

  if (!saleId || !deviceToken || !bytes || bytes.length === 0) {
    return json({ ok: false, error: "faltan_campos" }, 400);
  }
  if (!["pase", "bolsa", "degradado"].includes(kind)) {
    return json({ ok: false, error: "kind_no_valido" }, 400);
  }

  const cuando = capturadaEn ? new Date(capturadaEn) : new Date();
  if (Number.isNaN(cuando.getTime())) return json({ ok: false, error: "captured_at_no_valido" }, 400);

  // ── El dispositivo, por el mismo camino que order_for_print ────────────────
  const { data: dev, error: eDev } = await sb.rpc("kds_resolve_device", { p_token: deviceToken });
  const disp = Array.isArray(dev) ? dev[0] : dev;
  if (eDev || !disp?.id) return json({ ok: false, error: "dispositivo_no_valido" }, 401);

  // ── El pedido tiene que ser de ESA cuenta y ESE local (regla 9) ────────────
  const { data: venta, error: eVenta } = await sb
    .from("sale").select("id, account_id, location_id").eq("id", saleId).maybeSingle();
  if (eVenta || !venta) return json({ ok: false, error: "pedido_no_encontrado" }, 404);
  if (venta.account_id !== disp.account_id || venta.location_id !== disp.location_id) {
    // Ni se dice de quien es: quien pregunta no tiene por que enterarse.
    return json({ ok: false, error: "pedido_de_otra_cuenta_o_local" }, 403);
  }

  // ── Sin plazo de retencion no hay foto (§6) ────────────────────────────────
  const { data: ks, error: eKs } = await sb
    .from("kitchen_settings").select("photo_retention_days")
    .eq("account_id", venta.account_id).maybeSingle();
  if (eKs) {
    // No se captura a ciegas: si no se ha podido leer el plazo, no se sabe si
    // hay plazo. La tablet reintentara.
    console.warn("order-evidence-capture: no se pudo leer kitchen_settings", eKs.message);
    return json({ ok: false, error: "plazo_ilegible", reintentable: true }, 503);
  }
  if (!ks) {
    return json({
      ok: false,
      error: "sin_fila_en_kitchen_settings",
      // Legible a proposito: esto se le enseña al usuario de la tablet.
      motivo: "Esta cuenta no tiene fila en kitchen_settings, asi que nadie ha decidido " +
              "cuantos dias se guardan las fotos. No se captura ninguna hasta que se decida.",
    }, 412);
  }
  const dias = ks.photo_retention_days;

  const dim = medirJpeg(bytes);
  const ladoMayor = dim ? Math.max(dim.w, dim.h) : 0;
  const sha = await sha256Hex(bytes);
  const ruta = rutaDe(venta.account_id, venta.location_id, saleId, cuando);

  const { error: eSubida } = await sb.storage.from(BUCKET)
    .upload(ruta, bytes, { contentType: "image/jpeg", upsert: false });
  if (eSubida) {
    // La tablet reintentara desde su cola. No es un fallo del pedido.
    console.warn("order-evidence-capture: subida fallida", eSubida.message);
    return json({ ok: false, error: "subida_fallida", reintentable: true }, 503);
  }

  const { data: fila, error: eIns } = await sb.from("sale_capture").insert({
    account_id: venta.account_id,
    location_id: venta.location_id,
    sale_id: saleId,
    device_id: disp.id,
    kind,
    captured_at: cuando.toISOString(),
    image_path: ruta,
    width: dim?.w ?? null,
    height: dim?.h ?? null,
    bytes: bytes.length,
    sha256: sha,
  }).select("id, received_at").single();

  if (eIns) {
    // Objeto sin fila = objeto huerfano que nadie purgaria. Se deshace.
    await sb.storage.from(BUCKET).remove([ruta]);
    console.warn("order-evidence-capture: insercion fallida, objeto retirado", eIns.message);
    return json({ ok: false, error: "insercion_fallida", reintentable: true }, 503);
  }

  // Un aviso, no un rechazo: la foto ya vale como prueba aunque sea pequeña,
  // pero se dice, porque una foto corta se paga en unidades no leidas por L3.
  const aviso = ladoMayor > 0 && ladoMayor < LADO_MINIMO_ACEPTABLE
    ? `Foto de ${dim?.w}x${dim?.h}: el lado mayor esta por debajo de ${LADO_MINIMO_ACEPTABLE} px ` +
      `(recomendado ${LADO_RECOMENDADO}). Se guarda igual, pero L3 leera peor.`
    : null;

  return json({
    ok: true,
    id: fila.id,
    sha256: sha,
    bytes: bytes.length,
    width: dim?.w ?? null,
    height: dim?.h ?? null,
    retention_days: dias,
    en_diferido: new Date(fila.received_at).getTime() - cuando.getTime() > 60_000,
    aviso,
  }, 200);
});
