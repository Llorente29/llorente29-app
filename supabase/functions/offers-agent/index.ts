// offers-agent — El agente de ofertas de Folvy (v1, motor de reglas determinista y auditable)
// Corre cada hora vía pg_cron -> net.http_post con secreto interno (patrón catcher-dispatch).
// Decide campañas con margen REAL (RPC preview_platform_promo_impact) y guardarraíles duros.
// Shop: publica solo (shop_mode=auto). Plataformas: crea PROPUESTAS (origin='agent', active=false).
// REGLA INNEGOCIABLE: marcas cedidas (ownership_type='licensed') JAMÁS en campañas de plataforma.

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("OFFERS_AGENT_SECRET")!;
const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Perfil por agresividad: profundidad máx de descuento, cooldown, cuántas oportunidades ataca
const PROFILES: Record<string, { maxPct: number; cooldownDays: number; proactive: boolean; maxNew: number }> = {
  low:    { maxPct: 10, cooldownDays: 14, proactive: false, maxNew: 1 },
  medium: { maxPct: 15, cooldownDays: 7,  proactive: true,  maxNew: 2 },
  high:   { maxPct: 20, cooldownDays: 5,  proactive: true,  maxNew: 3 },
  max:    { maxPct: 30, cooldownDays: 3,  proactive: true,  maxNew: 4 },
};

const PLATFORM_CHANNELS = ["Glovo", "Uber"]; // v1 (JustEat cuando su brazo exista)

