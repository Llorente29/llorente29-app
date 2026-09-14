// social-token-refresh — Renovar sola la llave de Instagram · 14/09/2026
//
// DESPLIEGUE: --no-verify-jwt (lo llama pg_cron; frontera = x-agent-secret).
//
// ══════════════════════════════════════════════════════════════════════════
// POR QUÉ EXISTE
// ══════════════════════════════════════════════════════════════════════════
//
// La llave de Instagram vive 60 días. La anterior murió el 04/09 a la 01:12 de
// Madrid y nadie se enteró hasta que Julio la renovó a mano el 13/09 a las
// 21:12. NUEVE DÍAS Y VEINTE HORAS sin publicar, con la fila de la base
// diciendo `linked` todo el rato.
//
// ── LO QUE DICE LA PÁGINA DE META (17/07/2025) ────────────────────────────
//
//     GET https://graph.instagram.com/refresh_access_token
//         ?grant_type=ig_refresh_token
//         &access_token=<LONG_LIVED_ACCESS_TOKEN>
//
//     { "access_token": "...", "token_type": "bearer", "expires_in": 5183944 }
//
// `expires_in` es un ENTERO en segundos; 5.183.944 s son 59,999 días. Permiso
// necesario: `instagram_business_basic`.
//
// ── 🔴 LA PRECONDICIÓN QUE MANDA EN TODO ──────────────────────────────────
//
// Literal: «Actualiza un identificador de larga duración que tenga MÁS DE 24
// HORAS pero que NO HAYA CADUCADO».
//
// UNA LLAVE CADUCADA NO SE PUEDE RENOVAR. Pasada la fecha, esto no sirve para
// nada nunca más y hay que ir a Meta a mano. Por eso se empieza a intentar el
// día 45 de 60 --quince días de margen, quince intentos-- y por eso a falta de
// menos de 7 días el aviso sube a crítico: pasada esa raya ya casi no hay
// segunda oportunidad.
//
// ── 🔴 Y POR QUÉ NO SE USA `pg_net` ───────────────────────────────────────
//
// Meta pide la llave EN LA DIRECCIÓN; no hay variante con cabecera documentada
// para este punto. Una cadena de consulta la registra todo el que la toca por
// el camino — y `pg_net` guardaría la URL entera en `net._http_request`, o sea
// que escribiría la llave DENTRO DE NUESTRA PROPIA BASE. Así que la llamada se
// hace desde aquí con `fetch`, TLS directo contra Meta y sin intermediarios que
// apunten nada.
//
// ── 🔴 LO QUE PUEDE DEJAR ESTO PEOR QUE ANTES, Y CÓMO SE TAPA ─────────────
//
// La página de Meta NO dice que la llave vieja siga valiendo después de
// renovar. (Yo lo había dado por bueno de una fuente secundaria; el PM lo
// corrigió trayendo la página.) Así que el caso malo es: Meta devuelve una
// llave nueva y nosotros no la guardamos.
//
// Dentro de la base eso es imposible: `social_llave_renovada` escribe, LEE DE
// VUELTA y mueve las dos fechas en UNA transacción. O está todo o no está nada.
//
// Lo que queda fuera es que la llamada a esa RPC no llegue. Ese caso es un
// CRÍTICO inmediato, con su cuenta, y lo dice en palabras: hay que ir a Meta a
// renovarla a mano AHORA.
//
// ── Y LA LLAVE NO SE ESCRIBE EN NINGÚN SITIO ──────────────────────────────
//
// Ni entera, ni sus primeros caracteres, ni su longitud. Todo lo que salga de
// aquí pasa por `sinSecretos`, igual que en `social-publish`.

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("OFFERS_AGENT_SECRET")!;
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const REFRESH_URL = "https://graph.instagram.com/refresh_access_token";

/** El día en que se empieza a intentar. 60 - 45 = quedan 15. */
const DIAS_PARA_EMPEZAR = 15;
/** Por debajo de esto, un fallo ya no es un aviso: es una urgencia. */
const DIAS_CRITICOS = 7;

/**
 * ⚠️ EL MISMO CEDAZO QUE EN `social-publish`, y por el mismo motivo: la llave
 * no se guarda «por si acaso», se quita antes de escribir.
 */
