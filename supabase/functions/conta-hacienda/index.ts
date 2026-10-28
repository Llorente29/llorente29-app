// supabase/functions/conta-hacienda/index.ts
//
// I01a · 6 · LAS LLAMADAS A HACIENDA, desde un solo sitio.
//
// Recibe { accion, … } con la sesión de quien lo pide (la persona sale de su
// JWT, nunca del cuerpo):
//   · «probar»               { confirmacion }                    Probar con Hacienda.
//   · «presentar_303»        { declaracion, confirmacion }        Presentar el 303.
//   · «ya_presentado_fuera»  { declaracion, csv, confirmacion? }  Ya lo presenté fuera.
//   · «puerta»               {}                                   I01b: ¿está abierta? (no llama a Hacienda).
//   · «fichero_303»          { declaracion }                      I01b: el fichero oficial (no llama a Hacienda).
//   · «fichero_190»          { declaracion }                      S02: el del 190 (no llama a Hacienda).
// La confirmación es el token de un solo uso que da conta_cert_confirmar a
// quien «puede presentar», al confirmar ESA acción.
//
// Todo pasa por la puerta (_shared/hacienda/puerta.ts), que está CERRADA si
// no se dice otra cosa:
//   CONTA_HACIENDA            «doble» (staging) · «pruebas» · «produccion»
//   CONTA_HACIENDA_AUTORIZA   «pruebas:AAAA-MM-DD» (ese día, laborable de 8 a 15)
//                             o «produccion»
// Los dos los pone Julio a mano: ninguna llamada de verdad sin él. El doble
// nunca contra la base de producción.
//
// En el registro: la acción, el entorno y cómo acabó. Nunca el certificado,
// ni cabeceras, ni cuerpos, ni el CSV, ni el NIF.
//
// verify_jwt = true (config.toml).

import forge from "npm:node-forge@1.3.1";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { AlmacenVault } from "../_shared/certificados/almacen.ts";
import { HaciendaDoble } from "../_shared/hacienda/doble.ts";
import { CERRADA, comprobarPuerta, type Hacienda, HaciendaAeat, HaciendaCerrada, PuertaCerrada } from "../_shared/hacienda/puerta.ts";
import { contabilizarTrasPresentar, type Dependencias, fichero190, fichero303, presentar303, probar, type Salida, yaPresentadoFuera } from "../_shared/hacienda/acciones.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PRODUCCION_REF = "xzmpnchlguibclvxyynt";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function sha256(datos: Uint8Array | string): Promise<string> {
  const bytes = typeof datos === "string" ? new TextEncoder().encode(datos) : datos;
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function laPuerta(): Hacienda {
  const entorno = comprobarPuerta({
    entorno: Deno.env.get("CONTA_HACIENDA"),
    autorizacion: Deno.env.get("CONTA_HACIENDA_AUTORIZA"),
    ahora: new Date(),
    esProduccion: SUPABASE_URL.includes(PRODUCCION_REF),
  });
  if (entorno === "cerrada") return new HaciendaCerrada();
  if (entorno === "doble") return new HaciendaDoble();
  return new HaciendaAeat(entorno, {
    crearCliente: (m) => Deno.createHttpClient({ cert: m.cert, key: m.key }),
    pedir: (url, init) => fetch(url, init as RequestInit),
  }, (url) => fetch(url, { signal: AbortSignal.timeout(20_000) }));
}

