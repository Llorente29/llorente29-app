// supabase/staging/sondas/stripe-bizum/index.ts  (Deno; fuera de supabase/functions a propósito: main no la despliega)
//
// PC01 · E4 · Punto 3 · LA SONDA DE BIZUM CON STRIPE CONNECT, solo en staging-conta.
//
// La pregunta del encargo, antes de construir el enlace de pago: ¿Bizum
// funciona con Stripe Connect en una cuenta conectada ESPAÑOLA, en modo de
// prueba? Se contesta haciendo, no leyendo:
//
//   1. la plataforma: país y moneda de la cuenta de la clave (GET /v1/account);
//   2. UNA alta de prueba, España, por Accounts v2 (panel completo, Stripe
//      cobra las comisiones y cubre las pérdidas, solo tarjeta en el alta),
//      probando las versiones de la API en orden y guardando el error literal
//      de cada una (Respuesta 9 al PC01, 27/10). Después, aparte:
//        2.1 todas sus capacidades, con su estado;
//        2.2 pedir bizum_payments (POST /v1/accounts/{id}/capabilities/…);
//        2.3 sus configuraciones de métodos de pago: si sale Bizum y si se
//            puede activar;
//   3. en esa cuenta (cargo directo, cabecera Stripe-Account, como la tienda de
//      Folvy en shop-payment-intent): un cobro solo con Bizum, los métodos
//      automáticos y la sesión de pago (Checkout) con Bizum y con tarjeta y
//      Bizum. Sin datos de alta (los pide Stripe), el error literal también
//      responde;
//   4. y se borra (o se cierra) la cuenta de prueba.
//
// Lo que no puede hacer, y lo vigila el workflow antes de desplegarla:
//   · Producción: para si SUPABASE_URL es la de producción.
//   · Una clave que no sea de PRUEBA: para si STRIPE_SECRET_KEY no empieza por
//     sk_test_ o rk_test_. Nada de lo que hace mueve dinero de verdad.
//   · Escribir la clave en ningún sitio: solo registra { sonda, paso, status }.
//
// Historia: el run de las 06:40Z del 27/10 no llegó al cobro: Stripe rechazó
// el alta de prueba por business_profile[url] («Not a valid URL»). La web no es
// obligatoria y se quitó (1245193a). El de las 08:42Z (be54e853) dijo la causa
// de verdad: el alta llevaba «type» con la plataforma cubriendo las pérdidas, y
// eso Stripe ya no lo acepta. El de las 11:03Z (57153459): la v1 con panel
// Express exige que las pérdidas sean de la plataforma, y la v2 pide versión y
// no conoce bizum_payments en el alta. Ahora: una alta v2 con panel completo, y
// Bizum se pide aparte, después.
//
// El workflow la copia a supabase/functions/stripe-bizum-sonda/ dentro del
// runner, la llama una vez y la borra. No vive en main.

const PRODUCCION_REF = "xzmpnchlguibclvxyynt";
const API = "https://api.stripe.com";
const SOLO_PRUEBA = /^(sk|rk)_test_/;
const VUELTA = "https://example.com/sonda-bizum/vuelta";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Resp = { status: number; ok: boolean; datos: any; version?: string | null };

async function stripe(clave: string, metodo: "GET" | "POST" | "DELETE", ruta: string, campos: Record<string, string> = {}, cuenta?: string): Promise<Resp> {
  const headers: Record<string, string> = { Authorization: `Bearer ${clave}` };
  if (cuenta) headers["Stripe-Account"] = cuenta;
  let body: string | undefined;
  if (metodo === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(campos).toString();
  }
  const r = await fetch(`${API}${ruta}`, { method: metodo, headers, body, signal: AbortSignal.timeout(25_000) });
  const datos = await r.json().catch(() => null);
  console.log(JSON.stringify({ sonda: "stripe-bizum", paso: `${metodo} ${ruta.split("?")[0].replace(/(acct|pi|cs)_[A-Za-z0-9_]+/g, "$1_…")}`, status: r.status }));
  return { status: r.status, ok: r.ok, datos, version: r.headers.get("stripe-version") };
}

