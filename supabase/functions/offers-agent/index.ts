// offers-agent — El agente de ofertas de Folvy (motor de reglas determinista y auditable)
// v2.0 (06/07/2026) — COBERTURA TOTAL + INTENSIDAD INTELIGENTE (decisión Julio):
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
// Plataformas donde el agente PROPONE campañas (Glovo con robot; Uber pendiente = manual).
const PROPOSABLE_PLATFORMS = ["Glovo", "Uber"];

// Suelo de visibilidad (múltiplos de 5): mantener el mínimo para no perder ranking.
const MAINT_FLOOR = 5;
const ABS_FLOOR = 5;
// Cupo por canal y ronda: alto para lograr cobertura total (el 'busy' evita duplicar).
const COVERAGE_CAP = 60;

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

    // ── 3. OPORTUNIDADES por marca×canal×local — COBERTURA TOTAL (todas tienen oferta)
    const opps: Opp[] = [];
    for (const row of (sales ?? []) as Array<any>) {
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
      const pctOfTarget = hasTarget ? (s7 / target) * 100 : 100; // sin objetivo → tratar como "va bien"

      let pct = 0; let reason = ""; let urgent = false; let gap = 0;

      if (hasTarget && s7 < 0.15) {
        // ARTILLERÍA: objetivo y ventas a cero.
        pct = prof.maxPct; urgent = true; gap = 1;
        reason = `URGENTE ${locShort}: ${s7.toFixed(1)} ped/día con objetivo ${target}. ` +
          (peak > 0 ? `(pico histórico ${peak.toFixed(1)}) ` : `(sin historia — lanzamiento) `) +
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

      opps.push({ row, brand, chKey, channelId: channelId as string, pct, reason, urgent, gap });
    }

    // ── 4. PRIORIZAR: urgentes primero, luego mayor hueco, luego mayor %
    opps.sort((a, b) =>
      (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || b.gap - a.gap || b.pct - a.pct);

    // ── 5. CREAR con cobertura + bebidas fuera + guardarraíl de margen
    const usedByChannel = new Map<string, number>();
    const previewCache = new Map<string, { ok: any[]; under: any[]; baseIds: string[] | null; bannedCount: number }>();
    for (const o of opps) {
      const used = usedByChannel.get(o.chKey) ?? 0;
      if (used >= COVERAGE_CAP) continue;

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
      const armed = ARMED_PLATFORMS.includes(o.row.channel_name);
      const endDays = Math.min(cfg.max_campaign_days, 7);
      const locShort = String(o.row.location_name ?? "").replace(/^Foodint\s+/i, "");

      const kind = "standard";
      const name = `[Agente] ${o.pct}% ${o.brand.name} · ${o.row.channel_name} · ${locShort}`;
      const value = o.pct;
      const scopeFinal: Record<string, unknown> = {
        brand_ids: [o.brand.id], menu_item_ids: scopeItems, location_ids: [o.row.location_id],
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
      created++;
      usedByChannel.set(o.chKey, used + 1);
      busy.add(`${o.chKey}:${o.brand.id}:${o.row.location_id}`);
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