function sinSecretos(texto: string): string {
  return texto
    .replace(/access_token=[^&\s"'})\]]+/gi, "access_token=[QUITADO]")
    .replace(/"access_token"\s*:\s*"[^"]*"/gi, '"access_token":"[QUITADO]"')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1[QUITADO]")
    .replace(/\b(IG|EAA)[A-Za-z0-9_-]{20,}/g, "[LLAVE QUITADA]");
}

type Severidad = "info" | "aviso" | "alto" | "critico";

async function avisa(
  kind: string, subject: string, message: string,
  cuenta: string | null, severidad: Severidad, ventana = "12:00:00",
) {
  // Con el mismo cinturón que el sello de `social-publish`: si encolar
  // revienta, no puede tumbar la pasada ni esconder lo que ya se hizo.
  try {
    await supa.rpc("encolar_alerta", {
      p_kind: kind,
      p_subject: subject,
      p_message: sinSecretos(message),
      p_debounce_kind: kind + ":" + (cuenta ?? "-"),
      p_debounce_window: ventana,
      p_account_id: cuenta,
      p_severity: severidad,
    });
  } catch {
    // A propósito en silencio: el resultado de la pasada ya lo cuenta todo.
  }
}

Deno.serve(async (req) => {
  if (req.headers.get("x-agent-secret") !== AGENT_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const out: Array<Record<string, unknown>> = [];

  // Las cuentas enlazadas que tienen llave con nombre en el Vault. Por cuenta,
  // no a bulto: las tablas son multi-cuenta (regla 9).
  const { data: cuentas, error: errCuentas } = await supa
    .from("social_account")
    .select("account_id, network, config, llave_caduca_el")
    .eq("link_status", "linked")
    .eq("is_active", true);

  if (errCuentas) {
    return Response.json({ ok: false, error: sinSecretos(errCuentas.message) }, { status: 500 });
  }

  const hoy = new Date();

  for (const fila of (cuentas ?? []) as Array<Record<string, unknown>>) {
    const cfg = (fila.config ?? {}) as Record<string, unknown>;
    const nombre = typeof cfg.token_vault_name === "string" ? cfg.token_vault_name : null;
    const cuenta = fila.account_id as string;
    const red = fila.network as string;

    if (!nombre) {
      out.push({ red, cuenta, saltada: "no tiene nombre de llave en el Vault" });
      continue;
    }

    const caducaIso = fila.llave_caduca_el as string | null;
    if (!caducaIso) {
      out.push({ red, cuenta, nombre, saltada: "no se sabe cuando caduca" });
      await avisa(
        "social_llave_sin_fecha",
        `${red}: no se sabe cuando caduca la llave`,
        `La llave ${nombre} no tiene fecha de caducidad apuntada, asi que no se puede `
        + "renovar sola ni avisar a tiempo. Hay que apuntarla en social_account.llave_caduca_el.",
        cuenta, "aviso", "168:00:00",
      );
      continue;
    }

    const dias = Math.floor(
      (new Date(caducaIso).getTime() - hoy.getTime()) / 86_400_000,
    );

    // ── 🔴 YA CADUCADA. Meta no la renueva. Esto ya no tiene arreglo
    //    automatico, y decirlo flojito seria mentir sobre su gravedad.
    if (dias < 0) {
      out.push({ red, cuenta, nombre, dias, estado: "caducada, sin remedio automatico" });
      await avisa(
        "social_llave_caducada_sin_remedio",
        `${red}: la llave ha caducado y ya NO se puede renovar sola`,
        `La llave ${nombre} caduco el ${caducaIso.slice(0, 10)}. Meta solo renueva llaves que `
        + "todavia no han caducado, asi que el renovador automatico ya no puede hacer nada. "
        + "Hay que generar una nueva a mano en Meta (app Folvy Social) y guardarla en el Vault "
        + `con el nombre ${nombre}. Hasta entonces no se publica nada en ${red}.`,
        cuenta, "critico", "06:00:00",
      );
      continue;
    }

    // ── Todavia falta. No se molesta a Meta ni se toca nada.
    if (dias > DIAS_PARA_EMPEZAR) {
      out.push({ red, cuenta, nombre, dias, saltada: "todavia falta" });
      continue;
    }

    const urgente: Severidad = dias < DIAS_CRITICOS ? "critico" : "alto";

    // ── Se pide la llave actual y se llama a Meta.
    const { data: llave, error: errLlave } = await supa.rpc("social_secret_read", { p_name: nombre });
    if (errLlave || !llave) {
      out.push({ red, cuenta, nombre, dias, error: "no se pudo leer la llave del Vault" });
      await avisa(
        "social_llave_no_se_renueva",
        `${red}: no se ha podido renovar la llave`,
        `No se ha podido leer ${nombre} del Vault para renovarla. Quedan ${dias} dias.`,
        cuenta, urgente,
      );
      continue;
    }

    let respuesta: Response;
    try {
      const url = `${REFRESH_URL}?grant_type=ig_refresh_token&access_token=${encodeURIComponent(String(llave))}`;
      respuesta = await fetch(url, { method: "GET" });
    } catch (e) {
      out.push({ red, cuenta, nombre, dias, error: "no se pudo hablar con Meta" });
      await avisa(
        "social_llave_no_se_renueva",
        `${red}: no se ha podido renovar la llave`,
        `Fallo al llamar a Meta para renovar ${nombre}: ${sinSecretos(String(e))}. `
        + `Quedan ${dias} dias.`,
        cuenta, urgente,
      );
      continue;
    }

    const crudo = await respuesta.text();
    let json: Record<string, unknown> | null;
    try { json = JSON.parse(crudo) as Record<string, unknown>; } catch { json = null; }

    const nueva = json && typeof json.access_token === "string" && json.access_token.length > 0
      ? json.access_token as string
      : null;

    // ── NO HAY LLAVE. No se toca el Vault, y se apuntan los NOMBRES de las
    //    claves que vinieron, nunca sus valores: si Meta cambia la forma de la
    //    respuesta, nos lo dice el, no una busqueda.
    if (!nueva) {
      const claves = json ? Object.keys(json).join(", ") : "(la respuesta no era JSON)";
      out.push({
        red, cuenta, nombre, dias,
        error: "Meta no devolvio llave",
        http: respuesta.status,
        claves_de_la_respuesta: claves,
      });
      await avisa(
        "social_llave_no_se_renueva",
        `${red}: Meta no ha renovado la llave`,
        `Se pidio renovar ${nombre} y Meta contesto ${respuesta.status} sin llave nueva. `
        + `La llave de ahora sigue en su sitio y caduca en ${dias} dias. `
        + `Campos que traia la respuesta: ${claves}. `
        + (dias < DIAS_CRITICOS
            ? "QUEDA MUY POCO: si se pasa la fecha ya no se puede renovar, hay que generarla a mano en Meta."
            : "Se vuelve a intentar manana."),
        cuenta, urgente,
      );
      continue;
    }

    // `expires_in` es entero segun la pagina de Meta. Si no lo fuera, no se
    // inventa fecha: la RPC guarda la llave igual y deja las fechas quietas.
    const segundos = typeof json?.expires_in === "number" && Number.isFinite(json.expires_in)
      ? Math.floor(json.expires_in as number)
      : null;

    // ── GUARDAR. Escribir, leer de vuelta y mover las dos fechas, todo en una
    //    transaccion dentro de la RPC.
    const { data: guardado, error: errGuardar } = await supa.rpc("social_llave_renovada", {
      p_nombre: nombre, p_llave: nueva, p_segundos: segundos,
    });

    // ── 🔴 EL CASO QUE PUEDE DEJARLO PEOR QUE ANTES.
    //    Meta ha renovado y nosotros no lo hemos guardado. La pagina de Meta no
    //    promete que la vieja siga valiendo, asi que esto no puede quedarse en
    //    un registro que nadie mira.
    if (errGuardar) {
      out.push({ red, cuenta, nombre, dias, error: "RENOVADA Y NO GUARDADA" });
      await avisa(
        "social_llave_renovada_sin_guardar",
        `🔴 ${red}: se ha renovado la llave y NO se ha podido guardar`,
        `Meta ha devuelto una llave nueva para ${nombre} y no se ha podido guardar en el Vault `
        + `(${sinSecretos(errGuardar.message)}). Meta no garantiza que la anterior siga valiendo, `
        + "asi que puede que ya no se publique nada. HAY QUE ENTRAR EN META (app Folvy Social), "
        + `generar una llave nueva y guardarla en el Vault con el nombre ${nombre}, AHORA.`,
        cuenta, "critico", "01:00:00",
      );
      continue;
    }

    const g = (guardado ?? {}) as Record<string, unknown>;
    out.push({
      red, cuenta, nombre,
      dias_antes: dias,
      renovada: true,
      comprobada: g.comprobada === true,
      caduca_actualizada: g.caduca_actualizada === true,
      caduca_el: g.caduca_el ?? null,
    });

    await avisa(
      "social_llave_renovada",
      `${red}: la llave se ha renovado sola`,
      `La llave ${nombre} se ha renovado sin que nadie haga nada. Quedaban ${dias} dias y `
      + (g.caduca_actualizada === true
          ? `ahora caduca el ${String(g.caduca_el ?? "").slice(0, 10)}.`
          : "Meta no dijo cuanto dura, asi que la fecha apuntada no se ha movido y hay que mirarla."),
      cuenta, g.caduca_actualizada === true ? "info" : "aviso", "12:00:00",
    );
  }

  return Response.json({ ok: true, cuentas: out });
});
