// offers-agent — El agente de ofertas de Folvy (motor de reglas determinista y auditable)
// v2.1 (08/07/2026) — TODOS LOS CANALES + CASCADA DE ALTERNATIVAS + ALERTAS (decisión Julio):
//   (1) La señal (agent_sales_signal_v2) ya trae los 4 canales: Shop y JustEat entran (antes solo
//       Glovo/Uber). Cedidas solo en Shop. El Shop (comisión 5%) es el canal de más margen.
//   (2) JustEat pasa a PROPOSABLE (nace propuesta, sin robot aún = manual, como Uber).
//   (3) CASCADA (opción 3 de Julio): si el % propuesto no aguanta el margen, el agente BAJA el %
//       de 5 en 5 hasta el mayor que aguante ≥1 plato — cada canal a su máximo rentable. El margen
//       mínimo (cfg.margin_floor_pct) es SAGRADO e igual en todos los canales; el Shop aguanta %
//       más altos SOLO porque su comisión es menor (el preview resta menos). Ya no se rinde al 1er no.
//   (4) ALERTA en vez de silencio: si NI el 5% aguanta ningún plato, registra un verdict "⚠️ ALERTA"
//       visible (marca a cero sin oferta rentable posible) en vez del 'continue' mudo anterior.
// --- v2.0 (06/07/2026) — COBERTURA TOTAL + INTENSIDAD INTELIGENTE (decisión Julio):
//   Sin ofertas, los algoritmos de Glovo/Uber te bajan de posición → pierdes visibilidad y
//   ventas. Por eso la política cambia de "creo donde hay oportunidad" a "SIEMPRE cubro, y la
//   señal decide la INTENSIDAD":
//     · va mal / a cero (con objetivo) → ARTILLERÍA (hasta maxPct).
//     · va regular (bajo objetivo)     → proporcional al hueco.
//     · va bien / sin objetivo         → MANTENIMIENTO: visibilidad mínima (5%), y si la
//                                        tendencia baja (7d < 28d) sube un escalón (10%).
//   Nunca 'pct=0 → continue': todo marca×canal×local habilitado tiene oferta. El equilibrio se
//   busca solo: si un mantenimiento al 5% empieza a resentirse, cae al tramo de crecimiento y
//   sube en rondas siguientes hasta estabilizar. Suelo de % ahora 5 (antes 10).
//   UBER: ahora se PROPONE (no solo Glovo). Nace active=false = "pendiente de publicar";
//   como el brazo de Uber aún no está aprobado, se sube a mano en Uber Eats Manager. Glovo
//   sigue con robot. Cupo por canal ampliado (COVERAGE_CAP) para cubrir todo en la 1ª ronda.
// --- historial previo (intacto) ---
// v1.7: 2x1 CONGELADO (BOGO_ENABLED=false). v1.6: autoaprendizaje del uplift medido.
// v1.5: señal por día de semana. v1.4: 2x1-espejo. v1.3: vara = OBJETIVO por marca×canal×local.
// v1.2: bebidas fuera + múltiplos de 5. v1.1: solo canales con brazo + cupo + higiene.
// Corre cada hora vía pg_cron -> net.http_post con secreto del Vault. Guardarraíl de margen
// REAL (preview_platform_promo_impact) plato a plato. REGLA INNEGOCIABLE: cedidas JAMÁS en
// plataforma. DESPLIEGUE: SIEMPRE --no-verify-jwt (frontera x-agent-secret).

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("OFFERS_AGENT_SECRET")!;
const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const PROFILES: Record<string, { maxPct: number; cooldownDays: number; proactive: boolean; maxNew: number }> = {
  low:    { maxPct: 10, cooldownDays: 14, proactive: false, maxNew: 1 },
  medium: { maxPct: 15, cooldownDays: 7,  proactive: true,  maxNew: 2 },
  high:   { maxPct: 20, cooldownDays: 5,  proactive: true,  maxNew: 3 },
  max:    { maxPct: 30, cooldownDays: 3,  proactive: true,  maxNew: 4 },
};

// Plataformas con brazo publicador VIVO (robot). Uber entra cuando Partner Engineering apruebe.
const ARMED_PLATFORMS = ["Glovo"];
// Plataformas donde el agente PROPONE campañas (Glovo con robot; Uber/JustEat pendiente = manual).
const PROPOSABLE_PLATFORMS = ["Glovo", "Uber", "JustEat"];

