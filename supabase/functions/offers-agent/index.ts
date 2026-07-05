// offers-agent — El agente de ofertas de Folvy (motor de reglas determinista y auditable)
// v1.3 (05/07/2026) — ETAPA CRECIMIENTO (decisión Julio):
//   La vara de medir pasa del PICO HISTÓRICO al OBJETIVO POR MARCA×CANAL×LOCAL
//   (tabla brand_channel_target, puesta por el operador). Motivo (verificado con datos):
//   el pico del backfill nov-2025 era una vara falsa (Meraki "al 106%" de un pico enano),
//   el umbral peak>=0.1 excluía marcas sin historia (Urban Kebab), y una marca a cero en
//   28d NI GENERABA FILA (Dirty Burger invisible). Ahora: el universo son los objetivos
//   (señal v2, el cero es una fila), la reactivación urgente NO exige pasado, la
//   profundidad es proporcional al hueco contra TU objetivo, y la decisión + la campaña
//   son POR LOCAL (scope.location_ids; el robot publica solo en el POS de ese local).
//   El pico queda como dato informativo en el razonamiento.
// v1.2: bebidas jamás en promo (categorías con 'bebida' vetadas) + % en múltiplos de 5.
// v1.1: solo canales con brazo (ARMED_PLATFORMS) + priorización + cupo por canal + higiene.
// Corre cada hora vía pg_cron (job 'offers-agent-hourly') -> net.http_post con secreto del Vault.
// Guardarraíl de margen REAL (preview_platform_promo_impact) plato a plato.
// Shop: publica solo (shop_mode=auto). Plataformas: PROPUESTAS (origin='agent', active=false).
// REGLA INNEGOCIABLE: cedidas (ownership_type='licensed') JAMÁS en campañas de plataforma.
// DESPLIEGUE: SIEMPRE --no-verify-jwt (lo llama pg_cron SIN JWT; la frontera es x-agent-secret).

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

// Plataformas con brazo publicador VIVO. Añadir "Uber" cuando Partner Engineering apruebe
// los scopes eats.store.promotion.* (brazo uber-promo-push ya desplegado en seco).
const ARMED_PLATFORMS = ["Glovo"];

// Categorías de carta VETADAS en promos del agente (decisión Julio 05/07: descontar bebida
// es destruir margen sin tirón). Para vetar postres algún día: añadir /postre/i.
const EXCLUDED_CATEGORY_PATTERNS = [/bebida/i];

