// social-agent — El agente de contenido de Folvy (v2.1, 06/07/2026)
// Gemelo del offers-agent: motor de reglas DETERMINISTA Y AUDITABLE. Propone, jamás
// publica (modo b: el humano aprueba en la pantalla Social). Diseño: docs/folvy_rrss_diseno.md
// + docs/folvy_rrss_estrategia_lanzamiento.md.
//
// FASE DEL PLAN (social_config.launch_phase): 'apetito' | 'comunidad' | 'conversion'.
//   · apetito/comunidad → NO se vende: R1 (ofertas) APAGADA; solo contenido de apetito.
//   · conversion        → R1 activa (anuncia la promo real, verdad de Glovo).
//
// Reglas (prioridad): [R1 promo activa SOLO en conversion, SOLO propias] → R3 evento
// demand-up (tema del día, apetito) → R2 rotación justa (apetito).
//
// MARCAS: propias y cedidas rotan EN IGUALDAD (mismo pool, por "más días sin salir").
//   · Propias  → se NOMBRAN (protagonistas).
//   · Cedidas  → SIEMPRE ANÓNIMAS: su plato + su foto, JAMÁS la marca / logo / hashtag de
//     marca (línea roja invariable). En el Shop sí se ven y venden; aquí van sin marca.
//     R1 (ofertas) nunca incluye cedidas.
//
// Guardarraíles: solo platos con foto real (el plato es la foto real) · cupo 1 borrador/día/red
// · anti-invención (solo promos/platos/precios reales) · idempotente por día y por cupón.
// Cron diario (10:00 UTC = mediodía Madrid, antes del servicio). Frontera x-agent-secret.

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("OFFERS_AGENT_SECRET")!;
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const SHOP_URL = "https://foodint.es";                 // canal propio (antes app.folvy.app/t/foodint)
const BASE_TAGS = ["#foodint", "#madrid", "#fooddelivery", "#comidaadomicilio"];

// ── Banco de copys (voz: calle + emojis + tonos mezclados). Tunable sin tocar la lógica.
// Placeholders: {star} = nombre del plato · {brand} = marca (SOLO propias) · {pct} = % oferta.
const COPY = {
  apetito_own: [
    "Para de scrollear un momento 🛑 {star} de {brand}, recién hecho y directo de cocina. Lo pides sin intermediarios — link en la bio 🛵",
    "{star} de {brand} 🔥 Del pase a tu puerta, tal cual sale. En el link de la bio, directo de cocina.",
    "Ojito 👀 {star} de {brand}. El pase no para hoy. Pídelo directo en el link de la bio, sin apps de por medio.",
  ],
  curiosidad_own: [
    "¿{star} de {brand}? Puede que sea lo mejor que pidas hoy 😏 Link en la bio, directo de cocina.",
    "Esto de aquí es {star} de {brand} 👀 ¿Te lo vas a perder? Link en la bio.",
  ],
  apetito_cedida: [
    "Ojito con esto 👀 {star}. Del horno a tu puerta, directo de cocina — link en la bio 🍕",
    "Para de scrollear 🛑 {star} recién hecho. Lo pides directo en el link de la bio, sin intermediarios 🛵",
    "{star} 🔥 Tal cual sale de cocina, a tu puerta. Link en la bio.",
  ],
  event_calor_own: [
    "Hoy no se enciende el horno de casa 🥵 {star} de {brand} a domicilio. Link en la bio, directo de cocina 🛵",
  ],
  event_lluvia_own: [
    "Día de sofá y manta ☔ De cocinar, nada. {star} de {brand} directo a tu puerta — link en la bio.",
  ],
  event_generic_own: [
    "Hoy el plan es no cocinar 😎 {star} de {brand} directo de cocina. Link en la bio 🛵",
  ],
  event_calor_cedida: [
    "Con este calor no se cocina 🥵 {star} directo a tu puerta. Link en la bio 🛵",
  ],
  event_lluvia_cedida: [
    "Día de manta y no moverse ☔ {star} directo de cocina a tu sofá. Link en la bio.",
  ],
  event_generic_cedida: [
    "Hoy el plan es no cocinar 😎 {star} directo a tu puerta. Link en la bio 🛵",
  ],
  oferta_own: [
    "🔥 {pct}% en {star} de {brand} — solo pidiendo directo en foodint.es (link en la bio). Del pase a tu puerta 🛵",
  ],
};

