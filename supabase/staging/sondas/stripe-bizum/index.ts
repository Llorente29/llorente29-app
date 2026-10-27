// supabase/staging/sondas/stripe-bizum/index.ts  (Deno; fuera de supabase/functions a propósito: main no la despliega)
//
// PC01 · E4 · Punto 3 · LA SONDA DE BIZUM CON STRIPE CONNECT, solo en staging-conta.
//
// La pregunta del encargo, antes de construir el enlace de pago: ¿Bizum
// funciona con Stripe Connect en una cuenta conectada ESPAÑOLA, en modo de
// prueba? Se contesta haciendo, no leyendo:
//
//   1. la plataforma: país y moneda de la cuenta de la clave (GET /v1/account);
//   2. DOS altas de prueba, España: la que pide Bizum (bizum_payments) y la
//      que no. Sin «type» y con el controlador explícito (Stripe cubre las
//      pérdidas): v1 con controller[…] y, si no la acepta, v2
//      (/v2/core/accounts). De cada una: si se crea, el estado de cada
//      capacidad y el error literal de Stripe (Respuesta 8 al PC01, 27/10);
//   3. en la cuenta que pide Bizum (cargo directo, cabecera Stripe-Account,
//      como la tienda de Folvy en shop-payment-intent): un cobro solo con
//      Bizum, los métodos automáticos y la sesión de pago (Checkout) con Bizum
//      y con tarjeta y Bizum. La cuenta no tiene los datos de alta (los pide
//      Stripe): el error literal también responde;
//   4. y se borran las cuentas de prueba.
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
// eso Stripe ya no lo acepta. Ahora va sin «type» y con el controlador.
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
  out.plataforma = plat.ok ? {
    pais: plat.datos?.country ?? null, moneda: plat.datos?.default_currency ?? null,
    capacidades_bizum: Object.fromEntries(Object.entries(plat.datos?.capabilities ?? {}).filter(([k]) => /bizum/i.test(k))),
  } : error(plat);

  // 2. Las dos altas de prueba, España: la que pide Bizum y la que no. Sin
  //    «type» (la plataforma no puede ser quien cubre las pérdidas: Respuesta 8
  //    al PC01) y con el controlador explícito, como el ejemplo de Stripe de
  //    cuentas con el riesgo gestionado por Stripe:
  //      · v1: controller[losses][payments]=stripe, controller[fees][payer]=application,
  //            controller[requirement_collection]=stripe, controller[stripe_dashboard][type]=express;
  //      · si la v1 no lo acepta, v2 (POST /v2/core/accounts) con losses_collector=stripe.
  //    De cada alta: si se crea, el estado de cada capacidad y el error literal.
  //    Con requirement_collection=stripe los datos los pide Stripe en su alta:
  //    aquí no se rellenan (la cuenta queda sin cobros activos, y lo dice).
  const altas: Record<string, unknown> = {};
  const creadas: { id: string; via: "v1" | "v2"; bizum: boolean }[] = [];
  for (const conBizum of [true, false]) {
    const r = await alta(clave, conBizum);
    altas[conBizum ? "con_bizum" : "sin_bizum"] = r.informe;
    if (r.id) creadas.push({ id: r.id, via: r.via!, bizum: conBizum });
  }
  out.altas = altas;

  const cuenta = creadas.find((c) => c.bizum)?.id ?? creadas[0]?.id ?? null;
  try {
    if (cuenta) out.cobros = await cobros(clave, cuenta);
  } finally {
    // 4. Se borran las cuentas conectadas de prueba.
    const borradas: Record<string, unknown> = {};
    for (const c of creadas) {
      const b = await stripe(clave, "DELETE", `/v1/accounts/${c.id}`);
      if (b.ok && b.datos?.deleted === true) { borradas[c.bizum ? "con_bizum" : "sin_bizum"] = { borrada: true }; continue; }
      const v2 = c.via === "v2" ? await stripeV2(clave, `/v2/core/accounts/${c.id}/close`, {}, VERSION_V2[0]) : null;
      borradas[c.bizum ? "con_bizum" : "sin_bizum"] = v2?.ok ? { borrada: false, cerrada: true } : { borrada: false, error_v1: tapar(error(b).mensaje), error_v2: v2 ? tapar(error(v2).mensaje) : null };
    }
    out.borradas = borradas;
  }
  return json(out);
});

