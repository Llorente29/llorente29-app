// supabase/functions/conta-stripe-webhook/index.ts
//
// PC01 · Entrega 4 · LOS AVISOS DE STRIPE para el cobro con tarjeta y Bizum de
// Sumied (un punto de aviso de Connect: llegan los de las cuentas de los
// restaurantes, con «account»).
//
//   · checkout.session.completed con el pago hecho (tarjeta), o
//     checkout.session.async_payment_succeeded (Bizum, que se autoriza en el
//     móvil y llega después): apunta el cobro por el motor de la E1
//     (conta_enlace_pago_cobrado), una vez por sesión, con el método de verdad;
//   · S01: con el cobro, la comisión y el neto que da Stripe (el movimiento de
//     saldo del cargo), para casar después en Bancos su abono, que trae el
//     neto (conta_enlace_pago_comision);
//   · account.updated y capability.updated: vuelve a leer la cuenta y guarda
//     tarjeta y Bizum en palabras; con Bizum activo, lo enciende en sus
//     métodos de pago (refrescar).
//
// Solo con la firma de Stripe (STRIPE_SUMIED_WEBHOOK_SECRET; firmaValida): sin
// ella, 400 y no se toca nada. Lo que no es de Sumied (otra cuenta, otra sesión)
// se contesta 200 y se ignora, para que Stripe no lo repita.
//
// verify_jwt = false (config.toml): lo llama Stripe.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { firmaValida, refrescar, v1 } from "../_shared/stripeSumied.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const cuerpo = await req.text();
  const secreto = Deno.env.get("STRIPE_SUMIED_WEBHOOK_SECRET") ?? "";
  if (!(await firmaValida(cuerpo, req.headers.get("stripe-signature"), secreto))) return json({ error: "firma" }, 400);

  let ev: { id?: string; type?: string; account?: string; data?: { object?: Record<string, any> } };
  try { ev = JSON.parse(cuerpo); } catch { return json({ error: "json" }, 400); }
  const tipo = String(ev.type ?? "");
  const cuenta = typeof ev.account === "string" ? ev.account : null;
  const o = ev.data?.object ?? {};
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const clave = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!cuenta) return json({ ok: true, ignorado: "sin_cuenta" });
  const { data: de } = await srv.rpc("conta_cobro_stripe_de", { p_stripe: cuenta });
  const empresa = (de as { empresa?: string } | null)?.empresa ?? null;
  if (!empresa) return json({ ok: true, ignorado: "otra_cuenta" });

  if (tipo === "account.updated" || tipo === "capability.updated") {
    const r = await refrescar(clave, srv, empresa, cuenta, "Stripe");
    if (!r.ok) { console.error(`conta-stripe-webhook · ${ev.id} · ${r.error}`); return json({ error: "refrescar" }, 500); }
    return json({ ok: true, estado: r.estado });
  }

  const pagado = (tipo === "checkout.session.completed" && o.payment_status === "paid") || tipo === "checkout.session.async_payment_succeeded";
  if (!pagado) return json({ ok: true, ignorado: tipo });
  // El método de verdad: el del cargo (tarjeta o Bizum).
  let metodo = "tarjeta";
  let saldo: { fee?: number; net?: number } | null = null;
  if (typeof o.payment_intent === "string") {
    const pi = await v1(clave, "GET", `/v1/payment_intents/${o.payment_intent}?expand[]=latest_charge.balance_transaction`, {}, cuenta);
    const t = pi.datos?.latest_charge?.payment_method_details?.type;
    if (t === "bizum") metodo = "bizum";
    const bt = pi.datos?.latest_charge?.balance_transaction;
    if (bt && typeof bt === "object" && Number.isFinite(Number(bt.fee)) && Number.isFinite(Number(bt.net))) saldo = { fee: Number(bt.fee), net: Number(bt.net) };
  }
  const { data, error } = await srv.rpc("conta_enlace_pago_cobrado", {
    p_sesion: String(o.id ?? ""), p_stripe: cuenta, p_pago_ref: typeof o.payment_intent === "string" ? o.payment_intent : null,
    p_importe: Number(o.amount_total ?? 0) / 100, p_metodo: metodo, p_fecha: null,
  });
  if (error) { console.error(`conta-stripe-webhook · ${ev.id} · ${error.message}`); return json({ error: "cobrado" }, 500); }
  // La comisión y el neto (en céntimos en Stripe). Sin ellos, el abono se casa igual, pero no «seguro».
  if (saldo && (data as { hecho?: boolean } | null)?.hecho) {
    const { error: ec } = await srv.rpc("conta_enlace_pago_comision", { p_sesion: String(o.id ?? ""), p_comision: saldo.fee! / 100, p_neto: saldo.net! / 100 });
    if (ec) console.error(`conta-stripe-webhook · ${ev.id} · comisión: ${ec.message}`);
  }
  console.log(JSON.stringify({ funcion: "conta-stripe-webhook", evento: tipo, ...(data as Record<string, unknown>) }));
  return json({ ok: true, ...(data as Record<string, unknown>) });
});
