// supabase/functions/_shared/hubrisePush.ts
//
// EMPUJE DE ESTADO A HUBRISE — helper compartido.
// ============================================================================
// Único lugar donde se construye el PATCH /location/orders/:id a HubRise. Lo usan:
//   - hubrise-order-status (Edge de SALIDA, lo llama la app con sesión).
//   - hubrise-webhook (la rama de AUTO-ACEPTACIÓN, en la frontera de entrada).
// Así el contrato con HubRise (cabecera X-Access-Token, base de API, forma del
// body) vive en UN sitio y no se duplica.
//
// AUTENTICACIÓN HubRise (verificado contra developers/api/authentication):
//   cabecera "X-Access-Token: <token>" (NO Bearer). El token es POR LOCATION
//   (HubRise emite un token por cliente×location).
//
// DEUDA P-A / CP2 — CERRADA el 27/08/2026.
//   El token es POR LOCATION y vive en external_integration (source='hubrise',
//   is_active, external_catalog_id is null). Los tres llamadores lo resuelven
//   con resolveHubriseToken y lo pasan en opts.accessToken.
//
//   Lo que costó tenerlo abierto: hubrise-webhook era el ÚNICO que no lo hacía,
//   así que el ack y la auto-aceptación usaban el Secret global — que apunta a
//   la location de PRUEBAS. HubRise respondía 404 "Order does not exist" al
//   100 % de los empujes (medido: 20 de 20 acks y 47 pushes en 23 h). Ningún
//   pedido se aceptaba desde Folvy; los que nadie aceptaba a mano en la
//   plataforma acababan cancelados.
//
//   El Secret se queda SOLO como red de compatibilidad, y su uso se registra:
//   si vuelve a haber 404, el log dirá en una línea que se cayó al Secret.

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
  const perLocation = (opts?.accessToken ?? "").trim();
  const token = perLocation || HUBRISE_ACCESS_TOKEN_ENV;
  if (!token) {
    return { ok: false, status: 0, error: "Sin token HubRise para esta location y sin Secret global" };
  }
  if (!perLocation) {
    // Que no vuelva a fallar en silencio: el Secret global no es el token de
    // ninguna location real, así que HubRise contestará 404 y hay que saberlo.
    console.error(
      `pushOrderStatus ${externalRef}: SIN token por location, usando el Secret global. ` +
      `Revisa external_integration (source=hubrise, is_active, external_catalog_id is null).`,
    );
  }
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
      // PATCH (no PUT): HubRise actualiza el estado del pedido con PATCH.
      // Verificado en la auditoría de integración HubRise. No revertir a PUT.
      method: "PATCH",
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
