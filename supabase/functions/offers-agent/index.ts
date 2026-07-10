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

// Bandas de % del Shop por ESTADO (v3 · 3a). El agente ROTA dentro de la banda por
// marca+día → variedad entre marcas y cambio diario, pero SIEMPRE dentro de la
// estrategia (nunca "todo 30 plano"). El margen 45% recorta después si no aguanta.
//   lanzamiento = marca fuerte (vende en plataforma) con storefront nuevo → base
//   moderada que deja hueco a la Happy Hour. urgente = a cero en todo → artillería.
const SHOP_BANDS: Record<string, number[]> = {
  lanzamiento:   [25, 20, 15],
  urgente:       [30, 25],
  crecimiento:   [25, 20, 15],
  mantenimiento: [20, 15, 10],
};
// Tope de la Happy Hour: puede ir por ENCIMA del maxPct del perfil (es un empujón
// puntual del valle), siempre gateado por el margen. El agente decide el incremento
// (el % más profundo que aguante, por encima de la base).
const HH_MAX = 40;

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

  // Día del año (hora UTC) para la rotación diaria determinista del Shop.
  const _now = new Date();
  const dayOfYear = Math.floor(
    (Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), _now.getUTCDate()) - Date.UTC(_now.getUTCFullYear(), 0, 1)) / 864e5);
  // % del día para una marca: rota dentro de la banda del estado por marca+fecha.
  // Marcas distintas → índice distinto el mismo día; misma marca → cambia día a día.
  const brandDayPct = (brandId: string, band: number[]): number => {
    let hash = 0;
    for (let i = 0; i < brandId.length; i++) hash = (hash * 31 + brandId.charCodeAt(i)) & 0x7fffffff;
    return band[(hash + dayOfYear) % band.length];
  };

  const { data: configs } = await supa.from("offers_agent_config").select("*").eq("enabled", true);
  for (const cfg of configs ?? []) {
    const accountId = cfg.account_id as string;

    // ── REGLAS del Shop (v3 · paso 4): "automático pero con reglas". El agente lee
    //    offers_agent_config.shop_rules (jsonb). Estructura: { default:{bands,happy_hour,gift},
    //    brands:{ <brand_id>:{...override...} } }. Donde hay regla se respeta; donde no,
    //    los defaults de hoy. El suelo de margen 45% es INTOCABLE por encima de cualquier regla.
    const rules = (cfg.shop_rules ?? {}) as any;
    const rDefault = (rules.default ?? {}) as any;
    const rBrands = (rules.brands ?? {}) as any;
    const bandsFor = (brandId: string, state: string): number[] => {
      const b = rBrands[brandId]?.bands?.[state] ?? rDefault.bands?.[state] ?? SHOP_BANDS[state] ?? SHOP_BANDS.mantenimiento;
      return Array.isArray(b) && b.length > 0 ? b : (SHOP_BANDS[state] ?? SHOP_BANDS.mantenimiento);
    };
    const hhFor = (brandId: string) => ({
      enabled: rBrands[brandId]?.happy_hour?.enabled ?? rDefault.happy_hour?.enabled ?? true,
      maxPct:  Number(rBrands[brandId]?.happy_hour?.max_pct ?? rDefault.happy_hour?.max_pct ?? HH_MAX),
    });
    const giftFor = (brandId: string) => ({
      enabled:  rBrands[brandId]?.gift?.enabled ?? rDefault.gift?.enabled ?? true,
      minFloor: Number(rBrands[brandId]?.gift?.min_floor ?? rDefault.gift?.min_floor ?? 12),
      minCap:   Number(rBrands[brandId]?.gift?.min_cap ?? rDefault.gift?.min_cap ?? 30),
    });
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

    // Rotación diaria del Shop (v3 · 3a): retira las propuestas de Shop del agente de
    // días anteriores para presentar una tanda fresca cada día (se acabó el borrado manual).
    await supa.rpc("retire_stale_agent_shop_offers", { p_account_id: accountId });

    // ── 2. SEÑALES
    const { data: brands } = await supa.from("brand")
      .select("id,name,ownership_type").eq("account_id", accountId).eq("is_active", true);

    const { data: channels } = await supa.from("sales_channel")
      .select("id,name").eq("account_id", accountId);
    const chanByName = new Map((channels ?? []).map(c => [c.name, c.id]));

    const { data: sales } = await supa.rpc("agent_sales_signal_v2", { p_account_id: accountId });
    signals.sales = sales;

    const { data: events } = await supa.from("local_event")
      .select("name,event_type,starts_at,ends_at,demand_effect,location_id")
      .eq("account_id", accountId)
      .gte("ends_at", nowIso)
      .lte("starts_at", new Date(Date.now() + 7 * 864e5).toISOString());
    signals.events = events;
    // Eventos demanda-up separados por alcance (frente #3): los de CUENTA (location_id null)
    // aplican a todo; los de LOCAL solo a su local. Un partido en Madrid ya no empuja el
    // local de otra ciudad.
    const acctUpNames = (events ?? []).filter(e => e.demand_effect === "up" && !e.location_id).map(e => e.name);
    const eventUpByLoc = new Map<string, string[]>();
    for (const e of (events ?? []) as Array<any>) {
      if (e.demand_effect === "up" && e.location_id) {
        const arr = eventUpByLoc.get(e.location_id) ?? [];
        arr.push(e.name); eventUpByLoc.set(e.location_id, arr);
      }
    }

    const { data: dowRows } = await supa.rpc("agent_dow_signal", { p_account_id: accountId });
    const dowMap = new Map<string, Map<number, number>>();
    for (const r of (dowRows ?? []) as Array<any>) {
      const k = `${r.brand_id}:${r.channel_name}`;
      if (!dowMap.has(k)) dowMap.set(k, new Map());
      dowMap.get(k)!.set(Number(r.dow), Number(r.pct_share));
    }
    // Aprendizaje transversal (frente #2): uplift por marca×canal×MECÁNICA (4 canales).
    // Jubila agent_learning_signal + la lógica parcial de Shop → una sola verdad.
    const { data: mechRows } = await supa.rpc("agent_mechanic_signal", { p_account_id: accountId });
    const mechMap = new Map<string, any>();      // clave brand:channel:mechanic
    const learnMap = new Map<string, any>();     // clave brand:channel = mecánica 'pct' (compat con el ajuste de %)
    for (const r of (mechRows ?? []) as Array<any>) {
      mechMap.set(`${r.brand_id}:${r.channel_name}:${r.mechanic}`, r);
      if (r.mechanic === "pct") learnMap.set(`${r.brand_id}:${r.channel_name}`, r);
    }
    signals.learning = mechRows;
    // Rotación PONDERADA de mecánica: rota por marca+día entre las viables, pesando hacia la
    // de mayor uplift medido (≥2 medidas). Sin datos → rotación equilibrada ("rotar", Julio).
    const pickMechanic = (brandId: string, channel: string, viable: string[]): string => {
      if (viable.length <= 1) return viable[0] ?? "pct";
      const bag: string[] = [];
      for (const m of viable) {
        const e = mechMap.get(`${brandId}:${channel}:${m}`);
        const up = e && Number(e.n_medidas) >= 2 ? Number(e.uplift_medio ?? 0) : 0;
        const w = Math.max(1, 1 + Math.round(Math.max(0, up) / 10));   // peso: 1 + uplift/10
        for (let k = 0; k < w; k++) bag.push(m);
      }
      let hash = 0;
      for (let i = 0; i < brandId.length; i++) hash = (hash * 31 + brandId.charCodeAt(i)) & 0x7fffffff;
      return bag[(hash + dayOfYear) % bag.length];
    };

    // Señal horaria (v3 · pieza 2): valle de la tarde por marca → Happy Hour en Shop.
    const { data: hourlyRows } = await supa.rpc("agent_hourly_signal", { p_account_id: accountId });
    const hourlyMap = new Map<string, any>();
    for (const r of (hourlyRows ?? []) as Array<any>) hourlyMap.set(r.brand_id, r);
    signals.hourly = hourlyRows;

    // Señal del regalo (v3 · 3b): plato más barato de regalar + food-cost-ratio real por
    // marca → el agente calcula el mínimo que mantiene el margen tras regalar.
    const { data: giftRows } = await supa.rpc("agent_gift_signal", { p_account_id: accountId });
    const giftMap = new Map<string, any>();
    for (const r of (giftRows ?? []) as Array<any>) giftMap.set(r.brand_id, r);
    signals.gift = giftRows;

    const jsDow = new Date().getDay();
    const isoToday = jsDow === 0 ? 7 : jsDow;
    const nextDows = [0, 1, 2].map(o => ((isoToday - 1 + o) % 7) + 1);
    const DOW_NAMES = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    const nextDowTxt = nextDows.map(d => DOW_NAMES[d]).join("-");

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

    // Ventas de plataforma por marca (7d): una marca que vende en plataforma pero con
    // Shop a cero = LANZAMIENTO de storefront (no urgencia ciega) → base moderada + HH.
    const platformS7ByBrand = new Map<string, number>();
    for (const row of (sales ?? []) as Array<any>) {
      if (row.channel_name === "Shop") continue;
      platformS7ByBrand.set(row.brand_id, (platformS7ByBrand.get(row.brand_id) ?? 0) + Number(row.sales_7d ?? 0));
    }

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

      // SHOP · rotación diaria de % (v3 · 3a): reemplaza el pct fijo por uno que ROTA
      // por marca+día dentro de la banda del estado (variedad entre marcas, cambio a
      // diario). Marca fuerte en plataforma con Shop a cero = LANZAMIENTO (base moderada
      // que deja hueco a la Happy Hour), no artillería ciega. El evento/DOW/aprendizaje
      // y el guardarraíl de margen ajustan encima.
      if (!isPlatform) {
        const platS7 = platformS7ByBrand.get(row.brand_id) ?? 0;
        const shopState = platS7 >= 5 ? "lanzamiento" : "urgente";
        const band = bandsFor(row.brand_id, shopState);
        pct = brandDayPct(row.brand_id, band);
        urgent = shopState === "urgente";
        gap = urgent ? 1 : 0.5;
        reason = `${shopState === "lanzamiento" ? "LANZAMIENTO" : "URGENTE"} ${brand.name} (Shop): ${pct}% del día ` +
          `(rota por marca y fecha en banda ${band.join("/")}%; storefront ${platS7 >= 5 ? "nuevo de marca con ventas en plataforma" : "sin ventas en ningún canal"}).`;
      }

      // Evento demanda-up (frente #3, por LOCAL): los de cuenta aplican a todo; los de
      // local, solo a su local. El Shop es per-marca (multi-local) → aplica si hay evento
      // de cuenta o en cualquier local (su storefront sirve a todas las zonas).
      const locEvNames = isPlatform ? (eventUpByLoc.get(o.row.location_id) ?? []) : [...new Set(([] as string[]).concat(...eventUpByLoc.values()))];
      const evNames = [...acctUpNames, ...locEvNames];
      if (prof.proactive && evNames.length > 0) {
        pct = Math.min(prof.maxPct, pct + 5);
        reason += ` + evento demanda-up: ${evNames.join(", ")}`;
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
      let scopeItems = (pv.under.length > 0 || baseInfo.baseIds !== null) ? pv.ok.map((r: any) => r.menu_item_id) : null;

      const isShop = o.row.channel_name === "Shop";
      const mode = isShop ? cfg.shop_mode : cfg.platform_mode;
      if (mode === "off") continue;
      const autoPublish = isShop && mode === "auto";
      const armed = ARMED_PLATFORMS.includes(o.row.channel_name);
      const endDays = Math.min(cfg.max_campaign_days, 7);
      const locShort = String(o.row.location_name ?? "").replace(/^Foodint\s+/i, "");

      const kind = o.kind;
      const isItemPct = kind === "item_percent";

      // ── JUGADA A/B (v3 · 3b): si la marca puede permitirse REGALO, se baja a un %
      //    MODERADO que deja sitio al regalo (acumulable) y esa marca NO lleva Happy Hour
      //    (el regalo es su gancho; así no se acumulan descuentos que revienten el 45%).
      //    Si no cabe regalo → jugada A (% fuerte + Happy Hour), como estaba.
      let giftPlay = false, giftBasePct = 0, giftMin = 0, giftInfo: any = null;
      if (isShop && isItemPct) {
        const gr = giftFor(o.brand.id);
        const gi = gr.enabled ? giftMap.get(o.brand.id) : null;
        const fcr = gi ? Number(gi.fcr) : NaN;
        if (gi && gi.gift_item_id && Number.isFinite(fcr) && fcr > 0) {
          const floorR = Number(cfg.margin_floor_pct) / 100;
          for (const cand of [20, 15, 10, 5]) {
            if (cand > o.pct) continue;                                // no subir sobre el % ya elegido
            const denom = (1 - cand / 100) * (1 - floorR) - fcr;
            if (denom > 0) {
              let m = Math.ceil(Number(gi.gift_cost) / denom);
              if (m < gr.minFloor) m = gr.minFloor;                    // mínimo razonable (solo mejora margen)
              if (m <= gr.minCap) { giftPlay = true; giftBasePct = cand; giftMin = m; giftInfo = gi; break; }
            }
          }
        }
      }

      // ── ELECCIÓN DE MECÁNICA (frente #2, rotación ponderada): si la marca puede hacer
      //    REGALO (jugada B) Y tiene valle para HAPPY HOUR (jugada A), el agente rota entre
      //    ambas pesando por lo que mejor ha funcionado (uplift medido). Si solo una es
      //    viable, esa. Sin datos → rotación equilibrada por marca+día.
      if (giftPlay) {
        const h = hourlyMap.get(o.brand.id);
        const hhViable = hhFor(o.brand.id).enabled && !!h && Number(h.day_orders ?? 0) >= 30;
        if (hhViable && pickMechanic(o.brand.id, "Shop", ["gift", "happy_hour"]) === "happy_hour") {
          giftPlay = false;   // jugada A: base fuerte + Happy Hour (el agente aprendió/rotó a ella)
        }
      }

      if (giftPlay && giftBasePct !== o.pct) {
        // Recomputar el alcance al % moderado (a menor %, aguantan más platos).
        const gk = `${o.brand.id}:${o.channelId}:${giftBasePct}`;
        let gcand = previewCache.get(gk) as any;
        if (!gcand) {
          const { data: gimp } = await supa.rpc("preview_platform_promo_impact", {
            p_account_id: accountId, p_channel_id: o.channelId, p_brand_ids: [o.brand.id],
            p_discount_type: "percent", p_discount_value: giftBasePct, p_menu_item_ids: baseInfo.baseIds,
            p_margin_floor_pct: cfg.margin_floor_pct,
          });
          gcand = { ok: (gimp ?? []).filter((r: any) => r.status === "ok"), under: (gimp ?? []).filter((r: any) => r.status === "bajo_suelo") };
          previewCache.set(gk, gcand);
        }
        if (gcand.ok.length > 0) {
          o.pct = giftBasePct;
          scopeItems = (gcand.under.length > 0 || baseInfo.baseIds !== null) ? gcand.ok.map((r: any) => r.menu_item_id) : null;
          o.reason += ` · jugada regalo: base moderada ${giftBasePct}% + ${giftInfo.gift_name} gratis desde ${giftMin}€`;
        } else {
          giftPlay = false;  // si al % moderado no aguanta nada, cae a jugada A
        }
      }

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

      // ── HAPPY HOUR (v3 · pieza 2): sobre una base item_percent de Shop, si la marca
      //    tiene un valle fiable y hay margen para ir MÁS profundo que la base, se crea
      //    una 2ª oferta con franja en el valle. Concurrencia resuelta por el motor:
      //    _shop_item_offer elige la de mayor value → en el valle gana la Happy Hour.
      const hhCfg = hhFor(o.brand.id);
      const hv = isItemPct && isShop && !giftPlay && hhCfg.enabled ? hourlyMap.get(o.brand.id) : null;
      const dayOrders = hv ? Number(hv.day_orders ?? 0) : 0;
      if (hv && coupon?.id && dayOrders >= 30 && o.pct < hhCfg.maxPct) {
        // Cascada desde el tope (reglas) hacia abajo: el % más profundo que aguante y > base
        // (la Happy Hour es ADITIVA sobre la base; el agente decide el incremento).
        let hhPct = 0; let hhScope: string[] | null = null;
        for (let t = hhCfg.maxPct; t > o.pct; t -= 5) {
          const ck = `${o.brand.id}:${o.channelId}:${t}`;
          let cand = previewCache.get(ck) as any;
          if (!cand) {
            const { data: impact } = await supa.rpc("preview_platform_promo_impact", {
              p_account_id: accountId, p_channel_id: o.channelId, p_brand_ids: [o.brand.id],
              p_discount_type: "percent", p_discount_value: t, p_menu_item_ids: baseInfo.baseIds,
              p_margin_floor_pct: cfg.margin_floor_pct,
            });
            cand = { ok: (impact ?? []).filter((r: any) => r.status === "ok"),
                     under: (impact ?? []).filter((r: any) => r.status === "bajo_suelo") };
            previewCache.set(ck, cand);
          }
          if (cand.ok.length > 0) {
            hhPct = t;
            hhScope = (cand.under.length > 0 || baseInfo.baseIds !== null) ? cand.ok.map((r: any) => r.menu_item_id) : null;
            break;
          }
        }
        // Aprendizaje: si el histórico de la marca en Shop es malo, contener un escalón.
        const hhLearn = learnMap.get(`${o.brand.id}:Shop`);
        if (hhLearn && Number(hhLearn.uplift_medio ?? 0) < 0 && Number(hhLearn.arranques ?? 0) === 0 && hhPct - 5 > o.pct) hhPct -= 5;

        if (hhPct > o.pct) {
          const vf = `${String(hv.valley_from).padStart(2, "0")}:00`;
          const vt = `${String(hv.valley_to).padStart(2, "0")}:00`;
          const hhReason = `HAPPY HOUR ${o.brand.name}: valle ${vf}-${vt} (${hv.valley_orders} pedidos vs día ${dayOrders}, 60d) → ${hhPct}% en la franja floja para llenarla.`;
          const { data: hhC, error: hhErr } = await supa.from("coupon").insert({
            account_id: accountId,
            code: `AGENT-SHOP-HH-${o.brand.id.slice(0, 8)}-${Date.now().toString(36)}`,
            name: `[Agente] Happy Hour ${hhPct}% carta ${o.brand.name} · Shop · ${vf}-${vt}`,
            discount_type: "percent", value: hhPct, applies_to: "subtotal",
            channels: ["shop"], kind: "item_percent",
            scope: { brand_ids: [o.brand.id], menu_item_ids: hhScope, location_ids: null },
            time_from: vf, time_to: vt,
            starts_at: nowIso, ends_at: new Date(Date.now() + endDays * 864e5).toISOString(),
            active: autoPublish, origin: "agent",
            omnibus_ref_note: `Agente ${nowIso.slice(0, 10)}: ${hhReason}`,
          }).select("id").single();
          if (!hhErr && hhC?.id) {
            const hhRows = (hhScope && hhScope.length > 0)
              ? hhScope.map((iid) => ({ coupon_id: hhC.id, menu_item_id: iid }))
              : [{ coupon_id: hhC.id, brand_id: o.brand.id }];
            await supa.from("campaign_scope").insert(hhRows);
            created++;
            decisions.push({
              brand: o.brand.name, channel: "Shop", location: "Shop",
              kind: "item_percent", pct: hhPct, franja: `${vf}-${vt}`, reason: hhReason,
              verdict: autoPublish ? "PUBLICADA (Shop auto · Happy Hour)" : "PROPUESTA (Happy Hour)",
              coupon_id: hhC.id,
            });
          } else if (hhErr) {
            decisions.push({ brand: o.brand.name, warn: `happy_hour: ${hhErr.message}` });
          }
        }
      }

      // ── PLATO DE REGALO (v3 · 3b): se crea si la marca entró en JUGADA B (base moderada
      //    con hueco para el regalo). El margen ≥ suelo ya está garantizado por el cálculo
      //    del mínimo. Reglas de BD: free_item con code=null, value>0 y auto_apply=true.
      if (giftPlay && coupon?.id && giftInfo) {
        const giftReason = `REGALO ${o.brand.name}: ${giftInfo.gift_name} gratis desde ${giftMin}€ (acumulable al ${o.pct}% de carta). Coste regalo ${Number(giftInfo.gift_cost).toFixed(2)}€; margen ≥ ${cfg.margin_floor_pct}% garantizado.`;
        const { data: giftC, error: giftErr } = await supa.from("coupon").insert({
          account_id: accountId,
          code: null,
          name: `[Agente] Regalo ${giftInfo.gift_name} · ${o.brand.name} · Shop · desde ${giftMin}€`,
          discount_type: "fixed", value: 1,
          applies_to: "subtotal",
          channels: ["shop"], kind: "free_item",
          auto_apply: true,
          min_subtotal: giftMin,
          scope: { brand_ids: [o.brand.id], location_ids: null },
          starts_at: nowIso, ends_at: new Date(Date.now() + endDays * 864e5).toISOString(),
          active: autoPublish, origin: "agent",
          omnibus_ref_note: `Agente ${nowIso.slice(0, 10)}: ${giftReason}`,
        }).select("id").single();
        if (!giftErr && giftC?.id) {
          await supa.from("campaign_scope").insert([{ coupon_id: giftC.id, menu_item_id: giftInfo.gift_item_id }]);
          created++;
          decisions.push({
            brand: o.brand.name, channel: "Shop", location: "Shop",
            kind: "free_item", min_subtotal: giftMin, gift: giftInfo.gift_name, reason: giftReason,
            verdict: autoPublish ? "PUBLICADA (Shop auto · regalo)" : "PROPUESTA (regalo)",
            coupon_id: giftC.id,
          });
        } else if (giftErr) {
          decisions.push({ brand: o.brand.name, warn: `gift: ${giftErr.message}` });
        }
      }
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
