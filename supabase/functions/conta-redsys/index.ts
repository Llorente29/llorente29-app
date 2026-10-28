// supabase/functions/conta-redsys/index.ts
//
// S01 · PR 1 · GUARDAR EL TPV VIRTUAL (Redsys) de una empresa para cobrar con
// tarjeta y Bizum desde el enlace de pago. Lo llama Ajustes › Cobros («Cómo te
// pagan») con la sesión de quien pulsa «Guardar cambios».
//
//   · Solo un administrador o un encargado de la cuenta.
//   · La clave del comercio va a la caja fuerte (Vault) por
//     conta_cobro_redsys_guardar; nunca vuelve a la pantalla. Sin clave nueva,
//     se queda la de antes.
//   · Si cobra, lo decide el servidor, no la pantalla: de verdad (sis) solo las
//     empresas que Julio ha pasado a real (REDSYS_COBRO_REAL, ids separados por
//     comas); en pruebas (sis-t) solo donde el entorno lo abre
//     (REDSYS_PRUEBAS=si: staging). En producción, una empresa sin pasar a real
//     guarda sus datos y queda «en pruebas»: no se le ofrece a nadie el enlace.
//
// Contesta 200 con { ok, texto, estado } en palabras (regla 8), salvo sesión
// (401) o permiso (403).
//
// verify_jwt = true (config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { claveValida, empresaEnReal } from "../_shared/redsysSumied.ts";

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

  let b: Record<string, unknown> = {};
  try { b = await req.json() as Record<string, unknown>; } catch { /* vacío */ }
  const empresa = typeof b.empresa === "string" ? b.empresa : "";
  if (!/^[0-9a-f-]{36}$/i.test(empresa)) return json({ error: "falta la empresa" }, 400);
  const comercio = typeof b.comercio === "string" ? b.comercio : "";
  const terminal = typeof b.terminal === "string" ? b.terminal : "1";
  const clave = typeof b.clave === "string" && b.clave.trim() ? b.clave.trim() : null;
  const meta = (u.user.user_metadata ?? {}) as Record<string, unknown>;
  const quien = (typeof b.quien === "string" && b.quien.trim() ? b.quien : String(meta.full_name ?? meta.name ?? u.user.email ?? "")).slice(0, 120) || null;
  if (clave && !claveValida(clave)) {
    return json({ ok: false, texto: "La clave del comercio son 32 letras y números (la «clave SHA-256» del TPV virtual, en el panel de tu banco)." });
  }

  const { data: co } = await sb.from("company").select("id, account_id").eq("id", empresa).maybeSingle();
  if (!co) return json({ ok: false, texto: "Esa empresa no está." }, 404);
  const { data: puede } = await sb.rpc("current_user_is_admin_or_manager_of", { p_account_id: co.account_id });
  if (puede !== true) return json({ error: "Solo un administrador o un encargado de la cuenta guarda cómo te pagan." }, 403);

  const real = empresaEnReal(Deno.env.get("REDSYS_COBRO_REAL"), empresa);
  const pruebasAbiertas = (Deno.env.get("REDSYS_PRUEBAS") ?? "").trim().toLowerCase() === "si";
  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const { data, error } = await srv.rpc("conta_cobro_redsys_guardar", {
    p_company: empresa, p_comercio: comercio, p_terminal: terminal, p_clave: clave, p_bizum: b.bizum === true, p_en_enlace: b.en_enlace !== false,
    p_modo: real ? "real" : "prueba", p_cobra: real || pruebasAbiertas, p_quien: quien,
  });
  if (error) return json({ ok: false, texto: `No se ha guardado: ${error.message}` });
  const d = data as { frase?: string; estado?: string; proveedor_enlace?: string | null };
  return json({ ok: true, texto: String(d.frase ?? "Guardado."), estado: d.estado ?? null, proveedor: d.proveedor_enlace ?? null });
});
