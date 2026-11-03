// supabase/functions/conta-justificante/index.ts
//
// B01 · Cola 1e · EL JUSTIFICANTE DE UN PAGO, fuera de Sumied (Julio, 02/11).
//
//   GET  ?c=<clave>   EL ENLACE PÚBLICO del WhatsApp, sin sesión. Solo con la
//                     clave entera (43 letras al azar, no se puede adivinar):
//                     el PDF del justificante y nada más (el IBAN ya va tapado
//                     salvo los 4 últimos). Pasados los 30 días: «Este
//                     justificante ha caducado; pídelo a quien te pagó».
//   POST {accion: "correo", justificante, para?}
//                     «Mandar al proveedor», con la sesión de quien pulsa
//                     (administrador o encargado de la cuenta). Al correo del
//                     proveedor, o al que se escriba. Con el freno de los
//                     correos con marca («justificante_pago», cerrado hasta que
//                     Julio lo abra), y en una cuenta de demo no sale nada.
//                     Contesta siempre { enviado, texto } en palabras (regla 8).
//
// verify_jwt = false (config.toml): el enlace público no lleva sesión; el POST
// comprueba la suya. En el registro no va la clave, ni un correo, ni un IBAN.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { cuentaPuedeSalir, EN_LA_DEMO } from "../_shared/puerta.ts";
import { CLAVE, correoValido, mandarJustificante, nombreJustificante, PIE_JUSTIFICANTE, type DatosJustificante } from "../_shared/justificantePago.ts";
import { BUCKET_JUSTIFICANTES } from "../_shared/justificanteServidor.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * Lo que no es el PDF (caducado o que no existe), en TEXTO PLANO: en su dominio,
 * Supabase no deja que una función sirva HTML (lo entrega como texto, para que
 * nadie se haga pasar por otro), y el proveedor vería las etiquetas. Medido en
 * la e2e 41586077241: el 404 llegaba, la página no.
 */
function aviso(titulo: string, texto: string, status: number) {
  return new Response(`${titulo}\n\n${texto}\n\n${PIE_JUSTIFICANTE}\n`, {
    status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });

  // ── El enlace público ─────────────────────────────────────────────────────
  if (req.method === "GET") {
    const clave = new URL(req.url).searchParams.get("c") ?? "";
    if (!CLAVE.test(clave)) return aviso("Este enlace no vale", "No es el enlace de ningún justificante. Pídelo a quien te pagó.", 404);
    const { data: j } = await srv.rpc("conta_justificante_publico", { p_clave: clave });
    if (!j) return aviso("Este enlace no vale", "No es el enlace de ningún justificante. Pídelo a quien te pagó.", 404);
    if (j.caducado) return aviso("Justificante caducado", "Este justificante ha caducado; pídelo a quien te pagó.", 410);
    const { data: pdf, error } = await srv.storage.from(BUCKET_JUSTIFICANTES).download(j.pdf_path);
    if (error || !pdf) {
      console.error("[conta-justificante] no se ha podido leer un PDF");
      return aviso("No se ha podido abrir", "El justificante no se ha podido abrir ahora mismo. Vuelve a probar en un rato.", 503);
    }
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nombreJustificante(j.numero)}"`,
        "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer",
      },
    });
  }
  if (req.method !== "POST") return json({ error: "usa GET o POST" }, 405);

  // ── «Mandar al proveedor» ─────────────────────────────────────────────────
  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "no autenticado" }, 401);
  let id = "", paraPedido: string | null = null, quien: string | null = null;
  try {
    const b = await req.json() as Record<string, unknown>;
    if (b.accion !== "correo") return json({ error: "No sé hacer eso." }, 400);
    id = typeof b.justificante === "string" ? b.justificante : "";
    paraPedido = b.para == null || b.para === "" ? null : correoValido(b.para) ?? "mal";
    quien = typeof b.quien === "string" ? b.quien.slice(0, 120) : null;
  } catch { /* vacío */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "falta el justificante" }, 400);
  if (paraPedido === "mal") return json({ enviado: false, texto: "No se ha mandado: ese correo no vale." }, 400);

  // Con la sesión de quien pulsa: si no es de su cuenta, no está.
  const { data: j } = await sb.from("conta_pago_justificante").select("id, account_id, salida_id").eq("id", id).maybeSingle();
  if (!j) return json({ enviado: false, texto: "No se ha mandado: ese justificante no está." }, 404);
  const { data: puede } = await sb.rpc("current_user_is_admin_or_manager_of", { p_account_id: j.account_id });
  if (puede !== true) return json({ error: "Solo un administrador o un encargado de la cuenta manda justificantes." }, 403);

  const { data: d } = await srv.rpc("conta_pago_justificante_datos", { p_salida: j.salida_id });
  const datos = d as DatosJustificante | null;
  if (!datos?.justificante) return json({ enviado: false, texto: "No se ha mandado: no se ha podido leer el justificante." }, 500);
  const para = paraPedido ?? correoValido(datos.proveedor.correo);
  const apuntar = (a: string | null, texto: string) => srv.rpc("conta_pago_justificante_correo", { p_id: id, p_a: a, p_texto: texto, p_quien: quien });
  if (!para) return json({ enviado: false, texto: `No se ha mandado: ${datos.proveedor.nombre} no tiene correo en su ficha. Ponlo en Proveedores › ${datos.proveedor.nombre} › Contactos.` });

  if (!(await cuentaPuedeSalir(srv, j.account_id))) {
    const texto = `Mandado el justificante a ${para}. ${EN_LA_DEMO}`;
    await apuntar(para, texto);
    return json({ enviado: true, demo: true, texto });
  }
  const { data: pdf, error } = await srv.storage.from(BUCKET_JUSTIFICANTES).download(datos.justificante.pdf_path);
  if (error || !pdf) return json({ enviado: false, texto: "No se ha mandado: no se ha podido leer el PDF del justificante." });
  const r = await mandarJustificante({
    fetch, resendKey: Deno.env.get("RESEND_API_KEY"), abiertos: Deno.env.get("CORREO_MARCA_ABIERTOS"), para, d: datos, pdf: new Uint8Array(await pdf.arrayBuffer()),
  });
  await apuntar(r.enviado ? para : null, r.texto);
  if (!r.enviado) console.log(`[conta-justificante] ${id.slice(0, 8)} sin mandar`);
  return json(r);
});