const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, mensaje: "Esto solo se pide con POST." }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const comoPersona = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: sesion } = await comoPersona.auth.getUser(jwt);
  const usuario = sesion?.user?.id;
  if (!usuario) return json({ ok: false, mensaje: "Tienes que entrar con tu usuario." }, 401);

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ ok: false, mensaje: "No ha llegado qué hay que hacer." }, 400);
  }
  const accion = typeof cuerpo.accion === "string" ? cuerpo.accion : "";
  const programa = { version: "0001", nifDesarrollo: Deno.env.get("CONTA_NIF_DESARROLLO") ?? "" };

  // I01b · El fichero oficial: no llama a Hacienda ni abre el certificado, así que no pasa por la puerta.
  if (accion === "fichero_303") {
    const declaracion = uuid(cuerpo.declaracion);
    if (!declaracion) return json({ ok: false, mensaje: "Falta la declaración." }, 400);
    const servicio = createClient(SUPABASE_URL, SERVICIO);
    const { data: r } = await servicio.from("tax_return").select("company_id, form_code").eq("id", declaracion).maybeSingle();
    if (!r || r.form_code !== "303") return json({ ok: false, mensaje: "Esa declaración no está." }, 404);
    const salida = await fichero303(servicio, programa, { usuario, declaracion, empresa: r.company_id });
    console.log(JSON.stringify({ hacienda: accion, resultado: salida.ok ? "ok" : salida.motivo }));
    return json(salida, salida.ok ? 200 : 422);
  }

  // S02 · El fichero del 190, igual: sin Hacienda ni certificado.
  if (accion === "fichero_190") {
    const declaracion = uuid(cuerpo.declaracion);
    if (!declaracion) return json({ ok: false, mensaje: "Falta la declaración." }, 400);
    const servicio = createClient(SUPABASE_URL, SERVICIO);
    const { data: r } = await servicio.from("tax_return").select("company_id, form_code").eq("id", declaracion).maybeSingle();
    if (!r || r.form_code !== "190") return json({ ok: false, mensaje: "Esa declaración no está." }, 404);
    const salida = await fichero190(servicio, { usuario, declaracion, empresa: r.company_id });
    console.log(JSON.stringify({ hacienda: accion, resultado: salida.ok ? "ok" : salida.motivo }));
    return json(salida, salida.ok ? 200 : 422);
  }

  let hacienda: Hacienda;
  try {
    hacienda = laPuerta();
  } catch (e) {
    const mensaje = e instanceof PuertaCerrada ? e.message : "La conexión con Hacienda está mal configurada. No se ha enviado nada.";
    console.log(JSON.stringify({ hacienda: accion, entorno: "error", resultado: "cerrada" }));
    return json({ ok: false, motivo: "cerrada", mensaje }, 503);
  }

  // I01b · ¿Está abierta? Para que el botón diga por qué no presenta todavía, antes de pulsarlo.
  if (accion === "puerta") {
    return json({
      ok: true, entorno: hacienda.entorno, abierta: hacienda.entorno !== "cerrada",
      mensaje: hacienda.entorno === "cerrada" ? CERRADA
        : hacienda.entorno === "doble" ? "Estás en pruebas: Sumied habla con un Hacienda de mentira. No llega nada a Hacienda." : "",
    });
  }

  const servicio = createClient(SUPABASE_URL, SERVICIO);
  const d: Dependencias = {
    base: servicio,
    almacen: new AlmacenVault(servicio),
    hacienda,
    forge,
    sha256,
    programa,
    async guardarPdf(ruta, pdf) {
      const { error } = await servicio.storage.from("conta-documentos").upload(ruta, pdf, { contentType: "application/pdf", upsert: false });
      // Con la huella en el nombre, «ya existe» es el mismo PDF: no se pisa.
      if (error && !/exists|duplicate/i.test(error.message)) throw new Error("No se ha podido guardar el justificante.");
    },
  };

  let salida: Salida;
  try {
    if (accion === "probar") {
      const confirmacion = uuid(cuerpo.confirmacion);
      if (!confirmacion) return json({ ok: false, mensaje: "Falta la confirmación: vuelve a pulsar y confirmar." }, 400);
      salida = await probar(d, { usuario, confirmacion });
    } else if (accion === "presentar_303") {
      const confirmacion = uuid(cuerpo.confirmacion);
      const declaracion = uuid(cuerpo.declaracion);
      if (!confirmacion || !declaracion) return json({ ok: false, mensaje: "Falta la declaración o la confirmación: vuelve a pulsar y confirmar." }, 400);
      salida = await presentar303(d, { usuario, confirmacion, declaracion });
    } else if (accion === "ya_presentado_fuera") {
      const declaracion = uuid(cuerpo.declaracion);
      const csv = typeof cuerpo.csv === "string" ? cuerpo.csv : "";
      if (!declaracion) return json({ ok: false, mensaje: "Falta la declaración." }, 400);
      const { data: r } = await servicio.from("tax_return").select("id, account_id, company_id, form_code, fiscal_year, period").eq("id", declaracion).maybeSingle();
      if (!r) return json({ ok: false, mensaje: "Esa declaración no está." }, 404);
      const { data: puede } = await servicio.rpc("conta_impuesto_gestiona", { p_user: usuario, p_company: r.company_id });
      if (puede !== true) return json({ ok: false, mensaje: "No puedes apuntar los impuestos de esta empresa." }, 403);
      const { data: c } = await servicio.from("company").select("tax_id").eq("id", r.company_id).maybeSingle();
      salida = await yaPresentadoFuera(d, {
        usuario, declaracion, csv, confirmacion: uuid(cuerpo.confirmacion),
        nif: String(c?.tax_id ?? ""), modelo: r.form_code, ejercicio: r.fiscal_year, periodo: r.period, cuenta: r.account_id,
      });
    } else {
      return json({ ok: false, mensaje: "Esa acción no existe." }, 400);
    }
  } catch {
    console.log(JSON.stringify({ hacienda: accion, entorno: hacienda.entorno, resultado: "fallo" }));
    return json({ ok: false, motivo: "fallo", mensaje: "No se ha podido terminar. Mira el registro de la declaración antes de repetir." }, 500);
  }
  // I01b: presentada (aquí o fuera), el asiento de liquidación con la sesión de la persona.
  // Si no sale, la presentación se queda como está y la pantalla dice por qué.
  if (salida.ok && (accion === "presentar_303" || accion === "ya_presentado_fuera")) {
    const contabilizado = await contabilizarTrasPresentar(comoPersona, String(cuerpo.declaracion));
    salida = { ...salida, contabilizado, mensaje: `${salida.mensaje} ${contabilizado.mensaje}` };
  }
  console.log(JSON.stringify({ hacienda: accion, entorno: hacienda.entorno, resultado: salida.ok ? "ok" : salida.motivo }));
  return json(salida, salida.ok ? 200 : 422);
});
