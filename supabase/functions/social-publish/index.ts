// social-publish — El brazo publicador de RRSS (v1: Instagram) · 05/07/2026
// Publica los social_post APROBADOS por el humano (modo b: la aprobación es la puerta;
// desde ahí, máquina). Instagram Graph API en dos pasos (contenedor → publish), token
// desde el Vault vía social_secret_read (jamás en tablas ni en código).
// Idempotente: claim optimista approved→publishing; attempts<5; errores con mensaje claro.
// El copy ya referencia "link en bio" — en el caption van copy + hashtags (los enlaces
// no son clicables en captions de IG; el UTM vive en la bio/stories y en la publicación
// asistida). Cron cada 15 min ('social-publish-worker') + invocable a mano.
// DESPLIEGUE: --no-verify-jwt (lo llama pg_cron; frontera = x-agent-secret).
//
// ── 13/09/2026 · SE ESPERA A QUE LA FOTO ESTÉ LISTA ────────────────────────
//
// Hasta hoy el paso 2 se disparaba JUSTO después del paso 1, sin esperar y sin
// preguntar nada. Pero entre los dos, Instagram tiene que ir a buscar nuestra
// imagen, descargarla y prepararla. Si no ha terminado, el paso 2 falla con
// «The media is not ready for publishing» (code 9007, error_subcode 2207027).
//
// Era una carrera, y por eso el patrón parecía suerte: 10 caídas así desde el
// 17/07, NUEVE de ellas descartadas después por una persona desde la pantalla.
// Dos meses. Nada que ver con el token — eso fueron otras cinco, del 07 al 12/09.
//
// Ahora, entre los dos pasos, se pregunta por el estado del contenedor hasta
// que dice que está listo. Y hay DOS arreglos, porque hacen falta los dos:
//
//   1. EL SONDEO CORTO hace que casi siempre salga a la primera.
//   2. GUARDAR EL CONTENEDOR hace que no se pierda NINGUNA. Antes, cada
//      reintento creaba un contenedor nuevo y abandonaba el anterior —que a lo
//      mejor ya estaba listo—, así que a los 15 minutos se volvía a correr
//      contra el mismo reloj. Ahora la pasada siguiente pregunta por ESE.
//
// El ritmo NO es el que yo había propuesto (cada 3 s hasta 60 s): Meta
// recomienda una consulta por minuto durante no más de 5 minutos, y eso no
// cabe en una ejecución. Quedarse ahí bloqueado sería peor que el fallo que
// estamos arreglando. Así que se sondea corto y, si no llega, se deja para la
// pasada siguiente: el cron es cada 15 min y el contenedor vive 24 h.
//
// Y «todavía no está lista» NO es un fallo: no gasta intento de los 5 y no
// deja la publicación en «error», de donde no sale sola.

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("OFFERS_AGENT_SECRET")!;
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GRAPH = "https://graph.instagram.com/v23.0";

/** El ritmo del sondeo. Corto a propósito — ver la cabecera. */
const PRIMERA_ESPERA_MS = 3_000;
const ENTRE_CONSULTAS_MS = 5_000;
const TECHO_MS = 30_000;

/** Los estados que devuelve Instagram en `status_code`. Sólo uno autoriza. */
type EstadoContenedor = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

/** Las claves de `social_post.error_kind`. Claves, no frases: las frases van en el front. */
type ClaseDeFallo = "esperando" | "llave_caducada" | "imagen_no_descargable" | "rechazado" | "otro";

const duerme = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * QUÉ CLASE DE FALLO ES. Cada rama dice de dónde sale, porque la mitad están
 * MEDIDAS sobre nuestros propios fallos y la otra mitad son lectura del
 * mensaje de Meta. Quien venga detrás tiene que poder distinguirlas.
 */
function claseDeFallo(err: unknown): ClaseDeFallo {
  const e = (err ?? {}) as Record<string, unknown>;
  const texto = JSON.stringify(err ?? "").toLowerCase();
  const code = Number(e.code ?? 0);

  // MEDIDO: cinco caídas del 07 al 12/09 con este mensaje literal.
  if (texto.includes("session has expired") || texto.includes("session is invalid")) return "llave_caducada";
  // Código de token inválido/caducado de Meta. Leído del mensaje, no supuesto:
  // si viene el 190 pero el texto no habla de sesión, igual es la llave.
  if (code === 190) return "llave_caducada";
  if (texto.includes("access token") && (texto.includes("expired") || texto.includes("invalid"))) return "llave_caducada";

  // Instagram no ha podido bajarse la foto. Se reconoce por lo que dice del
  // medio o de la URL al CREAR el contenedor.
  if (texto.includes("media could not be fetched")
      || texto.includes("unable to fetch")
      || texto.includes("could not be downloaded")
      || texto.includes("image url")
      || texto.includes("url is not accessible")) return "imagen_no_descargable";

  // Instagram dice que no, y lo dice con un error suyo con forma de rechazo.
  if (e.error_user_title || e.error_user_msg || code > 0) return "rechazado";

  // Y lo que no encaje se llama por su nombre: otro. No se le pone una
  // etiqueta bonita que no le toca.
  return "otro";
}

