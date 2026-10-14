// supabase/functions/conta-diez-enviar/index.ts
//
// C04b · R15 · «Validar y enviar a Diez»: envía a Diez un asiento de ventas ya
// VALIDADO, con su documento. Lo llama el Libro, con la sesión de quien pulsa,
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
// verify_jwt = true (config.toml): sin sesión no hay nada que hacer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { ClienteDiez, type AlmacenToken } from "../_shared/diezCliente.ts";
import { correspondenciaDeEmpresa } from "../_shared/diezAnalitica.ts";
import { autorizacionCubre, enviarAsientoADiez, enviarContraasientoADiez, type Autorizacion, type ConexionDiez, type ContraasientoBD, type EnvioFila, type PuertoEnvio } from "../_shared/diezEnviar.ts";
import type { ResumenBD } from "../_shared/resumenDeAsiento.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "conta-documentos";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "usa POST" }, 405);

  const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "no autenticado" }, 401);

  let entryId = "";
  try { const b = await req.json() as { entry_id?: unknown }; entryId = typeof b.entry_id === "string" ? b.entry_id : ""; } catch { /* vacío */ }
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) return json({ error: "falta entry_id" }, 400);

  // C06b R8: ¿es el contraasiento de una anulación? Entonces se manda la factura
  // que anula la de lo anulado (enviarContraasientoADiez), y el resumen es el
  // de lo anulado. Leído con los permisos de quien llama (si no es suyo, no está).
  const { data: je, error: e0 } = await sb.from("journal_entry")
    .select("id, account_id, company_id, status, entry_date, source_type, reverses_entry_id, number").eq("id", entryId).maybeSingle();
  if (e0) return json({ estado: "no_llega", motivo: e0.message, reintentar: true, texto: `No ha llegado a Diez: ${e0.message}` }, 400);
  if (!je) return json({ estado: "no_llega", motivo: "ese asiento no está", reintentar: false, texto: "No ha llegado a Diez: ese asiento no está." }, 404);
  const contra: ContraasientoBD | null = je.source_type === "reversal"
    ? { id: je.id, account_id: je.account_id, company_id: je.company_id, estado: je.status, fecha: String(je.entry_date), origen: je.source_type, anula: je.reverses_entry_id, numero: je.number }
    : null;

  // El asiento (o, para un contraasiento, lo que anula), con los permisos de quien llama.
  const { data: resumen, error: e1 } = await sb.rpc("conta_resumen_ventas", { p_entry: contra?.anula ?? entryId });
  if (e1) return json({ estado: "no_llega", motivo: e1.message, reintentar: false, texto: `No ha llegado a Diez: ${e1.message}` }, e1.code === "P0002" ? 404 : 400);
  const r = resumen as ResumenBD;
  const { data: puede } = await sb.rpc("current_user_is_admin_or_manager_of", { p_account_id: r.account_id });
  if (puede !== true) return json({ error: "Solo un administrador o un encargado de la cuenta envía a Diez." }, 403);

  const srv = createClient(SUPABASE_URL, SERVICIO, { auth: { persistSession: false } });
  const puerto: PuertoEnvio = {
    resumen: async (id) => {
      if (id === r.id) return r;
      const { data, error } = await sb.rpc("conta_resumen_ventas", { p_entry: id });
      if (error) throw new Error(error.message);
      return data as ResumenBD;
    },
    envio: async (id) => {
      const { data, error } = await srv.from("external_send").select("*").eq("entry_id", id).eq("account_id", r.account_id).neq("status", "rechazado").maybeSingle();
      if (error) throw new Error(`no se ha podido leer el envío: ${error.message}`);
      return data as EnvioFila | null;
    },
    guardar: async (f) => {
      const { id, ...resto } = f as EnvioFila & { created_at?: string; updated_at?: string };
      delete (resto as Record<string, unknown>).created_at;
      const fila = { ...resto, updated_at: new Date().toISOString() };
      const q = id ? srv.from("external_send").update(fila).eq("id", id).eq("account_id", r.account_id) : srv.from("external_send").insert(fila);
      const { data, error } = await q.select("*").single();
      if (error) throw new Error(`no se ha podido apuntar el envío: ${error.message}`);
      return data as EnvioFila;
    },
    conexion: async (companyId) => {
      const { data, error } = await srv.from("account_connector")
        .select("id, external_account_id, config, status, connector!inner(code)")
        .eq("account_id", r.account_id).eq("company_id", companyId).eq("scope", "company").eq("connector.code", "diez").eq("status", "connected").maybeSingle();
      if (error) throw new Error(`no se ha podido leer la conexión con Diez: ${error.message}`);
      if (!data) return null;
      const config = (data.config as Record<string, unknown> | null) ?? {};
      const bd = String(data.external_account_id ?? config.nombre_bd ?? "");
      return bd ? { id: String(data.id), nombreBd: bd, adjuntar: config.adjuntar_documentos === true } : null;
    },
    autorizado: async (id, companyId, nombreBd, fecha) => {
      // R8 (tarea 1): «desde» (0730) limita la de empresa a los asientos desde ese día.
      const { data, error } = await srv.from("conta_diez_autorizo").select("id, alcance, entry_id, desde")
        .eq("account_id", r.account_id).eq("company_id", companyId).ilike("nombre_bd", nombreBd);
      if (error) throw new Error(`no se ha podido leer lo autorizado en Diez: ${error.message}`);
      return autorizacionCubre((data ?? []) as Autorizacion[], id, fecha);
    },
    cliente: async (c: ConexionDiez, o) => {
      const { data: s, error } = await srv.rpc("connector_secret_read", { p_account_connector_id: c.id });
      if (error || !s) throw new Error("la conexión con Diez no tiene credenciales guardadas");
      const sec = (s as { secrets: Record<string, string>; config: Record<string, unknown> }).secrets;
      const cfg = (s as { config: Record<string, unknown> }).config ?? {};
      const almacen: AlmacenToken = {
        leer: async () => {
          const { data } = await srv.rpc("connector_token_read", { p_account_connector_id: c.id });
          const t = data as { token: string; expires_at: string } | null;
          return t ? { token: t.token, expiresAt: t.expires_at } : null;
        },
        guardar: async (token, expiresAt) => { await srv.rpc("connector_token_save", { p_account_connector_id: c.id, p_token: token, p_expires_at: expiresAt }); },
        caida: async (motivo) => { await srv.rpc("connector_mark_down", { p_account_connector_id: c.id, p_error: motivo }); },
      };
      // escribirEnReal solo con autorización de Julio (el núcleo ya lo ha mirado).
      return new ClienteDiez({
        base: String(cfg.base_url ?? "https://apicon.diezsoftware.com"), nombreBd: c.nombreBd,
        credenciales: { grant_type: sec.grant_type, client_id: sec.client_id, client_secret: sec.client_secret, username: sec.username, password: sec.password },
        almacen, escribir: true, escribirEnReal: o.real, pausaMs: 150,
      });
    },
    documento: async (ruta) => {
      if (!ruta.startsWith(`${r.account_id}/${r.id}/`)) throw new Error("la ruta del documento no es la de este asiento");
      const { data, error } = await srv.storage.from(BUCKET).download(ruta);
      if (error || !data) throw new Error(`no se ha podido leer el documento guardado: ${error?.message ?? "vacío"}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    sha256: async (b) => hex(await crypto.subtle.digest("SHA-256", b)),
    correspondencia: (companyId) => correspondenciaDeEmpresa(companyId),
    ahora: () => new Date(),
  };

  try {
    return json(contra ? await enviarContraasientoADiez(contra, puerto) : await enviarAsientoADiez(entryId, puerto));
  } catch (x) {
    const motivo = x instanceof Error ? x.message : String(x);
    return json({ estado: "no_llega", motivo, reintentar: true, texto: `No ha llegado a Diez: ${motivo}.` }, 500);
  }
});