/** Lo que se cuenta de un error de Stripe: su tipo, su código y su texto (de Stripe, sin datos de nadie). */
function error(r: Resp) {
  const e = r.datos?.error ?? {};
  return { status: r.status, tipo: e.type ?? null, codigo: e.code ?? null, parametro: e.param ?? null, mensaje: e.message ?? null };
}

const tapar = (s: unknown) => typeof s === "string" ? s.replace(/(acct|pi|pm|cs|pa_nonce|src)_[A-Za-z0-9_]+/g, "$1_…") : s;

async function autorizarPrueba(url: string): Promise<{ pasos: number; ultimo: number | null; nota: string }> {
  // La página de prueba de Stripe para métodos con redirección tiene dos
  // salidas, «Authorize» y «Fail». Se sigue la de autorizar.
  let pasos = 0, ultimo: number | null = null, nota = "sin_enlace_autorizar";
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
    pasos++; ultimo = r.status;
    const html = await r.text();
    const href = /href="([^"]*authorize[^"]*)"/i.exec(html)?.[1] ?? /action="([^"]*authorize[^"]*)"/i.exec(html)?.[1] ?? null;
    if (href) {
      const destino = new URL(href.replace(/&amp;/g, "&"), r.url).toString();
      const esForm = /action="[^"]*authorize/i.test(html);
      const r2 = await fetch(destino, { method: esForm ? "POST" : "GET", redirect: "manual", signal: AbortSignal.timeout(20_000) });
      pasos++; ultimo = r2.status; nota = esForm ? "formulario_autorizar" : "enlace_autorizar";
    } else if (/authorize/i.test(html)) {
      nota = "texto_autorizar_sin_enlace";
    }
  } catch (e) {
    nota = `fallo_${(e as Error).name}`;
  }
  return { pasos, ultimo, nota };
}

