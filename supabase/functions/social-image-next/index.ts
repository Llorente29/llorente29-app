// social-image-next — Entrega el siguiente borrador a componer (Tramo 1 · Op 2b)
// El worker residente pide trabajo aquí (no toca la BD). Llama a claim_next_image_job()
// con service_role, que coge atómico el siguiente 'N1-pendiente', lo marca 'N1-procesando'
// y devuelve lo necesario para componer (post, cuenta, foto héroe, plantilla, plato, % , anon).
// Frontera = x-agent-secret (OFFERS_AGENT_SECRET). DESPLIEGUE: --no-verify-jwt (lo llama el worker).

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("OFFERS_AGENT_SECRET")!;
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.headers.get("x-agent-secret") !== AGENT_SECRET) return new Response("forbidden", { status: 403 });
  const { data, error } = await supa.rpc("claim_next_image_job");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const job = (Array.isArray(data) && data.length) ? data[0] : null;
  return Response.json({ ok: true, job });
});
