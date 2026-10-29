// supabase/functions/conta-diez-cola/index.ts
//
// C07 · Todo asiento de Sumied a Diez al momento (Julio, 22/10) · EL SERVIDOR
// MANDA LO QUE SE QUEDA ATRÁS. La despierta, cada minuto y solo si hay algo,
// conta_diez_despertar (cron conta-diez-despertar, con el cron_secret del
// Vault). Coge lo que le toca (conta_diez_reclamar: lo validado de las empresas
// con «Enviar a Diez» encendido que no está en Diez, apartado 10 minutos) y lo
// manda uno a uno por el mismo camino que la pantalla (_shared/diezDespacho.ts),
// con los mismos frenos. Cada uno queda en su fila con su motivo y su
// siguiente intento: nada se pierde en silencio.
//
// Sin sesión: verify_jwt = false (config.toml) y la cabecera x-cron-secret
// tiene que ser CRON_SECRET, como los demás vigías. Contesta cuántos ha
// cogido, cuántos han llegado y cuántos no (sin textos de Diez: esos van a la
// base). En el registro, solo recuentos y los ids que no llegan.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { despacharADiez } from "../_shared/diezDespacho.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/** Por pasada: Diez tarda unos segundos por asiento y la función tiene su tope. */
const POR_PASADA = 10;
/** Si se acerca el tope de la función, lo que quede lo coge la pasada siguiente (a los 10 minutos). */
const TOPE_MS = 110_000;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);
  const esperado = Deno.env.get("CRON_SECRET") ?? "";
  const dado = req.headers.get("x-cron-secret") ?? "";
  if (!esperado || dado !== esperado) return json({ error: "no autorizado" }, 401);

  const t0 = Date.now();
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const { data, error } = await srv.rpc("conta_diez_reclamar", { p_limite: POR_PASADA });
  if (error) {
    console.error(`conta-diez-cola · no se ha podido coger lo pendiente: ${error.message}`);
    return json({ error: "no se ha podido coger lo pendiente" }, 500);
  }
  const cogidos = (data ?? []) as { entry_id: string }[];
  let llegan = 0, no = 0, sinTiempo = 0;
  for (const c of cogidos) {
    if (Date.now() - t0 > TOPE_MS) { sinTiempo++; continue; }
    const r = await despacharADiez({ lector: srv, srv, entryId: c.entry_id });
    if (r.estado === "en_diez") llegan++;
    else { no++; console.error(`conta-diez-cola · ${c.entry_id} · no ha llegado (apuntado en su envío)`); }
  }
  console.log(`conta-diez-cola · cogidos ${cogidos.length} · en Diez ${llegan} · sin llegar ${no} · para la siguiente ${sinTiempo}`);
  return json({ cogidos: cogidos.length, en_diez: llegan, sin_llegar: no, para_la_siguiente: sinTiempo });
});
// W12: rama de prueba que no se fusiona (T13).