Deno.serve(async (req: Request) => {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (url.includes(PRODUCCION_REF)) return json({ ok: false, error: "produccion" }, 403);
  const token = Deno.env.get("STRIPE_BIZUM_SONDA_TOKEN") ?? "";
  if (!token || req.headers.get("x-stripe-sonda") !== token) return json({ ok: false, error: "token" }, 401);

  const clave = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!clave) return json({ ok: false, error: "sin_clave" });
  if (!SOLO_PRUEBA.test(clave)) return json({ ok: false, error: "clave_no_es_de_prueba" });

  const out: Record<string, unknown> = { ok: true, modo_prueba: true };

  // 1. La plataforma.
  const plat = await stripe(clave, "GET", "/v1/account");
  out.plataforma = plat.ok ? {
    pais: plat.datos?.country ?? null, moneda: plat.datos?.default_currency ?? null,
    capacidades_bizum: Object.fromEntries(Object.entries(plat.datos?.capabilities ?? {}).filter(([k]) => /bizum/i.test(k))),
    version_de_la_cuenta: plat.version ?? null,
  } : error(plat);

  // 2. UNA alta de prueba, España (Respuesta 9 al PC01, del ejemplo oficial de
  //    Stripe «Create connected accounts with Managed Risk»): Accounts v2, panel
  //    completo (el restaurante tiene su propio panel de Stripe), Stripe cobra
  //    las comisiones y cubre las pérdidas, y solo tarjeta en el alta. Bizum va
  //    DESPUÉS, aparte. Versiones, en orden y con el error literal de cada una:
  //    la de la cuenta (la cabecera Stripe-Version de la v1) si no es preview,
  //    la última estable que se conoce y 2026-09-30.preview.
  const versiones = [...new Set([
    ...(plat.version && !/preview/i.test(plat.version) ? [plat.version] : []),
    "2025-09-30.clover",
    "2026-09-30.preview",
  ])];
  const cuerpo = {
    contact_email: "sonda-bizum@example.com",
    display_name: "Sonda Bizum (prueba)",
    dashboard: "full",
    identity: { country: "es" },
    defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
    configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
  };
  const intentos: unknown[] = [];
  let cuenta: string | null = null, version: string | null = null;
  for (const v of versiones) {
    const a = await stripeV2(clave, "/v2/core/accounts", cuerpo, v);
    if (a.ok && a.datos?.id) { cuenta = a.datos.id; version = v; intentos.push({ version: v, creada: true }); break; }
    intentos.push({ version: v, creada: false, ...error(a), mensaje: tapar(error(a).mensaje) });
  }
  out.alta = { creada: cuenta !== null, version, intentos };
  if (!cuenta) return json(out);

  try {
    // 2.1 Todas las capacidades de la cuenta, con su estado.
    await new Promise((r) => setTimeout(r, 3000));
    const leida = await stripe(clave, "GET", `/v1/accounts/${cuenta}`);
    out.capacidades = leida.ok ? {
      todas: leida.datos?.capabilities ?? {},
      cobros_activos: leida.datos?.charges_enabled === true,
      pendiente: leida.datos?.requirements?.currently_due ?? [],
      deshabilitada_por: leida.datos?.requirements?.disabled_reason ?? null,
    } : { ...error(leida), mensaje: tapar(error(leida).mensaje) };

    // 2.2 Pedir Bizum aparte, una vez creada.
    const pide = await stripe(clave, "POST", `/v1/accounts/${cuenta}/capabilities/bizum_payments`, { requested: "true" });
    out.pedir_bizum = pide.ok ? {
      ok: true, estado: pide.datos?.status ?? null, pedida: pide.datos?.requested ?? null,
      le_falta: pide.datos?.requirements?.currently_due ?? [], vencidos: pide.datos?.requirements?.past_due ?? [],
      deshabilitada_por: pide.datos?.requirements?.disabled_reason ?? null, errores: pide.datos?.requirements?.errors ?? [],
    } : { ok: false, ...error(pide), mensaje: tapar(error(pide).mensaje) };
    await new Promise((r) => setTimeout(r, 2000));
    const otra = await stripe(clave, "GET", `/v1/accounts/${cuenta}/capabilities/bizum_payments`);
    out.bizum_despues = otra.ok ? { estado: otra.datos?.status ?? null, le_falta: otra.datos?.requirements?.currently_due ?? [] } : { ...error(otra), mensaje: tapar(error(otra).mensaje) };

    // 2.3 Las configuraciones de métodos de pago de la cuenta: ¿sale Bizum y se puede activar?
    const conf = await stripe(clave, "GET", "/v1/payment_method_configurations", {}, cuenta);
    out.configuraciones = conf.ok ? ((conf.datos?.data ?? []) as any[]).map((c) => ({
      nombre: c?.name ?? null, activa: c?.active ?? null, por_defecto: c?.is_default ?? null,
      bizum: c?.bizum ? { disponible: c.bizum.available ?? null, preferencia: c.bizum.display_preference ?? null } : "no_aparece",
      tarjeta: c?.card ? { disponible: c.card.available ?? null, preferencia: c.card.display_preference ?? null } : "no_aparece",
    })) : { ...error(conf), mensaje: tapar(error(conf).mensaje) };

    // 3. Los cobros de antes, sobre esa cuenta.
    out.cobros = await cobros(clave, cuenta);
  } finally {
    // 4. Se borra la cuenta de prueba (o se cierra, si la v1 no la borra).
    const b = await stripe(clave, "DELETE", `/v1/accounts/${cuenta}`);
    if (b.ok && b.datos?.deleted === true) out.borrada = { borrada: true };
    else {
      const c = await stripeV2(clave, `/v2/core/accounts/${cuenta}/close`, {}, version);
      out.borrada = c.ok ? { borrada: false, cerrada: true } : { borrada: false, cerrada: false, error_v1: tapar(error(b).mensaje), error_v2: tapar(error(c).mensaje) };
    }
  }
  return json(out);
});

