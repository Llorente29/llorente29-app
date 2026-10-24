// supabase/functions/conta-diez-enviar/index.ts
//
// C04b · R15 · «Validar y enviar a Diez»: envía a Diez un asiento de ventas ya
// VALIDADO, con su documento. D01: también una factura recibida, a la serie 2
// (enviarRecibidaADiez), con los mismos frenos. Lo llama el Libro, con la sesión de quien pulsa,
// después de validar y de guardar el PDF.
//
// Todo lo que decide está en _shared/diezEnviar.ts (probado freno a freno en
// tests/conta/diez/enviar.test.ts). Aquí solo se pone el mundo:
//   · el asiento se lee CON EL JWT DE QUIEN LLAMA (conta_resumen_ventas: si no
//     es de su cuenta, no está), y tiene que ser administrador o encargado;
//   · external_send, la conexión, el Vault y el bucket, con la clave de
//     servicio (escribir en external_send es solo del servidor);
//   · el cliente de Diez con escribir: sí, y escribirEnReal SOLO con lo que
//     Julio autoriza en la base (C06b R7: conta_diez_autorizo, un asiento o la
//     empresa en esa base; R8: la de empresa, desde su fecha «desde»). Sin
//     autorización, como en R15: nada en C0008.
//     C0001 está vetada en el propio cliente.
//   · si Diez guarda documentos lo dice la conexión
//     (config.adjuntar_documentos; hoy, apagado): sin él, la factura va sin
//     adjunto y queda «PDF pendiente en Diez».
//
// C06b · Respuesta 8: con el id de un CONTRAASIENTO (al anular algo que ya
// está en Diez, el Libro lo llama solo), manda a Diez la factura que anula la
// de lo anulado, con los mismos frenos (enviarContraasientoADiez).
//
// Contesta siempre 200 con el resultado en palabras («En Diez: 1/1801…» o «No
// ha llegado a Diez: <motivo>.»), salvo sesión (401), permiso (403) o un fallo
// propio (500, también en palabras): el Libro lo enseña tal cual (regla 8).
//
// 17/10 · Y todo fallo queda ESCRITO en su envío (external_send.last_error),
// no solo en la respuesta: el núcleo lo apunta (conRed, diezEnviar.ts) y, si
// aun así algo se escapa hasta aquí, esta función lo apunta también
// (apuntarFallo). El 1861 contestó 500 a los 6 s y su fila se quedó con «el
// envío empezó y no terminó», sin su porqué. Y cada fallo deja una línea en el
// registro de la función (console.error: el id del asiento; el porqué va a la
// base, porque puede llevar texto de Diez).
//
// C07 (Julio, 22/10) · Todo asiento validado, sea del tipo que sea: el banco,
// los manuales y las liquidaciones como asiento general, y sus contraasientos.
// El camino lo elige _shared/diezDespacho.ts, que comparte con conta-diez-cola
// (el servidor, que manda lo que se queda atrás). Con «Enviar a Diez» apagado
// en la empresa no se manda nada. Después de cada intento, la fila dice cuándo
// lo vuelve a intentar el servidor.
//
// verify_jwt = true (config.toml): sin sesión no hay nada que hacer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { despacharADiez } from "../_shared/diezDespacho.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);

  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "no autenticado" }, 401);

  let entryId = "";
  try { const b = await req.json() as { entry_id?: unknown }; entryId = typeof b.entry_id === "string" ? b.entry_id : ""; } catch { /* vacío */ }
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) return json({ error: "falta entry_id" }, 400);

  // El asiento, con los permisos de quien llama: si no es de su cuenta, no está.
  const { data: je, error: e0 } = await sb.from("journal_entry").select("id, account_id").eq("id", entryId).maybeSingle();
  if (e0) return json({ estado: "no_llega", motivo: e0.message, reintentar: true, texto: `No ha llegado a Diez: ${e0.message}` }, 400);
  if (!je) return json({ estado: "no_llega", motivo: "ese asiento no está", reintentar: false, texto: "No ha llegado a Diez: ese asiento no está." }, 404);
  const { data: puede } = await sb.rpc("current_user_is_admin_or_manager_of", { p_account_id: je.account_id });
  if (puede !== true) return json({ error: "Solo un administrador o un encargado de la cuenta envía a Diez." }, 403);

  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const r = await despacharADiez({ lector: sb, srv, entryId });
  // En el registro, solo el asiento y si llegó: el porqué va a la base (puede llevar texto de Diez).
  if (r.estado !== "en_diez") console.error(`conta-diez-enviar · ${entryId} · no ha llegado (apuntado en su envío)`);
  const cuerpo: Record<string, unknown> = { ...r };
  delete cuerpo.cabecera;
  return json(cuerpo);
});