// Suelo de visibilidad (múltiplos de 5): mantener el mínimo para no perder ranking.
const MAINT_FLOOR = 5;
const ABS_FLOOR = 5;
// Cupo por canal y ronda: alto para lograr cobertura total (el 'busy' evita duplicar).
const COVERAGE_CAP = 60;

const EXCLUDED_CATEGORY_PATTERNS = [/bebida/i];

// Arsenal por canal (v3 · pieza 1): qué kinds propone el agente en cada canal y si la
// oferta es POR MARCA (Shop: las ofertas de carta son por marca, sin local) o por
// marca×local (plataforma). Añadir un arma = añadir un string; añadir un canal = una entrada.
//   Shop: item_percent = promo de carta VISIBLE y AUTOMÁTICA en el storefront. El "standard"
//   del Shop es un CÓDIGO que el cliente teclea → no empuja la tienda, no es arma del agente.
//   Más armas del Shop (bogo / envío gratis / regalo) entran en la pieza 3.
const CHANNEL_ARSENAL: Record<string, { kinds: string[]; perBrand: boolean }> = {
  Shop:    { kinds: ["item_percent"], perBrand: true },
  Glovo:   { kinds: ["standard"],     perBrand: false },
  Uber:    { kinds: ["standard"],     perBrand: false },
  JustEat: { kinds: ["standard"],     perBrand: false },
};

type Opp = {
  row: any; brand: any; chKey: string; channelId: string;
  pct: number; reason: string; urgent: boolean; gap: number;
  kind: string; perBrand: boolean;
};

