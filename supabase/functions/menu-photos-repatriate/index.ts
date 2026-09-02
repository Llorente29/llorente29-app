// supabase/functions/menu-photos-repatriate/index.ts
//
// TRAER LAS FOTOS A CASA.
//
// 497 fichas de Foodint (y 27 del catálogo plantilla) tienen `menu_item.photo_url`
// apuntando a `res.cloudinary.com/lastpos/…`. Son imágenes que se ven en la
// tienda, en el KDS y en lo que se publica a las plataformas, y viven en la
// cuenta de Cloudinary de OTRO producto. El día que esa cuenta se cierre, se
// reorganice o deje de servir a terceros, 497 platos se quedan sin foto y no
// hay copia en ninguna parte. Esta función se las trae al bucket `menu-photos`,
// que es donde ya viven las fotos que se suben desde Folvy.
//
// ── POR QUÉ ES UNA EDGE FUNCTION Y NO UNA MIGRACIÓN ────────────────────────
// Porque hay que DESCARGAR cada imagen. Postgres no puede: `pg_net` hace
// peticiones salientes pero no trae un binario a una tabla, y aunque pudiera,
// meter 500 descargas dentro de una transacción de migración es pedir un
// timeout con medio trabajo hecho y sin saber por dónde iba.
//
// ── LO QUE SE COMPROBÓ ANTES DE ESCRIBIRLA ─────────────────────────────────
// La pregunta que decidía todo era si el sincronizador de Last vuelve a
// escribir `photo_url` y deshace el trabajo. NO lo hace: ni
// `lastapp-sync-catalog` ni `lastapp-catalog-import` mencionan `photo_url` ni
// ninguna URL de imagen. Las únicas dos funciones que tocan ese campo son
// `hubrise-catalog-publish` (lo LEE para publicar) y `social-agent`. Así que
// una vez reescrita, la URL nueva se queda.
//
// ── REGLAS QUE SE RESPETAN ─────────────────────────────────────────────────
// · `account_id` es OBLIGATORIO. Las tablas son multi-cuenta y el catálogo
//   plantilla comparte tabla con producción: sin cuenta, esto tocaría fichas
//   que no son de nadie (Regla 9). Nunca hay un modo «todas las cuentas».
// · ENSAYO POR DEFECTO. Sin `dry_run:false` explícito no se escribe un byte:
//   dice cuántas hay, cuáles serían las primeras y a qué ruta irían.
// · NO SE BORRA NADA DE CLOUDINARY. No es nuestro, y mientras siga ahí es la
//   copia de seguridad de esta operación.
// · IDEMPOTENTE. Una ficha ya repatriada no vuelve a bajarse: el filtro es la
//   propia URL, así que en cuanto deja de apuntar a Cloudinary sale del lote.
//   Cada subida lleva su propio sello de tiempo, así que dos ejecuciones nunca
//   pelean por el mismo fichero.
// · LO QUE VEN LAS PLATAFORMAS NO CAMBIA SOLO. `hubrise-catalog-publish` LEE
//   `photo_url` al publicar, así que Glovo/Uber/JustEat seguirán enseñando la
//   imagen de Cloudinary hasta que se republique la carta. Esta función arregla
//   de quién es la foto, no lo que hay publicado ahora mismo.
// · POR LOTES, con `limit`. Devuelve cuántas quedan, así que se puede llamar
//   otra vez hasta que `quedan` sea 0 en vez de rezar por que quepa en el
//   tiempo de ejecución.
// · CADA FICHA SE ESCRIBE EN CUANTO SE SUBE. Nada de acumular 500 y guardar al
//   final: si la función muere a la mitad, lo hecho está hecho y la siguiente
//   llamada sigue donde se quedó.
//
// ── CÓMO SE USA (Julio despliega y ejecuta; esta función no se autoinvoca) ──
//   supabase functions deploy menu-photos-repatriate
//
//   1) Ensayo, sin escribir nada:
//      POST { "account_id": "<Foodint>" }
//   2) De verdad, en lotes de 50, repitiendo hasta que "quedan" sea 0:
//      POST { "account_id": "<Foodint>", "dry_run": false, "limit": 50 }
//
// Requiere sesión de un ADMIN de esa cuenta: la frontera es el JWT del usuario,
// no un secreto compartido. Desplegar SIN --no-verify-jwt.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BUCKET = "menu-photos";
const ORIGEN = "res.cloudinary.com";
const LIMITE_POR_DEFECTO = 50;
const LIMITE_MAXIMO = 200;
/** 15 MB. Una foto de carta no pesa eso ni de lejos; si lo pesa, algo va mal. */
const TAMANO_MAXIMO = 15 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** La extensión que toque, a partir del content-type real de la respuesta. */
function extensionDe(contentType: string | null): string {
  const t = (contentType ?? "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("avif")) return "avif";
  if (t.includes("gif")) return "gif";
  return "jpg";
}

interface Ficha { id: string; name: string | null; photo_url: string }

interface Resultado {
  menu_item_id: string;
  nombre: string;
  estado: "traida" | "fallo";
  destino?: string;
  motivo?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "usa POST" }, 405);

  // ── Frontera: un admin DE ESA CUENTA, no cualquier autenticado ────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const sbUser = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await sbUser.auth.getUser();
  if (!userData?.user) return json({ ok: false, error: "no autenticado" }, 401);

  let body: { account_id?: string; dry_run?: boolean; limit?: number } = {};
  try { body = await req.json(); } catch { /* cuerpo vacío = ensayo sin cuenta */ }

  const accountId = (body.account_id ?? "").trim();
  if (!accountId) {
    return json({
      ok: false,
      error: "falta account_id. Es obligatorio a propósito: las fichas son " +
             "multi-cuenta y el catálogo plantilla comparte tabla con producción.",
    }, 400);
  }

  const { data: esAdmin, error: errAdmin } = await sbUser
    .rpc("current_user_is_admin_of", { p_account_id: accountId });
  if (errAdmin) return json({ ok: false, error: `no se ha podido comprobar el permiso: ${errAdmin.message}` }, 500);
  if (esAdmin !== true) return json({ ok: false, error: "sin permiso de admin sobre esa cuenta" }, 403);

  // El ensayo es el valor por defecto: escribir exige pedirlo.
  const dryRun = body.dry_run !== false;
  const limite = Math.min(Math.max(1, body.limit ?? LIMITE_POR_DEFECTO), LIMITE_MAXIMO);

  const sb = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

  // ── Cuántas quedan, y el lote de esta llamada ─────────────────────────────
  const { count: pendientes, error: errCount } = await sb
    .from("menu_item")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .ilike("photo_url", `%${ORIGEN}%`);
  if (errCount) return json({ ok: false, error: `no se han podido contar las fichas: ${errCount.message}` }, 500);

  const { data: fichas, error: errSel } = await sb
    .from("menu_item")
    .select("id, name, photo_url")
    .eq("account_id", accountId)
    .ilike("photo_url", `%${ORIGEN}%`)
    .order("id")
    .limit(limite);
  if (errSel) return json({ ok: false, error: `no se han podido leer las fichas: ${errSel.message}` }, 500);

  const lote = (fichas ?? []) as Ficha[];

  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      account_id: accountId,
      pendientes: pendientes ?? 0,
      en_este_lote: lote.length,
      // Ni un byte ha salido ni ha entrado. Esto es lo que HARÍA.
      muestra: lote.slice(0, 10).map((f) => ({
        menu_item_id: f.id,
        nombre: f.name ?? "(sin nombre)",
        desde: f.photo_url,
        hacia: `${BUCKET}/${accountId}/${f.id}-<sello>.<ext>`,
      })),
      nota: "Ensayo: no se ha descargado, subido ni escrito nada. " +
            "Repite con dry_run:false para hacerlo de verdad.",
    });
  }

  // ── De verdad, una a una ──────────────────────────────────────────────────
  const resultados: Resultado[] = [];

  for (const f of lote) {
    const nombre = f.name ?? "(sin nombre)";
    try {
      const resp = await fetch(f.photo_url);
      if (!resp.ok) {
        resultados.push({
          menu_item_id: f.id, nombre, estado: "fallo",
          motivo: `el origen respondió ${resp.status}`,
        });
        continue;
      }

      const bytes = new Uint8Array(await resp.arrayBuffer());
      if (bytes.byteLength === 0) {
        resultados.push({ menu_item_id: f.id, nombre, estado: "fallo", motivo: "el origen devolvió 0 bytes" });
        continue;
      }
      if (bytes.byteLength > TAMANO_MAXIMO) {
        resultados.push({
          menu_item_id: f.id, nombre, estado: "fallo",
          motivo: `pesa ${Math.round(bytes.byteLength / 1024)} kB, por encima del máximo`,
        });
        continue;
      }

      const contentType = resp.headers.get("content-type");
      if (!(contentType ?? "").toLowerCase().startsWith("image/")) {
        // Lo que ha llegado no es una imagen. Antes de guardar basura en el
        // bucket y reescribir la ficha, se para y se dice.
        resultados.push({
          menu_item_id: f.id, nombre, estado: "fallo",
          motivo: `el origen no devolvió una imagen (content-type: ${contentType ?? "ninguno"})`,
        });
        continue;
      }

      // Misma convención de ruta que uploadMenuPhoto: cuenta/ficha-sello.ext.
      const ruta = `${accountId}/${f.id}-${Date.now()}.${extensionDe(contentType)}`;
      const { error: errUp } = await sb.storage
        .from(BUCKET)
        .upload(ruta, bytes, { contentType: contentType!, upsert: true });
      if (errUp) {
        resultados.push({ menu_item_id: f.id, nombre, estado: "fallo", motivo: `subida: ${errUp.message}` });
        continue;
      }

      const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(ruta);
      const urlNueva = pub?.publicUrl;
      if (!urlNueva) {
        resultados.push({ menu_item_id: f.id, nombre, estado: "fallo", motivo: "subida hecha pero sin URL pública" });
        continue;
      }

      // Se escribe AHORA, ficha a ficha. Si esto muere a la mitad, lo hecho
      // está hecho y la siguiente llamada sigue donde se quedó.
      const { error: errUpd } = await sb
        .from("menu_item")
        .update({ photo_url: urlNueva })
        .eq("id", f.id)
        .eq("account_id", accountId);   // cinturón: la cuenta también en el WHERE
      if (errUpd) {
        resultados.push({ menu_item_id: f.id, nombre, estado: "fallo", motivo: `guardar la URL: ${errUpd.message}` });
        continue;
      }

      resultados.push({ menu_item_id: f.id, nombre, estado: "traida", destino: urlNueva });
    } catch (e) {
      resultados.push({
        menu_item_id: f.id, nombre, estado: "fallo",
        motivo: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const traidas = resultados.filter((r) => r.estado === "traida").length;
  const fallos = resultados.filter((r) => r.estado === "fallo");

  // Los fallos van ENTEROS, no una muestra: si nueve fotos no se han podido
  // traer, hay que poder ver las nueve y por qué.
  return json({
    ok: fallos.length === 0,
    dry_run: false,
    account_id: accountId,
    traidas,
    fallos: fallos.length,
    quedan: Math.max(0, (pendientes ?? 0) - traidas),
    detalle_fallos: fallos,
    nota: (pendientes ?? 0) - traidas > 0
      ? "Quedan fichas por traer: vuelve a llamar con el mismo cuerpo hasta que «quedan» sea 0."
      : "No queda ninguna ficha apuntando a Cloudinary en esta cuenta.",
  });
});
