// sports-events v2 — El "ojeador" deportivo del agente de ofertas (frente #3).
// Gemelo de weather-events. Corre 1 vez/día (pg_cron) y siembra local_event (demand_effect
// 'up', event_type 'sports') según los partidos de HOY:
//   · COMPETICIONES NACIONALES (Mundial, Champions, Eurocopa) -> evento DE CUENTA
//     (location_id null): mueven delivery en TODO el país. Si juega España, se resalta.
//   · LIGA / SEGUNDA -> evento POR CIUDAD DEL LOCAL (la ciudad del equipo la da la API,
//     venue.city). Cuenta la ciudad del local Y la del visitante (ambas aficiones ven
//     el partido en casa) -> un equipo jugando fuera empuja igual su ciudad.
//
// GENÉRICO PARA TODA ESPAÑA (no hardcodea Madrid). Fuente: API-Football v3. Key en el Vault.
// IDEMPOTENTE: 1 evento nacional/cuenta/día + 1 evento de liga/local/día.
// DESPLIEGUE: SIEMPRE --no-verify-jwt. Todo en try/catch -> el error va en el JSON.

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("OFFERS_AGENT_SECRET")!;
const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const API = "https://v3.football.api-sports.io";
const CITY_LEAGUES = [140, 141];          // LaLiga, Segunda -> por ciudad
const NATIONAL_LEAGUES: Record<number, string> = { 1: "Mundial", 2: "Champions", 4: "Eurocopa" };

function seasonNow(): number {
  const d = new Date();
  return (d.getUTCMonth() + 1) >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}
const norm = (s: string) => (s ?? "").trim().toLowerCase();
const isSpain = (n: string) => /spain|españa|espana/i.test(n ?? "");

