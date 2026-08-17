// supabase/functions/_shared/hubriseCallback.ts
//
// Asegura el callback de HubRise para UN token -- GET, compara forma, POST
// SOLO si falta o no coincide. 2.6 (ENCARGO CODE, 15/08/2026): invocado
// SINCRONO desde el flujo de conexion (hubrise-oauth-callback, kind=location,
// al establecer o reconectar) -- NO por cron. El punto 2 del pre-audit de
// Antoine ("eliminar el polling GET /callback cada 5 min") se cerro con
// cron.unschedule(21); resucitar un cron que consulta callbacks periodicamente
// reabriria ese punto justo antes de pedirle que firme el 4. El registro se
// hace en los momentos concretos en que puede hacer falta -- conectar y
// reconectar -- no vigilando en bucle.
//
// Misma logica que hubrise-callback-ensure.ensureForToken (RECON, no
// asumido): verificado en vivo que el callback real de produccion en
// 1b6p8-0/Folvy coincide EXACTAMENTE con este shape (url=hubrise-webhook,
// events={order:[create,update]}) -- se replica el comportamiento
// certificado, no se inventa uno distinto. Extraida aqui para que el flujo
// de conexion sincrono y el barrido manual/opcional de hubrise-callback-ensure
// compartan una sola fuente de verdad del shape deseado (evita que ambos
// diverjan si WEBHOOK_URL o los eventos cambian algun dia).

const API_BASE = Deno.env.get("HUBRISE_API_BASE") ?? "https://api.hubrise.com/v1";
const WEBHOOK_URL = Deno.env.get("HUBRISE_WEBHOOK_URL") ??
  `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/hubrise-webhook`;
const DESIRED_EVENTS = { order: ["create", "update"] };

export type EnsureCallbackOutcome = "noop" | "registered" | "token_401" | "error";

function isOurs(cb: unknown): boolean {
  if (!cb || typeof cb !== "object") return false;
  const c = cb as Record<string, unknown>;
  const events = (c["events"] as Record<string, unknown> | undefined) ?? {};
  return c["url"] === WEBHOOK_URL && Array.isArray(events["order"]);
}

// Idempotente: no reescribe si ya esta registrado igual. Nunca lanza --
// devuelve el resultado, el llamador decide como reportarlo (nunca fallo mudo).
export async function ensureHubriseCallback(
  token: string,
): Promise<{ outcome: EnsureCallbackOutcome; status?: number }> {
  const headers = { "X-Access-Token": token, "Content-Type": "application/json" };

  let getResp: Response;
  try {
    getResp = await fetch(`${API_BASE}/callback`, { headers });
  } catch (e) {
    console.error("ensureHubriseCallback: GET /callback fallo", e);
    return { outcome: "error" };
  }
  if (getResp.status === 401) return { outcome: "token_401", status: 401 };

  const current = await getResp.json().catch(() => null);
  if (isOurs(current)) return { outcome: "noop" };

  let reg: Response;
  try {
    reg = await fetch(`${API_BASE}/callback`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: WEBHOOK_URL, events: DESIRED_EVENTS }),
    });
  } catch (e) {
    console.error("ensureHubriseCallback: POST /callback fallo", e);
    return { outcome: "error" };
  }
  if (!reg.ok) {
    const body = await reg.text().catch(() => "");
    console.error(`ensureHubriseCallback: registro fallo HTTP ${reg.status}: ${body.slice(0, 200)}`);
    return { outcome: "error", status: reg.status };
  }
  return { outcome: "registered" };
}
