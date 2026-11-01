// supabase/functions/conta-revolut-conectar/index.ts
//
// B01 Revolut · PR 1 · EL ASISTENTE DE «CONECTAR REVOLUT BUSINESS». Con la
// sesión de la persona (verify_jwt = true): solo un administrador o un
// encargado de la cuenta de la empresa. Lo secreto lo guarda y lo lee la clave
// de servicio, en el Vault; a la pantalla solo sale lo público.
//
// POST { accion, empresa, … }:
//   · empezar { origen, desde }: crea la llave de la empresa (la privada, al
//     Vault) y devuelve el certificado PÚBLICO y la dirección de vuelta (la de
//     la marca por la que entra: app.sumied.com o app.folvy.app). Si ya hay uno
//     sin terminar, devuelve ése (con `nuevo: true`, otro).
//   · client_id { clientId }: lo guarda en el Vault y devuelve la página de
//     Revolut donde se pulsa «Activar acceso» (leer y avisar: READ y WRITE,
//     respuesta 5; PAY, solo con «Activar pagos»).
//   · vuelta { code, state }: Revolut vuelve aquí. Cambia el código por el
//     token (el de renovación, al Vault), deja la conexión «conectada» y
//     devuelve sus cuentas para ligarlas a su 572.
//   · cuentas: las cuentas de Revolut, otra vez (para ligar después).
//   · leer: lee ya (después de ligar), hasta hoy.
//   · desconectar: borra secretos y cuentas conectadas; lo que entró se queda.
//     Antes, deja de pagar (sin conexión no se paga).
//   · activar_pagos (2b) y dejar_de_pagar (2c-1): vuelven a pasar por Revolut,
//     con PAY y sin él. Dejar de pagar quita antes, en Sumied y al instante,
//     el permiso de pagar (conta_pago_dejar): si la persona cancela en
//     Revolut, en Sumied ya está quitado.
//   · cancelada { state, error }: la persona ha vuelto de Revolut sin
//     autorizar; se dice qué ha quedado según a qué se fue (oauth_para).
//
// Una cuenta de demostración no se conecta a Revolut (DM1): la puerta.
// En ningún registro va un secreto, el client_id, un token ni un IBAN entero.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { MARCAS } from "../_shared/marcas.ts";
import { cuentaPuedeSalir, EN_LA_DEMO } from "../_shared/puerta.ts";
import { crearLlave } from "../_shared/revolut/certificado.ts";
import { clienteRevolut, entornoDe, FalloRevolut, dejanAvisar, paginaDeAutorizar, pedirToken, PERMISOS_AL_CONECTAR_TEXTO, PERMISOS_CON_PAGOS_TEXTO, registrarAviso, quitarAviso } from "../_shared/revolut/cliente.ts";
import { ultimos4 } from "../_shared/revolut/lectura.ts";
import { COLUMNAS_CONEXION, guardarSecreto, leerEmpresa, paraElRegistro, secreto, tokenDeAcceso, type ConexionRevolut } from "../_shared/revolut/servidor.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENTORNO = entornoDe(Deno.env.get("REVOLUT_ENTORNO"));
/** Los dominios por los que se entra (los de las marcas, y en staging los suyos, de REVOLUT_DOMINIOS). */
const DOMINIOS = new Set([...Object.values(MARCAS).flatMap((m) => m.dominios), ...(Deno.env.get("REVOLUT_DOMINIOS") ?? "").split(",").map((x) => x.trim()).filter(Boolean)]);
/** Cuánto vale una autorización empezada (el «state»): lo que tarda una persona en pulsar en Revolut. */
const MINUTOS_AUTORIZAR = 20;

type OauthPara = "conectar" | "activar_pagos" | "dejar_de_pagar";
/** Lo que ya ha pasado en Sumied cuando se deja de pagar, antes de ir a Revolut. */
const DEJADO = "En Sumied ya están quitados los pagos: nadie puede pagar con Revolut desde aquí.";