async function stripeV2(clave: string, ruta: string, cuerpo: unknown, version: string | null): Promise<Resp> {
  const headers: Record<string, string> = { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" };
  if (version) headers["Stripe-Version"] = version;
  const r = await fetch(`${API}${ruta}`, { method: "POST", headers, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(25_000) });
  const datos = await r.json().catch(() => null);
  console.log(JSON.stringify({ sonda: "stripe-bizum", paso: `POST ${ruta.replace(/acct_[A-Za-z0-9_]+/g, "acct_…")}`, version, status: r.status }));
  return { status: r.status, ok: r.ok, datos };
}

/** 3. En la cuenta (cargo directo, cabecera Stripe-Account, como la tienda): Bizum solo, los automáticos y la sesión de pago. */
async function cobros(clave: string, cuenta: string) {
  const out: Record<string, unknown> = {};
  const pi = await stripe(clave, "POST", "/v1/payment_intents", {
    amount: "1234", currency: "eur",
    "payment_method_types[]": "bizum",
    "payment_method_data[type]": "bizum",
    "payment_method_data[billing_details][phone]": "+34600000000",
    confirm: "true", return_url: VUELTA,
    description: "Sonda Bizum · factura de prueba",
  }, cuenta);
  if (pi.ok) {
    const na = pi.datos?.next_action ?? null;
    out.cobro_bizum = { ok: true, estado: pi.datos?.status, metodos: pi.datos?.payment_method_types, siguiente: na?.type ?? null };
    const ir = na?.redirect_to_url?.url ?? null;
    if (ir) {
      const a = await autorizarPrueba(ir);
      await new Promise((r) => setTimeout(r, 3000));
      const fin = await stripe(clave, "GET", `/v1/payment_intents/${pi.datos.id}`, {}, cuenta);
      out.autorizar = { ...a, dominio: new URL(ir).hostname, estado_final: fin.datos?.status ?? null, cobro: fin.datos?.latest_charge ? 1 : 0 };
      if (fin.datos?.latest_charge) {
        const ch = await stripe(clave, "GET", `/v1/charges/${fin.datos.latest_charge}`, {}, cuenta);
        out.cargo = { estado: ch.datos?.status ?? null, pagado: ch.datos?.paid === true, metodo: ch.datos?.payment_method_details?.type ?? null };
      }
    }
  } else {
    out.cobro_bizum = { ok: false, ...error(pi), mensaje: tapar(error(pi).mensaje) };
  }
  const auto = await stripe(clave, "POST", "/v1/payment_intents", { amount: "1234", currency: "eur", "automatic_payment_methods[enabled]": "true" }, cuenta);
  out.automaticos = auto.ok ? { metodos: auto.datos?.payment_method_types ?? [], bizum: (auto.datos?.payment_method_types ?? []).includes("bizum") } : { ok: false, ...error(auto), mensaje: tapar(error(auto).mensaje) };
  if (auto.ok) await stripe(clave, "POST", `/v1/payment_intents/${auto.datos.id}/cancel`, {}, cuenta);
  for (const [clave2, tipos] of [["sesion_bizum", ["bizum"]], ["sesion_tarjeta_y_bizum", ["card", "bizum"]]] as const) {
    const campos: Record<string, string> = {
      mode: "payment",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": "1234",
      "line_items[0][price_data][product_data][name]": "Factura de prueba",
      "line_items[0][quantity]": "1",
      success_url: VUELTA, cancel_url: VUELTA,
    };
    tipos.forEach((t, k) => { campos[`payment_method_types[${k}]`] = t; });
    const cs = await stripe(clave, "POST", "/v1/checkout/sessions", campos, cuenta);
    out[clave2] = cs.ok ? { ok: true, metodos: cs.datos?.payment_method_types ?? [] } : { ok: false, ...error(cs), mensaje: tapar(error(cs).mensaje) };
    if (cs.ok) await stripe(clave, "POST", `/v1/checkout/sessions/${cs.datos.id}/expire`, {}, cuenta);
  }
  return out;
}
