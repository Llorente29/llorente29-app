// weather-events — El meteorólogo del agente de ofertas (v2.1 T2, 05/07/2026).
// Corre UNA vez al día de madrugada (pg_cron 'weather-events-daily') y siembra
// local_event con demand_effect='up' cuando el pronóstico de HOY empuja el delivery:
//   · LLUVIA: probabilidad máxima de precipitación >= 60%
//   · CALOR EXTREMO: máxima >= 35°C
// La regla de eventos del agente EXISTE desde v1 (evento demand-up => +5% o promo suave);
// esta Edge es quien por fin la alimenta. Cero falsas alarmas: si el día es normal, silencio.
// Fuente: Open-Meteo (api.open-meteo.com, pública, sin API key => cero secretos nuevos).
// Coordenadas: locations.lat/lng (ya pobladas por el fichaje GPS — RECON 05/07).
// IDEMPOTENTE: un solo evento meteorológico por cuenta y día (event_type='weather');
// si ya existe el de hoy, no se duplica aunque el cron corra dos veces.
// DESPLIEGUE: SIEMPRE --no-verify-jwt (lo llama pg_cron sin JWT; frontera = x-agent-secret).

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("OFFERS_AGENT_SECRET")!;
const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const RAIN_PROB_MIN = 60;   // % probabilidad de precipitación
const HEAT_MAX_MIN = 35;    // °C máxima

Deno.serve(async (req) => {
  if (req.headers.get("x-agent-secret") !== AGENT_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const today = new Date().toISOString().slice(0, 10);
  const out: Array<Record<string, unknown>> = [];

  const { data: configs } = await supa.from("offers_agent_config").select("account_id").eq("enabled", true);
  for (const cfg of configs ?? []) {
    const accountId = cfg.account_id as string;

    // Idempotencia diaria: si ya hay evento meteo de hoy para la cuenta, silencio.
    const { count: existing } = await supa.from("local_event")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("event_type", "weather_alert")
      .gte("starts_at", `${today}T00:00:00Z`).lte("starts_at", `${today}T23:59:59Z`);
    if ((existing ?? 0) > 0) { out.push({ account_id: accountId, skipped: "evento meteo de hoy ya existe" }); continue; }

    const { data: locs } = await supa.from("locations")
      .select("id, name, lat, lng")
      .eq("account_id", accountId).eq("active", true)
      .not("lat", "is", null).not("lng", "is", null);
    if (!locs?.length) { out.push({ account_id: accountId, skipped: "sin locales con coordenadas" }); continue; }

    // Pronóstico de HOY por local; nos quedamos con el peor caso de la cuenta
    let worstRain = 0; let worstHeat = -99; const detail: string[] = [];
    for (const l of locs) {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${l.lat}&longitude=${l.lng}` +
          `&daily=precipitation_probability_max,temperature_2m_max&timezone=Europe%2FMadrid&forecast_days=1`;
        const r = await fetch(url);
        if (!r.ok) { detail.push(`${l.name}: HTTP ${r.status}`); continue; }
        const j = await r.json();
        const rain = Number(j?.daily?.precipitation_probability_max?.[0] ?? 0);
        const heat = Number(j?.daily?.temperature_2m_max?.[0] ?? -99);
        detail.push(`${l.name}: lluvia ${rain}% · máx ${heat}°C`);
        if (rain > worstRain) worstRain = rain;
        if (heat > worstHeat) worstHeat = heat;
      } catch (e) {
        detail.push(`${l.name}: ${String((e as Error).message).slice(0, 80)}`);
      }
    }

    const reasons: string[] = [];
    if (worstRain >= RAIN_PROB_MIN) reasons.push(`lluvia prevista (${worstRain}% prob.)`);
    if (worstHeat >= HEAT_MAX_MIN) reasons.push(`calor extremo (máx ${worstHeat}°C)`);

    if (reasons.length === 0) {
      out.push({ account_id: accountId, event: null, forecast: detail });
      continue; // día normal => silencio (cero falsas alarmas)
    }

    const { error } = await supa.from("local_event").insert({
      account_id: accountId,
      name: `Meteo: ${reasons.join(" + ")} — delivery al alza (Open-Meteo)`,
      event_type: "weather_alert", // el CHECK de local_event exige weather_alert
      starts_at: `${today}T10:00:00Z`,
      ends_at: `${today}T23:59:00Z`,
      demand_effect: "up",
    });
    out.push({ account_id: accountId, event: reasons.join(" + "), forecast: detail, error: error?.message ?? null });
  }

  return Response.json({ ok: true, date: today, results: out });
});