type Opp = {
  row: any; brand: any; chKey: string; channelId: string;
  pct: number; reason: string; urgent: boolean; gap: number;
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
    const signals: Record<string, unknown> = { armed_platforms: ARMED_PLATFORMS, signal: "v2_targets" };
    const decisions: Array<Record<string, unknown>> = [];
    let created = 0;

    // ── 1. HIGIENE de la corrida (v1.1)
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

    // v2: universo = objetivos por marca×canal×LOCAL (el cero es una fila)
    const { data: sales } = await supa.rpc("agent_sales_signal_v2", { p_account_id: accountId });
    signals.sales = sales;

    const { data: events } = await supa.from("local_event")
      .select("name,event_type,starts_at,ends_at,demand_effect")
      .eq("account_id", accountId)
      .gte("ends_at", nowIso)
      .lte("starts_at", new Date(Date.now() + 7 * 864e5).toISOString());
    signals.events = events;
    const eventUp = (events ?? []).some(e => e.demand_effect === "up");
    const eventUpNames = (events ?? []).filter(e => e.demand_effect === "up").map(e => e.name).join(", ");

    // Campañas recientes: busy POR marca×canal×LOCAL. Una campaña sin location_ids
    // (alcance cuenta entera, p.ej. manual) bloquea la marca×canal en TODOS los locales.
    const { data: recent } = await supa.from("coupon")
      .select("id,name,channels,scope,active,created_at,ends_at")
      .eq("account_id", accountId)
      .gte("created_at", new Date(Date.now() - prof.cooldownDays * 864e5).toISOString());
    const busy = new Set<string>();
    const busyAllLoc = new Set<string>(); // marca×canal bloqueada en todos los locales
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

    // ── 3. OPORTUNIDADES por marca×canal×local (calcular TODAS antes de crear)
    const opps: Opp[] = [];
    for (const row of (sales ?? []) as Array<any>) {
      const brand = (brands ?? []).find(b => b.id === row.brand_id);
      if (!brand) continue;

      const isPlatform = row.channel_name !== "Shop";
      if (isPlatform && !ARMED_PLATFORMS.includes(row.channel_name)) continue; // sin brazo
      if (isPlatform && brand.ownership_type === "licensed") continue;         // GUARDARRAÍL cedidas
      const chKey = row.channel_name.toLowerCase();
      if (busyAllLoc.has(`${chKey}:${brand.id}`)) continue;
      if (busy.has(`${chKey}:${brand.id}:${row.location_id}`)) continue;

      const channelId = chanByName.get(row.channel_name);
      if (!channelId) continue;

      const target = Number(row.target_daily ?? 0);
      if (target <= 0) continue;
      const s7 = Number(row.sales_7d ?? 0);
      const peak = Number(row.peak_daily ?? 0);
      const locShort = String(row.location_name ?? "").replace(/^Foodint\s+/i, "");
      const pctOfTarget = (s7 / target) * 100;

      let pct = 0; let reason = ""; let urgent = false; let gap = 0;
      if (s7 < 0.15) {
        // REACTIVACIÓN/LANZAMIENTO URGENTE: hay objetivo y las ventas están a cero.
        // v1.3: SIN exigir pasado (el pico ya no veta; solo informa).
        pct = prof.maxPct; urgent = true; gap = 1;
        reason = `URGENTE ${locShort}: ${s7.toFixed(1)} ped/día con objetivo ${target}. ` +
          (peak > 0 ? `(pico histórico ${peak.toFixed(1)}) ` : `(sin historia en este canal — lanzamiento) `) +
          `Promo máxima (${pct}%) para arrancar la marca.`;
      } else if (pctOfTarget < Number(cfg.recovery_target_pct)) {
        gap = (Number(cfg.recovery_target_pct) - pctOfTarget) / Number(cfg.recovery_target_pct);
        pct = Math.max(10, Math.min(prof.maxPct, Math.round(prof.maxPct * Math.min(1, gap * 2))));
        reason = `CRECIMIENTO ${locShort}: ${s7.toFixed(1)} ped/día = ${Math.round(pctOfTarget)}% del objetivo (${target}). ` +
          `Umbral ${cfg.recovery_target_pct}%. ` + (peak > 0 ? `Pico histórico: ${peak.toFixed(1)}. ` : "") +
          `Promo always-on proporcional al hueco.`;
      }
      if (pct > 0 && prof.proactive && eventUp) {
        pct = Math.min(prof.maxPct, pct + 5);
        reason += ` + evento demanda-up: ${eventUpNames}`;
      } else if (pct === 0 && prof.proactive && eventUp) {
        pct = Math.min(10, prof.maxPct); gap = 0.1;
        reason = `Evento con demanda al alza en ${locShort}: ${eventUpNames}`;
      }
      if (pct === 0) continue;
      // múltiplos de 5 (v1.2): pantalla = Glovo
      pct = Math.max(10, Math.min(prof.maxPct, Math.round(pct / 5) * 5));

      opps.push({ row, brand, chKey, channelId: channelId as string, pct, reason, urgent, gap });
    }

    // ── 4. PRIORIZAR: urgentes primero, luego mayor hueco, luego mayor %
    opps.sort((a, b) =>
      (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || b.gap - a.gap || b.pct - a.pct);

    // ── 5. CREAR con cupo POR CANAL + bebidas fuera + guardarraíl de margen
    const usedByChannel = new Map<string, number>();
    const previewCache = new Map<string, { ok: any[]; under: any[]; baseIds: string[] | null; bannedCount: number }>();
    for (const o of opps) {
      const used = usedByChannel.get(o.chKey) ?? 0;
      if (used >= prof.maxNew) continue;

      // Bebidas fuera + guardarraíl: la carta es por marca (igual en los 3 locales),
      // así que se cachea por marca×canal×pct para no repetir el preview por local.
      const cacheKey = `${o.brand.id}:${o.channelId}:${o.pct}`;
      let pv = previewCache.get(cacheKey);
      if (!pv) {
        const { data: items } = await supa.from("menu_item")
          .select("id, menu_category:menu_category_id(name)")
          .eq("account_id", accountId).eq("brand_id", o.brand.id)
          .is("archived_at", null);
        const banned = (items ?? []).filter((it: any) =>
          EXCLUDED_CATEGORY_PATTERNS.some(rx => rx.test(it.menu_category?.name ?? "")));
        const baseIds = banned.length > 0
          ? (items ?? []).filter((it: any) => !banned.some((b: any) => b.id === it.id)).map((it: any) => it.id)
          : null;
        if (baseIds !== null && baseIds.length === 0) {
          decisions.push({ brand: o.brand.name, channel: o.row.channel_name,
            verdict: "DESCARTADA: la carta solo tiene categorías vetadas (bebidas)" });
          previewCache.set(cacheKey, { ok: [], under: [], baseIds, bannedCount: banned.length });
          continue;
        }
        const { data: impact } = await supa.rpc("preview_platform_promo_impact", {
          p_account_id: accountId, p_channel_id: o.channelId,
          p_brand_ids: [o.brand.id], p_discount_type: "percent",
          p_discount_value: o.pct, p_menu_item_ids: baseIds,
          p_margin_floor_pct: cfg.margin_floor_pct,
        });
        pv = {
          ok: (impact ?? []).filter((r: any) => r.status === "ok"),
          under: (impact ?? []).filter((r: any) => r.status === "bajo_suelo"),
          baseIds, bannedCount: banned.length,
        };
        previewCache.set(cacheKey, pv);
      }
      if (pv.ok.length === 0) {
        decisions.push({ brand: o.brand.name, channel: o.row.channel_name, location: o.row.location_name,
          pct: o.pct, reason: o.reason, verdict: "DESCARTADA: ningún plato aguanta el suelo", under: pv.under.length });
        continue;
      }
      const scopeItems = (pv.under.length > 0 || pv.baseIds !== null) ? pv.ok.map((r: any) => r.menu_item_id) : null;

      const isShop = o.row.channel_name === "Shop";
      const mode = isShop ? cfg.shop_mode : cfg.platform_mode;
      if (mode === "off") continue;
      const autoPublish = isShop && mode === "auto";
      const endDays = Math.min(cfg.max_campaign_days, 7);
      const locShort = String(o.row.location_name ?? "").replace(/^Foodint\s+/i, "");

      const { data: coupon, error } = await supa.from("coupon").insert({
        account_id: accountId,
        code: `AGENT-${o.chKey.toUpperCase()}-${Date.now().toString(36)}`,
        name: `[Agente] ${o.pct}% ${o.brand.name} · ${o.row.channel_name} · ${locShort}`,
        discount_type: "percent", value: o.pct,
        applies_to: "subtotal",
        channels: [o.chKey],
        scope: { brand_ids: [o.brand.id], menu_item_ids: scopeItems, location_ids: [o.row.location_id] },
        starts_at: nowIso,
        ends_at: new Date(Date.now() + endDays * 864e5).toISOString(),
        active: autoPublish,
        origin: "agent",
        omnibus_ref_note: `Agente ${nowIso.slice(0, 10)}: ${o.reason}`,
      }).select("id").single();

      if (error) { decisions.push({ brand: o.brand.name, location: o.row.location_name, error: error.message }); continue; }
      created++;
      usedByChannel.set(o.chKey, used + 1);
      busy.add(`${o.chKey}:${o.brand.id}:${o.row.location_id}`);
      decisions.push({
        brand: o.brand.name, channel: o.row.channel_name, location: o.row.location_name,
        pct: o.pct, reason: o.reason,
        verdict: autoPublish ? "PUBLICADA (Shop auto)" : "PROPUESTA (pendiente de aprobación)",
        excluded_under_floor: pv.under.map((r: any) => r.item_name),
        coupon_id: coupon?.id,
      });
    }

    // ── 6. Log auditable de la corrida (por cuenta)
    await supa.from("agent_run_log").insert({
      account_id: accountId, signals, decisions, campaigns_created: created,
    });
    runs.push({ account_id: accountId, created, decisions });
  }

  return new Response(JSON.stringify({ ok: true, runs }), {
    headers: { "content-type": "application/json" },
  });
});
