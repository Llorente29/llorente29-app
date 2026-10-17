// futbol-partidos — los partidos del Real Madrid de football-data.org, para la
// predicción de personal (src/services/enrichment.ts).
//
// W02 (17/10). El token de football-data.org iba escrito en el front: viajaba
// en el bundle a cualquiera que abriera la web. Ahora vive aquí, en el secreto
// de la función FOOTBALL_DATA_TOKEN, y el front llama a esta función con su
// sesión (verify_jwt = true en config.toml).
//
//   POST { dateFrom: 'YYYY-MM-DD', dateTo: 'YYYY-MM-DD' }
//   → 200 { ok: true, matches: [{ competition, utcDate, home, away, stage }] }
//   → 200 { ok: false, error } si falta el token o football-data falla: la
//     predicción sigue sin partidos, como hacía el front cuando fallaba.
//
// Solo devuelve lo que el front usaba (fecha, equipos, fase, competición).

import { corsHeaders } from "../_shared/cors.ts";

const TOKEN = Deno.env.get("FOOTBALL_DATA_TOKEN") ?? "";
const REAL_MADRID_ID = 86;
const COMPETICIONES = ["PD", "CL", "CDR"]; // LaLiga, Champions, Copa del Rey
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "solo POST" });

  let body: { dateFrom?: unknown; dateTo?: unknown };
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "cuerpo no es JSON" }); }
  const { dateFrom, dateTo } = body;
  if (typeof dateFrom !== "string" || typeof dateTo !== "string" || !FECHA.test(dateFrom) || !FECHA.test(dateTo)) {
    return json(400, { ok: false, error: "dateFrom y dateTo tienen que ser YYYY-MM-DD" });
  }
  if (!TOKEN) return json(200, { ok: false, error: "falta el secreto FOOTBALL_DATA_TOKEN" });

  const matches: { competition: string; utcDate: string; home: string; away: string; stage: string | null }[] = [];
  const fallos: string[] = [];
  for (const comp of COMPETICIONES) {
    const url = `https://api.football-data.org/v4/teams/${REAL_MADRID_ID}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&competitions=${comp}`;
    try {
      const res = await fetch(url, { headers: { "X-Auth-Token": TOKEN } });
      if (!res.ok) { fallos.push(`${comp}: ${res.status}`); continue; }
      const data = await res.json();
      // deno-lint-ignore no-explicit-any
      for (const m of (data.matches ?? []) as any[]) {
        if (!m?.utcDate) continue;
        matches.push({ competition: comp, utcDate: m.utcDate, home: m.homeTeam?.name ?? "", away: m.awayTeam?.name ?? "", stage: m.stage ?? null });
      }
    } catch (e) {
      fallos.push(`${comp}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (fallos.length) console.log("FUTBOL_PARTIDOS_FALLOS", fallos);
  return json(200, { ok: true, matches, fallos });
});
