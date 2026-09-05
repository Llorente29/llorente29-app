// supabase/functions/order-evidence-purge/index.ts
//
// C9 · Lote 2 §5 (04/09/2026). La purga: lo que hace verdad photo_retention_days.
// ============================================================================
// «Una columna de retencion que no purga es una mentira con nombre de columna»
// (regla F12). Esto es lo que la cumple.
//
// POR QUE AQUI Y NO EN SQL. La primera version borraba desde plpgsql con pg_net
// y sacaba la clave de Vault. Dos problemas: `project_url` y `service_role_key`
// NO EXISTEN en el Vault de este proyecto (comprobado, hay 14 secretos y no
// estan), asi que habria fallado en la primera ejecucion nocturna; y la salida
// facil -- meterlos -- era dejar una llave maestra en un sitio nuevo solo para
// poder borrar ficheros. Una edge function ya tiene SUPABASE_SERVICE_ROLE_KEY
// en su entorno: ninguna llave nueva en ningun sitio nuevo.
//
// CUENTA LO QUE BORRA, Y TAMBIEN LO QUE NO. El encargo pide que diga cuantas
// borro. Se dicen ademas las dos formas de que una foto se quede para siempre
// sin que nadie se entere: retenida por una reclamacion abierta, o de una
// cuenta sin plazo definido. Un contador que solo dice «0 borradas» en verde no
// distingue «no habia nada» de «no pude» (regla 7).
//
// SIN PLAZO NO SE PURGA, igual que sin plazo no se captura: si nadie ha decidido
// cuantos dias se guarda, esta funcion no se lo inventa.
//
// Deploy: POR CI, nunca por MCP (regla 22).

import { createClient } from "@supabase/supabase-js";

const BUCKET = "order-evidence";
const LOTE = 500;

function json(cuerpo: unknown, status: number): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  // La despierta el cron con el mismo secreto que a los demas vigias.
  const esperado = Deno.env.get("CRON_SECRET") ?? "";
  const dado = req.headers.get("x-cron-secret") ?? "";
  if (!esperado || dado !== esperado) return json({ ok: false, error: "no_autorizado" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { data: aPurgar, error: eLista } = await sb.rpc("capturas_a_purgar", { p_limite: LOTE });
  if (eLista) {
    console.error("order-evidence-purge: no se pudo listar", eLista.message);
    return json({ ok: false, error: "listado_fallido", detalle: eLista.message }, 500);
  }

  const filas = (aPurgar ?? []) as Array<{ id: string; image_path: string }>;
  let borradas = 0;
  let fallos = 0;

  if (filas.length > 0) {
    // Se borra en bloque y SOLO se sellan las que el bucket confirma borradas.
    // Sellar antes de borrar dejaria filas diciendo «purgada» con el fichero
    // todavia dentro, que es exactamente la mentira que este lote persigue.
    const rutas = filas.map((f) => f.image_path);
    const { data: quitadas, error: eDel } = await sb.storage.from(BUCKET).remove(rutas);
    if (eDel) {
      console.error("order-evidence-purge: borrado fallido", eDel.message);
      return json({ ok: false, error: "borrado_fallido", detalle: eDel.message }, 500);
    }
    const okRutas = new Set((quitadas ?? []).map((o: { name: string }) => o.name));
    const idsOk = filas.filter((f) => okRutas.has(f.image_path)).map((f) => f.id);
    fallos = filas.length - idsOk.length;

    if (idsOk.length > 0) {
      const { data: n, error: eMarca } = await sb.rpc("marcar_capturas_purgadas", { p_ids: idsOk });
      if (eMarca) {
        // Objetos borrados y filas sin sellar: se reintentaria el borrado de algo
        // que ya no esta. Es recuperable, pero hay que verlo.
        console.error("order-evidence-purge: objetos borrados pero filas SIN sellar", eMarca.message);
        return json({ ok: false, error: "marcado_fallido", borrados_sin_sellar: idsOk.length }, 500);
      }
      borradas = Number(n ?? 0);
    }
  }

  const { data: estado } = await sb.rpc("capturas_estado_purga");

  console.log(`order-evidence-purge: ${borradas} borradas, ${fallos} fallos`, estado);
  return json({ ok: true, borradas, fallos, estado }, 200);
});
