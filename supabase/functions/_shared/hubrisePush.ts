// supabase/functions/_shared/hubrisePush.ts
//
// EMPUJE DE ESTADO A HUBRISE — helper compartido.
// ============================================================================
// Único lugar donde se construye el PUT /location/orders/:id a HubRise. Lo usan:
//   - hubrise-order-status (Edge de SALIDA, lo llama la app con sesión).
//   - hubrise-webhook (la rama de AUTO-ACEPTACIÓN, en la frontera de entrada).
// Así el contrato con HubRise (cabecera X-Access-Token, base de API, forma del
// body) vive en UN sitio y no se duplica.
//
// AUTENTICACIÓN HubRise (verificado contra developers/api/authentication):
//   cabecera "X-Access-Token: <token>" (NO Bearer). El token es POR LOCATION
//   (HubRise emite un token por cliente×location).
//
// DEUDA DECLARADA (P-A / CP2): el token multi-location = tabla hubrise_integration.
//   Hoy un único Secret HUBRISE_ACCESS_TOKEN cubre la location de pruebas. La firma
//   de pushOrderStatus admite un accessToken explícito para, cuando exista la tabla,
//   resolver el token por location sin reescribir el helper.

const HUBRISE_API_BASE = Deno.env.get("HUBRISE_API_BASE") ?? "https://api.hubrise.com/v1";
const HUBRISE_ACCESS_TOKEN_ENV = Deno.env.get("HUBRISE_ACCESS_TOKEN") ?? "";

// Estados que el EPOS PUEDE enviar a HubRise. Coincide con el SENDABLE del Edge de
// salida (no 'new' inicial; no 'awaiting_shipment', que HubRise marca deprecado en
// salida aunque el CHECK local lo admita en entrada).
export const HUBRISE_SENDABLE = new Set<string>([
  "received", "accepted", "in_preparation", "awaiting_collection",
  "in_delivery", "completed", "rejected", "cancelled",
]);

export type HubrisePushResult =
  | { ok: true; status: number }
  | { ok: false; status: number; error: string };

/**
 * Empuja un estado de pedido a HubRise. NO toca la BBDD: solo habla con HubRise.
 * El llamador decide si espeja `order_status` en función del resultado.
 *
 * @param externalRef  id del pedido en HubRise (sale.external_ref).
 * @param status       estado canónico a enviar (debe estar en HUBRISE_SENDABLE).
 * @param opts.confirmedTime  hora prometida (ISO) opcional.
 * @param opts.accessToken    token por location; si se omite, usa el Secret de entorno.
 */
export async function pushOrderStatus(
  externalRef: string,
  status: string,
  opts?: { confirmedTime?: string | null; accessToken?: string | null },
): Promise<HubrisePushResult> {
  const token = (opts?.accessToken ?? "").trim() || HUBRISE_ACCESS_TOKEN_ENV;
  if (!token) return { ok: false, status: 0, error: "HUBRISE_ACCESS_TOKEN no configurado" };
  if (!externalRef) return { ok: false, status: 0, error: "Falta external_ref" };
  if (!HUBRISE_SENDABLE.has(status)) {
    return { ok: false, status: 0, error: `Estado no enviable a HubRise: ${status}` };
  }

  const body: Record<string, unknown> = { status };
  if (opts?.confirmedTime) body["confirmed_time"] = opts.confirmedTime;

  const url = `${HUBRISE_API_BASE}/location/orders/${encodeURIComponent(externalRef)}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "PUT",
      headers: { "X-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, status: 0, error: `red HubRise: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, error: text.slice(0, 500) || `HTTP ${resp.status}` };
  }
  return { ok: true, status: resp.status };
}
