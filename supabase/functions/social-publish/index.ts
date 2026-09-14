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
//
// ── 14/09/2026 · LA LLAVE FUERA DE LA DIRECCIÓN, Y `publishing` DEJA DE SER
//                UN POZO ────────────────────────────────────────────────────
//
// Dos fallos que Julio encontró leyendo la v21 ya desplegada, y un tercero que
// salió al medirlos. La v21 llegó a publicar de verdad una vez (13/09 23:00:27,
// `attempts 2`), o sea que los dos dejaron de ser teóricos esa noche.
//
//   1. LA LLAVE VIAJABA EN LA DIRECCIÓN. Ahora va en la cabecera. El motivo no
//      es lo que haga un `fetch` roto --eso no lo hemos podido medir ninguno de
//      los dos-- sino que una cadena de consulta la registra todo el que la
//      toca por el camino, Meta el primero.
//      Y encima un CEDAZO (`sinSecretos`) en el único sitio por el que se
//      escribe `last_error`: la cabecera arregla ese sitio, el cedazo arregla
//      el siguiente.
//
//   2. `publishing` NO TIENE SALIDA. Ninguna función de la base lo devuelve a
//      `approved`; el buscador solo mira `approved`. Con el sondeo hay hasta
//      150 s en vuelo por pasada, así que una ejecución que se corte deja
//      publicaciones ahí para siempre. Dos remedios: un PLAZO COMPARTIDO por
//      toda la pasada (60 s; la que no quepa se deja sin tocar) y un RESCATE
//      al entrar (más de 10 min parada → vuelve a `approved` con su contenedor
//      y se le devuelve el intento que gastó el reclamo).
//
//   3. Y LA PANTALLA LA PARALIZABA A LA VISTA: pintaba «Publicándose…» y ni un
//      botón. No es que desapareciera: es que decía algo tranquilizador sobre
//      una fila muerta. Eso se arregla en el front, no aquí.

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("OFFERS_AGENT_SECRET")!;
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GRAPH = "https://graph.instagram.com/v23.0";

/** El ritmo del sondeo. Corto a propósito — ver la cabecera. */
const PRIMERA_ESPERA_MS = 3_000;
const ENTRE_CONSULTAS_MS = 5_000;
const TECHO_MS = 30_000;

/**
 * EL PLAZO DE TODA LA PASADA, no de cada publicación (Julio, 13/09 23:15).
 *
 * Con el sondeo, una publicación puede tardar 30 s y se cogen 5 por pasada:
 * hasta 150 s en vuelo. Si esa ejecución se corta --se le acaba el tiempo a la
 * función, un despliegue en medio, cualquier cosa-- las que estuvieran a medias
 * se quedan en `publishing`, y de ahí NO SALE NADIE: ninguna función de la base
 * las devuelve a `approved`, el buscador solo mira `approved`, y la pantalla
 * les pinta «Publicándose…» sin un solo botón al lado. Desaparecen en silencio
 * estando a la vista.
 *
 * Con un plazo compartido, la que no quepa se deja SIN TOCAR para la pasada
 * siguiente. Es mejor que bajar el `limit(5)` porque no depende de cuántas haya.
 */
const PLAZO_DE_LA_PASADA_MS = 60_000;

/**
 * Una publicación parada en `publishing` más de esto es una pasada que se
 * murió a medias. Se rescata al entrar. Diez minutos es holgado: la pasada
 * entera tiene un plazo de 60 s, así que nada sano llega ahí.
 */
const PARADA_DEMASIADO_MS = 10 * 60_000;

/**
 * ⚠️ EL CEDAZO. Todo lo que vaya a `last_error` pasa por aquí, SIEMPRE.
 *
 * `last_error` es una columna de la base Y lo que se pinta en la tarjeta de la
 * pantalla. Cualquier texto que llegue ahí con una llave dentro deja esa llave
 * guardada y enseñada.
 *
 * La llave ya no viaja en la URL --va en la cabecera, ver `estadoDelContenedor`--
 * pero eso arregla ESE sitio y no el siguiente: mañana alguien añade una
 * llamada, mete el token donde no debe, y el mensaje de error acaba en la
 * pantalla. Un secreto no se guarda «por si acaso»: se quita antes de escribir,
 * en el unico sitio por el que se escribe.
 */
