// supabase/staging/sondas/stripe-bizum/index.ts  (Deno; fuera de supabase/functions a propósito: main no la despliega)
//
// PC01 · E4 · Punto 3 · LA SONDA DE BIZUM CON STRIPE CONNECT, solo en staging-conta.
//
// La pregunta del encargo, antes de construir el enlace de pago: ¿Bizum
// funciona con Stripe Connect en una cuenta conectada ESPAÑOLA, en modo de
// prueba? Se contesta haciendo, no leyendo:
//
//   1. la plataforma: país y moneda de la cuenta de la clave (GET /v1/account);
//   2. una cuenta conectada de prueba, España, pidiendo las capacidades de
//      tarjeta, transferencias y Bizum (bizum_payments), con los datos de
//      prueba que Stripe acepta para activarla;
//   3. en esa cuenta (cargo directo, cabecera Stripe-Account, como la tienda de
//      Folvy en shop-payment-intent):
//        a. un PaymentIntent solo con Bizum, confirmado con Bizum y una
//           dirección de vuelta: qué contesta y qué siguiente paso pide;
//        b. si pide ir a la página del banco, la página de PRUEBA de Stripe
//           se autoriza y se mira el estado final del cobro;
//        c. un PaymentIntent con los métodos automáticos (lo que hace hoy la
//           tienda): ¿sale Bizum entre ellos?
//        d. una sesión de pago (Checkout) solo con Bizum: lo que usaría el
//           enlace de pago;
//   4. y se borra la cuenta conectada de prueba.
//
// Lo que no puede hacer, y lo vigila el workflow antes de desplegarla:
//   · Producción: para si SUPABASE_URL es la de producción.
//   · Una clave que no sea de PRUEBA: para si STRIPE_SECRET_KEY no empieza por
//     sk_test_ o rk_test_. Nada de lo que hace mueve dinero de verdad.
//   · Escribir la clave en ningún sitio: solo registra { sonda, paso, status }.
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

