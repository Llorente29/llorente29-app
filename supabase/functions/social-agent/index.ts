// social-agent — El agente de contenido de Folvy (v1, 05/07/2026)
// Gemelo del offers-agent: motor de reglas DETERMINISTA Y AUDITABLE. Propone, jamás
// publica (modo b: el humano aprueba en la pantalla Social). Diseño: docs/folvy_rrss_diseno.md.
// Reglas (prioridad): R1 anunciar la promo ACTIVA del offers-agent (el post que se
// escribe solo) → R3 evento demand-up de hoy (tema del día) → R2 plato estrella de la
// marca que MÁS días lleva sin salir (rotación justa del food hall).
// Guardarraíles: solo marcas PROPIAS con foto real (regla de oro: el plato es la foto
// real) · cupo 1 borrador/día/red · anti-invención (solo promos/platos/precios reales)
// · idempotente por día y por cupón anunciado.
// Cron diario (10:00 UTC = mediodía Madrid, antes del servicio). Frontera x-agent-secret.

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("OFFERS_AGENT_SECRET")!;
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const SHOP_URL = "https://app.folvy.app/t/foodint";
const BASE_TAGS = ["#foodint", "#madrid", "#fooddelivery", "#comidaadomicilio"];

function slugTag(name: string) {
  return "#" + name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
function utm(network: string) {
  const d = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${SHOP_URL}?utm_source=${network}&utm_medium=social&utm_campaign=foodint_${d}`;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-agent-secret") !== AGENT_SECRET) return new Response("forbidden", { status: 403 });
  const today = new Date().toISOString().slice(0, 10);
  const out: Array<Record<string, unknown>> = [];

  const { data: accounts } = await supa.from("social_account")
    .select("id, account_id, network").eq("is_active", true);
  const byAccount = new Map<string, Array<any>>();
  for (const a of accounts ?? []) {
    if (!byAccount.has(a.account_id)) byAccount.set(a.account_id, []);
    byAccount.get(a.account_id)!.push(a);
  }

  for (const [accountId, nets] of byAccount) {
    // ── señales de la cuenta
    const { data: brands } = await supa.from("brand")
      .select("id, name").eq("account_id", accountId).eq("ownership_type", "own").eq("is_active", true);
    const brandById = new Map((brands ?? []).map((b: any) => [b.id, b.name]));
    if (brandById.size === 0) { out.push({ accountId, skipped: "sin marcas propias" }); continue; }

    // top seller 7d por marca (con foto) — combustible de R1 y R2
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
    for (const it of items ?? []) {
      if (!brandById.has(it.brand_id)) continue;
      const n = countByItem.get(it.id) ?? 0;
      const cur = starByBrand.get(it.brand_id);
      if (!cur || n > cur.n) starByBrand.set(it.brand_id, { ...it, n });
    }

    // promo activa del agente de ofertas en plataformas (R1)
    const { data: promos } = await supa.from("coupon")
      .select("id, name, value, kind, scope, channels, ends_at")
      .eq("account_id", accountId).eq("origin", "agent").eq("active", true)
      .eq("kind", "standard").order("value", { ascending: false }).limit(5);

    // evento demand-up vigente (R3)
    const { data: events } = await supa.from("local_event")
      .select("name, event_type").eq("account_id", accountId).eq("demand_effect", "up")
      .lte("starts_at", new Date().toISOString()).gte("ends_at", new Date().toISOString());
    const eventUp = (events ?? [])[0] ?? null;

    // rotación justa: última vez que cada marca protagonizó un post no descartado
    const { data: lastPosts } = await supa.from("social_post")
      .select("brand_id, created_at").eq("account_id", accountId)
      .neq("status", "discarded").order("created_at", { ascending: false }).limit(200);
    const lastByBrand = new Map<string, string>();
    for (const p of lastPosts ?? []) if (p.brand_id && !lastByBrand.has(p.brand_id)) lastByBrand.set(p.brand_id, p.created_at);

    // ── decidir el contenido del día (uno, compartido por redes)
    let chosen: { brandId: string; star: any; copy: string; reason: string } | null = null;

    // R1: promo activa cuyo alcance tenga marca con estrella fotografiada
    for (const p of promos ?? []) {
      const bIds: string[] = ((p.scope as any)?.brand_ids ?? []).filter((b: string) => brandById.has(b));
      const bId = bIds.find((b) => starByBrand.has(b));
      if (!bId) continue;
      // v1.0.1: anti-invencion — solo promos DE VERDAD publicadas (job done = verdad de Glovo)
      const { count: livePush } = await supa.from("promo_push_job")
        .select("id", { count: "exact", head: true }).eq("coupon_id", p.id).eq("status", "done");
      if ((livePush ?? 0) === 0) continue;
      // idempotencia: esta promo ya anunciada en borrador/aprobado/publicado
      const { count } = await supa.from("social_post")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId).neq("status", "discarded")
        .eq("payload->>coupon_id", p.id);
      if ((count ?? 0) > 0) continue;
      const star = starByBrand.get(bId);
      const brand = brandById.get(bId)!;
      const pct = Math.round(Number(p.value ?? 0));
      chosen = {
        brandId: bId, star,
        copy: `🔥 ${pct}% en ${brand}, ya activo. ${star.name} recién hecho, del pase a tu puerta.\n\nPídelo en nuestro Shop (link en bio) — sin intermediarios.`,
        reason: `R1 promo activa: campaña '${p.name}' (${pct}%) del agente de ofertas — anunciar la promo vigente con la estrella de la marca (${star.name}, top 7d).${eventUp ? ` + evento: ${eventUp.name}` : ""}`,
      };
      if (chosen) (chosen as any).couponId = p.id;
      break;
    }

    // R3: evento demand-up tematiza (si no hubo promo que anunciar)
    if (!chosen && eventUp) {
      const bId = [...brandById.keys()].filter((b) => starByBrand.has(b))
        .sort((a, b) => (lastByBrand.get(a) ?? "0").localeCompare(lastByBrand.get(b) ?? "0"))[0];
      if (bId) {
        const star = starByBrand.get(bId);
        const tema = /calor/i.test(eventUp.name) ? "Hoy no se enciende el horno de casa." :
                     /lluvia/i.test(eventUp.name) ? "Día de sofá y manta. De cocinar, nada." :
                     "Hoy el plan es no cocinar.";
        chosen = {
          brandId: bId, star,
          copy: `${tema} ${star.name} de ${brandById.get(bId)} a domicilio 🛵\n\nShop en el link de la bio — pides directo, sin apps de por medio.`,
          reason: `R3 evento demanda-up: '${eventUp.name}' → contenido temático con la estrella de la marca menos reciente (rotación justa).`,
        };
      }
    }

    // R2: rotación justa pura
    if (!chosen) {
      const bId = [...brandById.keys()].filter((b) => starByBrand.has(b))
        .sort((a, b) => (lastByBrand.get(a) ?? "0").localeCompare(lastByBrand.get(b) ?? "0"))[0];
      if (bId) {
        const star = starByBrand.get(bId);
        chosen = {
          brandId: bId, star,
          copy: `${star.name}. Sin más presentación — el que más sale de ${brandById.get(bId)} esta semana 🖤\n\nEn el Shop del link de la bio, directo de cocina.`,
          reason: `R2 rotación justa: ${brandById.get(bId)} es la marca propia con más días sin protagonizar un post; su estrella 7d es '${star.name}' (${star.n} uds).`,
        };
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

      const payload = {
        copy: chosen.copy,
        hashtags: [...BASE_TAGS, slugTag(brandById.get(chosen.brandId)!)],
        image_url: chosen.star.photo_url,
        image_level: "N1-pendiente",  // v1: foto real tal cual; composición de marca = TR4
        link: utm(net.network),
        brand_name: brandById.get(chosen.brandId),
        star_item: chosen.star.name,
        format: net.network === "tiktok" ? "photo_carousel" : "feed_4_5",
        coupon_id: (chosen as any).couponId ?? null,
      };
      const { error } = await supa.from("social_post").insert({
        account_id: accountId, social_account_id: net.id, network: net.network,
        status: "draft", payload, reason: chosen.reason, origin: "agent", brand_id: chosen.brandId,
      });
      out.push({ accountId, network: net.network, created: !error, brand: payload.brand_name, error: error?.message ?? null });
    }
  }

  return Response.json({ ok: true, date: today, results: out });
});
