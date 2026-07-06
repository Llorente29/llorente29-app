// social-agent — El agente de contenido de Folvy (v2.4, 06/07/2026)
// Gemelo del offers-agent: motor de reglas DETERMINISTA Y AUDITABLE. Propone, jamás
// publica (modo b: el humano aprueba en la pantalla Social). Diseño: docs/folvy_rrss_diseno.md
// + docs/folvy_rrss_estrategia_lanzamiento.md.
//
// DIRECTIVAS DEL HUMANO (v2.4): antes de R1/R2/R3, el agente consume una directiva pendiente
// (social_directive) y la respeta — empujar marca/plato (push), tematizar (context) o a medida
// (custom). Tú diriges, la máquina ejecuta con su calidad (foto, voz, margen). Blindaje: una
// CEDIDA empujada por ti sigue SIEMPRE anónima (línea roja invariable). Marca payload.directive.
//
// PARÁMETROS (body): { account_id?, force? }. account_id → generar solo para esa cuenta;
// force → saltar el cupo diario (lo usa "Generar ahora"). El cron no envía nada → igual que antes.
//
// VOZ VIVA: frases desde pick_social_copy(pillar) — tabla social_copy editable. Rellena
// {plato}/{marca}/{pct}.
//
// FASE (social_config.launch_phase): apetito/comunidad → no vende (R1 off); conversion → R1 on.
// Reglas: [R0 directiva] → [R1 promo, solo conversion, solo propias] → R3 evento → R2 rotación justa.
// MARCAS: propias nombradas; cedidas SIEMPRE anónimas (sin marca/logo/hashtag). R1 nunca cedidas.
// Guardarraíles: solo platos con foto real · cupo 1/día/red (salvo force) · anti-invención.

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("OFFERS_AGENT_SECRET")!;
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const SHOP_URL = "https://foodint.es";
const BASE_TAGS = ["#foodint", "#madrid", "#fooddelivery", "#comidaadomicilio"];

const FALLBACK: Record<string, string> = {
  apetito: "{plato} de {marca} 🔥 Directo de cocina, sin intermediarios — link en la bio.",
  curiosidad: "Ojito 👀 {plato} de {marca}. Link en la bio.",
  cedida: "Esto es delito 🔥 {plato} recién hecho, directo a tu puerta. Link en la bio.",
  evento_calor: "Hoy no cocinas 🥵 {plato} de {marca} a tu puerta. Link en la bio.",
  evento_lluvia: "Día de sofá ☔ {plato} de {marca} a tu puerta. Link en la bio.",
  evento_generico: "Hoy el plan es no cocinar 😎 {plato} de {marca}. Link en la bio.",
  oferta: "{pct}% en {plato} de {marca} 🔥 Solo en foodint.es. Link en la bio 😈",
};

async function pickCopy(pillar: string, accountId: string): Promise<string> {
  const { data, error } = await supa.rpc("pick_social_copy", { p_pillar: pillar, p_account_id: accountId });
  if (error || !data) return FALLBACK[pillar] ?? "{plato} — pídelo en foodint.es 🔥";
  return data as string;
}
async function claimDirective(accountId: string): Promise<any | null> {
  const { data, error } = await supa.rpc("claim_pending_directive", { p_account_id: accountId });
  if (error || !data) return null;
  return data; // fila de social_directive (o null)
}

