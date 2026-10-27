// supabase/functions/conta-pago/index.ts
//
// PC01 · Entrega 4 · EL ENLACE DE PAGO: de la página pagar.html?t=… (sin
// cuenta) a la página de pago de Stripe, con tarjeta y Bizum.
//
//   · con el token del enlace y nada más (verify_jwt = false): lee la factura,
//     lo pendiente y la cuenta de Stripe de la empresa (conta_enlace_pago_datos);
//   · crea la sesión de pago en la cuenta del restaurante (cargo directo,
//     cabecera Stripe-Account) pidiendo los métodos DE FORMA EXPLÍCITA:
//     tarjeta y, si está activo, Bizum (nunca los automáticos: Bizum no sale
//     en ellos, lo dijo la sonda);
//   · guarda la sesión; el cobro lo apunta el aviso de Stripe
//     (conta-stripe-webhook) cuando Stripe lo confirma, no la vuelta del cliente.
//   · En producción, con la clave real, solo cobra una empresa que Julio haya
//     pasado a real (STRIPE_COBRO_REAL).
//
// Contesta 200 con { url } o { ok: false, texto } en palabras.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { MARCAS } from "../_shared/marcas.ts";
import { origenFirma } from "../_shared/cobroCorreos.ts";
import { centimos, clavePrueba, errorStripe, v1 } from "../_shared/stripeSumied.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DOMINIOS = Object.values(MARCAS).flatMap((m) => m.dominios);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  let token = "", origen: unknown = null;
  try {
    const b = await req.json() as Record<string, unknown>;
    token = typeof b.token === "string" ? b.token : "";
    origen = b.origen;
  } catch { /* vacío */ }
  if (!/^[0-9a-f]{64}$/.test(token)) return json({ ok: false, texto: "Este enlace no está completo. Ábrelo otra vez desde el correo." }, 400);

  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const { data } = await srv.rpc("conta_enlace_pago_datos", { p_token: token });
  const d = data as Record<string, unknown> | null;
  if (!d) return json({ ok: false, texto: "Este enlace no existe. Ábrelo otra vez desde el correo." });
  if (d.estado === "pagado") return json({ ok: false, texto: "Esta factura ya está pagada. Gracias." });
  if (d.estado !== "abierto") return json({ ok: false, texto: "Este enlace ya no vale. Pide otro a quien te lo mandó." });
  const pendiente = Number(d.pendiente ?? 0);
  if (!(pendiente >= 0.5)) return json({ ok: false, texto: "Esta factura no tiene nada pendiente de pagar." });
  if (!d.stripe || d.tarjeta !== "activo") return json({ ok: false, texto: `${d.empresa} aún no puede cobrar con tarjeta. Pregúntale cómo pagar.` });

  const clave = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!clave) return json({ ok: false, texto: "El pago con tarjeta no está disponible ahora mismo." });
  const reales = (Deno.env.get("STRIPE_COBRO_REAL") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const empresaId = String(d.empresa_id ?? "");
  if (!clavePrueba(clave) && (d.modo !== "real" && !reales.includes(empresaId.toLowerCase()))) {
    return json({ ok: false, texto: `${d.empresa} aún no cobra con tarjeta por aquí. Pregúntale cómo pagar.` });
  }

  const base = `${origenFirma(origen, DOMINIOS)}/pagar.html?t=${token}`;
  const campos: Record<string, string> = {
    mode: "payment",
    locale: "es",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(centimos(pendiente)),
    "line_items[0][price_data][product_data][name]": `Factura ${d.factura} de ${d.empresa}`.slice(0, 250),
    "line_items[0][quantity]": "1",
    "payment_method_types[0]": "card",
    success_url: `${base}&vuelta=ok`,
    cancel_url: `${base}&vuelta=no`,
    "metadata[enlace]": String(d.enlace),
    "metadata[factura]": String(d.factura_id),
    "payment_intent_data[metadata][enlace]": String(d.enlace),
    "payment_intent_data[metadata][factura]": String(d.factura_id),
  };
  if (d.bizum === "activo") campos["payment_method_types[1]"] = "bizum";
  if (typeof d.correo === "string" && d.correo) campos.customer_email = d.correo;
  const s = await v1(clave, "POST", "/v1/checkout/sessions", campos, String(d.stripe));
  if (!s.ok || !s.datos?.url) {
    console.error(`conta-pago · ${d.enlace} · Stripe ${s.status}`);
    return json({ ok: false, texto: `No se ha podido abrir el pago: ${errorStripe(s)}` });
  }
  await srv.rpc("conta_enlace_pago_sesion", { p_token: token, p_sesion: String(s.datos.id) });
  return json({ ok: true, url: String(s.datos.url) });
});
