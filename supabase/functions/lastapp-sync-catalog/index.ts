// supabase/functions/lastapp-sync-catalog/index.ts
//
// ══ RETIRADA el 19/08/2026 ══════════════════════════════════════════════════
//
// USA `last-catalog-sync`. Esta función ya no hace nada: responde 410 y
// registra en consola quién la ha llamado.
//
// NO SE BORRA A PROPÓSITO. Si algo la sigue invocando, quiero que se VEA:
// borrarla haría que el llamador fallara en silencio (404 del gateway, sin
// pista de qué pedía ni por qué), y volveríamos justo a donde estábamos.
//
// ── Por qué se retira ──
//
// Había DOS sincronizadores escribiendo la misma tabla (external_catalog_product):
//
//   · `last-catalog-sync`  — la buena. La que corre el cron horario
//     (last-catalog-sync-hourly, 0 12-23 * * *, vía last_catalog_sync_dispatch()).
//     Lee cada catálogo POR LOCAL, y mantiene los sellos de antigüedad
//     (disabled_since / missing_since / last_synced_at).
//
//   · esta — no la llamaba nadie en automático, y tenía un defecto que
//     CORROMPE el dato: cacheaba los productos por id de catálogo, con el
//     comentario "el contenido del catálogo no cambia por ubicación". Es falso.
//     El mismo catálogo y el mismo producto, leídos con distinto locationID,
//     devuelven distinto `price` (comprobado: 1230 en Alcalá, 1399 en
//     Carabanchel, con el resto del nodo idéntico). Y `enabled` sale de ese
//     mismo nodo — que es el dato del 86 por local.
//
// El 19/08 se lanzó tres veces a mano para "refrescar el espejo". Calcó el
// estado de un local sobre los demás y dejó 35 filas marcadas como agotadas
// que en Last estaban a la venta. Se reparó con last-catalog-sync
// (reappeared: 35), al precio de perder el sello disabled_since de esas 35.
//
// Además nunca escribía last_synced_at, así que sus pasadas dejaban el espejo
// pareciendo rancio ante el watchdog aunque acabara de tocarlo.
//
// ── Comprobado antes de retirar (19/08) ──
//   cron.job              -> ninguna entrada la invoca
//   funciones de Postgres -> ninguna la menciona
//   frontend (src/)       -> ninguna llamada; el panel usa lastapp-catalog-import
//   otras Edge Functions  -> solo menciones en comentarios
//
// ── El código que hacía ──
// Vive en git, en el commit c84b610 y anteriores. Si hiciera falta recuperarlo:
//   git show c84b610:supabase/functions/lastapp-sync-catalog/index.ts
// ════════════════════════════════════════════════════════════════════════════

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Todo lo que ayude a identificar al llamador, sin volcar secretos.
  let cuerpo: unknown = null;
  try { cuerpo = await req.json(); } catch { /* puede no traer JSON */ }

  const pista = {
    metodo: req.method,
    user_agent: req.headers.get("user-agent"),
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
    trae_internal_key: req.headers.get("x-internal-key") !== null,
    trae_authorization: req.headers.get("authorization") !== null,
    cuerpo,
  };
  console.error("lastapp-sync-catalog RETIRADA: alguien la ha invocado ->", JSON.stringify(pista));

  return new Response(
    JSON.stringify({
      ok: false,
      error: "retirada, usar last-catalog-sync",
      retirada_el: "2026-08-19",
      usar_en_su_lugar: "last-catalog-sync",
      motivo:
        "Cacheaba los productos por catalogo y calcaba el precio y el is_enabled " +
        "de un local sobre los demas. El 19/08 dejo 35 filas del espejo marcadas " +
        "como agotadas que en Last estaban a la venta.",
      equivalencia_de_parametros: {
        lastapp_organization_id: "external_org_id",
        nota: "last-catalog-sync ademas acepta location_id para acotar a un local",
      },
      quien_llama: pista,
    }, null, 2),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