Deno.serve(async (req) => {
  if (req.headers.get("x-agent-secret") !== AGENT_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const signals: Record<string, unknown> = {};
  const decisions: Array<Record<string, unknown>> = [];
  let created = 0;

  // ── 0. Config de cada cuenta con agente encendido
  const { data: configs } = await supa.from("offers_agent_config").select("*").eq("enabled", true);
  for (const cfg of configs ?? []) {
    const accountId = cfg.account_id as string;
    const prof = PROFILES[cfg.aggressiveness] ?? PROFILES.medium;

    // ── 1. SEÑALES
    // Marcas (propias para plataformas; todas con shop para Shop)
    const { data: brands } = await supa.from("brand")
      .select("id,name,ownership_type").eq("account_id", accountId).eq("is_active", true);
    const ownBrands = (brands ?? []).filter(b => b.ownership_type !== "licensed");

    // Canales
    const { data: channels } = await supa.from("sales_channel")
      .select("id,name").eq("account_id", accountId);
    const chanByName = new Map((channels ?? []).map(c => [c.name, c.id]));

    // Ventas 7d vs media 28d por marca (señal de caída/salud)
    const { data: sales } = await supa.rpc("agent_sales_signal", { p_account_id: accountId });
    signals.sales = sales;

    // Eventos activos o próximos (7 días vista)
    const { data: events } = await supa.from("local_event")
      .select("name,event_type,starts_at,ends_at,demand_effect")
      .eq("account_id", accountId)
      .gte("ends_at", new Date().toISOString())
      .lte("starts_at", new Date(Date.now() + 7 * 864e5).toISOString());
    signals.events = events;

    // Campañas recientes (cooldown + 1-activa-por-marca-canal)
    const { data: recent } = await supa.from("coupon")
      .select("id,name,channels,scope,active,created_at,ends_at")
      .eq("account_id", accountId)
      .gte("created_at", new Date(Date.now() - prof.cooldownDays * 864e5).toISOString());
    // busy = tiene campaña VIVA (activa sin expirar) o propuesta pendiente -> no duplicar.
    // Las expiradas NO bloquean en growth_mode (always-on: al caducar una, entra la siguiente).
    const busy = new Set<string>();
    const nowIso = new Date().toISOString();
    for (const c of recent ?? []) {
      const alive = (c.active && (!c.ends_at || c.ends_at > nowIso)) || c.active === false && !c.ends_at;
      const isPending = c.active === false; // propuesta sin resolver también bloquea
      if (!alive && !isPending && cfg.growth_mode) continue;
      const bids: string[] = (c as any).scope?.brand_ids ?? [];
      for (const ch of (c.channels ?? []) as string[]) for (const b of bids) busy.add(`${ch}:${b}`);
    }

    // ── 2. REGLAS
    let newCount = 0;
    for (const row of (sales ?? []) as Array<any>) {
      if (newCount >= prof.maxNew) break;
      const brand = (brands ?? []).find(b => b.id === row.brand_id);
      if (!brand) continue;

      const drop = row.avg_28d > 0 ? row.sales_7d / row.avg_28d : 1;
      const isPlatform = PLATFORM_CHANNELS.includes(row.channel_name);
      if (isPlatform && brand.ownership_type === "licensed") continue; // GUARDARRAÍL cedidas
      const chKey = row.channel_name.toLowerCase() === "uber" ? "uber" : row.channel_name.toLowerCase();
      if (busy.has(`${chKey}:${brand.id}`)) continue;                   // cooldown / ya activa

      // R-RECOVERY (growth_mode, la regla PRINCIPAL): la marca está por debajo del
      // objetivo de recuperación respecto a su PICO histórico -> promo always-on al
      // máximo del perfil. El algoritmo de la plataforma premia tener promo activa:
      // para marcas en recuperación la promo no es táctica, es presencia.
      // R1 — caída vs media 28d (para cuentas sin growth_mode)
      // R2 — EVENTO demanda-up: empuje adicional (perfiles proactivos)
      let pct = 0; let reason = "";
      const peak = Number(row.peak_daily ?? 0);
      const pctOfPeak = peak > 0 ? (row.sales_7d / peak) * 100 : 100;
      if (cfg.growth_mode && peak >= 0.1 && row.sales_7d < 0.15) {
        // REACTIVACIÓN URGENTE: la marca existió (hay pico) y hoy está a CERO.
        // Máxima agresividad: es el caso más urgente, no un descarte.
        pct = prof.maxPct;
        reason = `REACTIVACIÓN URGENTE: ${row.sales_7d.toFixed(1)} ped/día con pico histórico de ${peak.toFixed(1)}. Promo máxima (${pct}%) para resucitar la marca.`;
      } else if (cfg.growth_mode && peak >= 0.1 && pctOfPeak < Number(cfg.recovery_target_pct)) {
        // Profundidad proporcional al hueco: muy hundida -> maxPct; cerca del objetivo -> suave
        const gap = (Number(cfg.recovery_target_pct) - pctOfPeak) / Number(cfg.recovery_target_pct);
        pct = Math.max(10, Math.min(prof.maxPct, Math.round(prof.maxPct * Math.min(1, gap * 2))));
        reason = `RECUPERACIÓN: ${row.sales_7d.toFixed(1)} ped/día = ${Math.round(pctOfPeak)}% del pico (${peak.toFixed(1)}). Objetivo ${cfg.recovery_target_pct}%. Promo always-on para ranking.`;
      } else if (!cfg.growth_mode && drop < 0.75 && row.avg_28d >= 3) {
        pct = Math.min(prof.maxPct, drop < 0.5 ? prof.maxPct : 10 + Math.round((0.75 - drop) * 40));
        reason = `Caída de ventas: ${row.sales_7d.toFixed(0)}/día vs media ${row.avg_28d.toFixed(0)} (${Math.round(drop * 100)}%)`;
      }
      if (pct > 0 && prof.proactive && (events ?? []).some(e => e.demand_effect === "up")) {
        pct = Math.min(prof.maxPct, pct + 5);
        reason += ` + evento demanda-up: ${(events ?? []).filter(e => e.demand_effect === "up").map(e => e.name).join(", ")}`;
      } else if (pct === 0 && prof.proactive && (events ?? []).some(e => e.demand_effect === "up")) {
        pct = Math.min(10, prof.maxPct);
        reason = `Evento con demanda al alza: ${(events ?? []).filter(e => e.demand_effect === "up").map(e => e.name).join(", ")}`;
      }
      if (pct === 0) continue;

      const channelId = chanByName.get(row.channel_name);
      if (!channelId) continue;

      // ── 3. GUARDARRAÍL DE MARGEN: preview real; platos bajo suelo se EXCLUYEN del alcance
      const { data: impact } = await supa.rpc("preview_platform_promo_impact", {
        p_account_id: accountId, p_channel_id: channelId,
        p_brand_ids: [brand.id], p_discount_type: "percent",
        p_discount_value: pct, p_menu_item_ids: null,
        p_margin_floor_pct: cfg.margin_floor_pct,
      });
      const ok = (impact ?? []).filter((r: any) => r.status === "ok");
      const under = (impact ?? []).filter((r: any) => r.status === "bajo_suelo");
      if (ok.length === 0) {
        decisions.push({ brand: brand.name, channel: row.channel_name, pct, reason,
          verdict: "DESCARTADA: ningún plato aguanta el suelo", under: under.length });
        continue;
      }
      const scopeItems = under.length > 0 ? ok.map((r: any) => r.menu_item_id) : null; // null = toda la carta

      // ── 4. CREAR la campaña (Shop auto / plataforma propuesta)
      const isShop = row.channel_name === "Shop";
      const mode = isShop ? cfg.shop_mode : cfg.platform_mode;
      if (mode === "off") continue;
      const autoPublish = isShop && mode === "auto";
      const endDays = Math.min(cfg.max_campaign_days, 7);

      const { data: coupon, error } = await supa.from("coupon").insert({
        account_id: accountId,
        code: `AGENT-${chKey.toUpperCase()}-${Date.now().toString(36)}`,
        name: `[Agente] ${pct}% ${brand.name} · ${row.channel_name}`,
        discount_type: "percent", value: pct,
        applies_to: "subtotal",
        channels: [chKey],
        scope: { brand_ids: [brand.id], menu_item_ids: scopeItems },
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + endDays * 864e5).toISOString(),
        active: autoPublish,
        origin: "agent",
        omnibus_ref_note: `Agente ${new Date().toISOString().slice(0, 10)}: ${reason}`,
      }).select("id").single();

      if (error) { decisions.push({ brand: brand.name, error: error.message }); continue; }
      created++; newCount++;
      busy.add(`${chKey}:${brand.id}`);
      decisions.push({
        brand: brand.name, channel: row.channel_name, pct, reason,
        verdict: autoPublish ? "PUBLICADA (Shop auto)" : "PROPUESTA (pendiente de aprobación)",
        excluded_under_floor: under.map((r: any) => r.item_name),
        coupon_id: coupon?.id,
      });
    }

    // ── 5. Log auditable de la corrida
    await supa.from("agent_run_log").insert({
      account_id: accountId, signals, decisions, campaigns_created: created,
    });
  }

  return new Response(JSON.stringify({ ok: true, created, decisions }), {
    headers: { "content-type": "application/json" },
  });
});
