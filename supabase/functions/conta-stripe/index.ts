// supabase/functions/conta-stripe/index.ts
//
// PC01 · Entrega 4 · EL ALTA DEL RESTAURANTE EN STRIPE para cobrar con tarjeta
// y Bizum, y su estado. Lo llama Ajustes › Cobros y Ventas › Cobros («Cómo te
// pagan») con la sesión de quien pulsa.
//
//   accion «alta»:   si la empresa aún no tiene cuenta, la crea con el alta que
//                    funcionó en la sonda (Accounts v2, panel completo, Stripe
//                    cobra las comisiones y cubre las pérdidas, tarjeta) y pide
//                    Bizum justo después. Devuelve el enlace al FORMULARIO DE
//                    STRIPE para terminar el alta (nunca uno nuestro con sus datos).
//   accion «estado»: lee la cuenta en Stripe y guarda tarjeta y Bizum en
//                    palabras; con Bizum activo, lo enciende en sus métodos de pago.
//
// En producción, con la clave real, solo las empresas que Julio pase a real
// (STRIPE_COBRO_REAL, sus ids separados por comas); las demás, «aún en pruebas».
// Contesta 200 con { ok, texto, … } en palabras (regla 8), salvo sesión (401),
// permiso (403) o datos que faltan (400).
//
// verify_jwt = true (config.toml).

import { cuentaPuedeSalir, EN_LA_DEMO } from "../_shared/puerta.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { MARCAS } from "../_shared/marcas.ts";
import { origenFirma } from "../_shared/cobroCorreos.ts";
import { clavePrueba, cuerpoAlta, enlaceAlta, errorStripe, fraseEstado, refrescar, v1, v2 } from "../_shared/stripeSumied.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DOMINIOS = Object.values(MARCAS).flatMap((m) => m.dominios);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);

  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "no autenticado" }, 401);

  let empresa = "", accion = "", origen: unknown = null, quien: string | null = null;
  try {
    const b = await req.json() as Record<string, unknown>;
    empresa = typeof b.empresa === "string" ? b.empresa : "";
    accion = typeof b.accion === "string" ? b.accion : "";
    origen = b.origen;
    quien = typeof b.quien === "string" ? b.quien.slice(0, 120) : null;
  } catch { /* vacío */ }
  if (!/^[0-9a-f-]{36}$/i.test(empresa)) return json({ error: "falta la empresa" }, 400);
  if (accion !== "alta" && accion !== "estado") return json({ error: "accion: alta o estado" }, 400);

  const { data: co } = await sb.from("company").select("id, account_id, legal_name, trade_name, email").eq("id", empresa).maybeSingle();
  if (!co) return json({ ok: false, texto: "Esa empresa no está." }, 404);
  const { data: puede } = await sb.rpc("current_user_is_admin_or_manager_of", { p_account_id: co.account_id });
  if (puede !== true) return json({ error: "Solo un administrador o un encargado de la cuenta da de alta el cobro." }, 403);
  // DM1 · PR 2a · La puerta: una cuenta de demo no se da de alta en Stripe ni le pregunta nada.
  if (!(await cuentaPuedeSalir(sb, co.account_id))) {
    return json({ ok: false, demo: true, texto: `${EN_LA_DEMO} Una empresa de demostración no se da de alta en Stripe: el cobro con tarjeta se enseña, pero no cobra.` });
  }

  const clave = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!clave) return json({ ok: false, texto: "El cobro con tarjeta y Bizum no está configurado en este entorno." });
  const reales = (Deno.env.get("STRIPE_COBRO_REAL") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!clavePrueba(clave) && !reales.includes(empresa.toLowerCase())) {
    return json({ ok: false, texto: "El cobro con tarjeta y Bizum aún está en pruebas: lo abre Julio, empresa a empresa." });
  }

  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const { data: ya } = await srv.rpc("conta_cobro_stripe_de_empresa", { p_company: empresa });
  let cuenta = (ya as { stripe?: string } | null)?.stripe ?? null;

  if (accion === "estado") {
    if (!cuenta) return json({ ok: true, estado: null, texto: "Aún no te has dado de alta en Stripe." });
    const r = await refrescar(clave, srv, empresa, cuenta, quien);
    if (!r.ok) return json({ ok: false, texto: `No se ha podido leer tu alta en Stripe: ${r.error}` });
    return json({ ok: true, estado: r.estado, texto: fraseEstado(String(r.estado.tarjeta), String(r.estado.bizum)) });
  }

  // accion «alta»
  if (!cuenta) {
    const nombre = String(co.trade_name || co.legal_name || "Empresa");
    const a = await v2(clave, "/v2/core/accounts", cuerpoAlta({ correo: co.email ?? null, nombre }));
    if (!a.ok || !a.datos?.id) return json({ ok: false, texto: `Stripe no ha creado tu cuenta: ${errorStripe(a)}` });
    cuenta = String(a.datos.id);
    const b = await v1(clave, "POST", `/v1/accounts/${cuenta}/capabilities/bizum_payments`, { requested: "true" });
    if (!b.ok) console.error(`conta-stripe · ${empresa} · Bizum no pedido: ${b.status}`);
    const { error } = await srv.rpc("conta_cobro_stripe_apuntar", {
      p_company: empresa, p_stripe: cuenta, p_tarjeta: "falta_alta", p_bizum: "falta_alta", p_bizum_encendido: false, p_pendiente: 0, p_quien: quien,
    });
    if (error) return json({ ok: false, texto: `Tu cuenta de Stripe se ha creado, pero no se ha podido guardar: ${error.message}. Avisa a soporte.` });
  }
  const base = `${origenFirma(origen, DOMINIOS)}/conta/ajustes/cobros`;
  const e = await enlaceAlta(clave, cuenta, `${base}?stripe=vuelta`, `${base}?stripe=otra`);
  if ("error" in e) return json({ ok: false, texto: `Stripe no ha dado el enlace para terminar tu alta: ${e.error}` });
  return json({ ok: true, url: e.url, texto: "Te llevo al alta de Stripe." });
});
