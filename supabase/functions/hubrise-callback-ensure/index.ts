// hubrise-callback-ensure — AUTO-SANADOR del callback de HubRise.
// HubRise borra el callback de una conexión tras 6 entregas fallidas: si pasa,
// dejamos de recibir pedidos EN SILENCIO. Este cron comprueba y re-registra el
// callback si falta o apunta mal. Idempotente; solo habla con HubRise.
// Deploy: --no-verify-jwt (inocua; solo repone NUESTRO callback -> NUESTRO webhook).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API_BASE = Deno.env.get("HUBRISE_API_BASE") ?? "https://api.hubrise.com/v1";
const TOKEN = Deno.env.get("HUBRISE_ACCESS_TOKEN") ?? "";
const WEBHOOK_URL = Deno.env.get("HUBRISE_WEBHOOK_URL") ??
  `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/hubrise-webhook`;
const DESIRED_EVENTS = { order: ["create", "update"] };

function json(o: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isOurs(cb: unknown): boolean {
  if (!cb || typeof cb !== "object") return false;
  const c = cb as Record<string, unknown>;
  const events = (c["events"] as Record<string, unknown> | undefined) ?? {};
  return c["url"] === WEBHOOK_URL && Array.isArray(events["order"]);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!TOKEN) return json({ ok: false, error: "HUBRISE_ACCESS_TOKEN vacío" }, 500);

  const headers = { "X-Access-Token": TOKEN, "Content-Type": "application/json" };

  let getResp: Response;
  try {
    getResp = await fetch(`${API_BASE}/callback`, { headers });
  } catch (e) {
    console.error("hubrise-callback-ensure GET error", e);
    return json({ ok: false, error: `red HubRise: ${e}` }, 502);
  }
  if (getResp.status === 401) {
    console.error("hubrise-callback-ensure: token 401 -> re-autorizar OAuth (oob)");
    return json({ ok: false, error: "token 401: re-autorizar OAuth" }, 401);
  }
  const current = await getResp.json().catch(() => null);
  const list = Array.isArray(current) ? current : [current];

  if (list.some(isOurs)) return json({ ok: true, action: "noop" });

  const reg = await fetch(`${API_BASE}/callback`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: WEBHOOK_URL, events: DESIRED_EVENTS }),
  });
  const body = await reg.text();
  if (!reg.ok) {
    console.error(`hubrise-callback-ensure: re-registro falló HTTP ${reg.status}: ${body.slice(0, 200)}`);
    return json({ ok: false, action: "reregister-failed", status: reg.status }, 502);
  }
  console.error("hubrise-callback-ensure: CALLBACK AUSENTE -> re-registrado automáticamente");
  return json({ ok: true, action: "reregistered" });
});