function slugTag(name: string) {
  return "#" + name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
function utm(network: string) {
  const d = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${SHOP_URL}?utm_source=${network}&utm_medium=social&utm_campaign=foodint_${d}`;
}
// Rotación determinista del banco: misma entrada → misma frase; varía por día y por semilla.
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function pickCopy(bank: string[], seed: string): string {
  if (bank.length === 0) return "";
  const day = new Date().toISOString().slice(0, 10);
  return bank[hashStr(day + "|" + seed) % bank.length];
}
function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
// De un pool de brandIds con estrella, el que más días lleva sin protagonizar un post.
function oldestBrand(ids: string[], lastByBrand: Map<string, string>): string | undefined {
  return ids.slice().sort((a, b) => (lastByBrand.get(a) ?? "0").localeCompare(lastByBrand.get(b) ?? "0"))[0];
}

Deno.serve(async (req) => {
  if (req.headers.get("x-agent-secret") !== AGENT_SECRET) return new Response("forbidden", { status: 403 });
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const out: Array<Record<string, unknown>> = [];

  const { data: accounts } = await supa.from("social_account")
    .select("id, account_id, network").eq("is_active", true);
  const byAccount = new Map<string, Array<any>>();
  for (const a of accounts ?? []) {
    if (!byAccount.has(a.account_id)) byAccount.set(a.account_id, []);
    byAccount.get(a.account_id)!.push(a);
  }

  for (const [accountId, nets] of byAccount) {
    // ── fase del plan (gatea la venta). Sin fila → apetito (no vende).
    const { data: cfg } = await supa.from("social_config")
      .select("launch_phase").eq("account_id", accountId).maybeSingle();
    const phase: string = cfg?.launch_phase ?? "apetito";
    const sellingPhase = phase === "conversion";

    // ── marcas: propias (nombradas) y cedidas (anónimas), en igualdad de rotación
    const { data: brands } = await supa.from("brand")
      .select("id, name, ownership_type").eq("account_id", accountId).eq("is_active", true)
      .in("ownership_type", ["own", "licensed"]);
    const ownById = new Map<string, string>();
    const cededById = new Map<string, string>();
    for (const b of (brands ?? []) as any[]) {
      if (b.ownership_type === "own") ownById.set(b.id, b.name);
      else if (b.ownership_type === "licensed") cededById.set(b.id, b.name);
    }
    if (ownById.size === 0 && cededById.size === 0) { out.push({ accountId, skipped: "sin marcas" }); continue; }
    const isAnon = (bId: string) => cededById.has(bId);

    // ── top seller 7d por marca (con foto real) — combustible de apetito
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: sales } = await supa.from("sale")
      .select("id, brand_id, sale_line(menu_item_id)")
      .eq("account_id", accountId).gte("created_at", since)
      .not("order_status", "in", '("cancelled","rejected")').limit(3000);
    const countByItem = new Map<string, number>();
    for (const s of sales ?? []) for (const l of (s as any).sale_line ?? [])
      if (l.menu_item_id) countByItem.set(l.menu_item_id, (countByItem.get(l.menu_item_id) ?? 0) + 1);

    const { data: items } = await supa.from("menu_item")
      .select("id, brand_id, name, photo_url, price")
      .eq("account_id", accountId).is("archived_at", null).not("photo_url", "is", null)
      .is("mirror_of_item_id", null);
    const starByBrand = new Map<string, any>();
    for (const it of (items ?? []) as any[]) {
      if (!ownById.has(it.brand_id) && !cededById.has(it.brand_id)) continue;
      const n = countByItem.get(it.id) ?? 0;
      const cur = starByBrand.get(it.brand_id);
      if (!cur || n > cur.n) starByBrand.set(it.brand_id, { ...it, n });
    }
    // Pool único de rotación: propias + cedidas, en igualdad.
    const rotationPool = [...ownById.keys(), ...cededById.keys()].filter((b) => starByBrand.has(b));

    // ── evento demand-up vigente (R3)
    const { data: events } = await supa.from("local_event")
      .select("name, event_type").eq("account_id", accountId).eq("demand_effect", "up")
      .lte("starts_at", nowIso).gte("ends_at", nowIso);
    const eventUp = (events ?? [])[0] ?? null;

    // ── rotación justa: última vez que cada marca protagonizó un post no descartado
    const { data: lastPosts } = await supa.from("social_post")
      .select("brand_id, created_at").eq("account_id", accountId)
      .neq("status", "discarded").order("created_at", { ascending: false }).limit(300);
    const lastByBrand = new Map<string, string>();
    for (const p of lastPosts ?? []) if (p.brand_id && !lastByBrand.has(p.brand_id)) lastByBrand.set(p.brand_id, p.created_at);

    // ── decidir el contenido del día (uno, compartido por redes)
    type Chosen = {
      brandId: string; star: any; copy: string; reason: string;
      template: "oferta" | "apetito" | "curiosidad"; anonymous: boolean; couponId?: string | null;
    };
    let chosen: Chosen | null = null;

    // R1 — promo activa (SOLO en fase de conversión; SOLO propias; verdad de Glovo)
    if (sellingPhase) {
      const { data: promos } = await supa.from("coupon")
        .select("id, name, value, kind, scope, channels, ends_at")
        .eq("account_id", accountId).eq("origin", "agent").eq("active", true)
        .eq("kind", "standard").order("value", { ascending: false }).limit(5);

      for (const p of promos ?? []) {
        const bIds: string[] = ((p.scope as any)?.brand_ids ?? []).filter((b: string) => ownById.has(b));
        const bId = bIds.find((b) => starByBrand.has(b));
        if (!bId) continue;
        // anti-invención: solo promos DE VERDAD publicadas (job done = verdad de Glovo)
        const { count: livePush } = await supa.from("promo_push_job")
          .select("id", { count: "exact", head: true }).eq("coupon_id", p.id).eq("status", "done");
        if ((livePush ?? 0) === 0) continue;
        // idempotencia: esta promo ya anunciada en borrador/aprobado/publicado
        const { count: already } = await supa.from("social_post")
          .select("id", { count: "exact", head: true })
          .eq("account_id", accountId).neq("status", "discarded")
          .eq("payload->>coupon_id", p.id);
        if ((already ?? 0) > 0) continue;

        const star = starByBrand.get(bId);
        const brand = ownById.get(bId)!;
        const pct = Math.round(Number(p.value ?? 0));
        chosen = {
          brandId: bId, star, template: "oferta", anonymous: false, couponId: p.id,
          copy: fill(pickCopy(COPY.oferta_own, bId), { star: star.name, brand, pct }),
          reason: `R1 promo activa (fase conversión): campaña '${p.name}' (${pct}%) — anunciar con la estrella de ${brand} (${star.name}, top 7d).${eventUp ? ` + evento: ${eventUp.name}` : ""}`,
        };
        break;
      }
    }

    // R3 — evento demand-up tematiza (apetito, sin precio). Pool en igualdad.
    if (!chosen && eventUp) {
      const bId = oldestBrand(rotationPool, lastByBrand);
      if (bId) {
        const anon = isAnon(bId);
        const star = starByBrand.get(bId);
        const brand = anon ? "" : ownById.get(bId)!;
        const isCalor = /calor/i.test(eventUp.name), isLluvia = /lluvia/i.test(eventUp.name);
        const bank = anon
          ? (isCalor ? COPY.event_calor_cedida : isLluvia ? COPY.event_lluvia_cedida : COPY.event_generic_cedida)
          : (isCalor ? COPY.event_calor_own : isLluvia ? COPY.event_lluvia_own : COPY.event_generic_own);
        chosen = {
          brandId: bId, star, template: "apetito", anonymous: anon,
          copy: fill(pickCopy(bank, bId), { star: star.name, brand }),
          reason: `R3 evento demanda-up: '${eventUp.name}' → apetito con ${anon ? `plato anónimo (cedida oculta: ${cededById.get(bId)})` : `la estrella de ${brand}`} (${star.name}, rotación justa).`,
        };
      }
    }

    // R2 — rotación justa pura (apetito). Pool en igualdad; cedida → anónima.
    if (!chosen) {
      const bId = oldestBrand(rotationPool, lastByBrand);
      if (bId) {
        const anon = isAnon(bId);
        const star = starByBrand.get(bId);
        if (anon) {
          chosen = {
            brandId: bId, star, template: "apetito", anonymous: true,
            copy: fill(pickCopy(COPY.apetito_cedida, bId), { star: star.name }),
            reason: `R2 rotación justa (cedida anónima): plato '${star.name}' de cedida oculta (${cededById.get(bId)}); marca no nombrada. ${star.n} uds/7d.`,
          };
        } else {
          const brand = ownById.get(bId)!;
          // apetito la mayoría; curiosidad de vez en cuando (determinista por día×marca)
          const useCuriosidad = hashStr(today + "|c|" + bId) % 3 === 0;
          const bank = useCuriosidad ? COPY.curiosidad_own : COPY.apetito_own;
          chosen = {
            brandId: bId, star, template: useCuriosidad ? "curiosidad" : "apetito", anonymous: false,
            copy: fill(pickCopy(bank, bId), { star: star.name, brand }),
            reason: `R2 rotación justa: ${brand} es la marca con más días sin protagonizar; su estrella 7d es '${star.name}' (${star.n} uds).`,
          };
        }
      }
    }

    if (!chosen) { out.push({ accountId, skipped: "sin contenido elegible (¿fotos/ventas?)" }); continue; }

    // ── crear 1 borrador por red (cupo: si ya hay post de hoy en esa red, silencio)
    for (const net of nets) {
      const { count: todayCount } = await supa.from("social_post")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId).eq("network", net.network)
        .gte("created_at", `${today}T00:00:00Z`);
      if ((todayCount ?? 0) > 0) { out.push({ accountId, network: net.network, skipped: "cupo diario cubierto" }); continue; }

      const brandTag = chosen.anonymous ? [] : [slugTag(ownById.get(chosen.brandId)!)];
      const payload = {
        copy: chosen.copy,
        hashtags: [...BASE_TAGS, ...brandTag],            // cedida anónima → sin hashtag de marca
        image_url: chosen.star.photo_url,                 // héroe crudo; la fábrica (TR4) compondrá N1
        image_level: "N1-pendiente",
        template: chosen.template,                        // 'oferta' | 'apetito' | 'curiosidad' (fábrica de imágenes)
        brand_anonymous: chosen.anonymous,                // true → la banda solo lleva Foodint, sin marca
        star_item: chosen.star.name,                      // nombre del plato (= descriptor honesto en cedidas)
        brand_name: chosen.anonymous ? null : ownById.get(chosen.brandId),
        link: utm(net.network),
        format: net.network === "tiktok" ? "photo_carousel" : "feed_4_5",
        coupon_id: chosen.couponId ?? null,
        phase,
      };
      const { error } = await supa.from("social_post").insert({
        account_id: accountId, social_account_id: net.id, network: net.network,
        status: "draft", payload, reason: chosen.reason, origin: "agent", brand_id: chosen.brandId,
      });
      out.push({ accountId, network: net.network, created: !error, anonymous: chosen.anonymous, error: error?.message ?? null });
    }
  }

  return Response.json({ ok: true, date: today, results: out });
});