Deno.serve(async (req) => {
  if (req.headers.get("x-agent-secret") !== AGENT_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const { data: keyRow, error: keyErr } = await supa.rpc("read_apifootball_key");
    if (keyErr) return Response.json({ ok: false, stage: "read_key", error: keyErr.message }, { status: 200 });
    const KEY = (keyRow as string | null) ?? "";
    if (!KEY) return Response.json({ ok: false, stage: "read_key", error: "sin API key en el Vault" }, { status: 200 });

    const H = { headers: { "x-apisports-key": KEY } };
    const season = seasonNow();
    // Fecha de HOY en Madrid, robusta en el runtime del Edge (en-CA da YYYY-MM-DD directo).
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const diag: Record<string, unknown> = { date: today, season };

    // Bootstrap ciudad de equipos (LaLiga/Segunda) si la tabla está casi vacía.
    const { count: teamCount } = await supa.from("football_team_city").select("team_id", { count: "exact", head: true });
    let bootstrapped = 0;
    if ((teamCount ?? 0) < 20) {
      for (const lg of CITY_LEAGUES) {
        const r = await fetch(`${API}/teams?league=${lg}&season=${season}`, H);
        const j = await r.json();
        const rows = (j?.response ?? []).map((t: any) => ({
          team_id: t.team?.id, team_name: t.team?.name, city: t.venue?.city ?? null,
          league: lg === 140 ? "LaLiga" : "Segunda", updated_at: new Date().toISOString(),
        })).filter((x: any) => x.team_id);
        if (rows.length) { await supa.from("football_team_city").upsert(rows, { onConflict: "team_id" }); bootstrapped += rows.length; }
      }
    }
    diag.bootstrapped = bootstrapped;

    // COMPETICIONES NACIONALES: ¿hay partido hoy? -> evento de cuenta.
    const nationalLabels: string[] = [];
    let spainPlays = false;
    for (const [lgId, lgName] of Object.entries(NATIONAL_LEAGUES)) {
      const r = await fetch(`${API}/fixtures?league=${lgId}&season=${season}&date=${today}`, H);
      const j = await r.json();
      for (const f of (j?.response ?? []) as Array<any>) {
        const h = f.teams?.home?.name ?? "?", a = f.teams?.away?.name ?? "?";
        nationalLabels.push(`${lgName}: ${h} - ${a}`);
        if (isSpain(h) || isSpain(a)) spainPlays = true;
      }
    }
    diag.national = nationalLabels;

    // LIGA/SEGUNDA: partidos de hoy por ciudad (local + visitante).
    const { data: teams } = await supa.from("football_team_city").select("team_id, city");
    const cityOf = new Map<number, string>();
    for (const t of (teams ?? []) as Array<any>) if (t.city) cityOf.set(t.team_id, t.city);

    const cityMatches = new Map<string, string[]>();
    for (const lg of CITY_LEAGUES) {
      const r = await fetch(`${API}/fixtures?league=${lg}&season=${season}&date=${today}`, H);
      const j = await r.json();
      for (const f of (j?.response ?? []) as Array<any>) {
        const home = f.teams?.home, away = f.teams?.away;
        const label = `${home?.name ?? "?"} - ${away?.name ?? "?"}`;
        for (const id of [home?.id, away?.id]) {
          const c = id ? cityOf.get(id) : null; if (!c) continue;
          const k = norm(c); const arr = cityMatches.get(k) ?? [];
          if (!arr.includes(label)) arr.push(label); cityMatches.set(k, arr);
        }
      }
    }
    diag.cities = [...cityMatches.keys()];

    const out: Array<Record<string, unknown>> = [];
    const { data: configs } = await supa.from("offers_agent_config").select("account_id").eq("enabled", true);

    for (const cfg of (configs ?? []) as Array<any>) {
      const accountId = cfg.account_id as string;

      // (1) Evento NACIONAL de cuenta (location_id null), idempotente por cuenta/día.
      if (nationalLabels.length > 0) {
        const { count: exN } = await supa.from("local_event")
          .select("id", { count: "exact", head: true })
          .eq("account_id", accountId).is("location_id", null).eq("event_type", "sports")
          .gte("starts_at", `${today}T00:00:00Z`).lte("starts_at", `${today}T23:59:59Z`);
        if ((exN ?? 0) === 0) {
          const nm = `${spainPlays ? "JUEGA ESPAÑA — " : "Fútbol hoy — "}${nationalLabels.join(" · ")} — delivery al alza`;
          const { error } = await supa.from("local_event").insert({
            account_id: accountId, location_id: null, name: nm, event_type: "sports",
            starts_at: `${today}T12:00:00Z`, ends_at: `${today}T23:59:00Z`, demand_effect: "up",
          });
          out.push({ account_id: accountId, scope: "nacional", spainPlays, matches: nationalLabels, error: error?.message ?? null });
        }
      }

      // (2) Eventos de LIGA por local cuya ciudad tenga partido.
      if (cityMatches.size > 0) {
        const { data: locs } = await supa.from("locations")
          .select("id, name, city").eq("account_id", accountId).eq("active", true).not("city", "is", null);
        for (const l of (locs ?? []) as Array<any>) {
          const matches = cityMatches.get(norm(l.city)); if (!matches?.length) continue;
          const { count: exL } = await supa.from("local_event")
            .select("id", { count: "exact", head: true })
            .eq("account_id", accountId).eq("location_id", l.id).eq("event_type", "sports")
            .gte("starts_at", `${today}T00:00:00Z`).lte("starts_at", `${today}T23:59:59Z`);
          if ((exL ?? 0) > 0) continue;
          const { error } = await supa.from("local_event").insert({
            account_id: accountId, location_id: l.id,
            name: `Fútbol en ${l.city}: ${matches.join(", ")} — delivery al alza`,
            event_type: "sports", starts_at: `${today}T12:00:00Z`, ends_at: `${today}T23:59:00Z`, demand_effect: "up",
          });
          out.push({ account_id: accountId, scope: "ciudad", local: l.name, city: l.city, matches, error: error?.message ?? null });
        }
      }
    }

    return Response.json({ ok: true, ...diag, results: out });
  } catch (e) {
    return Response.json({ ok: false, crash: String((e as Error)?.message ?? e), stack: String((e as Error)?.stack ?? "").slice(0, 500) }, { status: 200 });
  }
});
