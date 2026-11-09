// supabase/functions/conta-venta-correo/index.ts
//
// V01 · Entrega 1 · «Enviar por correo» una factura de venta ya emitida, con
// su PDF adjunto. Lo llama la ficha (al emitir, si se ha marcado, y con
// «Enviar de nuevo»), con la sesión de quien pulsa.
//
//   · la factura y la empresa se leen CON EL JWT DE QUIEN LLAMA (si no es de su
//     cuenta, no está), y tiene que ser administrador o encargado;
//   · el PDF se baja del almacén y el envío se apunta con la clave de servicio;
//   · sale de sumied.com con el nombre de la empresa, y las respuestas van al
//     correo de la empresa si lo tiene (_shared/facturaVentaCorreo.ts);
//   · EL FRENO: «factura_venta» está cerrado hasta que Julio lo abra en
//     CORREO_MARCA_ABIERTOS. El primer envío real, solo a su correo de prueba
//     («factura_venta:<correo>») y con su sí. Cerrado, no se manda nada y el
//     historial de la factura lo dice.
//
// Contesta siempre 200 con { enviado, texto } en palabras (regla 8), salvo
// sesión (401), permiso (403) o datos que faltan (400).
//
// verify_jwt = true (config.toml): sin sesión no hay nada que hacer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { correoValido } from "../_shared/facturaVentaCorreo.ts";
import { enviarFacturaVenta } from "../_shared/facturaVentaEnviar.ts";

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

  let id = "", para: string | null = null, quien: string | null = null;
  try {
    const b = await req.json() as { factura?: unknown; para?: unknown; quien?: unknown };
    id = typeof b.factura === "string" ? b.factura : "";
    para = correoValido(b.para);
    quien = typeof b.quien === "string" ? b.quien.slice(0, 120) : null;
  } catch { /* vacío */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "falta la factura" }, 400);
  if (!para) return json({ enviado: false, texto: "No se ha mandado: ese correo no vale." }, 400);

  const { data: f, error: e0 } = await sb.from("customer_invoice")
    .select("id, account_id, company_id, status, doc_type, number_text, issue_date, due_date, total, customer, pdf_path")
    .eq("id", id).maybeSingle();
  if (e0) return json({ enviado: false, texto: `No se ha mandado: ${e0.message}` }, 400);
  if (!f) return json({ enviado: false, texto: "No se ha mandado: esa factura no está." }, 404);
  const { data: puede } = await sb.rpc("current_user_is_admin_or_manager_of", { p_account_id: f.account_id });
  if (puede !== true) return json({ error: "Solo un administrador o un encargado de la cuenta manda facturas." }, 403);

  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  // G05 · T4 · El envío (la puerta de las demos, el freno, el correo y su apunte), en _shared/facturaVentaEnviar.ts:
  // el mismo que usa el envío solo al emitir una factura de un recibo.
  const r = await enviarFacturaVenta(srv, f, para, quien, {
    resendKey: Deno.env.get("RESEND_API_KEY"), buzonDePruebas: Deno.env.get("CORREO_BUZON_PRUEBAS"), abiertos: Deno.env.get("CORREO_MARCA_ABIERTOS"),
  });
  if (!r.enviado && r.texto === "No se ha mandado: el servicio de correo no está configurado.") return json(r, 500);
  return json(r);
});