async function igToken(vaultName: string): Promise<string | null> {
  const { data } = await supa.rpc("social_secret_read", { p_name: vaultName });
  return (data as string) ?? null;
}

/**
 * El estado del contenedor. `status_code` es el campo, y sus cinco valores son
 * los de arriba. El token viaja en la URL porque es como se consulta un nodo
 * de Graph; POR ESO ESTA URL NO SE REGISTRA NUNCA EN NINGÚN SITIO.
 */
async function estadoDelContenedor(
  creationId: string, token: string,
): Promise<{ estado: EstadoContenedor | null; error: unknown }> {
  const r = await fetch(
    `${GRAPH}/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.status_code) return { estado: null, error: j?.error ?? j };
  return { estado: j.status_code as EstadoContenedor, error: null };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-agent-secret") !== AGENT_SECRET) return new Response("forbidden", { status: 403 });
  const out: Array<Record<string, unknown>> = [];

  // Posts aprobados de cuentas de Instagram ENLAZADAS, sin programación futura
  const { data: posts } = await supa.from("social_post")
    .select("id, account_id, network, payload, attempts, ig_creation_id, social_account_id, social_account:social_account_id(link_status, config)")
    .eq("status", "approved").eq("network", "instagram")
    .lt("attempts", 5)
    .or(`scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()}`)
    .order("created_at").limit(5);

  for (const p of posts ?? []) {
    const sa: any = (p as any).social_account;
    if (!sa || sa.link_status !== "linked") { out.push({ id: p.id, skipped: "cuenta no enlazada" }); continue; }
    const igUserId = sa.config?.ig_user_id;
    const vaultName = sa.config?.token_vault_name;
    if (!igUserId || !vaultName) { out.push({ id: p.id, skipped: "config sin ig_user_id/token_vault_name" }); continue; }

    const intentosPrevios = p.attempts ?? 0;

    // claim optimista: solo uno se lo lleva
    const { data: claimed } = await supa.from("social_post")
      .update({ status: "publishing", attempts: intentosPrevios + 1, updated_at: new Date().toISOString() })
      .eq("id", p.id).eq("status", "approved").select("id");
    if (!claimed?.length) continue;

    /** Un fallo DE VERDAD: se para, se cuenta el intento y se dice qué clase es. */
    const fail = async (msg: string, clase: ClaseDeFallo, borrarContenedor = true) => {
      await supa.from("social_post").update({
        status: "error", last_error: msg.slice(0, 400), error_kind: clase,
        ...(borrarContenedor ? { ig_creation_id: null } : {}),
        updated_at: new Date().toISOString(),
      }).eq("id", p.id);
      out.push({ id: p.id, ok: false, clase, error: msg.slice(0, 200) });
    };

    /**
     * TODAVÍA NO ESTÁ LISTA. No es un fallo: vuelve a la cola tal y como
     * estaba —con sus intentos SIN gastar— y conserva el contenedor, que es lo
     * que hace que la próxima pasada no empiece de cero.
     */
    const devuelveALaCola = async (creationId: string | null, detalle: string) => {
      await supa.from("social_post").update({
        status: "approved", attempts: intentosPrevios,
        error_kind: "esperando", last_error: detalle.slice(0, 400),
        ig_creation_id: creationId,
        updated_at: new Date().toISOString(),
      }).eq("id", p.id);
      out.push({ id: p.id, ok: false, clase: "esperando", contenedor: creationId });
    };

    try {
      const token = await igToken(vaultName);
      if (!token) { await fail("token no encontrado en el Vault: " + vaultName, "llave_caducada"); continue; }

      const pl: any = p.payload;
      const caption = [pl.copy, (pl.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");
      if (!pl.image_url) { await fail("payload sin image_url", "otro"); continue; }

      // ── Paso 1: el contenedor. Si ya hay uno de una pasada anterior, NO se
      // crea otro: se sigue con ése. Ésta es la mitad que evita perder una.
      let creationId: string | null =
        (p as { ig_creation_id?: string | null }).ig_creation_id ?? null;
      const reutilizado = creationId !== null;

      if (!creationId) {
        const r1 = await fetch(`${GRAPH}/${igUserId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_url: pl.image_url, caption, access_token: token }),
        });
        const j1 = await r1.json();
        if (!r1.ok || !j1.id) {
          const e = j1?.error ?? j1;
          await fail(`IG media: ${JSON.stringify(e).slice(0, 300)}`, claseDeFallo(e));
          continue;
        }
        creationId = String(j1.id);
        // Se guarda ANTES de sondear: si esta ejecución se cae aquí mismo, el
        // contenedor no se queda huérfano y la pasada siguiente lo encuentra.
        await supa.from("social_post")
          .update({ ig_creation_id: creationId, updated_at: new Date().toISOString() })
          .eq("id", p.id);
      }

      // ── Paso 1bis: esperar a que esté listo, preguntando.
      let estado: EstadoContenedor | null = null;
      let ultimoError: unknown = null;
      const arranque = Date.now();
      await duerme(PRIMERA_ESPERA_MS);
      let consultas = 0;

      while (Date.now() - arranque < TECHO_MS) {
        const r = await estadoDelContenedor(creationId, token);
        consultas += 1;
        estado = r.estado;
        ultimoError = r.error;
        if (estado === "FINISHED" || estado === "ERROR" || estado === "EXPIRED" || estado === "PUBLISHED") break;
        if (!estado) break;                       // no se pudo preguntar: se trata abajo
        if (Date.now() - arranque + ENTRE_CONSULTAS_MS >= TECHO_MS) break;
        await duerme(ENTRE_CONSULTAS_MS);
      }

      // No se pudo ni preguntar (llave, red). Eso sí es un fallo de verdad.
      if (!estado) {
        const clase = claseDeFallo(ultimoError);
        await fail(`IG estado: ${JSON.stringify(ultimoError ?? "sin respuesta").slice(0, 300)}`, clase, false);
        continue;
      }

      // El contenedor ya se publicó en una pasada anterior: no se publica dos
      // veces. Sin esto, guardar el identificador abriría la puerta a duplicar.
      if (estado === "PUBLISHED") {
        await supa.from("social_post").update({
          status: "published", published_at: new Date().toISOString(),
          last_error: null, error_kind: null, ig_creation_id: null,
          updated_at: new Date().toISOString(),
        }).eq("id", p.id);
        out.push({ id: p.id, ok: true, ya_estaba: true, consultas });
        continue;
      }

      if (estado === "ERROR" || estado === "EXPIRED") {
        const porque = estado === "EXPIRED"
          ? "el contenedor ha caducado (viven 24 h)"
          : "Instagram no ha podido preparar la foto";
        await fail(
          `IG contenedor ${estado}: ${porque}. ${JSON.stringify(ultimoError ?? "").slice(0, 200)}`,
          estado === "EXPIRED" ? "rechazado" : "imagen_no_descargable",
        );
        continue;
      }

      if (estado === "IN_PROGRESS") {
        // Se acabó el tiempo de ESTA ejecución, no la paciencia. Vuelve a la
        // cola con su contenedor y sin gastar intento.
        await devuelveALaCola(
          creationId,
          `Instagram seguía preparando la foto tras ${consultas} consultas en ${Math.round((Date.now() - arranque) / 1000)} s.`,
        );
        continue;
      }

      // ── Paso 2: publicar. Sólo se llega aquí con FINISHED.
      const r2 = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: creationId, access_token: token }),
      });
      const j2 = await r2.json();
      if (!r2.ok || !j2.id) {
        const e = j2?.error ?? j2;
        await fail(`IG publish: ${JSON.stringify(e).slice(0, 300)}`, claseDeFallo(e), false);
        continue;
      }

      await supa.from("social_post").update({
        status: "published", external_ref: String(j2.id),
        published_at: new Date().toISOString(), last_error: null,
        error_kind: null, ig_creation_id: null,
        updated_at: new Date().toISOString(),
      }).eq("id", p.id);
      out.push({
        id: p.id, ok: true, ig_media_id: j2.id, brand: pl.brand_name,
        // La espera, EN EL REGISTRO: es la prueba de que se preguntó y de que
        // no se publicó hasta que estuvo listo (§5.2 del encargo).
        consultas, espera_s: Math.round((Date.now() - arranque) / 1000), reutilizado,
      });
    } catch (e) {
      await fail(String((e as Error).message), "otro", false);
    }
  }

  return Response.json({ ok: true, processed: out.length, results: out });
});