function sinSecretos(texto: string): string {
  return texto
    .replace(/access_token=[^&\s"'})\]]+/gi, 'access_token=[QUITADO]')
    .replace(/"access_token"\s*:\s*"[^"]*"/gi, '"access_token":"[QUITADO]"')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1[QUITADO]')
    // Los tokens de Meta son largos y empiezan por IG/EAA. Se corta por su
    // forma, no por dónde aparecen: es la red de debajo de las tres de arriba.
    .replace(/\b(IG|EAA)[A-Za-z0-9_-]{20,}/g, '[LLAVE QUITADA]');
}

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
 * los de arriba.
 *
 * LA LLAVE VA EN LA CABECERA, NO EN LA DIRECCIÓN (Julio, 13/09 23:15), y el
 * motivo no depende de qué haga ningún runtime cuando un `fetch` revienta:
 * una cadena de consulta LA REGISTRA TODO EL QUE LA TOCA POR EL CAMINO —Meta
 * en su propio registro de accesos el primero, y cualquier intermediario entre
 * medias—. La llave saldría de nuestro control aunque nosotros no la
 * escribiéramos en ningún sitio nuestro.
 *
 * (Aquí ponía antes «POR ESO ESTA URL NO SE REGISTRA NUNCA EN NINGÚN SITIO».
 *  Era una garantía escrita justo donde no se podía dar.)
 */
async function estadoDelContenedor(
  creationId: string, token: string,
): Promise<{ estado: EstadoContenedor | null; error: unknown }> {
  const r = await fetch(
    `${GRAPH}/${creationId}?fields=status_code`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.status_code) return { estado: null, error: j?.error ?? j };
  return { estado: j.status_code as EstadoContenedor, error: null };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-agent-secret") !== AGENT_SECRET) return new Response("forbidden", { status: 403 });
  const out: Array<Record<string, unknown>> = [];
  const arranqueDeLaPasada = Date.now();

  // ── EL RESCATE. Lo primero de cada pasada, antes de buscar nada.
  //
  // `publishing` no tiene salida: ninguna funcion de la base lo devuelve a
  // `approved` --la unica que nombra los dos estados es la RPC de la pantalla--
  // y el buscador de abajo solo mira `approved`. Una publicacion que se quede
  // ahi no la vuelve a coger nadie.
  //
  // Se conserva el `ig_creation_id`: es lo que hace que la pasada siguiente no
  // empiece la carrera de cero. Y se DEVUELVE el intento que gasto el reclamo,
  // porque esa pasada no llego a concluir: cobrarselo seria cobrarle al pedido
  // que se cayera nuestra ejecucion.
  const { data: rescatadas } = await supa.from("social_post")
    .update({ status: "approved", error_kind: "esperando",
              last_error: "Una pasada anterior se corto a medias y esta se quedo sin terminar. Vuelve a la cola con su contenedor.",
              updated_at: new Date().toISOString() })
    .eq("status", "publishing")
    .lt("updated_at", new Date(Date.now() - PARADA_DEMASIADO_MS).toISOString())
    .select("id, attempts");

  for (const p of rescatadas ?? []) {
    // El intento se devuelve una a una porque PostgREST no sabe restar.
    await supa.from("social_post")
      .update({ attempts: Math.max(0, (p.attempts ?? 1) - 1) })
      .eq("id", p.id);
    out.push({ id: p.id, rescatada: "estaba parada en publishing" });
  }

  // Posts aprobados de cuentas de Instagram ENLAZADAS, sin programación futura
  const { data: posts } = await supa.from("social_post")
    .select("id, account_id, network, payload, attempts, ig_creation_id, social_account_id, social_account:social_account_id(link_status, config)")
    .eq("status", "approved").eq("network", "instagram")
    .lt("attempts", 5)
    .or(`scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()}`)
    .order("created_at").limit(5);

  for (const p of posts ?? []) {
    // EL PLAZO DE LA PASADA. La que no quepa se deja SIN TOCAR --ni reclamada,
    // ni marcada, ni nada-- para la siguiente. Se dice en el informe: una
    // publicacion que no se mira tiene que poder verse que no se miro.
    if (Date.now() - arranqueDeLaPasada > PLAZO_DE_LA_PASADA_MS) {
      out.push({ id: p.id, aplazada: "se acabo el plazo de esta pasada, sin tocarla" });
      continue;
    }

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
        status: "error", last_error: sinSecretos(msg).slice(0, 400), error_kind: clase,
        ...(borrarContenedor ? { ig_creation_id: null } : {}),
        updated_at: new Date().toISOString(),
      }).eq("id", p.id);
      out.push({ id: p.id, ok: false, clase, error: sinSecretos(msg).slice(0, 200) });
    };

    /**
     * TODAVÍA NO ESTÁ LISTA. No es un fallo: vuelve a la cola tal y como
     * estaba —con sus intentos SIN gastar— y conserva el contenedor, que es lo
     * que hace que la próxima pasada no empiece de cero.
     */
    const devuelveALaCola = async (creationId: string | null, detalle: string) => {
      await supa.from("social_post").update({
        status: "approved", attempts: intentosPrevios,
        error_kind: "esperando", last_error: sinSecretos(detalle).slice(0, 400),
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