/** Qué ha quedado cuando la persona vuelve de Revolut sin autorizar, según a qué fue. */
function textoCancelada(para: OauthPara | null): string {
  if (para === "activar_pagos") return "No has autorizado los pagos en Revolut. Sumied sigue leyendo como antes; no ha cambiado nada.";
  if (para === "dejar_de_pagar") return `${DEJADO} En Revolut no has cambiado el permiso: para quitárselo también allí, vuelve a pulsar «Quitar el permiso en Revolut».`;
  if (para === "conectar") return "No has autorizado a Sumied en Revolut. Vuelve a pulsar «Autorizar en Revolut» cuando quieras.";
  return "Revolut ha vuelto sin el permiso. Vuelve a empezar desde Bancos.";
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const mal = (texto: string, status = 200) => json({ ok: false, texto }, status);

async function sha256(s: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function vueltaDe(origen: unknown): string | null {
  try {
    const u = new URL(String(origen));
    return u.protocol === "https:" && DOMINIOS.has(u.host) ? `https://${u.host}/bancos/revolut/vuelta` : null;
  } catch { return null; }
}

/** El client_id que da Revolut: una línea de letras, números, guiones o subrayados. */
function comprobarClientId(s: string): string | null {
  if (/BEGIN|CERTIFICATE|-----/.test(s)) return "Eso es el certificado, no el Client ID. El Client ID lo enseña Revolut después de guardar el certificado: es una línea corta de letras y números, debajo de «Client ID».";
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(s)) return "Ese Client ID no tiene la forma de los de Revolut: tiene que ser una sola línea de letras y números, sin espacios. Cópialo otra vez de Revolut › Ajustes › API.";
  return null;
}

async function cuentasDeRevolut(acceso: string) {
  const c = clienteRevolut(fetch, ENTORNO, acceso);
  const cuentas = await c.cuentas();
  const out = [];
  for (const a of cuentas.filter((x) => x.state === "active")) {
    const datos = a.currency === "EUR" ? await c.datosBanco(a.id) : [];
    const iban = datos.map((d) => d.iban).find((x): x is string => !!x) ?? null;
    out.push({ id: a.id, nombre: a.name ?? "Cuenta", divisa: a.currency, saldo: a.balance, iban, iban4: ultimos4(iban) });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  let b: Record<string, unknown> = {};
  try { b = await req.json() as Record<string, unknown>; } catch { /* vacío */ }
  const accion = String(b.accion ?? "");

  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return mal("Tu sesión ha caducado. Vuelve a entrar.", 401);
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const { data: perfil } = await sb.rpc("conta_nombre_actor");
  const quien = typeof perfil === "string" && perfil ? perfil : (u.user.email ?? "alguien");

  // La vuelta de Revolut trae el «state», no la empresa: se busca por su huella.
  let empresa = typeof b.empresa === "string" ? b.empresa : "";
  let conexion: ConexionRevolut | null = null;
  let para: OauthPara | null = null;
  if (accion === "cancelada") {
    // Se vuelve sin autorizar: la autorización empezada deja de valer y se dice qué ha quedado.
    const state = String(b.state ?? "");
    if (!/^[0-9a-f]{64}$/.test(state)) return mal(textoCancelada(null));
    const { data } = await srv.from("revolut_conexion").select("id, company_id, oauth_para").eq("estado_oauth_huella", await sha256(state)).maybeSingle();
    if (!data) return mal(textoCancelada(null));
    const { data: co0 } = await srv.from("company").select("account_id").eq("id", data.company_id).maybeSingle();
    const { data: puede0 } = co0 ? await sb.rpc("current_user_is_admin_or_manager_of", { p_account_id: co0.account_id }) : { data: false };
    if (puede0 !== true) return mal("Solo un administrador o un encargado de la empresa conecta un banco.", 403);
    await srv.from("revolut_conexion").update({ estado_oauth_huella: null, estado_oauth_at: null }).eq("id", data.id);
    return mal(textoCancelada(data.oauth_para as OauthPara | null));
  }
  if (accion === "vuelta") {
    const state = String(b.state ?? ""), code = String(b.code ?? "");
    if (!/^[0-9a-f]{64}$/.test(state) || !code) return mal("Revolut ha vuelto sin el permiso. Vuelve a pulsar «Autorizar en Revolut».");
    const { data } = await srv.from("revolut_conexion").select(`${COLUMNAS_CONEXION}, estado_oauth_at, oauth_para`).eq("estado_oauth_huella", await sha256(state)).maybeSingle();
    if (!data) return mal("Esta autorización ya se usó o no es de Sumied. Vuelve a pulsar «Autorizar en Revolut».");
    para = (data.oauth_para ?? null) as OauthPara | null;
    if (!data.estado_oauth_at || Date.now() - Date.parse(data.estado_oauth_at) > MINUTOS_AUTORIZAR * 60_000) return mal(`La autorización ha caducado (vale ${MINUTOS_AUTORIZAR} minutos). Vuelve a pulsar «Autorizar en Revolut».`);
    conexion = data as ConexionRevolut;
    empresa = conexion.company_id;
  }
  if (!/^[0-9a-f-]{36}$/.test(empresa)) return mal("Falta la empresa.", 400);
  const { data: co } = await srv.from("company").select("id, account_id, legal_name, trade_name").eq("id", empresa).maybeSingle();
  if (!co) return mal("Esa empresa no existe.", 404);
  const { data: puede } = await sb.rpc("current_user_is_admin_or_manager_of", { p_account_id: co.account_id });
  if (puede !== true) return mal("Solo un administrador o un encargado de la empresa conecta un banco.", 403);
  // DM1: una cuenta de demostración no se conecta a Revolut. Desconectar, sí (no sale fuera).
  if (accion !== "desconectar" && !(await cuentaPuedeSalir(srv, co.account_id))) return json({ ok: false, demo: true, texto: `${EN_LA_DEMO} Una cuenta de demostración no se conecta a Revolut.` });
  if (!conexion) {
    const { data } = await srv.from("revolut_conexion").select(COLUMNAS_CONEXION).eq("company_id", empresa).maybeSingle();
    conexion = (data ?? null) as ConexionRevolut | null;
  }

  try {
    switch (accion) {
      case "empezar": {
        const vuelta = vueltaDe(b.origen);
        if (!vuelta) return mal("Abre Sumied desde su dirección de siempre (app.sumied.com) para conectar Revolut.");
        const desde = typeof b.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.desde) ? b.desde : null;
        if (conexion?.estado === "conectada") return mal("Revolut ya está conectado en esta empresa.");
        // Se sigue con la conexión a medias solo si es del mismo entorno: una
        // empezada contra el sandbox (antes de poner REVOLUT_ENTORNO) pediría el
        // token al sandbox con un Client ID de verdad. Si cambia, llave nueva.
        if (conexion && b.nuevo !== true && conexion.vuelta === vuelta && conexion.entorno === ENTORNO && ["certificado", "autorizar"].includes(conexion.estado)) {
          const { data } = await srv.from("revolut_conexion").select("certificado").eq("id", conexion.id).single();
          if (desde) await srv.from("revolut_conexion").update({ desde_historico: desde }).eq("id", conexion.id);
          return json({ ok: true, certificado: data?.certificado, vuelta, estado: conexion.estado });
        }
        const llave = await crearLlave(String(co.legal_name ?? co.trade_name ?? "Empresa"));
        await guardarSecreto(srv, empresa, "privada", llave.privadaPem);
        const fila = { account_id: co.account_id, company_id: empresa, entorno: ENTORNO, estado: "certificado", certificado: llave.certificadoPem, certificado_huella: llave.huella,
          vuelta, desde_historico: desde, permisos: null, estado_oauth_huella: null, estado_oauth_at: null, conectada_at: null, desconectada_at: null, last_error: null,
          created_by: u.user.id, created_by_name: quien };
        const { error } = await srv.from("revolut_conexion").upsert(fila, { onConflict: "company_id" });
        if (error) throw new Error(`No se ha podido guardar la conexión: ${error.message}`);
        return json({ ok: true, certificado: llave.certificadoPem, vuelta, estado: "certificado" });
      }
      case "client_id": {
        if (!conexion || !["certificado", "autorizar"].includes(conexion.estado)) return mal("Empieza otra vez: copia el certificado primero.");
        if (conexion.entorno !== ENTORNO) return mal("Revolut ha cambiado de entorno desde que empezaste. Cierra el asistente y vuelve a conectar: hay que copiar un certificado nuevo.");
        const clientId = String(b.clientId ?? "").trim();
        const motivo = comprobarClientId(clientId);
        if (motivo) return mal(motivo);
        await guardarSecreto(srv, empresa, "client_id", clientId);
        const state = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
        await srv.from("revolut_conexion").update({ estado: "autorizar", estado_oauth_huella: await sha256(state), estado_oauth_at: new Date().toISOString(), oauth_para: "conectar" }).eq("id", conexion.id);
        return json({ ok: true, url: paginaDeAutorizar(ENTORNO, { clientId, vuelta: conexion.vuelta, permisos: PERMISOS_AL_CONECTAR_TEXTO, estado: state }) });
      }
      case "activar_pagos": {
        // B01 · PR 2b · Volver a pasar por la página de autorizar de Revolut, ahora con PAY.
        if (conexion?.estado !== "conectada") return mal("Revolut no está conectado en esta empresa: conéctalo antes de activar los pagos.");
        if (conexion.entorno !== ENTORNO) return mal("Revolut ha cambiado de entorno desde que se conectó. Desconéctalo y vuelve a conectar.");
        const { data: admin } = await sb.rpc("current_user_is_admin_of", { p_account_id: co.account_id });
        if (admin !== true) return mal("Solo un administrador activa los pagos.", 403);
        // Sin llave ni PIN no podría dar la segunda aprobación (maqueta «Activar pagos», paso 1).
        const [{ count: llaves }, { data: pin }] = await Promise.all([
          srv.from("conta_llave").select("id", { count: "exact", head: true }).eq("user_id", u.user.id).is("revoked_at", null),
          srv.from("conta_pago_pin").select("bloqueado_at").eq("user_id", u.user.id).maybeSingle(),
        ]);
        if (!llaves && !(pin && !pin.bloqueado_at)) return mal("Antes de activar los pagos, activa tu llave de acceso o crea tu PIN de pago: con ellos darás la segunda aprobación.");
        const clientId = await secreto(srv, empresa, "client_id");
        if (!clientId) return mal("Falta el Client ID de esta empresa: desconecta Revolut y vuelve a conectar.");
        const state = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
        await srv.from("revolut_conexion").update({ estado_oauth_huella: await sha256(state), estado_oauth_at: new Date().toISOString(), oauth_para: "activar_pagos" }).eq("id", conexion.id);
        return json({ ok: true, url: paginaDeAutorizar(ENTORNO, { clientId, vuelta: conexion.vuelta, permisos: PERMISOS_CON_PAGOS_TEXTO, estado: state }) });
      }
      case "dejar_de_pagar": {
        // B01 · 2c-1 (Julio, 01/11): primero, en Sumied y al instante, nadie paga.
        // Después, a Revolut con READ y WRITE, para que el token deje de tener PAY.
        const { data: admin } = await sb.rpc("current_user_is_admin_of", { p_account_id: co.account_id });
        if (admin !== true) return mal("Solo un administrador deja de pagar con Revolut.", 403);
        const { data: dej, error: dejErr } = await srv.rpc("conta_pago_dejar", { p_company: empresa, p_quien: u.user.id, p_quien_nombre: quien, p_motivo: `${quien} ha dejado de pagar con Revolut` });
        if (dejErr) return mal(`No se ha podido dejar de pagar: ${dejErr.message}`);
        const frase = String((dej as Record<string, unknown>)?.frase ?? "Ya no se puede pagar con Revolut desde Sumied.");
        console.log(`[conta-revolut-conectar] ${empresa.slice(0, 8)}: deja de pagar (${(dej as Record<string, unknown>)?.permisos ?? 0} permisos, ${(dej as Record<string, unknown>)?.lotes ?? 0} lotes)`);
        if (conexion?.estado !== "conectada" || conexion.entorno !== ENTORNO) return json({ ok: true, frase, texto: frase });
        const clientId = await secreto(srv, empresa, "client_id");
        if (!clientId) return json({ ok: true, frase, texto: `${frase} Falta el Client ID de esta empresa para quitar el permiso también en Revolut: desconecta Revolut y vuelve a conectar.` });
        const state = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
        await srv.from("revolut_conexion").update({ estado_oauth_huella: await sha256(state), estado_oauth_at: new Date().toISOString(), oauth_para: "dejar_de_pagar" }).eq("id", conexion.id);
        return json({ ok: true, frase, texto: frase, url: paginaDeAutorizar(ENTORNO, { clientId, vuelta: conexion.vuelta, permisos: PERMISOS_AL_CONECTAR_TEXTO, estado: state }) });
      }
      case "vuelta": {
        const c = conexion!;
        if (c.entorno !== ENTORNO) return mal("Revolut ha cambiado de entorno desde que empezaste. Cierra el asistente y vuelve a conectar: hay que copiar un certificado nuevo.");
        // B01 · PR 2b · Una conexión que ya estaba conectada y vuelve de Revolut es «Activar pagos»,
        // o «Dejar de pagar» (2c-1), según a qué se fue.
        if (c.estado === "conectada" && para === "dejar_de_pagar") {
          const [privada, clientId] = await Promise.all([secreto(srv, empresa, "privada"), secreto(srv, empresa, "client_id")]);
          if (!privada || !clientId) return mal(`${DEJADO} Falta la llave o el Client ID de esta empresa para quitarlo también en Revolut: desconecta Revolut y vuelve a conectar.`);
          let t;
          try {
            t = await pedirToken(fetch, c.entorno, { privadaPem: privada, clientId, vuelta: c.vuelta, codigo: String(b.code) });
          } catch (e) {
            await srv.from("revolut_conexion").update({ estado_oauth_huella: null, estado_oauth_at: null }).eq("id", c.id);
            return mal(`${DEJADO} Revolut no ha cambiado el permiso: ${e instanceof Error ? e.message : String(e)} Para quitárselo también allí, vuelve a pulsar «Quitar el permiso en Revolut».`);
          }
          if (t.renovacion) await guardarSecreto(srv, empresa, "renovacion", t.renovacion);
          await srv.from("revolut_conexion").update({ permisos: PERMISOS_AL_CONECTAR_TEXTO, estado_oauth_huella: null, estado_oauth_at: null, last_error: null, oauth_para: null }).eq("id", c.id);
          console.log(`[conta-revolut-conectar] ${empresa.slice(0, 8)}: Revolut sin PAY (${c.entorno})`);
          return json({ ok: true, pagos: false, texto: "Hecho. Revolut ya no tiene el permiso de pagar: Sumied sigue leyendo los movimientos como antes." });
        }
        if (c.estado === "conectada") {
          const [privada, clientId] = await Promise.all([secreto(srv, empresa, "privada"), secreto(srv, empresa, "client_id")]);
          if (!privada || !clientId) return mal("Falta la llave o el Client ID de esta empresa: desconecta Revolut y vuelve a conectar.");
          let t;
          try {
            t = await pedirToken(fetch, c.entorno, { privadaPem: privada, clientId, vuelta: c.vuelta, codigo: String(b.code) });
          } catch (e) {
            await srv.from("revolut_conexion").update({ estado_oauth_huella: null, estado_oauth_at: null }).eq("id", c.id);
            return mal(`No has autorizado los pagos en Revolut: ${e instanceof Error ? e.message : String(e)} Sumied sigue leyendo como antes; no ha cambiado nada.`);
          }
          if (t.renovacion) await guardarSecreto(srv, empresa, "renovacion", t.renovacion);
          const { data: act, error: actErr } = await srv.rpc("conta_pago_activar", { p_company: empresa, p_user: u.user.id });
          if (actErr) {
            await srv.from("revolut_conexion").update({ estado_oauth_huella: null, estado_oauth_at: null }).eq("id", c.id);
            return mal(actErr.message);
          }
          await srv.from("revolut_conexion").update({ permisos: PERMISOS_CON_PAGOS_TEXTO, estado_oauth_huella: null, estado_oauth_at: null, last_error: null, oauth_para: null }).eq("id", c.id);
          const personas = ((act as Record<string, unknown>)?.personas as string[] | undefined) ?? [];
          const { data: topes } = await sb.rpc("conta_pago_topes", { p_company: empresa });
          const t2 = (topes ?? {}) as Record<string, number>;
          const euros = (n: number) => `${Number(n ?? 0).toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`;
          console.log(`[conta-revolut-conectar] ${empresa.slice(0, 8)}: pagos activados (${c.entorno}), ${personas.length} personas pagan`);
          return json({ ok: true, pagos: true, personas,
            texto: `Pagos activados con Revolut. Puede pagar: ${personas.join(", ") || quien}. Topes: ${euros(t2.tope_pago)} por pago y ${euros(t2.tope_dia)} al día.` });
        }
        const [privada, clientId] = await Promise.all([secreto(srv, empresa, "privada"), secreto(srv, empresa, "client_id")]);
        if (!privada || !clientId) return mal("Falta la llave o el Client ID de esta empresa. Empieza otra vez.");
        let t;
        try {
          t = await pedirToken(fetch, c.entorno, { privadaPem: privada, clientId, vuelta: c.vuelta, codigo: String(b.code) });
        } catch (e) {
          // El código vale una vez y poco tiempo: se pide otra autorización.
          await srv.from("revolut_conexion").update({ estado_oauth_huella: null, estado_oauth_at: null, last_error: e instanceof Error ? e.message : String(e) }).eq("id", c.id);
          const txt = e instanceof FalloRevolut && e.status === 403
            ? "Revolut no deja entrar a Sumied. Si tienes puesta en Revolut la lista de IP permitidas, Sumied no tiene una dirección fija: quítala en Revolut › Ajustes › API y vuelve a autorizar."
            : `Revolut no ha dado el permiso: ${e instanceof Error ? e.message : String(e)} Vuelve a pulsar «Autorizar en Revolut».`;
          return mal(txt);
        }
        if (!t.renovacion) return mal("Revolut no ha dado el permiso para seguir leyendo. Vuelve a pulsar «Autorizar en Revolut».");
        await guardarSecreto(srv, empresa, "renovacion", t.renovacion);
        await srv.from("revolut_conexion").update({ estado: "conectada", permisos: PERMISOS_AL_CONECTAR_TEXTO, estado_oauth_huella: null, estado_oauth_at: null,
          conectada_at: new Date().toISOString(), conectada_por: u.user.id, conectada_por_nombre: quien, desconectada_at: null, last_error: null }).eq("id", c.id);
        // El aviso pide WRITE: se ha pedido al conectar (los permisos de AHORA, no los de antes de
        // conectar, que están vacíos). Si Revolut no lo registra, la lectura de cada hora hace de aviso.
        let aviso = false;
        if (dejanAvisar(PERMISOS_AL_CONECTAR_TEXTO)) {
          try {
            const w = await registrarAviso(fetch, c.entorno, t.acceso, `${SUPABASE_URL}/functions/v1/conta-revolut-aviso?c=${c.id}`);
            if (w.secreto) await guardarSecreto(srv, empresa, "aviso", w.secreto);
            await srv.from("revolut_conexion").update({ webhook_id: w.id }).eq("id", c.id);
            aviso = true;
          } catch (e) { console.warn(`[conta-revolut-conectar] ${empresa.slice(0, 8)}: sin aviso (${e instanceof Error ? e.message : String(e)})`); }
        }
        const cuentas = await cuentasDeRevolut(t.acceso);
        console.log(`[conta-revolut-conectar] ${empresa.slice(0, 8)}: conectada (${c.entorno}), ${cuentas.length} cuentas, aviso ${aviso ? "sí" : "no"}`);
        return json({ ok: true, texto: `Conectado con Revolut Business. ${cuentas.length === 1 ? "Tiene 1 cuenta" : `Tiene ${cuentas.length} cuentas`}: lígalas a su cuenta contable.`, cuentas, aviso });
      }
      case "cuentas": {
        if (conexion?.estado !== "conectada") return mal("Revolut no está conectado en esta empresa.");
        return json({ ok: true, cuentas: await cuentasDeRevolut(await tokenDeAcceso(srv, fetch, conexion)) });
      }
      case "leer": {
        if (conexion?.estado !== "conectada") return mal("Revolut no está conectado en esta empresa.");
        const p = await leerEmpresa(srv, fetch, conexion);
        console.log(`[conta-revolut-conectar] leer ${JSON.stringify(paraElRegistro(p))}`);
        if (p.error) return mal(p.error);
        const nuevos = p.cuentas.reduce((s, x) => s + x.nuevos, 0);
        return json({ ok: true, texto: nuevos === 0 ? "Revolut está al día: no había movimientos nuevos." : `Traídos ${nuevos} movimientos de Revolut.`, cuentas: p.cuentas });
      }
      case "desconectar": {
        if (!conexion || !["conectada", "certificado", "autorizar"].includes(conexion.estado)) return mal("Revolut no está conectado en esta empresa.");
        // 2c-1: sin conexión no se paga. Primero, en Sumied, nadie paga y lo que esperaba no sale.
        const { data: dej, error: dejErr } = await srv.rpc("conta_pago_dejar", { p_company: empresa, p_quien: u.user.id, p_quien_nombre: quien, p_motivo: "Revolut se ha desconectado" });
        if (dejErr) return mal(`No se ha podido desconectar: antes hay que dejar de pagar, y ha fallado (${dejErr.message}).`);
        const pagosFuera = Number((dej as Record<string, unknown>)?.permisos ?? 0) + Number((dej as Record<string, unknown>)?.lotes ?? 0) > 0 ? ` ${String((dej as Record<string, unknown>)?.frase ?? "")}` : "";
        // El aviso, fuera de Revolut si se puede (si no, deja de valer al quitar el permiso).
        if (conexion.webhook_id && conexion.estado === "conectada" && (await cuentaPuedeSalir(srv, co.account_id))) {
          try { await quitarAviso(fetch, conexion.entorno, await tokenDeAcceso(srv, fetch, conexion), conexion.webhook_id); } catch { /* sigue: desconectar no puede quedarse a medias */ }
        }
        const { data, error } = await srv.rpc("conta_revolut_desconectar", { p_company: empresa, p_quien: u.user.id, p_quien_nombre: quien, p_desde_revolut: false });
        if (error) throw new Error(error.message);
        const n = Number((data as Record<string, unknown>)?.cuentas ?? 0);
        return json({ ok: true, texto: `Desconectado. Sumied ya no lee ${n === 1 ? "la cuenta" : `las ${n} cuentas`} de Revolut. Lo que ya entró se queda. Quita también el certificado en Revolut › Ajustes › API.${pagosFuera}` });
      }
      default:
        return mal("No sé hacer eso.", 400);
    }
  } catch (e) {
    console.error(`[conta-revolut-conectar] ${accion} ${empresa.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`);
    return mal(`No se ha podido: ${e instanceof Error ? e.message : String(e)}`);
  }
});