type Resp = { status: number; ok: boolean; datos: any };

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
  return { status: r.status, ok: r.ok, datos };
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
  out.plataforma = plat.ok ? { pais: plat.datos?.country ?? null, moneda: plat.datos?.default_currency ?? null } : error(plat);

  // 2. La cuenta conectada de prueba, España, con Bizum pedido.
  const base: Record<string, string> = {
    type: "custom",
    country: "ES",
    email: "sonda-bizum@example.com",
    business_type: "individual",
    "capabilities[card_payments][requested]": "true",
    "capabilities[transfers][requested]": "true",
    "capabilities[bizum_payments][requested]": "true",
    "business_profile[mcc]": "5812",
    "business_profile[product_description]": "Restaurante (sonda de prueba)",
    "individual[first_name]": "Sonda",
    "individual[last_name]": "Prueba",
    "individual[email]": "sonda-bizum@example.com",
    "individual[phone]": "+34600000000",
    "individual[dob][day]": "1",
    "individual[dob][month]": "1",
    "individual[dob][year]": "1901",
    "individual[address][line1]": "address_full_match",
    "individual[address][city]": "Madrid",
    "individual[address][postal_code]": "28001",
    "individual[address][country]": "ES",
    "individual[id_number]": "000000000",
    "external_account[object]": "bank_account",
    "external_account[country]": "ES",
    "external_account[currency]": "eur",
    "external_account[account_number]": "ES0700120345030000067890",
    "tos_acceptance[date]": String(Math.floor(Date.now() / 1000)),
    "tos_acceptance[ip]": "8.8.8.8",
  };
  let alta = await stripe(clave, "POST", "/v1/accounts", base);
  out.alta_con_bizum = alta.ok ? { ok: true } : error(alta);
  if (!alta.ok) {
    // ¿Es la capacidad de Bizum lo que no acepta? Se repite sin ella, para
    // poder probar igual el cobro y que el error lo diga el cobro.
    const sinBizum = { ...base };
    delete sinBizum["capabilities[bizum_payments][requested]"];
    alta = await stripe(clave, "POST", "/v1/accounts", sinBizum);
    out.alta_sin_bizum = alta.ok ? { ok: true } : error(alta);
  }
  const cuenta: string | null = alta.ok ? alta.datos?.id ?? null : null;
  if (!cuenta) return json(out);

  try {
    // Un momento para que Stripe resuelva la verificación de prueba.
    await new Promise((r) => setTimeout(r, 4000));
    const leida = await stripe(clave, "GET", `/v1/accounts/${cuenta}`);
    const caps = leida.datos?.capabilities ?? {};
    out.capacidades = { bizum_payments: caps.bizum_payments ?? "no_existe", card_payments: caps.card_payments ?? "no_existe", transfers: caps.transfers ?? "no_existe" };
    out.cobros_activos = leida.datos?.charges_enabled === true;
    out.pendiente = (leida.datos?.requirements?.currently_due ?? []).length;
    out.pendiente_lista = leida.datos?.requirements?.currently_due ?? [];

    // 3a. Solo Bizum, confirmado con Bizum.
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
        // 3b. La página de prueba: autorizar y mirar el estado final.
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

    // 3c. Los métodos automáticos (lo que hace hoy la tienda): ¿sale Bizum?
    const auto = await stripe(clave, "POST", "/v1/payment_intents", {
      amount: "1234", currency: "eur", "automatic_payment_methods[enabled]": "true",
    }, cuenta);
    out.automaticos = auto.ok ? { metodos: auto.datos?.payment_method_types ?? [], bizum: (auto.datos?.payment_method_types ?? []).includes("bizum") } : { ok: false, ...error(auto), mensaje: tapar(error(auto).mensaje) };
    if (auto.ok) await stripe(clave, "POST", `/v1/payment_intents/${auto.datos.id}/cancel`, {}, cuenta);

    // 3d. Una sesión de pago solo con Bizum (el enlace de pago).
    const cs = await stripe(clave, "POST", "/v1/checkout/sessions", {
      mode: "payment",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": "1234",
      "line_items[0][price_data][product_data][name]": "Factura de prueba",
      "line_items[0][quantity]": "1",
      "payment_method_types[]": "bizum",
      success_url: VUELTA, cancel_url: VUELTA,
    }, cuenta);
    out.sesion_bizum = cs.ok ? { ok: true, metodos: cs.datos?.payment_method_types ?? [], dominio: cs.datos?.url ? new URL(cs.datos.url).hostname : null } : { ok: false, ...error(cs), mensaje: tapar(error(cs).mensaje) };
    if (cs.ok) await stripe(clave, "POST", `/v1/checkout/sessions/${cs.datos.id}/expire`, {}, cuenta);

    // La misma sesión con tarjeta y Bizum juntos.
    const cs2 = await stripe(clave, "POST", "/v1/checkout/sessions", {
      mode: "payment",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": "1234",
      "line_items[0][price_data][product_data][name]": "Factura de prueba",
      "line_items[0][quantity]": "1",
      "payment_method_types[0]": "card",
      "payment_method_types[1]": "bizum",
      success_url: VUELTA, cancel_url: VUELTA,
    }, cuenta);
    out.sesion_tarjeta_y_bizum = cs2.ok ? { ok: true, metodos: cs2.datos?.payment_method_types ?? [] } : { ok: false, ...error(cs2), mensaje: tapar(error(cs2).mensaje) };
    if (cs2.ok) await stripe(clave, "POST", `/v1/checkout/sessions/${cs2.datos.id}/expire`, {}, cuenta);
  } finally {
    // 4. Se borra la cuenta conectada de prueba.
    const borra = await stripe(clave, "DELETE", `/v1/accounts/${cuenta}`);
    out.cuenta_borrada = borra.ok && borra.datos?.deleted === true;
  }
  return json(out);
});