Deno.serve(async (req) => {
  if (req.headers.get("x-agent-secret") !== AGENT_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const runs: Array<Record<string, unknown>> = [];

  const { data: configs } = await supa.from("offers_agent_config").select("*").eq("enabled", true);
  for (const cfg of configs ?? []) {
    const accountId = cfg.account_id as string;
    const prof = PROFILES[cfg.aggressiveness] ?? PROFILES.medium;
    const nowIso = new Date().toISOString();
    const signals: Record<string, unknown> = {
      armed_platforms: ARMED_PLATFORMS, proposable: PROPOSABLE_PLATFORMS, signal: "v2_targets", policy: "cobertura_total",
    };
    const decisions: Array<Record<string, unknown>> = [];
    let created = 0;

    // ── 1. HIGIENE de la corrida
    await supa.from("coupon").update({ active: false })
      .eq("account_id", accountId).eq("origin", "agent")
      .eq("active", true).lt("ends_at", nowIso);
    const staleIso = new Date(Date.now() - 48 * 3600e3).toISOString();
    await supa.from("coupon").update({ ends_at: nowIso })
      .eq("account_id", accountId).eq("origin", "agent").eq("active", false)
      .lt("created_at", staleIso).gt("ends_at", nowIso);

    // ── 2. SEÑALES
    const { data: brands } = await supa.from("brand")
      .select("id,name,ownership_type").eq("account_id", accountId).eq("is_active", true);

    const { data: channels } = await supa.from("sales_channel")
      .select("id,name").eq("account_id", accountId);
    const chanByName = new Map((channels ?? []).map(c => [c.name, c.id]));

    const { data: sales } = await supa.rpc("agent_sales_signal_v2", { p_account_id: accountId });
    signals.sales = sales;

    const { data: events } = await supa.from("local_event")
      .select("name,event_type,starts_at,ends_at,demand_effect")
      .eq("account_id", accountId)
      .gte("ends_at", nowIso)
      .lte("starts_at", new Date(Date.now() + 7 * 864e5).toISOString());
    signals.events = events;
    const eventUp = (events ?? []).some(e => e.demand_effect === "up");

    const { data: dowRows } = await supa.rpc("agent_dow_signal", { p_account_id: accountId });
    const dowMap = new Map<string, Map<number, number>>();
    for (const r of (dowRows ?? []) as Array<any>) {
      const k = `${r.brand_id}:${r.channel_name}`;
      if (!dowMap.has(k)) dowMap.set(k, new Map());
      dowMap.get(k)!.set(Number(r.dow), Number(r.pct_share));
    }
    const { data: learnRows } = await supa.rpc("agent_learning_signal", { p_account_id: accountId });
    const learnMap = new Map<string, any>();
    for (const r of (learnRows ?? []) as Array<any>) learnMap.set(`${r.brand_id}:${r.channel_name}`, r);
    signals.learning = learnRows;

    const jsDow = new Date().getDay();
    const isoToday = jsDow === 0 ? 7 : jsDow;
    const nextDows = [0, 1, 2].map(o => ((isoToday - 1 + o) % 7) + 1);
    const DOW_NAMES = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    const nextDowTxt = nextDows.map(d => DOW_NAMES[d]).join("-");
    const eventUpNames = (events ?? []).filter(e => e.demand_effect === "up").map(e => e.name).join(", ");

    const { data: recent } = await supa.from("coupon")
      .select("id,name,channels,scope,active,created_at,ends_at")
      .eq("account_id", accountId)
      .gte("created_at", new Date(Date.now() - prof.cooldownDays * 864e5).toISOString());
    const busy = new Set<string>();
    const busyAllLoc = new Set<string>();
    for (const c of recent ?? []) {
      const notExpired = !c.ends_at || c.ends_at > nowIso;
      const alive = c.active === true && notExpired;
      const pending = c.active === false && notExpired;
      if (!alive && !pending) continue;
      const bids: string[] = (c as any).scope?.brand_ids ?? [];
      const lids: string[] = (c as any).scope?.location_ids ?? [];
      for (const ch of (c.channels ?? []) as string[]) for (const b of bids) {
        if (lids.length === 0) busyAllLoc.add(`${ch}:${b}`);
        else for (const l of lids) busy.add(`${ch}:${b}:${l}`);
      }
    }

    // ── 3. OPORTUNIDADES — plataforma por marca×canal×local; Shop POR MARCA.
    //    Las ofertas de carta del Shop son por marca (sin local): se colapsan los
    //    locales SUMANDO objetivo y ventas (opción A aprobada por Julio).
    const units: Array<any> = [];
    const shopAgg = new Map<string, any>();
    for (const row of (sales ?? []) as Array<any>) {
      if (row.channel_name === "Shop") {
        const a = shopAgg.get(row.brand_id) ?? {
          brand_id: row.brand_id, channel_name: "Shop", location_id: null,
          location_name: "Shop", ownership_type: row.ownership_type,
          target_daily: 0, sales_7d: 0, avg_28d: 0, peak_daily: 0,
        };
        a.target_daily += Number(row.target_daily ?? 0);
        a.sales_7d     += Number(row.sales_7d ?? 0);
        a.avg_28d      += Number(row.avg_28d ?? 0);
        a.peak_daily    = Math.max(a.peak_daily, Number(row.peak_daily ?? 0));
        shopAgg.set(row.brand_id, a);
      } else {
        units.push(row);
      }
    }
    for (const a of shopAgg.values()) units.push(a);

    const opps: Opp[] = [];
    for (const row of units) {
      const brand = (brands ?? []).find(b => b.id === row.brand_id);
      if (!brand) continue;

      const isPlatform = row.channel_name !== "Shop";
      if (isPlatform && !PROPOSABLE_PLATFORMS.includes(row.channel_name)) continue; // fuera de las proponibles
      if (isPlatform && brand.ownership_type === "licensed") continue;              // GUARDARRAÍL cedidas
      const chKey = row.channel_name.toLowerCase();
      if (busyAllLoc.has(`${chKey}:${brand.id}`)) continue;
      if (busy.has(`${chKey}:${brand.id}:${row.location_id}`)) continue;

      const channelId = chanByName.get(row.channel_name);
      if (!channelId) continue;

      const target = Number(row.target_daily ?? 0);
      const s7 = Number(row.sales_7d ?? 0);
      const avg28 = Number(row.avg_28d ?? 0);
      const peak = Number(row.peak_daily ?? 0);
      const locShort = String(row.location_name ?? "").replace(/^Foodint\s+/i, "");
      const hasTarget = target > 0;
      const pctOfTarget = hasTarget ? (s7 / target) * 100 : 100; // con objetivo, % de consecución

      let pct = 0; let reason = ""; let urgent = false; let gap = 0;

      if (s7 < 0.15) {
        // ARTILLERÍA: ventas a CERO → arrancar la marca, CON o SIN objetivo.
        // (Fix 08/07: antes exigía objetivo → las cedidas y el Shop sin objetivo
        //  caían en mantenimiento 10%. En Shop cedidas=propias: a cero = agresivo.)
        pct = prof.maxPct; urgent = true; gap = 1;
        reason = hasTarget
          ? `URGENTE ${locShort}: ${s7.toFixed(1)} ped/día con objetivo ${target}. ` +
            (peak > 0 ? `(pico histórico ${peak.toFixed(1)}) ` : `(sin historia — lanzamiento) `) +
            `Artillería (${pct}%) para arrancar la marca.`
          : `URGENTE ${locShort}: ${s7.toFixed(1)} ped/día, canal a cero sin objetivo — crecimiento agresivo. ` +
            `Artillería (${pct}%) para arrancar la marca.`;
      } else if (hasTarget && pctOfTarget < Number(cfg.recovery_target_pct)) {
        // CRECIMIENTO: proporcional al hueco contra el objetivo.
        gap = (Number(cfg.recovery_target_pct) - pctOfTarget) / Number(cfg.recovery_target_pct);
        pct = Math.max(ABS_FLOOR, Math.min(prof.maxPct, Math.round(prof.maxPct * Math.min(1, gap * 2))));
        reason = `CRECIMIENTO ${locShort}: ${s7.toFixed(1)} ped/día = ${Math.round(pctOfTarget)}% del objetivo (${target}). ` +
          `Umbral ${cfg.recovery_target_pct}%. ` + (peak > 0 ? `Pico ${peak.toFixed(1)}. ` : "") +
          `Promo proporcional al hueco.`;
      } else {
        // MANTENIMIENTO: va bien (o sin objetivo). Visibilidad mínima adaptativa por tendencia.
        gap = 0;
        const declining = avg28 > 0 && s7 < avg28;              // empieza a resentirse
        pct = declining ? MAINT_FLOOR + 5 : MAINT_FLOOR;         // 5%, o 10% si baja
        reason = hasTarget
          ? `MANTENIMIENTO ${locShort}: ${Math.round(pctOfTarget)}% del objetivo — visibilidad mínima (${pct}%) para no perder ranking` +
            (declining ? `, subida por tendencia a la baja (7d ${s7.toFixed(1)} < 28d ${avg28.toFixed(1)})` : "") + `.`
          : `MANTENIMIENTO ${locShort}: sin objetivo fijado — visibilidad mínima (${pct}%) para no perder ranking.`;
      }

      // Evento demanda-up: profundiza (sobre cualquier tramo)
      if (prof.proactive && eventUp) {
        pct = Math.min(prof.maxPct, pct + 5);
        reason += ` + evento demanda-up: ${eventUpNames}`;
      }

      // T4: los 3 días por delante vs reparto histórico
      const shares = dowMap.get(`${row.brand_id}:${row.channel_name}`);
      if (shares && shares.size >= 4) {
        const ahead = nextDows.reduce((s, d) => s + (shares.get(d) ?? 0), 0);
        if (ahead >= 50) {
          pct = Math.min(prof.maxPct, pct + 5); gap = Math.min(1, gap + 0.15);
          reason += ` + días fuertes por delante (${nextDowTxt}: ${Math.round(ahead)}%)`;
        } else if (ahead < 25) {
          pct = Math.max(ABS_FLOOR, pct - 5);
          reason += ` − días flojos por delante (${nextDowTxt}: ${Math.round(ahead)}%) — contenida`;
        }
      }

      // T6: aprendizaje del uplift medido (>=2 medidas)
      const learn = learnMap.get(`${row.brand_id}:${row.channel_name}`);
      if (learn && Number(learn.n_medidas) >= 2) {
        const avg = Number(learn.uplift_medio ?? 0);
        const arr = Number(learn.arranques ?? 0);
        if (avg <= 0 && arr === 0) {
          pct = Math.max(ABS_FLOOR, pct - 5);
          reason += ` · aprendizaje: últimas ${learn.n_medidas} promos sin efecto (uplift ${avg}%) — contenida; considerar 2x1`;
        } else if (avg >= 25 || arr > 0) {
          reason += ` · aprendizaje: histórico favorable (uplift ${avg}%${arr > 0 ? `, ${arr} arranque(s)` : ""})`;
        }
      }

      // múltiplos de 5, suelo 5
      pct = Math.max(ABS_FLOOR, Math.min(prof.maxPct, Math.round(pct / 5) * 5));

      // TIPO (arsenal v3 · pieza 1): Shop = item_percent (% carta, visible+automática);
      // plataforma = standard. La profundidad (pct) ya la fija el estado más arriba.
      const arsenal = CHANNEL_ARSENAL[row.channel_name] ?? { kinds: ["standard"], perBrand: false };
      const kind = row.channel_name === "Shop" ? "item_percent" : "standard";

      opps.push({ row, brand, chKey, channelId: channelId as string, pct, reason, urgent, gap, kind, perBrand: arsenal.perBrand });
    }

    // ── 4. PRIORIZAR: urgentes primero, luego mayor hueco, luego mayor %
    opps.sort((a, b) =>
      (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || b.gap - a.gap || b.pct - a.pct);

    // ── 5. CREAR con cobertura + bebidas fuera + guardarraíl de margen
    const usedByChannel = new Map<string, number>();
    const previewCache = new Map<string, any>();
    for (const o of opps) {
      const used = usedByChannel.get(o.chKey) ?? 0;
      if (used >= COVERAGE_CAP) continue;

      // Carta base de la marca (bebidas fuera), una sola vez por marca — cacheada.
      const baseKey = `base:${o.brand.id}`;
      let baseInfo = previewCache.get(baseKey) as any;
      if (!baseInfo) {
        const { data: items } = await supa.from("menu_item")
          .select("id, menu_category:menu_category_id(name)")
          .eq("account_id", accountId).eq("brand_id", o.brand.id)
          .is("archived_at", null);
        const banned = (items ?? []).filter((it: any) =>
          EXCLUDED_CATEGORY_PATTERNS.some(rx => rx.test(it.menu_category?.name ?? "")));
        const baseIds = banned.length > 0
          ? (items ?? []).filter((it: any) => !banned.some((b: any) => b.id === it.id)).map((it: any) => it.id)
          : null;
        baseInfo = { baseIds, bannedCount: banned.length, empty: baseIds !== null && baseIds.length === 0 };
        previewCache.set(baseKey, baseInfo);
      }
      if (baseInfo.empty) {
        decisions.push({ brand: o.brand.name, channel: o.row.channel_name,
          verdict: "DESCARTADA: la carta solo tiene categorías vetadas (bebidas)" });
        continue;
      }

      // ── CASCADA DE ALTERNATIVAS (opción 3 de Julio): en vez de rendirse al primer %,
      //    baja el descuento de 5 en 5 desde el propuesto hasta ABS_FLOOR y se queda con el
      //    MAYOR % que aguante ≥1 plato con el margen sagrado (cfg.margin_floor_pct, 45%).
      //    El margen NO se toca: es el mismo suelo en todos los canales. Pero como el Shop
      //    solo se lleva 5% de comisión (vs Uber 27%), el preview resta menos y el Shop
      //    aguanta % más altos SOLO → cada canal exprimido a su máximo rentable.
      const tried: number[] = [];
      let chosenPct = 0;
      let pv: { ok: any[]; under: any[] } | null = null;
      for (let tryPct = o.pct; tryPct >= ABS_FLOOR; tryPct -= 5) {
        tried.push(tryPct);
        const cacheKey = `${o.brand.id}:${o.channelId}:${tryPct}`;
        let cand = previewCache.get(cacheKey) as any;
        if (!cand) {
          const { data: impact } = await supa.rpc("preview_platform_promo_impact", {
            p_account_id: accountId, p_channel_id: o.channelId,
            p_brand_ids: [o.brand.id], p_discount_type: "percent",
            p_discount_value: tryPct, p_menu_item_ids: baseInfo.baseIds,
            p_margin_floor_pct: cfg.margin_floor_pct,
          });
          cand = {
            ok: (impact ?? []).filter((r: any) => r.status === "ok"),
            under: (impact ?? []).filter((r: any) => r.status === "bajo_suelo"),
          };
          previewCache.set(cacheKey, cand);
        }
        if (cand.ok.length > 0) { chosenPct = tryPct; pv = cand; break; }  // el 1º que aguanta (el más alto) gana
      }

      // ── ARREGLO 4: si NI el 5% aguanta ningún plato → ALERTA visible, no silencio.
      if (!pv || chosenPct === 0) {
        const worst = previewCache.get(`${o.brand.id}:${o.channelId}:${ABS_FLOOR}`) as any;
        decisions.push({
          brand: o.brand.name, channel: o.row.channel_name, location: o.row.location_name,
          reason: o.reason,
          verdict: `⚠️ ALERTA: ${o.brand.name} en ${o.row.channel_name} — ningún descuento rentable (probé ${tried.join("/")}%) mantiene el margen mínimo (${cfg.margin_floor_pct}%). Revisa escandallo, precio o suelo.`,
          alert: true,
          tried_pcts: tried,
          under_at_floor: worst?.under?.length ?? null,
        });
        continue;
      }

      // Si el % bajó respecto al propuesto, dejar rastro del ajuste en el motivo.
      if (chosenPct < o.pct) {
        o.reason += ` · ajustado ${o.pct}%→${chosenPct}% para respetar margen ${cfg.margin_floor_pct}% en ${o.row.channel_name}`;
      }
      o.pct = chosenPct;  // el % final es el que aguantó
      const scopeItems = (pv.under.length > 0 || baseInfo.baseIds !== null) ? pv.ok.map((r: any) => r.menu_item_id) : null;

      const isShop = o.row.channel_name === "Shop";
      const mode = isShop ? cfg.shop_mode : cfg.platform_mode;
      if (mode === "off") continue;
      const autoPublish = isShop && mode === "auto";
      const armed = ARMED_PLATFORMS.includes(o.row.channel_name);
      const endDays = Math.min(cfg.max_campaign_days, 7);
      const locShort = String(o.row.location_name ?? "").replace(/^Foodint\s+/i, "");

      const kind = o.kind;
      const isItemPct = kind === "item_percent";
      const name = `[Agente] ${o.pct}%${isItemPct ? " carta" : ""} ${o.brand.name} · ${o.row.channel_name}${isShop ? "" : " · " + locShort}`;
      const value = o.pct;
      const scopeFinal: Record<string, unknown> = {
        brand_ids: [o.brand.id],
        menu_item_ids: scopeItems,
        location_ids: isShop ? null : [o.row.location_id],  // Shop = por marca, sin local
      };
      // Uber (o cualquier plataforma sin brazo): marcar que se publica a mano.
      const manualNote = (!isShop && !armed)
        ? ` [PUBLICAR A MANO en ${o.row.channel_name} Manager — brazo automático pendiente de aprobación]` : "";
      const reasonFinal = o.reason + manualNote;

      const { data: coupon, error } = await supa.from("coupon").insert({
        account_id: accountId,
        code: `AGENT-${o.chKey.toUpperCase()}-${Date.now().toString(36)}`,
        name,
        discount_type: "percent", value,
        applies_to: "subtotal",
        channels: [o.chKey],
        kind,
        scope: scopeFinal,
        starts_at: nowIso,
        ends_at: new Date(Date.now() + endDays * 864e5).toISOString(),
        active: autoPublish,
        origin: "agent",
        omnibus_ref_note: `Agente ${nowIso.slice(0, 10)}: ${reasonFinal}`,
      }).select("id").single();

      if (error) { decisions.push({ brand: o.brand.name, location: o.row.location_name, error: error.message }); continue; }

      // item_percent: el alcance vive en campaign_scope (NO en coupon.scope). Si hubo
      // exclusiones por margen → una fila por plato OK; si toda la carta aguanta → una
      // fila de marca. Así el guardarraíl se respeta (los platos bajo suelo quedan fuera).
      if (isItemPct && coupon?.id) {
        const scRows = (scopeItems && (scopeItems as string[]).length > 0)
          ? (scopeItems as string[]).map((iid) => ({ coupon_id: coupon.id, menu_item_id: iid }))
          : [{ coupon_id: coupon.id, brand_id: o.brand.id }];
        const { error: scErr } = await supa.from("campaign_scope").insert(scRows);
        if (scErr) decisions.push({ brand: o.brand.name, warn: `campaign_scope: ${scErr.message}` });
      }

      created++;
      usedByChannel.set(o.chKey, used + 1);
      if (isShop) busyAllLoc.add(`${o.chKey}:${o.brand.id}`);
      else busy.add(`${o.chKey}:${o.brand.id}:${o.row.location_id}`);
      decisions.push({
        brand: o.brand.name, channel: o.row.channel_name, location: o.row.location_name,
        kind, pct: o.pct, reason: reasonFinal,
        manual: (!isShop && !armed),
        verdict: autoPublish ? "PUBLICADA (Shop auto)"
          : armed ? "PROPUESTA (aprobar → robot publica)"
          : "PROPUESTA (subir a mano)",
        excluded_under_floor: pv.under.map((r: any) => r.item_name),
        coupon_id: coupon?.id,
      });
    }

    // ── 6. Log auditable
    await supa.from("agent_run_log").insert({
      account_id: accountId, signals, decisions, campaigns_created: created,
    });
    runs.push({ account_id: accountId, created, decisions });
  }

  return new Response(JSON.stringify({ ok: true, runs }), {
    headers: { "content-type": "application/json" },
  });
});