// Las versiones de la API v2 que se prueban, en orden (sin versión primero: la de la cuenta).
const VERSION_V2: (string | null)[] = [null, "2025-08-27.preview", "2025-04-30.preview"];

async function stripeV2(clave: string, ruta: string, cuerpo: unknown, version: string | null): Promise<Resp> {
  const headers: Record<string, string> = { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" };
  if (version) headers["Stripe-Version"] = version;
  const r = await fetch(`${API}${ruta}`, { method: "POST", headers, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(25_000) });
  const datos = await r.json().catch(() => null);
  console.log(JSON.stringify({ sonda: "stripe-bizum", paso: `POST ${ruta.replace(/acct_[A-Za-z0-9_]+/g, "acct_…")}`, version, status: r.status }));
  return { status: r.status, ok: r.ok, datos };
}

/** Las capacidades de una cuenta, con lo que le falta a cada una (GET /v1/accounts vale también para las de v2). */
async function capacidades(clave: string, id: string) {
  await new Promise((r) => setTimeout(r, 3000));
  const l = await stripe(clave, "GET", `/v1/accounts/${id}`);
  if (!l.ok) return { error: tapar(error(l).mensaje) };
  const caps = l.datos?.capabilities ?? {};
  const bizum = Object.keys(caps).filter((k) => /bizum/i.test(k));
  return {
    todas: caps,
    bizum: bizum.length ? Object.fromEntries(bizum.map((k) => [k, caps[k]])) : "ninguna_capacidad_con_bizum_en_el_nombre",
    cobros_activos: l.datos?.charges_enabled === true,
    controlador: l.datos?.controller ?? null,
    pendiente: l.datos?.requirements?.currently_due ?? [],
    deshabilitada_por: l.datos?.requirements?.disabled_reason ?? null,
  };
}

async function alta(clave: string, conBizum: boolean): Promise<{ id: string | null; via: "v1" | "v2" | null; informe: Record<string, unknown> }> {
  const informe: Record<string, unknown> = {};
  // v1, sin «type», con el controlador explícito.
  const v1: Record<string, string> = {
    country: "ES",
    email: "sonda-bizum@example.com",
    "controller[losses][payments]": "stripe",
    "controller[fees][payer]": "application",
    "controller[requirement_collection]": "stripe",
    "controller[stripe_dashboard][type]": "express",
    "capabilities[card_payments][requested]": "true",
    "capabilities[transfers][requested]": "true",
  };
  if (conBizum) v1["capabilities[bizum_payments][requested]"] = "true";
  const a1 = await stripe(clave, "POST", "/v1/accounts", v1);
  informe.v1 = a1.ok ? { creada: true } : { creada: false, ...error(a1), mensaje: tapar(error(a1).mensaje) };
  if (a1.ok && a1.datos?.id) {
    informe.capacidades = await capacidades(clave, a1.datos.id);
    return { id: a1.datos.id, via: "v1", informe };
  }
  // v2, con Stripe cubriendo las pérdidas.
  const cuerpo = {
    contact_email: "sonda-bizum@example.com",
    display_name: "Sonda Bizum (prueba)",
    identity: { country: "es" },
    dashboard: "express",
    defaults: { currency: "eur", responsibilities: { losses_collector: "stripe", fees_collector: "application" } },
    configuration: {
      merchant: { capabilities: { card_payments: { requested: true }, ...(conBizum ? { bizum_payments: { requested: true } } : {}) } },
    },
    include: ["configuration.merchant", "requirements"],
  };
  const intentos: unknown[] = [];
  for (const version of VERSION_V2) {
    const a2 = await stripeV2(clave, "/v2/core/accounts", cuerpo, version);
    if (a2.ok && a2.datos?.id) {
      informe.v2 = { creada: true, version, intentos, capacidades_v2: a2.datos?.configuration?.merchant?.capabilities ?? null };
      informe.capacidades = await capacidades(clave, a2.datos.id);
      return { id: a2.datos.id, via: "v2", informe };
    }
    intentos.push({ version, ...error(a2), mensaje: tapar(error(a2).mensaje) });
    // Si lo que falla no es la versión, otra versión no lo arregla.
    if (!/version/i.test(String(error(a2).mensaje ?? ""))) break;
  }
  informe.v2 = { creada: false, intentos };
  return { id: null, via: null, informe };
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