function fill(tpl: string, vars: { plato?: string; marca?: string; pct?: number | string }): string {
  return (tpl || "")
    .replaceAll("{plato}", vars.plato ?? "")
    .replaceAll("{marca}", vars.marca ?? "")
    .replaceAll("{pct}", vars.pct != null ? String(vars.pct) : "");
}
function slugTag(name: string) {
  return "#" + name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
function utm(network: string) {
  const d = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${SHOP_URL}?utm_source=${network}&utm_medium=social&utm_campaign=foodint_${d}`;
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function oldestBrand(ids: string[], lastByBrand: Map<string, string>): string | undefined {
  return ids.slice().sort((a, b) => (lastByBrand.get(a) ?? "0").localeCompare(lastByBrand.get(b) ?? "0"))[0];
}

Deno.serve(async (req) => {
  if (req.headers.get("x-agent-secret") !== AGENT_SECRET) return new Response("forbidden", { status: 403 });

  // Parámetros opcionales (el cron no envía cuerpo → valores por defecto = comportamiento clásico).
  let body: any = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const onlyAccount: string | null = body?.account_id ?? null;
  const force: boolean = body?.force === true;

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
    if (onlyAccount && accountId !== onlyAccount) continue;

    const { data: cfg } = await supa.from("social_config")
      .select("launch_phase").eq("account_id", accountId).maybeSingle();
    const phase: string = cfg?.launch_phase ?? "apetito";
    const sellingPhase = phase === "conversion";

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
    const itemById = new Map<string, any>();
    for (const it of (items ?? []) as any[]) {
      itemById.set(it.id, it);
      if (!ownById.has(it.brand_id) && !cededById.has(it.brand_id)) continue;
      const n = countByItem.get(it.id) ?? 0;
      const cur = starByBrand.get(it.brand_id);
      if (!cur || n > cur.n) starByBrand.set(it.brand_id, { ...it, n });
    }
    const rotationPool = [...ownById.keys(), ...cededById.keys()].filter((b) => starByBrand.has(b));

    const { data: events } = await supa.from("local_event")
      .select("name, event_type").eq("account_id", accountId).eq("demand_effect", "up")
      .lte("starts_at", nowIso).gte("ends_at", nowIso);
    const eventUp = (events ?? [])[0] ?? null;

    const { data: lastPosts } = await supa.from("social_post")
      .select("brand_id, created_at").eq("account_id", accountId)
      .neq("status", "discarded").order("created_at", { ascending: false }).limit(300);
    const lastByBrand = new Map<string, string>();
    for (const p of lastPosts ?? []) if (p.brand_id && !lastByBrand.has(p.brand_id)) lastByBrand.set(p.brand_id, p.created_at);

    type Chosen = {
      brandId: string; star: any; copy: string; reason: string;
      template: "oferta" | "apetito" | "curiosidad"; anonymous: boolean; couponId?: string | null;
      photoOverride?: string | null; hashtagsOverride?: string[] | null;
      directive?: { kind: string; theme?: string | null } | null;
    };
    let chosen: Chosen | null = null;

    // R0 — DIRECTIVA DEL HUMANO (máxima prioridad; tú diriges, la máquina ejecuta con su calidad)
    const dir: any = await claimDirective(accountId);
    if (dir && dir.id) {
      const bId = (dir.brand_id && (ownById.has(dir.brand_id) || cededById.has(dir.brand_id)))
        ? dir.brand_id : oldestBrand(rotationPool, lastByBrand);
      if (bId) {
        const anon = isAnon(bId) ? true : (dir.anonymous ?? false); // cedida SIEMPRE anónima (línea roja)
        const star = (dir.menu_item_id ? itemById.get(dir.menu_item_id) : null) ?? starByBrand.get(bId);
        const brand = anon ? "" : (ownById.get(bId) ?? "");
        const isCalor = /calor/i.test(dir.theme ?? ""), isLluvia = /lluvia/i.test(dir.theme ?? "");
        const pillar = dir.kind === "context"
          ? (anon ? "cedida" : (isCalor ? "evento_calor" : isLluvia ? "evento_lluvia" : "evento_generico"))
          : (anon ? "cedida" : (dir.template === "curiosidad" ? "curiosidad" : "apetito"));
        const baseCopy = (dir.caption && String(dir.caption).trim().length > 0)
          ? String(dir.caption) : await pickCopy(pillar, accountId);
        chosen = {
          brandId: bId, star,
          template: (dir.template === "curiosidad" || dir.template === "oferta") ? dir.template : "apetito",
          anonymous: anon, couponId: null,
          copy: fill(baseCopy, { plato: star?.name ?? "", marca: brand }),
          photoOverride: dir.photo_url ?? null,
          hashtagsOverride: (Array.isArray(dir.hashtags) && dir.hashtags.length) ? dir.hashtags : null,
          directive: { kind: dir.kind, theme: dir.theme ?? null },
          reason: `Directiva del humano (${dir.kind})${dir.theme ? ` · ${dir.theme}` : ""}: ${anon ? "plato anónimo (cedida oculta)" : (brand || "marca")} — ${star?.name ?? "a medida"}.`,
        };
      }
    }

    // R1 — promo activa (SOLO conversión; SOLO propias; verdad de Glovo)
    if (!chosen && sellingPhase) {
      const { data: promos } = await supa.from("coupon")
        .select("id, name, value, kind, scope, channels, ends_at")
        .eq("account_id", accountId).eq("origin", "agent").eq("active", true)
        .eq("kind", "standard").order("value", { ascending: false }).limit(5);

      for (const p of promos ?? []) {
        const bIds: string[] = ((p.scope as any)?.brand_ids ?? []).filter((b: string) => ownById.has(b));
        const bId = bIds.find((b) => starByBrand.has(b));
        if (!bId) continue;
        const { count: livePush } = await supa.from("promo_push_job")
          .select("id", { count: "exact", head: true }).eq("coupon_id", p.id).eq("status", "done");
        if ((livePush ?? 0) === 0) continue;
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
          copy: fill(await pickCopy("oferta", accountId), { plato: star.name, marca: brand, pct }),
          reason: `R1 promo activa (fase conversión): campaña '${p.name}' (${pct}%) — ${brand} (${star.name}, top 7d).${eventUp ? ` +evento ${eventUp.name}` : ""}`,
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
        const pillar = anon ? "cedida"
          : (isCalor ? "evento_calor" : isLluvia ? "evento_lluvia" : "evento_generico");
        chosen = {
          brandId: bId, star, template: "apetito", anonymous: anon,
          copy: fill(await pickCopy(pillar, accountId), { plato: star.name, marca: brand }),
          reason: `R3 evento '${eventUp.name}' → ${anon ? `plato anónimo (cedida oculta: ${cededById.get(bId)})` : `${brand}`} (${star.name}, rotación justa).`,
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
            copy: fill(await pickCopy("cedida", accountId), { plato: star.name }),
            reason: `R2 rotación justa (cedida anónima): plato '${star.name}' de cedida oculta (${cededById.get(bId)}); marca no nombrada. ${star.n} uds/7d.`,
          };
        } else {
          const brand = ownById.get(bId)!;
          const useCuriosidad = hashStr(today + "|c|" + bId) % 3 === 0;
          const pillar = useCuriosidad ? "curiosidad" : "apetito";
          chosen = {
            brandId: bId, star, template: useCuriosidad ? "curiosidad" : "apetito", anonymous: false,
            copy: fill(await pickCopy(pillar, accountId), { plato: star.name, marca: brand }),
            reason: `R2 rotación justa: ${brand} es la marca con más días sin protagonizar; su estrella 7d es '${star.name}' (${star.n} uds).`,
          };
        }
      }
    }

    if (!chosen) { out.push({ accountId, skipped: "sin contenido elegible (¿fotos/ventas?)" }); continue; }

    // ── crear 1 borrador por red (cupo: 1/día/red salvo force)
    for (const net of nets) {
      if (!force) {
        const { count: todayCount } = await supa.from("social_post")
          .select("id", { count: "exact", head: true })
          .eq("account_id", accountId).eq("network", net.network)
          .gte("created_at", `${today}T00:00:00Z`);
        if ((todayCount ?? 0) > 0) { out.push({ accountId, network: net.network, skipped: "cupo diario cubierto" }); continue; }
      }

      const brandTag = chosen.anonymous ? [] : [slugTag(ownById.get(chosen.brandId)!)];
      const payload = {
        copy: chosen.copy,
        hashtags: chosen.hashtagsOverride ?? [...BASE_TAGS, ...brandTag],
        image_url: chosen.photoOverride ?? chosen.star?.photo_url ?? null,
        image_level: "N1-pendiente",
        template: chosen.template,
        brand_anonymous: chosen.anonymous,
        star_item: chosen.star?.name ?? "",
        brand_name: chosen.anonymous ? null : ownById.get(chosen.brandId),
        link: utm(net.network),
        format: net.network === "tiktok" ? "photo_carousel" : "feed_4_5",
        coupon_id: chosen.couponId ?? null,
        directive: chosen.directive ?? null,       // "Dirigido por ti" (badge en la cola)
        phase,
      };
      const { error } = await supa.from("social_post").insert({
        account_id: accountId, social_account_id: net.id, network: net.network,
        status: "draft", payload, reason: chosen.reason, origin: "agent", brand_id: chosen.brandId,
      });
      out.push({ accountId, network: net.network, created: !error, anonymous: chosen.anonymous, directed: !!chosen.directive, error: error?.message ?? null });
    }
  }

  return Response.json({ ok: true, date: today, forced: force, results: out });
});
