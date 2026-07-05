// offers-agent — El agente de ofertas de Folvy (motor de reglas determinista y auditable)
// v1.2 (05/07/2026):
//   (e) BEBIDAS NUNCA EN PROMO (decisión Julio 05/07): las categorías cuyo nombre contiene
//       'bebida' se excluyen del alcance ANTES del guardarraíl — descontar bebida es
//       destruir margen sin tirón; la bebida es donde se recupera. De regalo: desaparecen
//       los fallos de mapeo de nombres del robot (eran precisamente las bebidas).
//   (f) % SIEMPRE EN MÚLTIPLOS DE 5: el robot ya ajustaba al chip de Glovo hacia abajo;
//       ahora el agente propone directamente en múltiplos de 5 → pantalla = Glovo.
// v1.1 (05/07/2026):
//   (a) solo propone en plataformas CON BRAZO publicador (ARMED_PLATFORMS) — antes proponía
//       en Uber sin nadie que publicara, quemando cupos y apilando propuestas inaccionables;
//   (b) PRIORIZA oportunidades (reactivación urgente > mayor hueco > mayor %) antes de gastar cupos
//       — antes recorría las señales en el orden arbitrario de la RPC y Uber dejaba a Glovo sin turno;
//   (c) cupo maxNew POR CANAL (antes global);
//   (d) higiene por corrida: desactiva campañas del agente ya caducadas (zombis del tablero)
//       y caduca propuestas pendientes >48h sin respuesta (dejan de bloquear el relevo).
// Corre cada hora vía pg_cron (job 'offers-agent-hourly') -> net.http_post con secreto del Vault.
// Decide con margen REAL (RPC preview_platform_promo_impact) y guardarraíles duros.
// Shop: publica solo (shop_mode=auto). Plataformas: crea PROPUESTAS (origin='agent', active=false).
// REGLA INNEGOCIABLE: marcas cedidas (ownership_type='licensed') JAMÁS en campañas de plataforma.
// DESPLIEGUE: SIEMPRE --no-verify-jwt (lo llama pg_cron SIN JWT; la frontera es x-agent-secret).

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

// Plataformas con brazo publicador VIVO. Añadir "Uber" cuando Partner Engineering apruebe
// los scopes eats.store.promotion.* (brazo por API oficial, OpenAPI ya en el repo).
// Todo canal distinto de "Shop" se considera plataforma: sin brazo, ni se evalúa.
const ARMED_PLATFORMS = ["Glovo"];

// Categorías de carta VETADAS en promos del agente (match por 'contiene', case-insensitive).
// Cubre "Bebidas" / "BEBIDAS" / "Nuestras Bebidas" (RECON 05/07: 99 items en 17 marcas).
// Para vetar también postres algún día: añadir /postre/i.
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

  // ── 0. Config de cada cuenta con agente encendido
  const { data: configs } = await supa.from("offers_agent_config").select("*").eq("enabled", true);
  for (const cfg of configs ?? []) {
    const accountId = cfg.account_id as string;
    const prof = PROFILES[cfg.aggressiveness] ?? PROFILES.medium;
    const nowIso = new Date().toISOString();
    const signals: Record<string, unknown> = { armed_platforms: ARMED_PLATFORMS };
    const decisions: Array<Record<string, unknown>> = [];
    let created = 0; // v1.1: contador POR CUENTA (en v1 acumulaba entre cuentas)

    // ── 1. HIGIENE de la corrida
    // 1a. Campañas del agente ya caducadas -> active=false (el ends_at ya mandaba en el cobro;
    //     esto limpia el tablero de Ofertas de zombis).
    await supa.from("coupon").update({ active: false })
      .eq("account_id", accountId).eq("origin", "agent")
      .eq("active", true).lt("ends_at", nowIso);
    // 1b. Propuestas pendientes >48h sin respuesta -> caducan (ends_at=ahora, NO se borran:
    //     quedan auditables como "expiradas") y dejan de bloquear el relevo de su marca×canal.
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

    // Ventas 7d vs media 28d vs pico histórico por marca×canal
    const { data: sales } = await supa.rpc("agent_sales_signal", { p_account_id: accountId });
    signals.sales = sales;

    // Eventos activos o próximos (7 días vista)
    const { data: events } = await supa.from("local_event")
      .select("name,event_type,starts_at,ends_at,demand_effect")
      .eq("account_id", accountId)
      .gte("ends_at", nowIso)
      .lte("starts_at", new Date(Date.now() + 7 * 864e5).toISOString());
    signals.events = events;
    const eventUp = (events ?? []).some(e => e.demand_effect === "up");
    const eventUpNames = (events ?? []).filter(e => e.demand_effect === "up").map(e => e.name).join(", ");

    // Campañas recientes (cooldown + 1-activa-por-marca-canal)
    const { data: recent } = await supa.from("coupon")
      .select("id,name,channels,scope,active,created_at,ends_at")
      .eq("account_id", accountId)
      .gte("created_at", new Date(Date.now() - prof.cooldownDays * 864e5).toISOString());
    // busy = campaña VIVA (activa sin expirar) o propuesta PENDIENTE (inactiva sin expirar).
    // Las expiradas NO bloquean (always-on: al caducar una, entra la siguiente).
    const busy = new Set<string>();
    for (const c of recent ?? []) {
      const notExpired = !c.ends_at || c.ends_at > nowIso;
      const alive = c.active === true && notExpired;
      const pending = c.active === false && notExpired;
      if (!alive && !pending) continue;
      const bids: string[] = (c as any).scope?.brand_ids ?? [];
      for (const ch of (c.channels ?? []) as string[]) for (const b of bids) busy.add(`${ch}:${b}`);
    }

    // ── 3. OPORTUNIDADES (calcular TODAS antes de crear nada)
    const opps: Opp[] = [];
    for (const row of (sales ?? []) as Array<any>) {
      const brand = (brands ?? []).find(b => b.id === row.brand_id);
      if (!brand) continue;

      const isPlatform = row.channel_name !== "Shop";
      if (isPlatform && !ARMED_PLATFORMS.includes(row.channel_name)) continue; // (a) sin brazo
      if (isPlatform && brand.ownership_type === "licensed") continue;         // GUARDARRAÍL cedidas
      const chKey = row.channel_name.toLowerCase();
      if (busy.has(`${chKey}:${brand.id}`)) continue;                          // viva o pendiente

      const channelId = chanByName.get(row.channel_name);
      if (!channelId) continue;

      // R-RECOVERY (growth_mode, la regla PRINCIPAL): marca por debajo del objetivo de
      // recuperación respecto a su PICO histórico -> promo always-on. El algoritmo de la
      // plataforma premia tener promo activa: en recuperación la promo es presencia.
      // R1 — caída vs media 28d (cuentas sin growth_mode). R2 — evento demanda-up.
      const drop = row.avg_28d > 0 ? row.sales_7d / row.avg_28d : 1;
      let pct = 0; let reason = ""; let urgent = false; let gap = 0;
      const peak = Number(row.peak_daily ?? 0);
      const pctOfPeak = peak > 0 ? (row.sales_7d / peak) * 100 : 100;

      if (cfg.growth_mode && peak >= 0.1 && row.sales_7d < 0.15) {
        // REACTIVACIÓN URGENTE: la marca existió (hay pico) y hoy está a CERO.
        pct = prof.maxPct; urgent = true; gap = 1;
        reason = `REACTIVACIÓN URGENTE: ${row.sales_7d.toFixed(1)} ped/día con pico histórico de ${peak.toFixed(1)}. Promo máxima (${pct}%) para resucitar la marca.`;
      } else if (cfg.growth_mode && peak >= 0.1 && pctOfPeak < Number(cfg.recovery_target_pct)) {
        gap = (Number(cfg.recovery_target_pct) - pctOfPeak) / Number(cfg.recovery_target_pct);
        pct = Math.max(10, Math.min(prof.maxPct, Math.round(prof.maxPct * Math.min(1, gap * 2))));
        reason = `RECUPERACIÓN: ${row.sales_7d.toFixed(1)} ped/día = ${Math.round(pctOfPeak)}% del pico (${peak.toFixed(1)}). Objetivo ${cfg.recovery_target_pct}%. Promo always-on para ranking.`;
      } else if (!cfg.growth_mode && drop < 0.75 && row.avg_28d >= 3) {
        gap = 1 - drop;
        pct = Math.min(prof.maxPct, drop < 0.5 ? prof.maxPct : 10 + Math.round((0.75 - drop) * 40));
        reason = `Caída de ventas: ${row.sales_7d.toFixed(0)}/día vs media ${row.avg_28d.toFixed(0)} (${Math.round(drop * 100)}%)`;
      }
      if (pct > 0 && prof.proactive && eventUp) {
        pct = Math.min(prof.maxPct, pct + 5);
        reason += ` + evento demanda-up: ${eventUpNames}`;
      } else if (pct === 0 && prof.proactive && eventUp) {
        pct = Math.min(10, prof.maxPct); gap = 0.1;
        reason = `Evento con demanda al alza: ${eventUpNames}`;
      }
      if (pct === 0) continue;
      // (f) múltiplos de 5: lo que la pantalla enseña = lo que Glovo publica (chips 10..60)
      pct = Math.max(10, Math.min(prof.maxPct, Math.round(pct / 5) * 5));

      opps.push({ row, brand, chKey, channelId: channelId as string, pct, reason, urgent, gap });
    }

    // ── 4. PRIORIZAR: urgentes primero, luego mayor hueco, luego mayor %
    opps.sort((a, b) =>
      (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || b.gap - a.gap || b.pct - a.pct);

    // ── 5. CREAR con cupo POR CANAL + guardarraíl de margen
    const usedByChannel = new Map<string, number>();
    for (const o of opps) {
      const used = usedByChannel.get(o.chKey) ?? 0;
      if (used >= prof.maxNew) continue; // (c) cupo por canal, no global

      // (e) BEBIDAS FUERA del alcance ANTES del guardarraíl (categorías vetadas)
      const { data: items } = await supa.from("menu_item")
        .select("id, menu_category:menu_category_id(name)")
        .eq("account_id", accountId).eq("brand_id", o.brand.id)
        .is("archived_at", null);
      const banned = (items ?? []).filter((it: any) =>
        EXCLUDED_CATEGORY_PATTERNS.some(rx => rx.test(it.menu_category?.name ?? "")));
      const baseIds = banned.length > 0
        ? (items ?? []).filter((it: any) => !banned.some((b: any) => b.id === it.id)).map((it: any) => it.id)
        : null; // null = toda la carta (la marca no tiene categorías vetadas)
      if (baseIds !== null && baseIds.length === 0) {
        decisions.push({ brand: o.brand.name, channel: o.row.channel_name, pct: o.pct, reason: o.reason,
          verdict: "DESCARTADA: la carta solo tiene categorías vetadas (bebidas)" });
        continue;
      }
      if (banned.length > 0) decisions.push({ brand: o.brand.name, note: `bebidas excluidas del alcance: ${banned.length} items` });

      // GUARDARRAÍL DE MARGEN: preview real; platos bajo suelo se EXCLUYEN del alcance
      const { data: impact } = await supa.rpc("preview_platform_promo_impact", {
        p_account_id: accountId, p_channel_id: o.channelId,
        p_brand_ids: [o.brand.id], p_discount_type: "percent",
        p_discount_value: o.pct, p_menu_item_ids: baseIds,
        p_margin_floor_pct: cfg.margin_floor_pct,
      });
      const ok = (impact ?? []).filter((r: any) => r.status === "ok");
      const under = (impact ?? []).filter((r: any) => r.status === "bajo_suelo");
      if (ok.length === 0) {
        decisions.push({ brand: o.brand.name, channel: o.row.channel_name, pct: o.pct, reason: o.reason,
          verdict: "DESCARTADA: ningún plato aguanta el suelo", under: under.length });
        continue;
      }
      // alcance final: si hay bajo-suelo O hay bebidas vetadas, lista explícita; si no, toda la carta
      const scopeItems = (under.length > 0 || baseIds !== null) ? ok.map((r: any) => r.menu_item_id) : null;

      // Shop auto / plataforma propuesta
      const isShop = o.row.channel_name === "Shop";
      const mode = isShop ? cfg.shop_mode : cfg.platform_mode;
      if (mode === "off") continue;
      const autoPublish = isShop && mode === "auto";
      const endDays = Math.min(cfg.max_campaign_days, 7);

      const { data: coupon, error } = await supa.from("coupon").insert({
        account_id: accountId,
        code: `AGENT-${o.chKey.toUpperCase()}-${Date.now().toString(36)}`,
        name: `[Agente] ${o.pct}% ${o.brand.name} · ${o.row.channel_name}`,
        discount_type: "percent", value: o.pct,
        applies_to: "subtotal",
        channels: [o.chKey],
        scope: { brand_ids: [o.brand.id], menu_item_ids: scopeItems },
        starts_at: nowIso,
        ends_at: new Date(Date.now() + endDays * 864e5).toISOString(),
        active: autoPublish,
        origin: "agent",
        omnibus_ref_note: `Agente ${nowIso.slice(0, 10)}: ${o.reason}`,
      }).select("id").single();

      if (error) { decisions.push({ brand: o.brand.name, error: error.message }); continue; }
      created++;
      usedByChannel.set(o.chKey, used + 1);
      busy.add(`${o.chKey}:${o.brand.id}`);
      decisions.push({
        brand: o.brand.name, channel: o.row.channel_name, pct: o.pct, reason: o.reason,
        verdict: autoPublish ? "PUBLICADA (Shop auto)" : "PROPUESTA (pendiente de aprobación)",
        excluded_under_floor: under.map((r: any) => r.item_name),
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
